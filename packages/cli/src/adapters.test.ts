import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventInputSchema, type EventInput } from '@swarmwatch/core';
import { adapterFilePath, commandKind, connectOpenCode, createCodexAdapter, createOpenCodeAdapter, localOpenCodeUrl } from './adapters.js';

let project: string;
const collected = () => {
  const events: EventInput[] = [];
  return { events, ctx: { project, sessionId: 'test-session', emit: (event: EventInput) => { EventInputSchema.parse(event); events.push(event); } } };
};
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'swarmwatch-adapter-')); mkdirSync(join(project, 'src')); });
afterEach(() => { rmSync(project, { recursive: true, force: true }); });

describe('Codex official exec JSONL adapter', () => {
  it('never infers a test/build outcome from compound shell exit codes', () => {
    const { ctx, events } = collected(), adapter = createCodexAdapter(ctx);
    adapter.ingest({ type: 'thread.started', thread_id: 'compound-thread' });
    for (const [index, command] of ['npm test || true', 'npm test; echo ok', 'npm test | cat', 'npm run build && echo done', 'pytest\necho ok'].entries()) {
      adapter.ingest({ type: 'item.completed', item: { id: `compound${index}`, type: 'command_execution', command, status: 'completed', exit_code: 0 } });
    }
    // A changed completion payload must not fall back to an earlier classification.
    adapter.ingest({ type: 'item.started', item: { id: 'changed', type: 'command_execution', command: 'npm test', status: 'in_progress' } });
    adapter.ingest({ type: 'item.completed', item: { id: 'changed', type: 'command_execution', command: 'npm test || true', status: 'completed', exit_code: 0 } });
    expect(events.filter(e => ['test.passed', 'test.failed', 'build.completed'].includes(e.eventType))).toHaveLength(0);
    expect(events.filter(e => e.eventType === 'task.completed')).toHaveLength(6);
  });
  it('reports one real thread, maps successful patches, and discards raw text and secrets', () => {
    const { events, ctx } = collected(), adapter = createCodexAdapter(ctx);
    const start = { type: 'thread.started', thread_id: 'thread-real-1' };
    adapter.ingest(start); adapter.ingest(start);
    adapter.ingest({ type: 'turn.started' });
    adapter.ingest({ type: 'item.completed', item: { id: 'patch1', type: 'file_change', status: 'completed', changes: [
      { path: join(project, 'src/Navbar.tsx'), kind: 'add' }, { path: 'src/Old.tsx', kind: 'delete' },
      { path: '.env.local', kind: 'update' }, { path: '../outside.tsx', kind: 'update' },
    ], text: 'sk-supersecrettoken' } });
    adapter.ingest({ type: 'item.completed', item: { id: 'message', type: 'agent_message', text: 'password=secret' } });
    adapter.ingest({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } });
    adapter.finish(); adapter.finish();
    expect(events.filter(e => e.eventType === 'agent.started')).toHaveLength(1);
    expect(events.filter(e => e.eventType === 'agent.finished')).toHaveLength(1);
    expect(events.filter(e => e.eventType.startsWith('file.')).map(e => [e.eventType, e.filePath])).toEqual([
      ['file.created', 'src/Navbar.tsx'], ['file.deleted', 'src/Old.tsx'],
    ]);
    expect(new Set(events.map(e => e.agentId)).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain('supersecret');
    expect(JSON.stringify(events)).not.toContain('password');
    expect(events[events.length - 1].status).toBe('disconnected');
  });

  it('derives test/build classification narrowly and requires actual command exit codes', () => {
    const { ctx, events } = collected(), adapter = createCodexAdapter(ctx);
    adapter.ingest({ type: 'thread.started', thread_id: 'x' });
    adapter.ingest({ type: 'item.started', item: { id: 'test1', type: 'command_execution', command: 'npm test', status: 'in_progress' } });
    adapter.ingest({ type: 'item.completed', item: { id: 'test1', type: 'command_execution', command: 'npm test', status: 'completed', exit_code: 0, aggregated_output: 'token=SECRET' } });
    adapter.ingest({ type: 'item.completed', item: { id: 'test2', type: 'command_execution', command: 'pytest', status: 'failed', exit_code: 1 } });
    adapter.ingest({ type: 'item.completed', item: { id: 'test3', type: 'command_execution', command: 'vitest run', status: 'declined', exit_code: null } });
    adapter.ingest({ type: 'item.completed', item: { id: 'build', type: 'command_execution', command: 'npm run build', status: 'failed', exit_code: 2 } });
    expect(events.filter(e => e.eventType === 'test.started')).toHaveLength(1);
    expect(events.filter(e => e.eventType === 'test.passed')).toHaveLength(1);
    expect(events.filter(e => e.eventType === 'test.failed')).toHaveLength(1);
    expect(events.find(e => e.eventType === 'build.completed')?.status).toBe('failed');
    expect(events.find(e => e.eventType === 'test.passed')?.metadata.classification).toBe('command-name-heuristic');
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  it('does not emit failed patch changes or infer agents from unknown events', () => {
    const { ctx, events } = collected(), adapter = createCodexAdapter(ctx);
    adapter.ingest({ type: 'item.completed', item: { id: 'bad', type: 'file_change', status: 'failed', changes: [{ path: 'src/a.tsx', kind: 'add' }] } });
    adapter.ingest({ type: 'hypothetical.planning', agent: 'imaginary-worker' });
    expect(events.map(e => e.eventType)).toEqual(['error.detected']);
    expect(adapter.finish()).toEqual([]);
  });
});

describe('OpenCode official v1 SSE event adapter', () => {
  it('keeps transport, real sessions, and unassigned edits distinct', () => {
    const { ctx, events } = collected(), adapter = createOpenCodeAdapter(ctx);
    adapter.ingest({ type: 'server.connected', properties: {} });
    expect(events).toHaveLength(0);
    adapter.ingest({ id: 'evt1', type: 'session.created', properties: { info: { id: 's1', directory: project } } });
    adapter.ingest({ id: 'evt2', type: 'session.created', properties: { info: { id: 's2', directory: project } } });
    adapter.ingest({ id: 'evt2', type: 'session.created', properties: { info: { id: 's2', directory: project } } });
    adapter.ingest({ type: 'file.edited', properties: { file: join(project, 'src/App.tsx') } });
    adapter.ingest({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } });
    adapter.ingest({ type: 'session.idle', properties: { sessionID: 's1' } });
    expect(events.filter(e => e.eventType === 'agent.started')).toHaveLength(2);
    expect(events.find(e => e.eventType === 'file.modified')?.agentId).toBe('opencode:unassigned');
    expect(events.filter(e => e.eventType === 'agent.finished')).toHaveLength(0);
    adapter.finish();
    expect(events.filter(e => e.eventType === 'agent.finished')).toHaveLength(2);
  });

  it('registers existing sessions from scoped activity even without a creation event', () => {
    const { ctx, events } = collected(), adapter = createOpenCodeAdapter(ctx);
    adapter.ingest({ type: 'server.connected', properties: {} });
    adapter.ingest({ type: 'file.edited', properties: { file: 'src/App.tsx' } });
    adapter.ingest({ type: 'session.error', properties: {} });
    expect(events.filter(e => e.eventType === 'agent.started')).toHaveLength(0);

    const status = adapter.ingest({ type: 'session.status', properties: { sessionID: 'existing', status: { type: 'busy' } } });
    expect(status.map(e => e.eventType)).toEqual(['agent.started', 'task.started']);
    expect(status[1].agentId).toBe(status[0].agentId);
    const idle = adapter.ingest({ type: 'session.idle', properties: { sessionID: 'existing' } });
    expect(idle.map(e => e.eventType)).toEqual(['task.completed']);
    expect(idle[0].agentId).toBe(status[0].agentId);
    expect(adapter.ingest({ type: 'session.created', properties: { info: { id: 'existing', directory: project } } })).toEqual([]);

    const tool = adapter.ingest({ type: 'message.part.updated', properties: {
      part: { id: 'part1', sessionID: 'tool-only', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'npm test' } } },
    } });
    expect(tool.map(e => e.eventType)).toEqual(['agent.started', 'task.started', 'test.started']);
    expect(tool[0].agentId).not.toBe(status[0].agentId);
    expect(adapter.finish().map(e => e.agentId)).toEqual([status[0].agentId, tool[0].agentId]);
  });

  it('never treats generic tool completion as test success, filters private files', () => {
    const { ctx, events } = collected(), adapter = createOpenCodeAdapter(ctx);
    adapter.ingest({ type: 'message.part.updated', properties: { part: { id: 'tool1', sessionID: 's1', type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'npm test' } } } } });
    adapter.ingest({ type: 'message.part.updated', properties: { part: { id: 'tool1', sessionID: 's1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, output: 'api_key=PRIVATE' } } } });
    adapter.ingest({ type: 'message.part.updated', properties: { part: { id: 'compound', sessionID: 's1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test || true' }, metadata: { exit: 0 } } } } });
    adapter.ingest({ type: 'file.edited', properties: { file: '.env' } });
    expect(events.filter(e => e.eventType === 'test.started')).toHaveLength(1);
    expect(events.filter(e => e.eventType === 'test.passed')).toHaveLength(0);
    expect(events.filter(e => e.eventType === 'file.modified')).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  });

  it('connects to a real local SSE endpoint, reconnects, deduplicates IDs, and aborts cleanly', async () => {
    const { ctx, events } = collected();
    const controller = new AbortController();
    let connections = 0;
    const server = createServer((req, res) => {
      expect(req.url).toContain('/event?directory=');
      connections++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'repeat', type: 'session.created', properties: { info: { id: 'real', directory: project } } })}\n\n`);
      if (connections === 1) res.end();
      else { res.write(`data: ${JSON.stringify({ id: 'edit', type: 'file.edited', properties: { file: 'src/App.tsx' } })}\n\n`); setTimeout(() => controller.abort(), 20); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server port');
    try {
      await connectOpenCode(`http://127.0.0.1:${address.port}`, ctx, controller.signal);
      expect(connections).toBe(2);
      expect(events.filter(e => e.eventType === 'agent.started')).toHaveLength(1);
      expect(events.filter(e => e.eventType === 'file.modified')).toHaveLength(1);
      expect(events.some(e => e.metadata.upstreamGap === true)).toBe(true);
    } finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

it('confines paths and rejects symlinks, credentials, traversal and unsafe endpoints', () => {
  writeFileSync(join(project, 'src/a.tsx'), '');
  symlinkSync('/tmp', join(project, 'escape'));
  expect(adapterFilePath(project, 'src/a.tsx')).toBe('src/a.tsx');
  for (const path of ['../escape.tsx', '.env.production', 'secrets.json', 'escape/outside.tsx', 'src\\a.tsx']) expect(adapterFilePath(project, path)).toBeUndefined();
  for (const url of ['https://127.0.0.1:4096', 'http://example.com', 'http://user:pass@localhost:4096', 'http://localhost.evil:4096']) expect(() => localOpenCodeUrl(url)).toThrow();
  expect(localOpenCodeUrl('http://localhost:4096').port).toBe('4096');
  expect(commandKind('echo npm test')).toBeUndefined();
  expect(commandKind('npm run build')).toBe('build');
});

it('classifies simple invocations and rejects shell syntax or command-name prefixes', () => {
  for (const command of ['npm test', 'npm run test:unit -- --watch=false', 'npx vitest run', 'python3 -m pytest tests/unit', 'cargo test --all']) expect(commandKind(command)).toBe('test');
  for (const command of ['npm run build', 'npx vite build --mode production', 'go build ./cmd/app']) expect(commandKind(command)).toBe('build');
  for (const command of ['npm test || true', 'npm test; echo ok', 'npm test | cat', 'npm test && echo ok', 'npm test &', 'npm test `echo hi`', 'npm test $(echo hi)', 'npm test > result.txt', 'npm test < input.txt', 'npm test\necho ok', 'npm test\r\necho ok', 'npm test\\\n; true', 'npm test # comment', 'npm test-pretend', 'npm run build-other', 'vitest-pretend run']) expect(commandKind(command)).toBeUndefined();
});
