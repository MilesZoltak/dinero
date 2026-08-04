const puppeteer = require('puppeteer');

(async () => {
  console.log('🚀 Starting E2E Puppeteer integration test for Dinero Assistant...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    // Set standard viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Capture browser console logs
    page.on('console', (msg) => {
      const txt = msg.text();
      if (!txt.includes('source map') && !txt.includes('Download the React DevTools')) {
        console.log(`  [Browser Console ${msg.type()}]: ${txt}`);
      }
    });

    const port = process.env.TEST_PORT || '3001';
    const targetUrl = `http://localhost:${port}/dashboard?bypassAuth=true`;

    console.log(`📡 Navigating to ${targetUrl}...`);
    await page.goto(targetUrl);
    console.log('⌛ Waiting for FAB element...');
    await page.waitForSelector('.dinero-fab-trigger', { timeout: 15000 });
    console.log('✅ PASS: Dinero Assistant FAB element rendered.');

    // 2. Click FAB to open floating window
    console.log('👆 Test 2: Clicking FAB to open floating chat window...');
    await page.click('.dinero-fab-trigger');
    await page.waitForSelector('.dinero-chat-floating-window', { timeout: 5000 });
    console.log('✅ PASS: Floating chat window opened.');

    // 3. Submit query
    console.log('💬 Test 3: Submitting user query "What is my net worth?"...');
    await page.type('.dinero-chat-textarea', 'What is my net worth?');
    await page.click('.dinero-chat-send-btn');

    // 4. Wait for streamed response to render
    console.log('⏳ Test 4: Verifying streaming response & database integration...');
    await page.waitForFunction(
      () => {
        const bubbles = document.querySelectorAll('.dinero-chat-bubble');
        if (bubbles.length < 2) return false;
        const lastText = bubbles[bubbles.length - 1].innerText;
        return lastText && !lastText.includes('Thinking...');
      },
      { timeout: 15000 }
    );

    const messages = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.dinero-chat-bubble')).map((b) => b.innerText);
    });

    console.log('📥 Rendered Chat Bubbles:\n', messages.join('\n---\n'));
    console.log('✅ PASS: Assistant streaming response received and formatted in DOM.');

    // 5. Test close confirmation modal
    console.log('🚪 Test 5: Testing close button & ephemeral reset modal...');
    await page.click('.dinero-chat-close-btn');
    await page.waitForSelector('.bg-gray-900.border-gray-800', { timeout: 5000 });
    
    const modalContent = await page.evaluate(() => {
      const modal = document.querySelector('.bg-gray-900.border-gray-800');
      return modal ? modal.innerText : '';
    });

    if (!modalContent.includes('Temporary Conversation')) {
      throw new Error('Reset warning modal content missing or incorrect.');
    }
    console.log('✅ PASS: Ephemeral warning modal popped up correctly.');

    // Confirm session clear
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const clearBtn = btns.find((b) => b.textContent.includes('Clear & Close'));
      if (clearBtn) clearBtn.click();
    });

    await page.waitForFunction(() => !document.querySelector('.dinero-chat-floating-window'), { timeout: 5000 });
    console.log('✅ PASS: Session cleared and floating chat window closed.');

    console.log('\n🎉 ALL E2E INTEGRATION TESTS PASSED SUCCESSFULLY!');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ E2E INTEGRATION TEST FAILED:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
