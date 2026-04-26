async function isAnyVisible(page, selectors, timeout = 1000) {
  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible({ timeout }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

export async function detectWeiboLoginState(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');

  const composerSelectors = [
    "textarea[placeholder*='有什么新鲜事']",
    "div[contenteditable='true']",
  ];
  const loginSelectors = [
    'text=登录/注册',
    "a:has-text('登录')",
    "button:has-text('登录')",
    'text=扫码登录',
  ];

  const composerVisible = await isAnyVisible(page, composerSelectors, 1500);
  const loginVisible = await isAnyVisible(page, loginSelectors, 1000);
  const bodyText = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
  const loginUrl = /passport\.weibo\.com|login/i.test(url) || /登录\s*-\s*微博/.test(title);
  const homeHints = /有什么新鲜事|发微博|热门微博|我的首页|首页/.test(bodyText);
  const loggedIn = composerVisible || (!loginVisible && !loginUrl && homeHints);

  return {
    loggedIn,
    url,
    title,
    composerVisible,
    loginVisible,
    loginUrl,
    homeHints,
  };
}

export async function ensureWeiboLoggedIn(page, options = {}) {
  const {
    taskName = '微博任务',
    homeUrl = 'https://weibo.com',
    loginHint = '请先运行 skills/social-publisher/scripts/login-weibo.ps1 完成扫码登录后再重试。',
    navigateHomeIfNeeded = true,
  } = options;

  let state = await detectWeiboLoginState(page).catch(() => ({
    loggedIn: false,
    url: page.url(),
    title: '',
    composerVisible: false,
    loginVisible: false,
    loginUrl: false,
    homeHints: false,
  }));

  if (!state.loggedIn && navigateHomeIfNeeded) {
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    state = await detectWeiboLoginState(page);
  }

  if (!state.loggedIn) {
    throw new Error(`${taskName}前检测到微博未登录。${loginHint} 当前页面: ${state.title || '(无标题)'} ${state.url}`);
  }

  return state;
}
