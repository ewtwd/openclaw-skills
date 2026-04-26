import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ensureWeiboLoggedIn } from './weibo-session.mjs';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    action: { type: 'string' },
    url: { type: 'string' },
    text: { type: 'string' },
    'context-path': { type: 'string' },
    'context-json': { type: 'string' },
    host: { type: 'boolean', default: false },
    cdpp: { type: 'string' },
    timeout: { type: 'string' },
    port: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});

const action = values.action;
const url = values.url;
const text = values.text || '';
const contextPath = values['context-path'] || '';
const contextJson = values['context-json'] || '';
const timeoutMs = Number(values.timeout || 60000);
const port = Number(values.port || 0);
const HOME_URL = 'https://weibo.com/';

if (!action || !url) {
  console.log('用法: node weibo-interactor.mjs --action <inspect|like|repost|comment|repost-comment> --url <微博链接> [--text 评论内容，可选] --host --cdpp <url>');
  process.exit(1);
}

const textOptionalActions = new Set(['comment', 'repost-comment', 'like-comment', 'like-repost-comment']);
const likeOnlyActions = new Set(['like', 'like-repost']);

function normalizeCDPEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    if ((u.protocol === 'ws:' || u.protocol === 'wss:') && (!u.pathname || u.pathname === '/')) {
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      return u.toString();
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

async function connect(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
  return browser;
}

function getContext(browser) {
  const context = browser.contexts()[0];
  if (!context) throw new Error('没有可用浏览器上下文');
  return context;
}

function normalizeTargetUrlForReuse(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(rawUrl || '').replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function isSameTargetUrl(a, b) {
  const na = normalizeTargetUrlForReuse(a);
  const nb = normalizeTargetUrlForReuse(b);
  return !!na && !!nb && na === nb;
}

async function acquireInteractionPage(context, targetUrl) {
  const pages = context.pages();
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const existing = pages[i];
    try {
      if (isSameTargetUrl(existing.url(), targetUrl)) {
        return { page: existing, reusedExistingPage: true };
      }
    } catch {}
  }

  const page = await context.newPage();
  return { page, reusedExistingPage: false };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function browseHomeFeedBeforeAction(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForTimeout(randomInt(2800, 5200));

  const scrollTimes = randomInt(4, 7);
  for (let i = 0; i < scrollTimes; i++) {
    await page.mouse.wheel(0, randomInt(420, 980));
    await page.waitForTimeout(randomInt(1500, 3000));
  }

  await page.waitForTimeout(randomInt(1000, 2400));
}

async function playVideoIfPresent(page, options = {}) {
  const {
    playbackMs = 0,
  } = options;

  const videoSelectors = [
    page.locator('button:has-text("播放视频")').first(),
    page.locator('.vjs-big-play-button').first(),
    page.locator('.vjs-play-control').first(),
    page.locator('video').first(),
  ];

  let hasVideo = false;
  for (const loc of videoSelectors) {
    try {
      if (await loc.count() > 0) {
        hasVideo = true;
        break;
      }
    } catch {}
  }
  if (!hasVideo) return { hasVideo: false, waitedMs: 0, clickedPlay: false };

  let clickedPlay = false;
  for (const loc of videoSelectors.slice(0, 3)) {
    try {
      if (await loc.count() > 0 && await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await loc.click({ timeout: 3000 }).catch(() => {});
        clickedPlay = true;
        break;
      }
    } catch {}
  }

  await page.waitForTimeout(300);
  if (playbackMs > 0) {
    await page.waitForTimeout(playbackMs);
    return { hasVideo: true, waitedMs: playbackMs, clickedPlay };
  }

  return { hasVideo: true, waitedMs: 0, clickedPlay };
}

async function prepareTargetPage(page, targetUrl) {
  await browseHomeFeedBeforeAction(page);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForTimeout(3000);
}

async function ensureOnPreparedTargetPage(page, targetUrl) {
  const currentUrl = page.url();
  if (currentUrl && isSameTargetUrl(currentUrl, targetUrl)) {
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(1200);
    return { reused: true };
  }

  await prepareTargetPage(page, targetUrl);
  return { reused: false };
}

async function extractWeiboPostContext(page) {
  return await page.evaluate(() => {
    const normalize = value => (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const splitLines = value => (value || '')
      .split(/\r?\n/)
      .map(line => normalize(line))
      .filter(Boolean);

    const bodyText = normalize(document.body?.innerText || '');
    const bodyLines = splitLines(bodyText);

    const topicMatch = bodyText.match(/([\u4e00-\u9fa5A-Za-z0-9_]+超话)/);
    const publishTimeMatch = bodyText.match(/\b\d{2}-\d-\d{2}\s+\d{2}:\d{2}\b/);
    const sourceDeviceMatch = bodyText.match(/来自\s+([^\n]+)/);
    const videoDurationMatch = bodyText.match(/时长\s*(\d{2}:\d{2})/);

    const noisePatterns = [
      /^\d+$/,
      /^(无障碍|首页|全部关注|最新微博|特别关注|好友圈|自定义分组|管理|展开|返回)$/,
      /^(公开|关注|播放视频|暂停|静音|全屏|小窗播放|倍速|播放速度|720p|点击展开)$/,
      /^(转发|评论|分享这条博文|同时转发|解锁真爱粉徽章|为TA助威|赞)$/,
      /^(发布于|来自 |查看个人主页|按倒序|按正序|按热度|微博热搜|点击刷新|帮助中心|微博客服|自助服务中心|常见问题|合作&服务|更多|关于微博|About Weibo|客户端下载|微博招聘|网站备案信息|微博隐私安全中心)/,
      /^(当前时间|时长|加载完成[:：]?)/,
    ];

    const stopWords = ['转发', '评论', '分享这条博文', '同时转发', '还没有人评论哦', '查看个人主页', '微博热搜'];

    const keepLine = line => {
      if (!line || line.length < 5) return false;
      if (noisePatterns.some(pattern => pattern.test(line))) return false;
      return true;
    };

    const candidateRoots = Array.from(document.querySelectorAll('article, [mid], .WB_cardwrap, [role="article"]'));
    const candidates = candidateRoots
      .map(node => ({
        text: normalize(node.innerText || node.textContent || ''),
        lines: splitLines(node.innerText || node.textContent || ''),
      }))
      .filter(item => item.text)
      .sort((a, b) => b.text.length - a.text.length);

    const extractFromLines = (lines) => {
      if (!lines.length) return [];

      let start = lines.findIndex(line => /^来自 /.test(line));
      if (start === -1) start = lines.findIndex(line => /^发布于/.test(line));
      start = start === -1 ? 0 : start + 1;

      const picked = [];
      for (let i = start; i < lines.length; i += 1) {
        const line = lines[i];
        if (stopWords.some(word => line.includes(word))) break;
        if (!keepLine(line)) continue;
        if (picked.includes(line)) continue;
        picked.push(line);
        if (picked.length >= 6) break;
      }

      return picked;
    };

    let selectedLines = [];
    let contextQuality = 'low';
    for (const candidate of candidates) {
      const picked = extractFromLines(candidate.lines);
      if (picked.join(' ').length >= 12) {
        selectedLines = picked;
        contextQuality = 'high';
        break;
      }
    }

    if (!selectedLines.length) {
      const fallbackLines = extractFromLines(bodyLines);
      if (fallbackLines.length) {
        selectedLines = fallbackLines;
        contextQuality = 'medium';
      }
    }

    const author = candidateRoots
      .flatMap(node => splitLines(node.innerText || node.textContent || '').slice(0, 4))
      .find(line => line && !line.includes('超话') && !/^\d/.test(line) && !/^发布于/.test(line) && !/^来自 /.test(line)) || null;

    const postText = selectedLines.join(' / ');
    const mediaType = /微博视频|时长\s*\d{2}:\d{2}|播放视频|video/i.test(bodyText) ? 'video' : 'text';

    return {
      author,
      topic: topicMatch ? topicMatch[1] : null,
      publishTime: publishTimeMatch ? publishTimeMatch[0] : null,
      sourceDevice: sourceDeviceMatch ? normalize(sourceDeviceMatch[1]) : null,
      postText,
      mediaType,
      videoDuration: videoDurationMatch ? videoDurationMatch[1] : null,
      contextQuality,
      fullContext: bodyText.slice(0, 4000),
    };
  });
}

function ensureCommentTextProvided(actionName, providedText) {
  if (textOptionalActions.has(actionName) && !providedText.trim()) {
    throw new Error('评论类 action 必须显式提供 --text。请先通过 weibo-ent-commenter 技能基于 inspect 结果生成评论，再把结果作为 --text 传入。');
  }
}

const commentPlaceholderPatterns = [
  /^获取内容$/i,
  /^获取帖子内容$/i,
  /^抓取内容$/i,
  /^先获取内容$/i,
  /^内容待补$/i,
  /^待补充$/i,
  /^占位符$/i,
  /^placeholder$/i,
  /^todo$/i,
  /^tbd$/i,
];

const commentMetaPatterns = [
  /作为占位符/,
  /先基于帖子内容生成/,
  /结果脚本直接把它当评论发出去了/,
  /补发一条/,
];

function ensureCommentTextSafe(actionName, providedText) {
  if (!textOptionalActions.has(actionName)) return;

  const normalized = providedText.trim();
  if (!normalized) return;

  if (commentPlaceholderPatterns.some(pattern => pattern.test(normalized))) {
    throw new Error(`评论文案疑似占位词：${normalized}。已阻止发送，请先基于帖子内容生成真实评论。`);
  }

  if (commentMetaPatterns.some(pattern => pattern.test(normalized))) {
    throw new Error('评论文案疑似内部说明/补救话术，已阻止发送。请改为面向微博用户的真实评论。');
  }
}

function buildContentFingerprint(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function loadCommentContext() {
  if (!contextPath && !contextJson) return null;

  try {
    if (contextPath) {
      return JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    }
    return JSON.parse(contextJson);
  } catch (error) {
    throw new Error(`评论上下文解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateCommentContext(actionName, currentUrl, postContext, loadedContext) {
  if (!textOptionalActions.has(actionName)) return null;
  if (!loadedContext) return null;

  const currentNormalizedUrl = normalizeTargetUrlForReuse(currentUrl);
  const contextNormalizedUrl = normalizeTargetUrlForReuse(loadedContext.url || '');
  if (!currentNormalizedUrl || !contextNormalizedUrl || currentNormalizedUrl !== contextNormalizedUrl) {
    throw new Error('评论类 action 的上下文 URL 与当前页面不一致，请重新 inspect 后再执行。');
  }

  const currentFingerprint = buildContentFingerprint(postContext?.postText || '');
  const contextFingerprint = loadedContext.contentFingerprint || buildContentFingerprint(loadedContext.postText || '');
  if (loadedContext.postText && postContext?.postText && currentFingerprint !== contextFingerprint) {
    throw new Error('评论类 action 的 inspect 上下文与当前帖子正文不一致，请重新 inspect 后再执行。');
  }

  return {
    ...loadedContext,
    contentFingerprint: contextFingerprint,
  };
}

async function finishByReturningHome(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(1500).catch(() => {});
}

function shouldReturnHomeAfterAction(actionName) {
  return !new Set(['inspect', 'comment', 'repost-comment', 'like-comment', 'like-repost-comment']).has(actionName);
}

function shouldCloseInteractionPage(actionName, acquired) {
  if (new Set(['comment', 'repost-comment', 'like-comment', 'like-repost-comment']).has(actionName)) {
    return true;
  }
  return actionName !== 'inspect' && !acquired?.reusedExistingPage;
}

function shouldSkipPreActionReplay(actionName, acquired, prepared) {
  if (!acquired?.reusedExistingPage || !prepared?.reused) return false;
  return new Set(['comment', 'repost-comment', 'like-comment', 'like-repost-comment']).has(actionName);
}

async function collectDebugState(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => null),
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 1600),
  };
}

async function clickFirstVisible(candidates, label) {
  for (const loc of candidates) {
    try {
      if (await loc.count() > 0 && await loc.first().isVisible({ timeout: 1200 }).catch(() => false)) {
        await loc.first().click({ timeout: 4000 });
        return true;
      }
    } catch {}
  }
  throw new Error(`未找到可点击的 ${label}`);
}

async function checkVerificationPopup(page) {
  const candidatePages = [];
  try {
    const contextPages = page.context().pages();
    for (const p of contextPages) {
      if (!candidatePages.includes(p)) candidatePages.push(p);
    }
  } catch {}

  const verifyPatterns = [
    /验证/i,
    /安全验证/i,
    /请完成验证/i,
    /请先验证/i,
    /拖动滑块/i,
    /滑块/i,
    /拼图/i,
    /验证码/i,
    /人机验证/i,
    /异常行为/i,
    /风险验证/i,
  ];

  for (const p of candidatePages) {
    try {
      const title = await p.title().catch(() => '');
      const url = p.url();
      const body = (await p.locator('body').innerText().catch(() => '')).slice(0, 4000);
      const combined = `${title}\n${url}\n${body}`;
      if (verifyPatterns.some(pattern => pattern.test(combined))) {
        return {
          detected: true,
          title,
          url,
          body: body.slice(0, 1200),
        };
      }
    } catch {}
  }

  return { detected: false };
}

async function clickLike(page) {
  await clickFirstVisible([
    page.locator('button[title="赞"]'),
    page.locator('.woo-like-main'),
    page.getByRole('button', { name: /赞/ }),
  ], '点赞按钮');
  await page.waitForTimeout(2500);

  if (port === 9333 || port === 9334) {
    const verification = await checkVerificationPopup(page);
    if (verification.detected) {
      const error = new Error('任务失败，跳验证');
      error.name = 'WeiboVerificationRequiredError';
      error.verification = verification;
      throw error;
    }
  }
}

async function openRepostLayer(page) {
  await clickFirstVisible([
    page.locator('i[title="转发"]').locator('xpath=ancestor::div[contains(@class,"_item_")][1]'),
    page.locator('i[title="转发"]').locator('xpath=ancestor::div[contains(@class,"_wrap_")][1]'),
    page.getByRole('button', { name: /^转发$/ }),
  ], '转发入口');
  await page.waitForTimeout(1800);
}

async function openCommentComposer(page) {
  const openers = [
    page.locator('i[title="评论"]').locator('xpath=ancestor::div[contains(@class,"_item_")][1]').first(),
    page.locator('i[title="评论"]').locator('xpath=ancestor::div[contains(@class,"_wrap_")][1]').first(),
    page.locator('text=/^评论$/').first(),
  ];

  for (const loc of openers) {
    try {
      if (await loc.count() > 0 && await loc.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await loc.first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const textareas = page.locator('textarea');
        if (await textareas.count().catch(() => 0)) return;
      }
    } catch {}
  }
}

async function fillComposerText(page, value) {
  await openCommentComposer(page);

  const candidates = [
    page.locator('textarea').last(),
    page.locator('div[contenteditable="true"]').last(),
    page.locator('[role="textbox"]').last(),
  ];

  for (const loc of candidates) {
    try {
      if (await loc.count() > 0 && await loc.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await loc.first().click({ timeout: 3000 });
        try {
          await loc.first().fill(value, { timeout: 3000 });
        } catch {
          await loc.first().press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
          await loc.first().press('Backspace').catch(() => {});
          await loc.first().type(value, { delay: 30 });
        }
        return true;
      }
    } catch {}
  }
  throw new Error('未找到可输入的文本框');
}

async function confirmRepost(page) {
  await clickFirstVisible([
    page.getByRole('button', { name: /^转发$/ }),
    page.locator('button:has-text("转发")').last(),
    page.locator('text=/^转发$/').last(),
  ], '确认转发按钮');
  await page.waitForTimeout(3000);
}

async function collectComposerScopes(page) {
  const scopes = [];
  const composerInputs = [
    page.locator('textarea').last(),
    page.locator('div[contenteditable="true"]').last(),
    page.locator('[role="textbox"]').last(),
  ];

  for (const input of composerInputs) {
    try {
      if (await input.count() > 0 && await input.first().isVisible({ timeout: 800 }).catch(() => false)) {
        scopes.push(input.locator('xpath=ancestor::*[@role="dialog"][1]').first());
        scopes.push(input.locator('xpath=ancestor::*[.//label[contains(normalize-space(),"同时转发")]][1]').first());
        scopes.push(input.locator('xpath=ancestor::*[.//button or .//a][1]').first());
      }
    } catch {}
  }

  scopes.push(page.locator('[role="dialog"]').last());
  scopes.push(page.locator('label:has-text("同时转发")').last().locator('xpath=ancestor::*[.//button or .//a][1]').first());
  return scopes;
}

async function clickSubmitInsideScope(scope, exactNames) {
  for (const name of exactNames) {
    const regex = new RegExp(`^${name}$`);
    const candidates = [
      scope.getByRole('button', { name: regex }).last(),
      scope.locator(`button:has-text("${name}")`).last(),
      scope.locator(`a:has-text("${name}")`).last(),
      scope.locator(`text=/^${name}$/`).last(),
    ];

    for (const loc of candidates) {
      try {
        if (await loc.count() > 0 && await loc.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await loc.first().click({ timeout: 4000 });
          return name;
        }
      } catch {}
    }
  }
  return null;
}

async function submitComment(page, { allowRepostButton = false } = {}) {
  const exactNames = allowRepostButton ? ['评论', '转发', '发布'] : ['评论', '发布'];
  const scopes = await collectComposerScopes(page);

  for (const scope of scopes) {
    try {
      if (await scope.count() === 0) continue;
      const clicked = await clickSubmitInsideScope(scope, exactNames);
      if (clicked) {
        await page.waitForTimeout(3000);
        return clicked;
      }
    } catch {}
  }

  throw new Error(`未找到评论提交按钮${allowRepostButton ? '（含转发层提交按钮）' : ''}`);
}

async function setAlsoRepost(page, checked) {
  await openCommentComposer(page);

  const label = page.locator('label:has-text("同时转发")').last();
  const checkbox = label.locator('input[type="checkbox"]').first();
  if (await checkbox.count() === 0) throw new Error('未找到“同时转发”复选框');

  let current = await checkbox.isChecked().catch(() => false);
  if (current === checked) return;

  try {
    await label.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    current = await checkbox.isChecked().catch(() => false);
    if (current === checked) return;
  } catch {}

  await page.evaluate(({ desired }) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const target = labels.find(el => (el.textContent || '').includes('同时转发'));
    if (!target) throw new Error('未找到“同时转发”标签');
    const input = target.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('未找到“同时转发”输入框');
    if (input.checked !== desired) {
      input.checked = desired;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }, { desired: checked });

  await page.waitForTimeout(500);
  current = await checkbox.isChecked().catch(() => false);
  if (current !== checked) throw new Error('“同时转发”状态切换失败');
}

async function run() {
  if (!values.host || !values.cdpp) throw new Error('微博互动脚本需要 --host --cdpp');

  const endpoint = normalizeCDPEndpoint(values.cdpp);
  const browser = await connect(endpoint);
  const context = getContext(browser);
  const acquired = await acquireInteractionPage(context, url);
  const page = acquired.page;
  const result = { action, url, reusedExistingPage: acquired.reusedExistingPage };

  try {
    await ensureWeiboLoggedIn(page, {
      taskName: '微博互动',
      navigateHomeIfNeeded: !acquired.reusedExistingPage,
    });
    const prepared = await ensureOnPreparedTargetPage(page, url);
    result.reusedPreparedTarget = prepared.reused;

    const skipPreActionReplay = shouldSkipPreActionReplay(action, acquired, prepared);
    result.skippedPreActionReplay = skipPreActionReplay;

    let postContext = null;
    if (!skipPreActionReplay || action === 'inspect' || textOptionalActions.has(action) || likeOnlyActions.has(action)) {
      const requiredPlaybackMs = likeOnlyActions.has(action) ? 10000 : 0;
      const videoResult = await playVideoIfPresent(page, {
        playbackMs: requiredPlaybackMs,
      });
      result.videoHandled = videoResult.hasVideo;
      result.videoClickedPlay = videoResult.clickedPlay;
      result.videoWaitedMs = videoResult.waitedMs;
      await page.waitForTimeout(1200);
      postContext = await extractWeiboPostContext(page);
    } else {
      result.videoHandled = false;
      result.videoClickedPlay = false;
      result.videoWaitedMs = 0;
    }

    const resolvedText = text.trim();
    result.generatedText = false;

    if (action === 'inspect') {
      const contentFingerprint = buildContentFingerprint(postContext?.postText || '');
      Object.assign(result, postContext || {});
      result.postContent = postContext?.postText || '';
      result.contentFingerprint = contentFingerprint;
      result.done = 'inspected';
      result.mode = 'inspect-only';
    } else {
      ensureCommentTextProvided(action, text);
      ensureCommentTextSafe(action, text);
      const loadedContext = loadCommentContext();
      const validatedContext = validateCommentContext(action, page.url(), postContext, loadedContext);
      Object.assign(result, postContext || {});
      result.postContent = postContext?.postText || '';
      result.contentFingerprint = buildContentFingerprint(postContext?.postText || '');
      if (validatedContext) {
        result.contextValidated = true;
        result.contextFingerprint = validatedContext.contentFingerprint;
      } else {
        result.contextValidated = false;
      }
    }

    if (action === 'like') {
      await clickLike(page);
      result.likeDone = true;
      result.done = 'liked';
    } else if (action === 'repost') {
      await openRepostLayer(page);
      await confirmRepost(page);
      result.done = 'reposted';
    } else if (action === 'comment') {
      // 单独评论：显式关闭“同时转发”，避免误转评
      await fillComposerText(page, resolvedText);
      await setAlsoRepost(page, false).catch(() => {});
      result.submitButton = await submitComment(page);
      result.done = 'commented';
      result.text = resolvedText;
      result.mode = 'comment-only';
    } else if (action === 'repost-comment') {
      // 转发带评论：与单独评论互斥，只走一次“评论并同时转发”
      await fillComposerText(page, resolvedText);
      await setAlsoRepost(page, true);
      result.submitButton = await submitComment(page, { allowRepostButton: true });
      result.done = 'repost-commented';
      result.text = resolvedText;
      result.mode = 'comment-and-repost';
    } else if (action === 'like-repost') {
      await clickLike(page);
      result.likeDone = true;
      await openRepostLayer(page);
      await confirmRepost(page);
      result.done = 'liked-and-reposted';
      result.mode = 'like-and-repost';
    } else if (action === 'like-comment') {
      await clickLike(page);
      result.likeDone = true;
      await page.waitForTimeout(1200);
      await fillComposerText(page, resolvedText);
      await setAlsoRepost(page, false).catch(() => {});
      result.submitButton = await submitComment(page);
      result.done = 'liked-and-commented';
      result.text = resolvedText;
      result.mode = 'like-and-comment';
    } else if (action === 'like-repost-comment') {
      await clickLike(page);
      result.likeDone = true;
      await page.waitForTimeout(1200);
      await fillComposerText(page, resolvedText);
      await setAlsoRepost(page, true);
      result.submitButton = await submitComment(page, { allowRepostButton: true });
      result.done = 'liked-and-repost-commented';
      result.text = resolvedText;
      result.mode = 'like-and-comment-and-repost';
    } else if (action === 'inspect') {
      // inspect 已在上方处理，此处保持为 no-op
    } else {
      throw new Error(`不支持的 action: ${action}`);
    }

    Object.assign(result, await collectDebugState(page));
    if (shouldReturnHomeAfterAction(action)) {
      await finishByReturningHome(page);
      result.returnedHome = true;
    } else {
      result.returnedHome = false;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    if (error && typeof error === 'object' && 'verification' in error && error.verification) {
      result.verification = error.verification;
    }
    Object.assign(result, await collectDebugState(page));
    if (shouldReturnHomeAfterAction(action)) {
      await finishByReturningHome(page);
      result.returnedHome = true;
    } else {
      result.returnedHome = false;
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    if (shouldCloseInteractionPage(action, acquired)) {
      await page.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

await run();
