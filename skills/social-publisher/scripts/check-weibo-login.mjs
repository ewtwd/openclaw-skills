import { chromium } from 'playwright';

async function checkLoginStatus() {
  const endpoint = 'ws://127.0.0.1:9333/devtools/browser/5478b263-6f61-435e-960f-80116a1aad99';
  const browser = await chromium.connectOverCDP(endpoint);
  
  try {
    const context = browser.contexts()[0];
    let weiboPage = null;
    
    // 查找微博相关页面
    for (const page of context.pages()) {
      if (page.url().includes('weibo.com')) {
        weiboPage = page;
        break;
      }
    }
    
    if (!weiboPage) {
      console.log('没有找到微博页面，正在打开登录页面...');
      weiboPage = await context.newPage();
      await weiboPage.goto('https://weibo.com', { waitUntil: 'networkidle' });
    }
    
    // 检查登录状态
    const isLoggedIn = await checkLoggedIn(weiboPage);
    
    if (isLoggedIn) {
      console.log('✅ 已检测到微博登录状态！');
      
      // 发布微博
      await publishWeibo(weiboPage);
    } else {
      console.log('🔐 需要登录微博！请在浏览器中完成登录操作。');
      console.log('当前页面标题:', await weiboPage.title());
      
      // 等待一段时间后重新检查
      setTimeout(checkLoginStatus, 10000);
    }
  } catch (error) {
    console.error('🚨 检查登录状态时出错:', error.message);
    // 等待一段时间后重新尝试
    setTimeout(checkLoginStatus, 15000);
  } finally {
    await browser.close();
  }
}

async function checkLoggedIn(page) {
  try {
    // 检查是否有登录按钮或用户信息
    const loginButtonExists = await page.locator('text=登录/注册', { timeout: 1000 }).count() > 0;
    const userInfoExists = await page.locator('div[class*="username"]', { timeout: 1000 }).count() > 0;
    
    return !loginButtonExists && userInfoExists;
  } catch (error) {
    // 如果元素查找超时，可能是登录页面或网络问题
    const url = page.url();
    return url.includes('weibo.com') && !url.includes('login');
  }
}

async function publishWeibo(page) {
  try {
    console.log('📝 开始发布微博...');
    
    // 确保在微博首页
    if (!page.url().includes('weibo.com/home')) {
      await page.goto('https://weibo.com/home', { waitUntil: 'networkidle' });
    }
    
    // 找到输入框
    const editBox = page.locator('textarea[placeholder*="有什么新鲜事"]').first();
    await editBox.waitFor({ state: 'visible', timeout: 10000 });
    await editBox.click();
    
    // 输入文字
    const text = '今天天气真好！';
    await editBox.fill(text);
    
    // 点击发送
    const sendButton = page.locator('button:text("发送"), a:text("发送")').first();
    await sendButton.waitFor({ state: 'visible', timeout: 5000 });
    await sendButton.click();
    
    console.log('✅ 微博发布成功！');
  } catch (error) {
    console.error('🚨 发布微博时出错:', error);
  }
}

console.log('🚀 启动微博登录状态监控...');
checkLoginStatus();
