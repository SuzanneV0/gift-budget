// Captures docs/screenshot.png: the demo's sample event page, in a separate
// headless Chrome (never your normal browser, so no real account data).
//
//   1. node scripts/build.mjs && (cd dist && python -m http.server 5174)
//   2. node scripts/screenshot.mjs
//
// Drives Chrome over the DevTools protocol using Node's built-in WebSocket.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SITE = process.env.SITE || 'http://localhost:5174';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'gs-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank',
]);

let ws;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? ''));
  return result.value;
}
async function go(url) {
  await send('Page.navigate', { url });
  await sleep(2500);
}

try {
  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    } catch {
      await sleep(250);
    }
  }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // Start the demo (sample data only), then open the sample event.
  await go(`${SITE}/`);
  await evaluate(`localStorage.setItem('giftbudget-demo-mode', 'on'); true`);
  await go(`${SITE}/#/events`);
  await send('Page.reload'); // the demo switch takes effect on a fresh load
  await sleep(3000);
  await evaluate(`document.querySelector('.event-card').click(); true`);
  await sleep(1500);
  // A few simulated price checks so the charts and sale tags have history.
  await evaluate(`(async () => { for (let i = 0; i < 6; i++) { document.querySelector('[data-action=check-prices]').click(); await new Promise(r => setTimeout(r, 300)); } return true; })()`);
  await evaluate(`document.getElementById('demo-banner').hidden = true; document.getElementById('toast').hidden = true; window.scrollTo(0, 0); true`);
  await sleep(800);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('docs/screenshot.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved docs/screenshot.png');
} finally {
  ws?.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
