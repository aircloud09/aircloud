// Open the office like the launcher's window, record WebSocket state frames and screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const frames = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('websocket', ws => ws.on('framereceived', f => {
    try { const d = JSON.parse(f.payload); frames.push({ t: Date.now(), type: d.type, boss: d.state?.boss ? { state: d.state.boss.state, task: d.state.boss.currentTask, bubble: d.state.boss.bubble?.text } : undefined }); } catch {}
  }));
  await page.goto('http://127.0.0.1:4747/');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/shot-${String(i).padStart(2, '0')}.png` });
  }
  const ui = await page.evaluate(() => ({ buttons: document.querySelectorAll('button').length, canvas: document.querySelectorAll('canvas').length, aside: document.querySelectorAll('aside').length, text: document.body.innerText.slice(0, 200) }));
  fs.writeFileSync(`${out}/frames.json`, JSON.stringify({ ui, errors, frames }, null, 1));
  await browser.close();
})();
