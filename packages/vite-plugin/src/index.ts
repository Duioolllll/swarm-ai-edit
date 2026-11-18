import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import path from 'node:path';
import type { Plugin } from 'vite';
import { clientBridge } from './client.js';
import { dashboardOrigins } from '@swarmwatch/bridge';
export { dashboardOrigins } from '@swarmwatch/bridge';

export type SwarmwatchOptions = { dashboardOrigin?: string | string[] };

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
  let base = '/';
  const configured = options.dashboardOrigin ?? process.env.SWARMWATCH_DASHBOARD_ORIGIN;
  const origins = dashboardOrigins(configured);
  const bridgePath = () => `${base}@swarmwatch/bridge`;
  return {
    name: 'swarmwatch:instrumentation', enforce: 'pre', apply: 'serve',
    configResolved(config) { root = config.root; base = config.base; },
    configureServer(server) {
      server.middlewares.use(bridgePath(), (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(`import {createHotContext} from ${JSON.stringify(base + '@vite/client')};\n(${clientBridge.toString()})(${JSON.stringify(origins)});\nconst hot = createHotContext(${JSON.stringify(bridgePath())});\nhot.on('vite:beforeUpdate',()=>window.dispatchEvent(new Event('swarmwatch:hmr-start')));\nhot.on('vite:afterUpdate',()=>window.dispatchEvent(new Event('swarmwatch:hmr')));`);
      });
    },
    transformIndexHtml() { return [{ tag: 'script', attrs: { type: 'module', src: bridgePath() }, injectTo: 'head' }]; },
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
