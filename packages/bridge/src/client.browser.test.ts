import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { clientBridge } from './client.js';
import { bridgeScript } from './index.js';

describe('browser bridge observations', () => {
  let server: Server, origin: string, browser: Browser;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url?.startsWith('/bridge.js')) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(bridgeScript(origin, {mode: 'file-change'}));
        return;
      }
      if (req.url?.startsWith('/child')) {
        const origins = req.url.includes('untrusted') ? [] : [origin];
        if (req.url.includes('generic')) res.end('<div id="panel">Plain baseline</div><button onclick="this.textContent=\'Clicked\'">Interact</button><input value="private input"><script src="/bridge.js"></script>');
        else res.end(`<button onclick="this.textContent='Clicked'" data-sw-file="src/Button.tsx" data-sw-component="Button">First</button><script>(${clientBridge.toString()})(${JSON.stringify(origins)})</script>`);
      } else {
        res.end(`<iframe src="/child${req.url?.includes('generic') ? '?generic' : ''}"></iframe><script>window.observations=[];addEventListener("message",event=>window.observations.push(event.data))</script>`);
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  });
  afterAll(async () => {
    await browser?.close();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it('suppresses baseline and assigns distinct IDs to repeat modifications of one element', async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ channel: 'swarmwatch', kind: 'connect', nonce: 'trusted-nonce-1234' }, location.origin));
    await expect.poll(() => page.evaluate(() => (window as any).observations.some((e: any) => e.kind === 'ready'))).toBe(true);
    expect(await page.evaluate(() => (window as any).observations.filter((e: any) => e.kind === 'changes'))).toHaveLength(0);
    const frame = page.frames().find(candidate => candidate.url().includes('/child'))!;
    await frame.evaluate(() => window.dispatchEvent(new Event('swarmwatch:hmr-start')));
    await frame.locator('button').evaluate(element => { element.textContent = 'Second'; });
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).filter((e: any) => e.kind === 'text').length)).toBe(1);
    await frame.locator('button').evaluate(element => { element.textContent = 'Third'; });
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).filter((e: any) => e.kind === 'text').length)).toBe(2);
    const changes = await page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []));
    expect(new Set(changes.map((event: any) => event.id)).size).toBe(changes.length);
    expect(changes.every((event: any) => typeof event.hmrId === 'string')).toBe(true);
    expect(changes.every((event: any) => event.filePath === 'src/Button.tsx' && event.mapping === 'instrumented')).toBe(true);
    await frame.locator('button').evaluate(element => { (element as HTMLElement).style.backgroundColor = 'rgb(10, 20, 30)'; });
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).some((e: any) => e.kind === 'style'))).toBe(true);
    await frame.locator('button').evaluate(element => element.remove());
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).some((e: any) => e.kind === 'deleted' && e.rect.width > 0))).toBe(true);
    await page.close();
  });
  it('does not emit interactive state changes, including a click immediately after HMR', async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ channel: 'swarmwatch', kind: 'connect', nonce: 'trusted-nonce-1234' }, location.origin));
    await expect.poll(() => page.evaluate(() => (window as any).observations.some((e: any) => e.kind === 'ready'))).toBe(true);
    const frame = page.frames().find(candidate => candidate.url().includes('/child'))!;
    await frame.locator('button').evaluate(element => { element.textContent = 'Interactive state'; });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).observations.filter((e: any) => e.kind === 'changes'))).toHaveLength(0);
    await frame.evaluate(() => window.dispatchEvent(new Event('swarmwatch:hmr-start')));
    await frame.locator('button').evaluate(element => { element.textContent = 'Development update'; });
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).length)).toBe(1);
    await frame.locator('button').click();
    expect(await frame.locator('button').textContent()).toBe('Clicked');
    await frame.evaluate(() => window.dispatchEvent(new Event('swarmwatch:hmr')));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).observations.flatMap((e: any) => e.changes || []).length)).toBe(1);
    await page.close();
  });
  it('rejects handshakes when the parent origin is not configured', async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.locator('iframe').evaluate(element => { (element as HTMLIFrameElement).src = '/child?untrusted'; });
    await expect.poll(() => page.frames().some(candidate => candidate.url().includes('untrusted'))).toBe(true);
    await page.frames().find(candidate => candidate.url().includes('untrusted'))!.waitForLoadState();
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ channel: 'swarmwatch', kind: 'connect', nonce: 'trusted-nonce-1234' }, location.origin));
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => (window as any).observations)).toHaveLength(0);
    await page.close();
  });
  it('measures plain HTML only after a validated real file control and suppresses user clicks', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/?generic`);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({channel:'swarmwatch',kind:'connect',nonce:'trusted-nonce-1234'}, location.origin));
    await expect.poll(() => page.evaluate(() => (window as any).observations.some((e:any) => e.kind === 'ready' && e.mode === 'file-change'))).toBe(true);
    const frame = page.frames().find(candidate => candidate.url().includes('/child'))!;
    await frame.locator('#panel').evaluate(element => {element.textContent='No file event';});
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []))).toHaveLength(0);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({channel:'swarmwatch',kind:'file-change',nonce:'trusted-nonce-1234',eventId:'file-1',filePath:'public/page.html',timestamp:new Date().toISOString()}, location.origin));
    await frame.locator('#panel').evaluate(element => {element.textContent='File-driven update';});
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).filter((e:any) => e.text === 'File-driven update').length)).toBe(1);
    const first = await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).find((e:any) => e.text === 'File-driven update'));
    expect(first.observation).toBe('file-change');
    expect(first.triggerEventId).toBe('file-1');
    expect(first.hmrId).toBeUndefined();
    expect(first.filePath).toBeUndefined();
    expect(first.mapping).toBe('unknown');
    const count = await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).length);
    await frame.locator('button').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).length)).toBe(count);
    expect(await frame.locator('button').textContent()).toBe('Clicked');
    await page.close();
  });
  it('buffers a bounded recent DOM delta until its matching file control arrives and rejects invalid controls', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/?generic`);
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({channel:'swarmwatch',kind:'connect',nonce:'trusted-nonce-1234'}, location.origin));
    await expect.poll(() => page.evaluate(() => (window as any).observations.some((e:any) => e.kind === 'ready'))).toBe(true);
    const frame = page.frames().find(candidate => candidate.url().includes('/child'))!;
    await frame.locator('#panel').evaluate(element => {element.textContent='Already rendered';});
    await page.waitForTimeout(120);
    const send = async (overrides: Record<string,unknown>) => page.evaluate(fields => document.querySelector('iframe')!.contentWindow!.postMessage({channel:'swarmwatch',kind:'file-change',nonce:'trusted-nonce-1234',eventId:'file-late',filePath:'public/page.html',timestamp:new Date().toISOString(),...fields}, location.origin), overrides);
    await send({nonce:'wrong-nonce'});
    await send({filePath:'../outside.html'});
    await send({filePath:'.env.local'});
    await send({timestamp:new Date(Date.now()-10000).toISOString()});
    expect(await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []))).toHaveLength(0);
    await send({});
    await expect.poll(() => page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).filter((e:any) => e.text === 'Already rendered').length)).toBe(1);
    await send({});
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).observations.flatMap((e:any) => e.changes || []).filter((e:any) => e.text === 'Already rendered').length)).toBe(1);
    await page.close();
  });
});
