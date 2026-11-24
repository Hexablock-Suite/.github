// Drives a headless Chromium through the DevTools protocol with no extra package.
// Node 24 has a global WebSocket.
// The browser runs in its own process group with a fresh profile in the system temp directory.
// close() stops only that group and then removes the profile, so other browsers on the machine stay alive.
// Only maintenance scripts use this file. The build needs no browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

// findChrome returns the first browser binary that exists, or null.
// It looks for CHROME_BIN, then for the Playwright browsers, then for a browser on the PATH.
export function findChrome() {
  const found = [];
  if (process.env.CHROME_BIN) found.push(process.env.CHROME_BIN);
  const pw = path.join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).sort().reverse();
    for (const d of dirs.filter((x) => x.startsWith('chromium-'))) found.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) found.push(path.join(dir, name));
  }
  return found.find((p) => p && existsSync(p)) ?? null;
}

export async function launch() {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chromium found: set CHROME_BIN');
  const profile = mkdtempSync(path.join(tmpdir(), 'drawio-clases-page-profile-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--font-render-hinting=none', 'about:blank'],
  { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((r) => proc.once('exit', r));
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chromium did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); res(m[1]); }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waits = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waits.has(msg.id)) {
      const w = waits.get(msg.id); waits.delete(msg.id);
      if (msg.error) w.rej(new Error(msg.error.message)); else w.res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id;
    waits.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  return {
    pid: proc.pid,
    async page() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId);
      const log = [];
      listeners.push((msg) => {
        if (msg.sessionId !== sessionId) return;
        const p = msg.params;
        if (msg.method === 'Runtime.exceptionThrown') log.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
        if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) log.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description).join(' '));
        if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') log.push('log: ' + p.entry.text + ' ' + (p.entry.url || ''));
        if (msg.method === 'Network.responseReceived' && p.response.status >= 400) log.push('http ' + p.response.status + ' ' + p.response.url);
        if (msg.method === 'Network.loadingFailed' && !p.canceled) log.push('failed ' + p.errorText + ' ' + p.requestId);
      });
      await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('Network.enable');
      const waitEvent = (name) => new Promise((r) => {
        const f = (msg) => { if (msg.sessionId === sessionId && msg.method === name) { listeners.splice(listeners.indexOf(f), 1); r(msg.params); } };
        listeners.push(f);
      });
      const page = {
        log, send: s,
        async viewport(width, height, mobile = false) {
          await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await s('Emulation.setTouchEmulationEnabled', { enabled: mobile });
        },
        async scheme(dark) { await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }); },
        async go(url) { const w = waitEvent('Page.loadEventFired'); await s('Page.navigate', { url }); await w; },
        async eval(expr) {
          const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          return r.result.value;
        },
        async wait(expr, ms = 15000) {
          const t0 = Date.now();
          while (Date.now() - t0 < ms) { if (await page.eval(expr)) return true; await new Promise((r) => setTimeout(r, 50)); }
          throw new Error('timeout: ' + expr);
        },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        async shot(file) { const { data } = await s('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(data, 'base64')); },
        async click(x, y) {
          await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        },
        async key(key, code = key, keyCode = 0, text) {
          await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
          if (text) await s('Input.dispatchKeyEvent', { type: 'char', text });
          await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
        },
        async type(text) { await s('Input.insertText', { text }); },
      };
      return page;
    },
    async close() {
      try { ws.close(); } catch { /* The socket may be closed already. */ }
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* The group may be gone already. */ }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
