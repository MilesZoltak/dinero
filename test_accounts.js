const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching headless browser test...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Capture console messages & errors
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.toString()));

  console.log('Navigating to http://localhost:3000/dashboard/accounts?bypassAuth=true...');
  await page.goto('http://localhost:3000/dashboard/accounts?bypassAuth=true', { waitUntil: 'networkidle2' });

  const html = await page.content();
  console.log('PAGE BODY TEXT:', await page.evaluate(() => document.body.innerText));

  // Test 1: Click "Connect Bank / Card" button
  console.log('Clicking "Connect Bank / Card" header button...');
  const clickedHeader = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const target = btns.find(b => b.textContent.includes('Connect Bank'));
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  console.log('Connect button clicked:', clickedHeader);
  await new Promise(r => setTimeout(r, 1000));

  // Test 2: Click Plaid Standard Bank button in modal
  console.log('Clicking Plaid Standard Bank option...');
  const clickedPlaid = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const target = btns.find(b => b.textContent.includes('Plaid: Standard Bank'));
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  console.log('Plaid Standard Bank button clicked:', clickedPlaid);
  await new Promise(r => setTimeout(r, 3000));

  // Step 1: Create a test manual account so there's an account row to click
  console.log('Creating test manual account...');
  const nameInput = await page.$('input[placeholder*="Employer 401(k)"]');
  const instInput = await page.$('input[placeholder*="Fidelity"]');
  const balanceInput = await page.$('input[placeholder="0.00"]');

  if (nameInput) await nameInput.type('Test Chase Checking');
  if (instInput) await instInput.type('Chase Test');
  if (balanceInput) await balanceInput.type('4250.00');

  const addBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Manual Account'));
  });
  if (addBtn) await page.evaluate(el => el.click(), addBtn);
  await new Promise(r => setTimeout(r, 2000));

  // Test 3: Test clicking an existing account row
  console.log('Checking existing account rows...');
  const clickedRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.account-row-link'));
    if (rows.length > 0) {
      rows[0].click();
      return rows.length;
    }
    return 0;
  });
  console.log(`Account rows found & clicked first of ${clickedRow} rows.`);
  await new Promise(r => setTimeout(r, 1000));
  
  const modalText = await page.evaluate(() => {
    const modal = document.querySelector('.glass-panel.animated-fade-in');
    return modal ? modal.innerText : 'NO MODAL FOUND';
  });
  console.log('ACCOUNT CLICK MODAL POPUP OUTPUT:\n', modalText);

  await browser.close();
  console.log('Browser test complete.');
})();
