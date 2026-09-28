// Usage: node check.cjs <page path relative to prototype/> [typeSelector] [text] [clickSelector] [--mobile]
// Opens a prototype page from disk, reports console errors and horizontal overflow,
// optionally types into a field and clicks a button, then saves a screenshot.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.join(__dirname, '../../QATestingApp/node_modules/playwright'));

(async () => {
  const args = process.argv.slice(2);
  const mobile = args.includes('--mobile');
  const [pagePath, sel, text, click] = args.filter(a => a !== '--mobile');
  const url = pathToFileURL(path.resolve(__dirname, '..', pagePath)).href;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const errs = [];
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(800);
  if (sel && sel !== '-' && text) { await page.fill(sel, text); await page.dispatchEvent(sel, 'input'); await page.waitForTimeout(2500); }
  if (click) { await page.click(click).catch(e => errs.push('click: ' + e.message)); await page.waitForTimeout(2500); }
  const out = path.join(process.env.SHOT_DIR || __dirname, pagePath.replace(/[\\/]/g, '_') + (mobile ? '.mobile' : '') + '.png');
  await page.screenshot({ path: out, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(JSON.stringify({ errs, horizontalOverflow: overflow, shot: out }));
  await browser.close();
})();
