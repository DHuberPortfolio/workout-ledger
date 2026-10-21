// Remakes the README screenshots (docs/shot-cal.png, shot-trends.png, shot-search.png) from the
// generated sample data: a 420-pixel-wide light-mode page, captured top to bottom by Edge or Chrome
// running without a window. Uses only Node's own modules (Node 22+ has WebSocket built in).
//
//   node scripts/screenshots.js
//   BROWSER="/path/to/chrome" node scripts/screenshots.js    (to pick the browser)

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const WIDTH = 420;
const SHOTS = [['cal', 'shot-cal.png'], ['trends', 'shot-trends.png'], ['search', 'shot-search.png']];
const CANDIDATES = [
  process.env.BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!exe) throw new Error('No Edge or Chrome found; set BROWSER to its path.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-shots-'));
  const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    }
    if (!target) throw new Error('The browser did not start.');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const waiting = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else if (msg.method) events.push(msg.method);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
    for (let i = 0; i < 50 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
    await run(`[...document.querySelectorAll('#toolbar button')].find(b => b.textContent === 'Load sample data').click()`);

    for (const [tab, file] of SHOTS) {
      await run(`showTab('${tab}')`);
      await sleep(300);
      const height = await run('document.documentElement.scrollHeight');
      const { data } = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
      });
      fs.writeFileSync(path.join(ROOT, 'docs', file), Buffer.from(data, 'base64'));
      console.log(`docs/${file}: ${WIDTH} x ${height}`);
    }
    await send('Browser.close').catch(() => {});
    ws.close();
  } finally {
    browser.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
