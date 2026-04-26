import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { ensureWeiboLoggedIn } from '../../social-publisher/scripts/weibo-session.mjs';

const require = createRequire(import.meta.url);

function loadPlaywrightChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    return require('../../social-publisher/node_modules/playwright').chromium;
  }
}

const chromium = loadPlaywrightChromium();
const HOT_URL = 'https://weibo.com/hot/entertainment';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    host: { type: 'boolean', default: false },
    cdpp: { type: 'string' },
    top: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});

const topN = Math.max(1, Math.min(20, parseInt(values.top, 10) || 10));

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
  return chromium.connectOverCDP(endpoint, { timeout: 90000 });
}

function getContext(browser) {
  const context = browser.contexts()[0];
  if (!context) throw new Error('没有可用浏览器上下文');
  return context;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function extractHotTopics(page) {
  await page.goto(HOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const topics = await page.evaluate((limit) => {
    const blacklist = new Set([
      '首页', '热搜', '文娱', '娱乐', '更多', '刷新', '换一换', '登录', '注册', '微博', '超话', '热议', '话题', '返回顶部'
    ]);

    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 12 && rect.height > 12;
    };

    const rows = [];
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const a of anchors) {
      if (!visible(a)) continue;
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2 || text.length > 32) continue;
      if (blacklist.has(text)) continue;
      if (/^(热搜|置顶|新|沸|爆|荐)$/u.test(text)) continue;

      const href = a.href || '';
      if (!href.startsWith('http')) continue;
      if (!/weibo\.com/.test(href)) continue;

      const rect = a.getBoundingClientRect();
      if (rect.top < 80 || rect.left < 60) continue;

      rows.push({
        text,
        href,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      });
    }

    const dedup = [];
    const seen = new Set();
    for (const row of rows.sort((a, b) => a.top - b.top || a.left - b.left)) {
      const key = `${row.text}__${row.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(row);
    }

    return dedup
      .filter(x => !/登录|注册|下载|客服|协议|隐私|帮助/.test(x.text))
      .slice(0, limit)
      .map((x, idx) => ({ rank: idx + 1, title: x.text, url: x.href }));
  }, topN);

  return topics;
}

async function extractDetail(page, topic) {
  const detailPage = await page.context().newPage();
  try {
    await detailPage.goto(topic.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await detailPage.waitForTimeout(5000);
    await detailPage.mouse.wheel(0, 1200).catch(() => {});
    await detailPage.waitForTimeout(1200);
    await detailPage.mouse.wheel(0, 900).catch(() => {});
    await detailPage.waitForTimeout(1200);

    const detail = await detailPage.evaluate((requestedUrl) => {
      const normalize = (text) => (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

      const genericLine = (line) => {
        if (!line) return true;
        if (/^\d+$/.test(line)) return true;
        if (line.length < 4) return true;
        if (/^(公开|关注|评论|转发|赞|收藏|首页|热搜|返回|按热度|按时间|查看更多|登录后查看更多)$/.test(line)) return true;
        if (/^(微博|超话|粉丝|发布于|来自|视频|图片|直播|搜索|大家都在搜)/.test(line)) return true;
        if (/^(展开|收起|网页链接|置顶|已编辑|全文)$/.test(line)) return true;
        return false;
      };

      const looksLikePostText = (text) => {
        if (!text) return false;
        if (text.length < 12) return false;
        if (/登录|注册|下载客户端|打开微博|联系客服|帮助中心/.test(text)) return false;
        return true;
      };

      const authorSelectors = [
        'a[href*="/u/"]',
        'a[href*="weibo.com/u/"]',
        'a[href*="/profile/"]',
        '[class*="head-info_nick"]',
        '[class*="username"]',
        '[class*="name"]',
        '.WB_info a'
      ];

      const contentSelectors = [
        '[node-type="feed_list_content"]',
        '[node-type="feed_list_reason"]',
        '.WB_text',
        '[class*="detail_wbtext"]',
        '[class*="Feed_text"]',
        '[class*="content"]',
        'article',
        '.card-wrap'
      ];

      const getAuthor = (node) => {
        const scopes = [node, node.parentElement, node.closest('article'), node.closest('.card-wrap'), node.closest('.WB_feed_detail')].filter(Boolean);
        for (const scope of scopes) {
          for (const selector of authorSelectors) {
            const el = scope.querySelector?.(selector);
            const text = normalize(el?.textContent || '');
            if (text && text.length <= 40 && !/关注|粉丝|主页|微博/.test(text)) return text;
          }
        }
        return '';
      };

      const posts = [];
      const seen = new Set();
      const contentNodes = Array.from(document.querySelectorAll(contentSelectors.join(',')));

      for (const node of contentNodes) {
        const text = normalize(node.innerText || node.textContent || '');
        if (!looksLikePostText(text)) continue;

        const lines = text.split(/\r?\n/).map(normalize).filter(line => !genericLine(line));
        const joined = normalize(lines.join(' '));
        if (!looksLikePostText(joined)) continue;

        const dedupKey = joined.slice(0, 160);
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        posts.push({ author: getAuthor(node), text: joined.slice(0, 500) });
        if (posts.length >= 12) break;
      }

      const bodyText = normalize(document.body?.innerText || '');
      const rawLines = bodyText.split(/\r?\n/).map(normalize).filter(Boolean);

      const keyLines = [];
      for (const post of posts) {
        const combined = normalize(`${post.author ? `${post.author}：` : ''}${post.text}`);
        if (!combined || keyLines.includes(combined)) continue;
        keyLines.push(combined);
        if (keyLines.length >= 8) break;
      }

      if (!keyLines.length) {
        for (const line of rawLines) {
          if (genericLine(line)) continue;
          if (keyLines.includes(line)) continue;
          keyLines.push(line);
          if (keyLines.length >= 12) break;
        }
      }

      const title = document.title || '';
      const url = location.href;
      const loginRequired = /passport\.weibo\.com/.test(url) || /登录\s*-\s*微博/.test(title);
      const snippet = posts.length
        ? posts.slice(0, 4).map(post => `${post.author ? `${post.author}：` : ''}${post.text}`).join(' / ').slice(0, 1600)
        : keyLines.join(' / ').slice(0, 1200);

      return {
        title,
        url,
        requestedUrl,
        loginRequired,
        snippet,
        keyLines,
        posts,
        postCount: posts.length,
        sourceQuality: posts.length >= 3 ? 'post-text-rich' : (posts.length >= 1 ? 'post-text-limited' : 'page-summary-only'),
      };
    }, topic.url);

    return detail;
  } finally {
    await detailPage.close().catch(() => {});
  }
}

async function main() {
  if (!values.host || !values.cdpp) {
    throw new Error('需要使用 --host --cdpp 连接已启动的调试版 Chrome');
  }

  const endpoint = normalizeCDPEndpoint(values.cdpp);
  const browser = await connect(endpoint);
  let page;
  try {
    const context = getContext(browser);
    page = await context.newPage();
    await ensureWeiboLoggedIn(page, { taskName: '微博热搜取材' });
    const topics = await extractHotTopics(page);
    if (!topics.length) throw new Error('未抓到文娱热搜项');

    const picked = pickOne(topics);
    const detail = await extractDetail(page, picked);

    const result = {
      board: { title: '微博文娱热搜', url: HOT_URL },
      topics,
      picked,
      detail,
      fetchedAt: new Date().toISOString(),
    };

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`已选热搜 #${picked.rank}: ${picked.title}`);
      console.log(picked.url);
      console.log('');
      console.log(detail.snippet);
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await main();
