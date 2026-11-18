import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { safeRelativePath, type EventInput, type EventType } from '@swarmwatch/core';

export interface AdapterContext {
  project: string;
  sessionId: string;
  emit: (event: EventInput) => unknown;
}
export interface AgentAdapter {
  /** Emits validated, allowlisted observations and also returns them for inspection. */
  ingest(raw: unknown): EventInput[];
  /** Reports collector disconnection, not a claim that the model completed its work. */
  finish(): EventInput[];
}
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : undefined;
const identity = (prefix: string, value: string) => `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;

/** Resolve deleted files too, but never accept a symlink escaping the monitored project. */
export function adapterFilePath(project: string, input: unknown): string | undefined {
  const value = string(input);
  if (!value || value.includes('\0') || value.includes('\\')) return;
  const root = realpathSync(project);
  const target = resolve(root, value);
  const path = relative(root, target).split(sep).join('/');
  if (!safeRelativePath(path)) return;
  let ancestor = target;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const actual = relative(root, realpathSync(ancestor));
  if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) return;
  return path;
}

/** Narrow command-name classification; no command text or output is retained. */
export function commandKind(value: unknown): 'test' | 'build' | undefined {
  if (typeof value !== 'string' || value.length > 10000) return;
  // Classify only simple invocations. A shell's final exit status cannot establish
  // an earlier test/build result in a compound command, pipeline or substitution.
  // Reject even quoted metacharacters rather than pretending to parse shell syntax.
  if (/[|;&`$()<>\\#\u0000-\u001f\u007f]/.test(value)) return;
  const cmd = value.trim();
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test:[\w-]+|test)|(?:npx\s+)?(?:vitest|jest|pytest|playwright\s+test)|python(?:3)?\s+-m\s+(?:pytest|unittest)|(?:cargo|go)\s+test)(?=\s|$)/.test(cmd)) return 'test';
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+build|(?:npx\s+)?vite\s+build|cargo\s+build|go\s+build)(?=\s|$)/.test(cmd)) return 'build';
}
function publisher(ctx: AdapterContext) {
  return (type: EventType, agentId: string, metadata: RecordValue = {}, path?: unknown, status = 'observed', suppliedId?: string): EventInput => {
    const filePath = adapterFilePath(ctx.project, path);
    const event: EventInput = {
      eventId: suppliedId ?? randomUUID(), sessionId: ctx.sessionId, agentId,
      timestamp: new Date().toISOString(), eventType: type, status,
      source: 'agent-hook', confidence: 'reported', metadata,
      ...(filePath ? { filePath } : {}),
    };
    ctx.emit(event);
    return event;
  };
}
function boundedSet(limit = 10000) {
  const seen = new Set<string>();
  return (key: string) => {
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > limit) seen.delete(seen.values().next().value!);
    return false;
  };
}

export function createCodexAdapter(ctx: AdapterContext): AgentAdapter {
  const publish = publisher(ctx), duplicate = boundedSet();
  let agent = 'codex:unassigned', started = false;
  const commands = new Map<string, 'test' | 'build'>();
  return {
    ingest(raw) {
      const data = object(raw), type = string(data.type), item = object(data.item);
      const out: EventInput[] = [];
      const add = (eventType: EventType, meta: RecordValue = {}, path?: unknown, status?: string) => out.push(publish(eventType, agent, { adapter: 'codex', ...meta }, path, status));
      if (type === 'thread.started' && string(data.thread_id)) {
        if (duplicate(`thread:${data.thread_id}`)) return out;
        agent = identity('codex', data.thread_id as string); started = true;
        add('agent.started', { transport: 'exec-jsonl' }, undefined, 'connected');
      } else if (type === 'turn.started') add('task.started', { kind: 'turn' }, undefined, 'running');
      else if (type === 'turn.completed') add('task.completed', { kind: 'turn' }, undefined, 'completed');
      else if (type === 'turn.failed' || type === 'error') add('error.detected', { kind: type }, undefined, 'failed');
      else if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
        const id = string(item.id);
        if (!id || duplicate(`${type}:${id}:${item.status ?? ''}`)) return out;
        if (item.type === 'file_change' && type === 'item.completed') {
          if (item.status !== 'completed') { add('error.detected', { kind: 'patch', itemId: id }, undefined, 'failed'); return out; }
          if (!Array.isArray(item.changes)) return out;
          for (const change of item.changes.slice(0, 1000)) {
            const file = object(change), path = adapterFilePath(ctx.project, file.path);
            if (!path) continue;
            const kind = file.kind === 'add' ? 'file.created' : file.kind === 'delete' ? 'file.deleted' : file.kind === 'update' ? 'file.modified' : undefined;
            if (kind) add(kind, { itemId: id }, path, 'completed');
          }
        } else if (item.type === 'command_execution') {
          const kind = typeof item.command === 'string' ? commandKind(item.command) : commands.get(id);
          if (kind) commands.set(id, kind);
          const meta = { itemId: id, kind: kind ?? 'command', ...(kind ? { classification: 'command-name-heuristic' } : {}) };
          if (type === 'item.started') {
            add('task.started', meta, undefined, 'running');
            if (kind) add(`${kind}.started`, meta, undefined, 'running');
          } else if (type === 'item.completed') {
            const exit = typeof item.exit_code === 'number' && Number.isInteger(item.exit_code) ? item.exit_code : undefined;
            const status = exit === undefined ? 'unknown' : exit === 0 ? 'completed' : 'failed';
            add('task.completed', { ...meta, ...(exit === undefined ? {} : { exitCode: exit }) }, undefined, status);
            if (kind === 'test' && exit !== undefined) add(exit === 0 ? 'test.passed' : 'test.failed', { ...meta, exitCode: exit }, undefined, status);
            if (kind === 'build' && exit !== undefined) add('build.completed', { ...meta, exitCode: exit }, undefined, status);
            if (exit !== undefined && exit !== 0) add('error.detected', { ...meta, exitCode: exit }, undefined, 'failed');
            commands.delete(id);
          }
          if (commands.size > 1000) commands.delete(commands.keys().next().value!);
        } else if (item.type === 'error') add('error.detected', { itemId: id }, undefined, 'failed');
      }
      return out;
    },
    finish() {
      commands.clear();
      if (!started) return [];
      started = false;
      return [publish('agent.finished', agent, { adapter: 'codex', reason: 'collector-ended' }, undefined, 'disconnected')];
    },
  };
}

export function createOpenCodeAdapter(ctx: AdapterContext): AgentAdapter {
  const publish = publisher(ctx), duplicate = boundedSet();
  const agents = new Set<string>(), commands = new Map<string, 'test' | 'build'>();
  return {
    ingest(raw) {
      const data = object(raw), properties = object(data.properties), type = string(data.type), out: EventInput[] = [];
      const eventId = string(data.id);
      if (eventId && duplicate(`event:${eventId}`)) return out;
      const info = object(properties.info);
      const sessionId = string(properties.sessionID);
      const sid = sessionId ?? string(info.id);
      const agent = sid ? identity('opencode', sid) : 'opencode:unassigned';
      const add = (eventType: EventType, meta: RecordValue = {}, path?: unknown, status?: string, id = agent) => out.push(publish(eventType, id, { adapter: 'opencode-v1', ...meta }, path, status));
      // The project-scoped stream can begin after a session was created.
      const observeAgent = (id: string) => {
        if (agents.has(id)) return;
        agents.add(id);
        add('agent.started', { transport: 'sse' }, undefined, 'connected', id);
      };
      if (type === 'session.created' && sid) {
        // Session event belongs to its declared directory when provided.
        if (typeof info.directory === 'string' && resolve(info.directory) !== realpathSync(ctx.project)) return out;
        observeAgent(agent);
      } else if (type === 'session.deleted' && sid) {
        agents.delete(agent); add('agent.finished', { reason: 'session-deleted' }, undefined, 'completed');
      } else if (type === 'session.status' && sessionId) {
        const status = object(properties.status).type;
        if (status === 'busy' || status === 'retry' || status === 'idle') observeAgent(agent);
        if (status === 'busy') add('task.started', { kind: 'session-turn' }, undefined, 'running');
        else if (status === 'retry') add('error.detected', { kind: 'retry' }, undefined, 'retrying');
      } else if (type === 'session.idle' && sessionId) {
        observeAgent(agent);
        add('task.completed', { kind: 'session-turn' }, undefined, 'idle');
      } else if (type === 'session.error') {
        if (sessionId) observeAgent(agent);
        add('error.detected', { kind: 'session' }, undefined, 'failed');
      } else if (type === 'file.edited') {
        const path = adapterFilePath(ctx.project, properties.file);
        if (path) add('file.modified', { attribution: 'unassigned: upstream event has no session ID' }, path, 'completed', 'opencode:unassigned');
      } else if (type === 'message.part.updated') {
        const part = object(properties.part), state = object(part.state), input = object(state.input), meta = object(state.metadata);
        const partId = string(part.id), partSessionId = string(part.sessionID);
        if (part.type !== 'tool' || !partId || !partSessionId || duplicate(`tool:${partId}:${state.status}`)) return out;
        const id = identity('opencode', partSessionId);
        if (state.status === 'running' || state.status === 'completed' || state.status === 'error') observeAgent(id);
        const kind = part.tool === 'bash' ? (typeof input.command === 'string' ? commandKind(input.command) : commands.get(partId)) : undefined;
        if (kind) commands.set(partId, kind);
        const details = { itemId: partId, kind: kind ?? 'tool', ...(kind ? { classification: 'command-name-heuristic' } : {}) };
        if (state.status === 'running') {
          add('task.started', details, undefined, 'running', id);
          if (kind) add(`${kind}.started`, details, undefined, 'running', id);
        } else if (state.status === 'completed' || state.status === 'error') {
          const exit = typeof meta.exit === 'number' && Number.isInteger(meta.exit) ? meta.exit : undefined;
          const status = state.status === 'error' || (exit !== undefined && exit !== 0) ? 'failed' : 'completed';
          add('task.completed', { ...details, ...(exit === undefined ? {} : { exitCode: exit }) }, undefined, status, id);
          // A generic tool completion without explicit command exit code is not a passed test.
          if (kind === 'test' && exit !== undefined) add(exit === 0 ? 'test.passed' : 'test.failed', { ...details, exitCode: exit }, undefined, status, id);
          if (kind === 'build' && exit !== undefined) add('build.completed', { ...details, exitCode: exit }, undefined, status, id);
          if (status === 'failed') add('error.detected', details, undefined, 'failed', id);
          commands.delete(partId);
        }
        if (commands.size > 1000) commands.delete(commands.keys().next().value!);
      }
      return out;
    },
    finish() {
      const out = [...agents].map(agent => publish('agent.finished', agent, { adapter: 'opencode-v1', reason: 'collector-ended' }, undefined, 'disconnected'));
      agents.clear(); commands.clear(); return out;
    },
  };
}

export function localOpenCodeUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash) throw new Error('OpenCode URL must be an HTTP loopback URL without embedded credentials');
  return url;
}
const delay = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
});

/** v1 read-only SSE subscription. Reconnects cannot recover upstream events missed during gaps. */
export async function connectOpenCode(input: string, ctx: AdapterContext, signal: AbortSignal, username = 'opencode', password?: string): Promise<void> {
  const url = localOpenCodeUrl(input);
  url.pathname = '/event'; url.search = ''; url.searchParams.set('directory', realpathSync(ctx.project));
  const adapter = createOpenCodeAdapter(ctx);
  let retry = 500;
  try {
    while (!signal.aborted) {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (password) headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const response = await fetch(url, { headers, signal, redirect: 'error' });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('OpenCode SSE unavailable');
        retry = 500;
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
            if (buffer.length > 256 * 1024) throw new Error('OpenCode SSE frame exceeded limit');
            let end: number;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) { try { adapter.ingest(JSON.parse(data)); } catch { /* unknown/malformed upstream event is ignored */ } }
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (!signal.aborted) throw new Error('OpenCode SSE disconnected');
      } catch {
        if (signal.aborted) break;
        // Transport status uses no claimed agent identity or fabricated cursor target.
        ctx.emit({ eventId: randomUUID(), sessionId: ctx.sessionId, agentId: 'opencode:transport', timestamp: new Date().toISOString(), eventType: 'error.detected', status: 'reconnecting', source: 'runtime', confidence: 'measured', metadata: { adapter: 'opencode-v1', scope: 'transport', upstreamGap: true } });
        await delay(retry, signal); retry = Math.min(retry * 2, 10000);
      }
    }
  } finally { adapter.finish(); }
}
