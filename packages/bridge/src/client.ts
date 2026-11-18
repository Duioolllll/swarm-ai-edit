/** Serialized after TypeScript compilation; keep this function self-contained. */
export function clientBridge(allowedOrigins: string[], options: {mode?: 'hmr' | 'file-change'} = {}) {
  type Snapshot = {
    id: string; filePath?: string; componentName?: string; tag: string; text: string;
    rect: {x: number; y: number; width: number; height: number}; style: string; media: string;
    mapping: 'instrumented' | 'inferred' | 'unknown';
  };
  type Delta = Omit<Snapshot, 'style' | 'media'> & {
    kind: string; capturedAt: string; viewport: {width:number;height:number};
  };
  type ContextualDelta = Delta & {observation: 'hmr' | 'file-change'; hmrId?: string; triggerEventId?: string};
  type FileControl = {id: string; filePath: string; timestamp: number; expiresAt: number};
  const mode = options.mode || 'hmr';
  const channel = 'swarmwatch';
  const selector = mode === 'file-change' ? 'body *' : '[data-sw-file],main,header,nav,section,article,h1,h2,h3,p,button,img,[role="button"]';
  let nonce = '', parentOrigin = '', baselineReady = false;
  let hmrUntil = 0;
  let hmrId: string | undefined;
  const correlationDelay = 500;
  let pending: {change: Delta; measuredAt: number}[] = [];
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressPendingUntil = 0;
  let lastInteractionAt = 0;
  const controls = new Map<string, FileControl>();
  let previous = new Map<Element, Snapshot>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  const ids = new WeakMap<Element, string>();
  const observed = new WeakSet<Element>();
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  function send(kind: 'ready' | 'changes', changes?: unknown[]) {
    if (nonce && parentOrigin && parent !== window) parent.postMessage({ channel, kind, nonce, changes, mode, viewport: viewport() }, parentOrigin);
  }
  function hmrActive() { return mode === 'hmr' && !!hmrId && performance.now() <= hmrUntil; }
  function transmit(changes: ContextualDelta[]) {
    for (let offset = 0; offset < changes.length; offset += 50) send('changes', changes.slice(offset, offset + 50));
  }
  function clearPending() {
    pending = [];
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  function fileTrigger(change: Delta, measuredAt: number) {
    const capturedAt = Date.parse(change.capturedAt);
    let best: FileControl | undefined;
    for (const control of controls.values()) {
      if (measuredAt > control.expiresAt || capturedAt < control.timestamp - correlationDelay || capturedAt - control.timestamp >= 2500) continue;
      if (change.filePath && change.filePath !== control.filePath && !/\.(css|scss|sass|less)$/.test(control.filePath)) continue;
      if (!best || Math.abs(capturedAt - control.timestamp) <= Math.abs(capturedAt - best.timestamp)) best = control;
    }
    return best;
  }
  function schedulePending() {
    if (pendingTimer !== undefined || pending.length === 0) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      const cutoff = performance.now() - correlationDelay;
      const ready: ContextualDelta[] = [];
      pending = pending.filter(({change, measuredAt}) => {
        if (measuredAt > cutoff) return true;
        const match = fileTrigger(change, measuredAt);
        if (match) ready.push({...change, observation: 'file-change', triggerEventId: match.id});
        return false;
      });
      transmit(ready);
      schedulePending();
    }, Math.max(0, pending[0]!.measuredAt + correlationDelay - performance.now()));
  }
  function privateElement(element: Element) {
    const file = element.closest('[data-sw-file]')?.getAttribute('data-sw-file') || '';
    return !!element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-sw-private],script,style,noscript') || /(?:^|\/)(?:\.env(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$))/i.test(file) || /\.(?:pem|key|p12|pfx)$/i.test(file);
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
      componentName: (element.getAttribute('data-sw-component') || owner?.getAttribute('data-sw-component') || '').slice(0, 200) || undefined,
      tag: element.tagName.toLowerCase().slice(0, 30), text,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height }, style,
      media: element.tagName === 'IMG' ? `${element.getAttribute('src') || ''}:${(element as HTMLImageElement).naturalWidth}` : '',
      mapping: filePath ? 'instrumented' : inherited ? 'inferred' : 'unknown',
    };
  }
  function measure(emit: boolean, buffer = true) {
    const current = new Map<Element, Snapshot>();
    const changes: Delta[] = [];
    const measuredAt = performance.now();
    const bufferGeneric = mode === 'file-change' && buffer && measuredAt >= suppressPendingUntil;
    const append = (entry: Snapshot, kind: string) => {
      const { style: _style, media: _media, ...value } = entry;
      if (changes.length < 100) changes.push({ ...value, id: `${entry.id.slice(0,95)}:${crypto.randomUUID()}`, kind, capturedAt: new Date().toISOString(), viewport: viewport() });
    };
    const elements = Array.from(document.querySelectorAll(selector)).slice(0, 2500);
    for (const element of elements) {
      const entry = snapshot(element);
      if (!entry) continue;
      current.set(element, entry);
      if (!observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
      if (!emit && !bufferGeneric) continue;
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
        if (emit || bufferGeneric) append(before, 'deleted');
      }
    }
    previous = current;
    if (emit) transmit(changes.map(change => ({...change, observation: 'hmr', hmrId})));
    else if (bufferGeneric && changes.length) {
      // Let the watcher report a newer edit before choosing a trigger for this delta.
      pending = [...pending, ...changes.map(change => ({change, measuredAt}))].slice(-100);
      schedulePending();
    }
  }
  function schedule() {
    if (!baselineReady || timeout) return;
    timeout = setTimeout(() => { timeout = undefined; measure(hmrActive()); }, 80);
  }
  const resizeObserver = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || parent === window || !allowedOrigins.includes(event.origin)) return;
    if (!message || message.channel !== channel) return;
    if (message.kind === 'connect') {
      if (typeof message.nonce !== 'string' || message.nonce.length < 8 || message.nonce.length > 256) return;
      if (nonce && nonce !== message.nonce) { clearPending(); controls.clear(); hmrId = undefined; hmrUntil = 0; }
      nonce = message.nonce; parentOrigin = event.origin;
      if (baselineReady) send('ready');
      return;
    }
    if (mode !== 'file-change' || message.kind !== 'file-change' || !nonce || message.nonce !== nonce || event.origin !== parentOrigin) return;
    const file = message.filePath, id = message.eventId;
    const timestamp = typeof message.timestamp === 'string' ? Date.parse(message.timestamp) : NaN;
    const validPath = typeof file === 'string' && file.length > 0 && file.length <= 1024 && !file.includes('\\') && !file.includes('\0') && !file.startsWith('/') && !/^[a-z]:/i.test(file)
      && !file.split('/').some((part: string) => part === '..' || /^(?:\.git|node_modules|dist|coverage|\.swarmwatch|\.ssh|\.aws)$/.test(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials|secrets?)(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
    if (!validPath || typeof id !== 'string' || !id || id.length > 120 || controls.has(id) || !Number.isFinite(timestamp) || timestamp > Date.now() + 1000 || timestamp < Date.now() - 5000 || timestamp <= lastInteractionAt) return;
    controls.set(id, {id, filePath: file, timestamp, expiresAt: performance.now() + 1500});
    if (controls.size > 200) controls.delete(controls.keys().next().value!);
    schedule();
  });
  function initialize() {
    // Let the initial React render settle; that render is a baseline, never a build animation.
    setTimeout(() => {
      measure(false, false); baselineReady = true;
      mutations.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden', 'width', 'height'] });
      send('ready');
    }, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  window.addEventListener('swarmwatch:hmr-start', () => {
    if (mode !== 'hmr') return;
    // Capture interactive state before the actual Vite update starts. DOM observation
    // alone does not establish development activity.
    if (baselineReady) measure(hmrActive());
    hmrId = crypto.randomUUID(); hmrUntil = performance.now() + 1500;
    schedule();
  });
  window.addEventListener('swarmwatch:hmr', () => {
    if (mode !== 'hmr') return;
    // A trusted user interaction may have cancelled this burst in the meantime.
    if (!hmrId) return;
    hmrUntil = performance.now() + 1500;
    schedule(); setTimeout(schedule, 160);
  });
  const cancelForInteraction = (event: Event) => {
    if (!event.isTrusted) return;
    hmrId = undefined; hmrUntil = 0; clearPending(); controls.clear();
    suppressPendingUntil = performance.now() + 600;
    lastInteractionAt = Date.now();
    schedule(); // Subsequent user-driven mutations update the baseline only.
  };
  for (const eventName of ['pointerdown', 'keydown', 'input']) window.addEventListener(eventName, cancelForInteraction, { capture: true, passive: true });
  window.addEventListener('load', schedule, true);
  window.addEventListener('resize', () => { if (baselineReady) { measure(false, false); clearPending(); send('ready'); } });
  window.addEventListener('scroll', () => {
    // Scrolling changes viewport coordinates but is not a development event.
    if (baselineReady) { if (timeout) clearTimeout(timeout); timeout = undefined; measure(false, false); clearPending(); }
  }, { passive: true, capture: true });
  window.addEventListener('pagehide', () => { mutations.disconnect(); resizeObserver.disconnect(); if (timeout) clearTimeout(timeout); clearPending(); });
}
