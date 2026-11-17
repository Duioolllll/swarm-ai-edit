import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import path from 'node:path';
import type { Plugin } from 'vite';
import { clientBridge } from './client.js';

export type SwarmwatchOptions = { dashboardOrigin?: string | string[] };

/** The dashboard is bound on IPv4 loopback; its two URL aliases share a capability. */
export function dashboardOrigins(configured?: string | string[]): string[] {
  const values = Array.isArray(configured) ? configured : configured ? [configured] : ['http://localhost:4317'];
  return [...new Set(values.flatMap(value => {
    const url = new URL(value);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('SwarmWatch dashboardOrigin must be a loopback HTTP(S) origin');
    if (url.hostname === '[::1]') return [url.origin];
    const alias = new URL(url.origin);
    alias.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    return [url.origin, alias.origin];
  }))];
}

/** Transform output only. The user's source files are never edited. */
export function instrumentJsx(code: string, filePath: string) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const output = new MagicString(code);
  const fallback = path.basename(filePath).replace(/\.[^.]+$/, '');
  // Babel's complete node union is intentionally not a runtime dependency.
  function visit(node: any, component: string) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id?.name) component = node.id.name;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) component = node.id.name;
    if (node.type === 'ClassDeclaration' && node.id?.name) component = node.id.name;
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name)) {
      const attrs = new Set(node.attributes.filter((a: any) => a.type === 'JSXAttribute').map((a: any) => a.name.name));
      const additions = [
        ['data-sw-file', filePath], ['data-sw-component', component || fallback],
        ['data-sw-id', `${filePath}:${node.start}`],
      ].filter(([name]) => !attrs.has(name)).map(([name, value]) => ` ${name}=${JSON.stringify(value)}`).join('');
      output.appendLeft(node.name.end, additions);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'tokens' || key === 'comments') continue;
      if (Array.isArray(child)) child.forEach(value => visit(value, component));
      else if (child && typeof child === 'object') visit(child, component);
    }
  }
  visit(ast, '');
  return { code: output.toString(), map: output.generateMap({ hires: true, source: filePath, includeContent: true }) };
}

export function swarmwatch(options: SwarmwatchOptions = {}): Plugin {
  let root = '';
  const configured = options.dashboardOrigin ?? process.env.SWARMWATCH_DASHBOARD_ORIGIN;
  const origins = dashboardOrigins(configured);
  return {
    name: 'swarmwatch:instrumentation', enforce: 'pre', apply: 'serve',
    configResolved(config) { root = config.root; },
    configureServer(server) {
      server.middlewares.use('/@swarmwatch/bridge', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(`import {createHotContext} from '/@vite/client';\n(${clientBridge.toString()})(${JSON.stringify(origins)});\nconst hot = createHotContext('/@swarmwatch/bridge');\nhot.on('vite:beforeUpdate',()=>window.dispatchEvent(new Event('swarmwatch:hmr-start')));\nhot.on('vite:afterUpdate',()=>window.dispatchEvent(new Event('swarmwatch:hmr')));`);
      });
    },
    transformIndexHtml() { return [{ tag: 'script', attrs: { type: 'module', src: '/@swarmwatch/bridge' }, injectTo: 'head' }]; },
    transform(code, id) {
      const clean = id.split('?')[0];
      if (!/\.[jt]sx?$/.test(clean) || clean.includes('/node_modules/')) return;
      const relative = path.relative(root, clean).split(path.sep).join('/');
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || /(?:^|\/)\.env(?:\.|$)/i.test(relative)) return;
      if (!code.includes('<')) return;
      try { return instrumentJsx(code, relative); }
      catch { return; } // Non-JSX modules and other plugin syntaxes remain untouched.
    },
  };
}

export default swarmwatch;
