import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { ensureWeiboLoggedIn } from './weibo-session.mjs';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    weibo: { type: 'string' },
    xhs: { type: 'string' },
    image: { type: 'string', multiple: true },
    topic: { type: 'string', multiple: true },
    submit: { type: 'boolean', default: false },
    profile: { type: 'string' },
    host: { type: 'boolean', default: false },
    cdpp: { type: 'string' },
  },
  strict: true,
  allowPositionals: true,
});

const weiboText = values.weibo;
const xhsText = values.xhs;
const images = values.image || [];
const topics = values.topic || [];

if (!weiboText && !xhsText) {
  console.log('用法: node social-publisher.mjs [--weibo 微博内容] [--xhs 小红书内容] [--image 图片路径] [--submit] [--host] [--cdpp <url>]');
  process.exit(1);
}

function normalizeCDPEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const hasOnlyRootPath = !url.pathname || url.pathname === '/';
    if ((url.protocol === 'ws:' || url.protocol === 'wss:') && hasOnlyRootPath) {
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      return url.toString();
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

async function probeCDPEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if ((url.protocol === 'ws:' || url.protocol === 'wss:') && url.pathname.includes('/devtools/browser/')) {
      return { ok: true, detail: '完整 websocket 地址', wsUrl: endpoint };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const versionUrl = new URL('/json/version', url).toString();
      const resp = await fetch(versionUrl);
      if (!resp.ok) return { ok: false, detail: `探测 ${versionUrl} 返回 HTTP ${resp.status}` };
      const data = await resp.json();
      if (data.webSocketDebuggerUrl) return { ok: true, detail: '发现 DevTools 服务', wsUrl: data.webSocketDebuggerUrl };
      return { ok: false, detail: `${versionUrl} 未返回 webSocketDebuggerUrl` };
    }
    return { ok: true, detail: '跳过探测', wsUrl: endpoint };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function closeBrowserConnection(browser, { timeoutMs = 5000 } = {}) {
  if (!browser) return;

  try {
    await Promise.race([
      browser.close(),
      sleep(timeoutMs).then(() => {
        throw new Error(`浏览器连接收尾超时（>${timeoutMs}ms）`);
      }),
    ]);
  } catch (error) {
    console.warn(`⚠️ 浏览器连接收尾失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveBrowserExecutable() {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  if (process.platform === 'linux') {
    const candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  return undefined;
}

async function connectWithRetry(endpoint, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`🔌 第 ${i}/${attempts} 次连接 CDP...`);
      return await chromium.connectOverCDP(endpoint, { timeout: 90000 });
    } catch (error) {
      lastError = error;
      console.log(`⚠️ 第 ${i} 次连接失败: ${error instanceof Error ? error.message : String(error)}`);
      if (i < attempts) await sleep(3000 * i);
    }
  }
  throw lastError;
}

function getDefaultContext(browserOrContext) {
  if (typeof browserOrContext.contexts !== 'function') return browserOrContext;
  const context = browserOrContext.contexts()[0];
  if (!context) throw new Error('没有可用浏览器上下文，请先打开一个普通标签页');
  return context;
}

async function waitForWeiboComposerStable(page) {
  await page.waitForTimeout(2500);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);
}

async function waitForWeiboImagesReady(page, expectedCount) {
  const previewSelectors = [
    "img[src*='wx'], img[src*='sinaimg'], img[src*='weibo']",
    "[class*='upload'] img",
    "[class*='picture'] img",
    "[class*='image'] img",
  ];

  try {
    await page.waitForFunction((selectors, minCount) => {
      const count = selectors
        .flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 30 && rect.height > 30;
        }).length;
      return count >= minCount;
    }, previewSelectors, Math.min(expectedCount, 1), { timeout: 15000 });
  } catch {
    // 预览结构不稳定时容忍回退，只做额外等待
  }

  await page.waitForTimeout(expectedCount > 3 ? 4000 : 2500);
}

function hasWeiboVideoAsset(uploadImages) {
  const videoExts = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'];
  return uploadImages.some(file => {
    const lower = String(file || '').toLowerCase();
    return videoExts.some(ext => lower.endsWith(ext));
  });
}

function getWeiboPostUploadPauseMs(uploadImages) {
  if (uploadImages.length === 0) return 0;
  if (hasWeiboVideoAsset(uploadImages)) return 45000;
  return 15000;
}

async function markWeiboComposerContext(page, token) {
  const marked = await page.evaluate((marker) => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const isDisabledLike = el => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(el.className || ''));
    const textOf = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

    document.querySelectorAll('[data-openclaw-weibo-composer]').forEach(el => el.removeAttribute('data-openclaw-weibo-composer'));
    document.querySelectorAll('[data-openclaw-weibo-publish]').forEach(el => el.removeAttribute('data-openclaw-weibo-publish'));

    const composer = Array.from(document.querySelectorAll("textarea[placeholder*='有什么新鲜事'], div[contenteditable='true']")).find(isVisible) || null;
    if (!composer) return null;

    const composerRect = composer.getBoundingClientRect();
    const allButtons = Array.from(document.querySelectorAll('button')).filter(isVisible).filter(el => !isDisabledLike(el));
    const candidates = allButtons.map(el => {
      const text = textOf(el);
      if (!/发送|发布/.test(text)) return null;
      const rect = el.getBoundingClientRect();
      const dy = Math.abs(rect.y - composerRect.bottom);
      const dx = Math.abs(rect.x - (composerRect.x + composerRect.width));
      const score = dy + dx * 0.15;
      return { el, text, score };
    }).filter(Boolean).sort((a, b) => a.score - b.score);

    const target = candidates[0] || null;
    if (!target) return null;

    composer.setAttribute('data-openclaw-weibo-composer', marker);
    target.el.setAttribute('data-openclaw-weibo-publish', marker);

    return { text: target.text, score: Math.round(target.score) };
  }, token);

  if (!marked) {
    throw new Error('未找到可标记的发布框或发布按钮');
  }

  return marked;
}

async function clickMarkedWeiboPublishButton(page, token) {
  const clicked = await page.evaluate((marker) => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const isDisabledLike = el => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(el.className || ''));
    const button = document.querySelector(`[data-openclaw-weibo-publish="${marker}"]`);
    if (!button || !isVisible(button) || isDisabledLike(button)) return null;

    const text = (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim();
    button.click();
    return { text };
  }, token);

  if (!clicked) {
    throw new Error('未找到当前发布容器内可点击的发布按钮');
  }

  return clicked;
}

async function inspectWeiboPublishState(page, token, expectedText = '') {
  return await page.evaluate(({ marker, expected }) => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const isDisabledLike = el => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(el.className || ''));
    const textOf = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

    const markedComposer = document.querySelector(`[data-openclaw-weibo-composer="${marker}"]`);
    const markedButton = document.querySelector(`[data-openclaw-weibo-publish="${marker}"]`);

    let error = null;
    if (/验证码|安全验证|请完成验证|请先验证|拖动滑块|账号异常/.test(bodyText)) {
      error = '触发验证';
    } else if (/上传失败|发布失败|发送失败|网络异常|请稍后再试|内容审核未通过|内容无法发布/.test(bodyText)) {
      const matched = bodyText.match(/上传失败|发布失败|发送失败|网络异常|请稍后再试|内容审核未通过|内容无法发布/);
      error = matched ? matched[0] : '发布失败';
    }

    const success = /发布成功|发送成功|分享成功/.test(bodyText);

    const normalizedExpected = (expected || '').replace(/\s+/g, ' ').trim();
    const allowFeedCheck = normalizedExpected.length >= 6;
    const feedSelectors = ['article', '[mid]', '[action-type="feed_list_item"]', '.WB_cardwrap'];
    const feedMatched = allowFeedCheck && feedSelectors
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .some(el => textOf(el).includes(normalizedExpected));

    return {
      markedComposerFound: !!markedComposer,
      markedComposerVisible: isVisible(markedComposer),
      markedButtonFound: !!markedButton,
      markedButtonVisible: isVisible(markedButton),
      markedButtonClickable: isVisible(markedButton) && !isDisabledLike(markedButton),
      markedButtonDisabled: isVisible(markedButton) && isDisabledLike(markedButton),
      markedButtonText: textOf(markedButton),
      success,
      error,
      feedMatched,
      bodySnippet: bodyText.slice(0, 300),
    };
  }, { marker: token, expected: expectedText });
}

async function clickWeiboPublishUntilConfirmed(page, expectedText, timeoutMs = 300000, intervalMs = 3000) {
  const token = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await markWeiboComposerContext(page, token);

  const start = Date.now();
  let clickAttempts = 0;
  let pollAttempts = 0;
  let composerGoneChecksAfterClick = 0;
  let lastStateSummary = '尚未获取页面状态';

  while (Date.now() - start < timeoutMs) {
    pollAttempts += 1;
    const state = await inspectWeiboPublishState(page, token, expectedText);
    lastStateSummary = `markedComposerVisible=${state.markedComposerVisible}, markedButtonFound=${state.markedButtonFound}, markedButtonClickable=${state.markedButtonClickable}, markedButtonDisabled=${state.markedButtonDisabled}, markedButtonText=${state.markedButtonText || '(none)'}, feedMatched=${state.feedMatched}`;

    if (state.error) {
      throw new Error(state.error);
    }

    if (state.success) {
      console.log(`✅ [微博] 检测到成功提示，发布确认成功（轮询 ${pollAttempts} 次，点击 ${clickAttempts} 次）`);
      return { confirmed: true, reason: 'success-toast', clickAttempts, pollAttempts };
    }

    if (clickAttempts > 0 && state.feedMatched) {
      console.log(`✅ [微博] 已在页面信息流中匹配到目标文案，判定发布成功（轮询 ${pollAttempts} 次，点击 ${clickAttempts} 次）`);
      return { confirmed: true, reason: 'feed-matched', clickAttempts, pollAttempts };
    }

    if (clickAttempts > 0 && !state.markedComposerVisible) {
      composerGoneChecksAfterClick += 1;
      console.log(`ℹ️ [微博] 当前这次发布容器已消失，连续确认 ${composerGoneChecksAfterClick}/2`);
      if (composerGoneChecksAfterClick >= 2) {
        console.log(`✅ [微博] 当前这次发布容器在点击后持续消失，判定发布成功（轮询 ${pollAttempts} 次，点击 ${clickAttempts} 次）`);
        return { confirmed: true, reason: 'composer-disappeared', clickAttempts, pollAttempts };
      }
    } else {
      composerGoneChecksAfterClick = 0;
    }

    if (state.markedButtonClickable) {
      try {
        const clicked = await clickMarkedWeiboPublishButton(page, token);
        clickAttempts += 1;
        console.log(`🖱️ [微博] 第 ${clickAttempts} 次点击发布 (${clicked.text || '发布'})`);
      } catch (error) {
        console.log(`⚠️ [微博] 第 ${clickAttempts + 1} 次点击前检查失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (state.markedButtonDisabled) {
      console.log(`⏳ [微博] 当前这次发布容器内的发布按钮仍不可点，继续等待处理完成（第 ${pollAttempts} 轮）`);
    } else {
      console.log(`⏳ [微博] 当前这次发布容器内暂未找到可点击发布按钮，继续等待（第 ${pollAttempts} 轮）`);
    }

    await page.waitForTimeout(intervalMs);
  }

  throw new Error(`等待 ${Math.round(timeoutMs / 1000)} 秒后仍未确认发布成功；最后状态：${lastStateSummary}`);
}

async function publishWeibo(page, text, uploadImages, submit) {
  console.log('🌐 [微博] 访问微博...');
  await ensureWeiboLoggedIn(page, { taskName: '发微博' });

  const editBox = page.locator("textarea[placeholder*='有什么新鲜事'], div[contenteditable='true']").first();
  await editBox.waitFor({ state: 'visible', timeout: 15000 });
  await editBox.click();
  if (text) await editBox.fill(text);

  if (uploadImages.length > 0) {
    console.log(`📤 [微博] 上传 ${uploadImages.length} 个素材...`);
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(uploadImages, { timeout: 300000 });
    await waitForWeiboImagesReady(page, uploadImages.length);
    await waitForWeiboComposerStable(page);

    const postUploadPauseMs = getWeiboPostUploadPauseMs(uploadImages);
    if (postUploadPauseMs > 0) {
      console.log(`⏳ [微博] 素材已注入，固定等待 ${Math.round(postUploadPauseMs / 1000)} 秒，再开始尝试点击发布...`);
      await page.waitForTimeout(postUploadPauseMs);
    }
  }

  if (submit) {
    console.log('🔁 [微博] 开始持续尝试发布并确认结果（最长 300 秒，每 3 秒轮询）...');
    return await clickWeiboPublishUntilConfirmed(page, text, 300000, 3000);
  }

  return { confirmed: false, reason: 'preview-only', clickAttempts: 0, pollAttempts: 0 };
}

async function publishXiaohongshu(page, text, uploadImages, submit) {
  console.log('🌐 [小红书] 访问小红书发布页面...');
  await page.goto('https://creator.xiaohongshu.com/publish/publish?from=menu&target=article', { waitUntil: 'networkidle', timeout: 60000 });
  const loginRequired = await page.locator('text=登录, text=扫码登录').isVisible({ timeout: 5000 }).catch(() => true);
  if (loginRequired) {
    console.log('🔐 [小红书] 请先在浏览器中登录小红书');
    process.exit(4);
  }
  if (uploadImages.length > 0) {
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(uploadImages);
    await page.waitForTimeout(3000);
  }
  if (text) {
    const titleBox = page.locator("textarea[placeholder*='输入标题'], input[placeholder*='输入标题']").first();
    await titleBox.waitFor({ state: 'visible', timeout: 15000 });
    await titleBox.fill(text.substring(0, 20));

    const contentBox = page.locator("div[contenteditable='true'], textarea[placeholder*='粘贴到这里或输入文字']").first();
    await contentBox.waitFor({ state: 'visible', timeout: 15000 });
    let fullText = text;
    if (topics.length > 0) fullText += ' ' + topics.map(t => `#${t}`).join(' ');
    await contentBox.fill(fullText);
  }
  if (submit) console.log('⚠️ [小红书] 发布按钮逻辑保留人工确认，当前脚本仅完成填充/上传。');
}

console.log('🚀 启动社交平台发布器...');
if (weiboText) console.log(`📝 微博内容: ${weiboText}`);
if (xhsText) console.log(`📝 小红书内容: ${xhsText}`);
console.log(`🖼️  图片: ${images.length > 0 ? images.join(', ') : '(无图片)'}`);
console.log(`🌐 浏览器: ${values.host ? 'Host 模式' : '本地 Chrome'}`);
console.log(`✅ 实际发布: ${values.submit ? '是' : '否 (预览模式)'}`);
console.log('');

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const skillDir = path.dirname(scriptDir);
const userDataDir = values.profile || path.join(skillDir, 'social-profile');

let browser;
try {
  if (values.host) {
    if (!values.cdpp) throw new Error('--host 模式需要指定 --cdpp 参数');
    let endpoint = normalizeCDPEndpoint(values.cdpp);
    const probe = await probeCDPEndpoint(endpoint);
    if (!probe.ok) throw new Error(probe.detail);
    if (probe.wsUrl) endpoint = probe.wsUrl;
    console.log(`🔗 最终连接地址: ${endpoint}`);
    browser = await connectWithRetry(endpoint, 3);
  } else {
    const executablePath = resolveBrowserExecutable();
    browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath,
      channel: !executablePath ? 'chrome' : undefined,
      viewport: { width: 1280, height: 800 },
    });
  }

  const context = getDefaultContext(browser);
  if (weiboText) {
    const weiboPage = await context.newPage();
    let weiboPublishResult = null;
    try {
      weiboPublishResult = await publishWeibo(weiboPage, weiboText, images, values.submit);
    } finally {
      if (values.submit && weiboPublishResult?.confirmed) {
        await weiboPage.close().catch(() => {});
      }
    }
  }
  if (xhsText) {
    const xhsPage = await context.newPage();
    await publishXiaohongshu(xhsPage, xhsText, images, values.submit);
  }
} catch (error) {
  console.error('❌ 出错:', error);
  process.exit(10);
} finally {
  await closeBrowserConnection(browser);
}
