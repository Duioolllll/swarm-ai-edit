import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { dashboardOrigins, instrumentJsx, swarmwatch } from './index.js';

describe('Vite development instrumentation', () => {
  it('adds source ownership to real DOM elements and leaves component invocations alone', () => {
    const source = 'export function Navbar(){return <nav><Button/><button>Ship</button></nav>}';
    const result = instrumentJsx(source, 'src/Navbar.tsx');
    expect(result.code).toContain('nav data-sw-file="src/Navbar.tsx" data-sw-component="Navbar"');
    expect(result.code).toContain('button data-sw-file="src/Navbar.tsx"');
    expect(result.code).toContain('<Button/>');
    expect(source).not.toContain('data-sw');
    expect(result.map.sources).toContain('src/Navbar.tsx');
  });
  it('handles TypeScript arrows, fragments and existing attributes', () => {
    const result = instrumentJsx('const Card = (x: {n:number}) => <><div data-sw-file="own">{x.n}</div><img src="x" /></>', 'src/Card.tsx');
    expect(result.code.match(/data-sw-file="own"/g)).toHaveLength(1);
    expect(result.code).toContain('data-sw-component="Card"');
    expect(result.code).toContain('<img data-sw-file="src/Card.tsx"');
  });
  it('runs only during serve and rejects nonlocal dashboard origins', () => {
    expect(swarmwatch().apply).toBe('serve');
    expect(() => swarmwatch({ dashboardOrigin: 'https://evil.example' })).toThrow('loopback');
  });
  it('accepts localhost and IPv4 loopback aliases at exactly the configured protocol and port', () => {
    expect(dashboardOrigins('http://127.0.0.1:4891')).toEqual(['http://127.0.0.1:4891', 'http://localhost:4891']);
    expect(dashboardOrigins('https://localhost:4891')).toEqual(['https://localhost:4891', 'https://127.0.0.1:4891']);
    expect(dashboardOrigins(['http://localhost:4317', 'http://127.0.0.1:4317'])).toHaveLength(2);
  });
  it('expands the CLI injected origin before serializing its bridge allowlist', () => {
    vi.stubEnv('SWARMWATCH_DASHBOARD_ORIGIN', 'http://127.0.0.1:4891');
    try {
      const plugin = swarmwatch();
      let script = '';
      const configure = plugin.configureServer as Function;
      configure({ middlewares: { use: (_path: string, middleware: Function) => middleware({}, { setHeader() {}, end(value: string) { script = value; } }) } });
      expect(script).toContain('["http://127.0.0.1:4891","http://localhost:4891"]');
      expect(script).not.toContain('"http://localhost:4317"');
    } finally { vi.unstubAllEnvs(); }
  });
  it('serves the bridge and Vite HMR client under the configured base', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swarmwatch-vite-base-'));
    const server = await createServer({root, base: '/preview/', configFile: false, server:{host:'127.0.0.1', port:0}, plugins:[swarmwatch()]});
    try {
      await writeFile(join(root, 'index.html'), '<!doctype html><html><body><main>Preview</main></body></html>');
      await server.listen();
      const url = server.resolvedUrls!.local[0]!;
      const page = await fetch(url);
      expect(page.ok).toBe(true);
      const bridgePath = (await page.text()).match(/src="([^"]+@swarmwatch\/bridge)"/)?.[1];
      expect(bridgePath).toBe('/preview/@swarmwatch/bridge');
      const bridge = await fetch(new URL(bridgePath!, url));
      expect(bridge.headers.get('content-type')).toContain('javascript');
      const clientPath = (await bridge.text()).match(/from "([^"]+@vite\/client)"/)?.[1];
      expect(clientPath).toBe('/preview/@vite/client');
      const client = await fetch(new URL(clientPath!, url));
      expect(client.ok).toBe(true);
      expect(client.headers.get('content-type')).toContain('javascript');
      await client.text();
    } finally {
      await server.close();
      await rm(root, {recursive:true, force:true});
    }
  });
});
