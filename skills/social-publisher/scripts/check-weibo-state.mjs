import { chromium } from 'playwright';

async function checkCurrentPageState() {
  const endpoint = 'ws://127.0.0.1:9333/devtools/browser/5478b263-6f61-435e-960f-80116a1aad99';
  const browser = await chromium.connectOverCDP(endpoint);
  
  try {
    const context = browser.contexts()[0];
    let weiboPage = null;
    
    for (const page of context.pages()) {
      if (page.url().includes('weibo.com')) {
        weiboPage = page;
        break;
      }
    }
    
    if (!weiboPage) {
      console.log('❌ 没有找到微博页面');
      return false;
    }
    
    console.log('🌐 微博页面 URL:', weiboPage.url());
    
    // 获取页面标题和内容
    const title = await weiboPage.title();
    const content = await weiboPage.content();
    
    console.log('📄 页面标题:', title);
    console.log('📄 页面内容片段:', content.slice(0, 300));
    
    // 检查页面是否包含登录相关元素
    const hasLoginElements = content.includes('登录/注册') || content.includes('登录') || content.includes('login');
    const hasHomeElements = content.includes('我的首页') || content.includes('微博正文') || content.includes('热门微博');
    
    console.log('🔍 包含登录元素:', hasLoginElements);
    console.log('🏠 包含首页元素:', hasHomeElements);
    
    // 更准确的登录状态判断
    if (hasLoginElements && !hasHomeElements) {
      console.log('❌ 页面显示登录页面');
    } else if (hasHomeElements) {
      console.log('✅ 用户已登录');
    } else {
      console.log('⚠️  页面状态不确定，需要进一步检查');
    }
    
    return !hasLoginElements || hasHomeElements;
  } catch (error) {
    console.error('🚨 检查页面状态时出错:', error);
    return false;
  } finally {
    await browser.close();
  }
}

checkCurrentPageState();
