import { clientBridge } from './client.js';
export { clientBridge } from './client.js';

export type BridgeOptions = { mode?: 'hmr' | 'file-change' };

/** Exact loopback URL aliases, with no wildcard hosts, protocols or ports. */
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

/** A classic script: no framework, module loader, fetch, injected command, or app proxy. */
export function bridgeScript(origins: string | string[], options: BridgeOptions = { mode: 'file-change' }): string {
  return `(${clientBridge.toString()})(${JSON.stringify(dashboardOrigins(origins))},${JSON.stringify(options)});`;
}
