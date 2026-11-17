/** Serialized by the plugin after TypeScript compilation; keep this function self-contained. */
export function clientBridge(allowedOrigins: string[]) {
  type Snapshot = {
    id: string; filePath?: string; componentName?: string; tag: string; text: string;
    rect: {x: number; y: number; width: number; height: number}; style: string; media: string;
    mapping: 'instrumented' | 'inferred' | 'unknown';
  };
  const channel = 'swarmwatch';
  const selector = '[data-sw-file],main,header,nav,section,article,h1,h2,h3,p,button,img,[role="button"]';
  let nonce = '', parentOrigin = '', baselineReady = false;
  let hmrUntil = 0;
  let hmrId: string | undefined;
  let previous = new Map<Element, Snapshot>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  const ids = new WeakMap<Element, string>();
  const observed = new WeakSet<Element>();
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  function send(kind: 'ready' | 'changes', changes?: unknown[]) {
    if (nonce && parentOrigin && parent !== window) parent.postMessage({ channel, kind, nonce, changes, viewport: viewport() }, parentOrigin);
  }
  function privateElement(element: Element) {
    return !!element.closest('input,textarea,select,[contenteditable="true"],[data-sw-private],script,style,noscript') || /(?:^|\/)(?:\.env(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$))/i.test(element.getAttribute('data-sw-file') || '');
  }
  function snapshot(element: Element): Snapshot | undefined {
    if (privateElement(element)) return;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.width > 100000 || box.height > 100000) return;
    const computed = getComputedStyle(element);
    if (computed.visibility === 'hidden' || computed.display === 'none') return;
    const filePath = element.getAttribute('data-sw-file') || undefined;
    const owner = element.closest('[data-sw-file]');
    const inherited = owner?.getAttribute('data-sw-file') || undefined;
    const id = ids.get(element) || `${element.getAttribute('data-sw-id') || 'dom'}:${++nextId}`;
    ids.set(element, id);
    const text = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    // Only measured properties are compared. Stylesheet text and application source are never read.
    const style = [computed.color, computed.backgroundColor, computed.borderColor, computed.borderWidth,
      computed.borderRadius, computed.padding, computed.margin, computed.fontSize, computed.fontWeight,
      computed.fontFamily, computed.display, computed.gap, computed.opacity, computed.boxShadow,
      Math.round(box.width), Math.round(box.height)].join('|');
    return {
      id: id.slice(0, 150), filePath: filePath || inherited,
      componentName: element.getAttribute('data-sw-component') || owner?.getAttribute('data-sw-component') || undefined,
      tag: element.tagName.toLowerCase(), text,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height }, style,
      media: element.tagName === 'IMG' ? `${element.getAttribute('src') || ''}:${(element as HTMLImageElement).naturalWidth}` : '',
      mapping: filePath ? 'instrumented' : inherited ? 'inferred' : 'unknown',
    };
  }
  function measure(emit: boolean) {
    const current = new Map<Element, Snapshot>();
    const changes: unknown[] = [];
    const append = (entry: Snapshot, kind: string) => {
      const { style: _style, media: _media, ...value } = entry;
      if (changes.length < 100) changes.push({ ...value, id: `${entry.id.slice(0,95)}:${crypto.randomUUID()}`, hmrId, kind, capturedAt: new Date().toISOString(), viewport: viewport() });
    };
    const elements = Array.from(document.querySelectorAll(selector)).slice(0, 2500);
    for (const element of elements) {
      const entry = snapshot(element);
      if (!entry) continue;
      current.set(element, entry);
      if (!observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
      if (!emit) continue;
      const before = previous.get(element);
      if (!before) append(entry, entry.tag === 'img' ? 'image' : 'created');
      else if (before.media !== entry.media) append(entry, 'image');
      else if (before.text !== entry.text) append(entry, 'text');
      else if (before.style !== entry.style) append(entry, 'style');
      else if (before.rect.x !== entry.rect.x || before.rect.y !== entry.rect.y) append(entry, 'updated');
    }
    for (const [element, before] of previous) {
      if (!current.has(element)) {
        resizeObserver.unobserve(element); observed.delete(element);
        if (emit) append(before, 'deleted');
      }
    }
    previous = current;
    // Bound every wire packet to the collector's per-message limit.
    for (let offset = 0; offset < changes.length; offset += 50) send('changes', changes.slice(offset, offset + 50));
  }
  function schedule() {
    if (!baselineReady || timeout) return;
    timeout = setTimeout(() => { timeout = undefined; measure(!!hmrId && performance.now() <= hmrUntil); }, 80);
  }
  const resizeObserver = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || parent === window || !allowedOrigins.includes(event.origin)) return;
    if (!message || message.channel !== channel || message.kind !== 'connect' || typeof message.nonce !== 'string' || message.nonce.length < 8 || message.nonce.length > 256) return;
    nonce = message.nonce; parentOrigin = event.origin;
    if (baselineReady) send('ready');
  });
  function initialize() {
    // Let the initial React render settle; that render is a baseline, never a build animation.
    setTimeout(() => {
      measure(false); baselineReady = true;
      mutations.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden', 'width', 'height'] });
      send('ready');
    }, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  window.addEventListener('swarmwatch:hmr-start', () => {
    // Capture interactive state before the actual Vite update starts. DOM observation
    // alone does not establish development activity.
    if (baselineReady) measure(!!hmrId && performance.now() <= hmrUntil);
    hmrId = crypto.randomUUID(); hmrUntil = performance.now() + 1500;
    schedule();
  });
  window.addEventListener('swarmwatch:hmr', () => {
    // A trusted user interaction may have cancelled this burst in the meantime.
    if (!hmrId) return;
    hmrUntil = performance.now() + 1500;
    schedule(); setTimeout(schedule, 160);
  });
  const cancelForInteraction = (event: Event) => {
    if (!event.isTrusted) return;
    hmrId = undefined; hmrUntil = 0;
    schedule(); // Subsequent user-driven mutations update the baseline only.
  };
  for (const eventName of ['pointerdown', 'keydown', 'input']) window.addEventListener(eventName, cancelForInteraction, { capture: true, passive: true });
  window.addEventListener('load', schedule, true);
  window.addEventListener('resize', () => { if (baselineReady) { measure(false); send('ready'); } });
  window.addEventListener('scroll', () => {
    // Scrolling changes viewport coordinates but is not a development event.
    if (baselineReady) { if (timeout) clearTimeout(timeout); timeout = undefined; measure(false); }
  }, { passive: true, capture: true });
  window.addEventListener('pagehide', () => { mutations.disconnect(); resizeObserver.disconnect(); if (timeout) clearTimeout(timeout); });
}
