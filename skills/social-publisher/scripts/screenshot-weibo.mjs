import { chromium } from 'playwright';

async function takeScreenshot() {
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
      return;
    }
    
    // 截取屏幕截图
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `weibo-page-${timestamp}.png`;
    await weiboPage.screenshot({ path: fileName, fullPage: true });
    console.log(`✅ 页面截图已保存到: ${fileName}`);
    
    // 同时获取页面的详细内容
    console.log('🌐 页面 URL:', weiboPage.url());
    console.log('📄 页面标题:', await weiboPage.title());
    
    // 获取页面的可见文本
    const visibleText = await weiboPage.innerText('body');
    console.log('📝 页面可见文本片段:', visibleText.slice(0, 200));
    
  } catch (error) {
    console.error('🚨 截图失败:', error);
  } finally {
    await browser.close();
  }
}

takeScreenshot();
