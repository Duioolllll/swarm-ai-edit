# Official agent integrations researched for SwarmWatch

Research date: 2026-11-17. These are independent observations of public interfaces, not reused implementation code. npm registry currently reports `@openai/codex` **0.169.0** and `opencode-ai` **1.19.5**. Git tags below were fetched and inspected. The moving OpenCode main branch is already restructuring its API; target v1 explicitly and fail visibly on unknown shapes.

## OpenAI Codex CLI

Supported MVP transport: capture stdout of **`codex exec --json <prompt>`** as newline-delimited JSON. `--json` is an official flag; stderr remains separate. A user can run Codex themselves and pipe JSONL into a SwarmWatch ingest CLI, avoiding claims to attach to arbitrary already-running interactive Codex sessions. A collector may also tail an explicitly provided JSONL file. Do not silently scan private Codex session storage.

Official schema at `openai/codex`, tag `rust-v0.169.0`, `codex-rs/exec/src/exec_events.rs`:

- `thread.started { thread_id }`: observed agent identity (thread).
- `turn.started`: task/turn start.
- `turn.completed { usage }`: task complete; it is not evidence that every desired test passed.
- `turn.failed { error: {message} }`, `error {message}`: actual errors.
- `item.started`, `item.updated`, `item.completed`, each with `item {id, type, ...}`.
- `item.type=command_execution`: `command`, `aggregated_output`, nullable `exit_code`, `status: in_progress|completed|failed|declined`. A test/build classification inferred from a command name must be labeled heuristic. SwarmWatch classifies simple invocations only; compound commands, pipelines, substitutions, redirections, and control characters are rejected for test/build classification because their final shell exit status can hide an earlier failure. Only `exit_code===0` establishes command-process success; unknown exit status is not test success. A successful process exit does not establish that any tests ran.
- `item.type=file_change`: `changes:[{path, kind:add|delete|update}]`, `status: in_progress|completed|failed`. Documented to be emitted only as a completed item after the patch succeeds/fails; it does not offer pre-patch start timing. Map successful changes to file events, failed changes to errors. Actual filesystem watcher remains authoritative about disk observations.
- `reasoning`, `agent_message`, `todo_list`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `error` also exist. Avoid collecting arbitrary raw messages/output since they can carry secrets. Map only known safe fields.
- `collab_tool_call` includes `sender_thread_id`, `receiver_thread_ids`, `agents_states`, `tool` (`spawn_agent`, `send_input`, `wait`, `close_agent`). Useful future multi-agent identity evidence; never invent workers just because concurrency is possible.

Do not assume a generic universal Codex Hook API. Current main has evolving lifecycle hooks, but stable JSONL is the narrow documented surface sufficient for this implementation. Do not state reading/planning intent from file changes.

Sources:
- https://developers.openai.com/codex/noninteractive
- https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/exec/src/cli.rs (`--json`, stdout events)
- https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/exec/src/exec_events.rs (full schema)
- https://github.com/openai/codex/blob/rust-v0.169.0/docs/exec.md (links official noninteractive guide)

## OpenCode v1

Supported MVP transport: user starts **`opencode serve --hostname 127.0.0.1 --port 4096`** (or uses an explicitly configured existing server); collector subscribes read-only to SSE **GET `/event?directory=<project absolute path>`**. Server docs also expose global SSE `/global/event` wrapped by directory; prefer instance `/event` to scope the watched project. No need to drive the agent, submit prompts, or expose command execution APIs. TUI defaults to a random port; `opencode serve` starts a separate server rather than automatically attaching to that random TUI server.

Official v1 event union at tag `v1.19.5`, `packages/sdk/js/src/gen/types.gen.ts`:

- `server.connected { properties:{} }`: transport connected; **not** an agent started.
- `session.created {properties:{info:{id,directory,parentID?,...}}}`: actual session identity. `session.deleted` has same info shape.
- `session.status {properties:{sessionID,status:{type: idle|busy|retry, ...}}}`: task activity; busy is not proof of editing.
- `session.idle {properties:{sessionID}}`: session turn idle, not session deletion; do not claim agent permanently finished.
- `session.error {properties:{sessionID?,error?}}`: actual error.
- `file.edited {properties:{file}}`: actual edit, but **no sessionID**, so attribution to a particular parallel session is unknown. `file.watcher.updated {properties:{file,event:add|change|unlink}}` also exists but can describe non-agent changes.
- `message.part.updated {properties:{part,delta?}}`: `part.type=tool` has id/sessionID/messageID/callID/tool/state. `state.status=pending|running|completed|error`; running input may contain command; completed metadata/output may include exit details but there is no top-level universal exit_code field. Do not claim a generic tool completion means tests passed.
- Tool part `state` input/output may contain secrets; drop raw output, commands, prompt content unless explicitly safe. Known path fields can be normalized with project containment checks.
- Other declared events include todo.updated, command.executed, session.diff, permission events. A `command.executed` slash-command event is not a test outcome.

SSE disconnect recovery: reconnect with backoff and report connectivity separately. Do not claim the upstream SSE guarantees durable catch-up: events during disconnection may be lost. SwarmWatch can guarantee its own persisted event-log recovery to dashboard clients, while disclosing upstream gaps.

OpenCode also officially supports local plugins `.opencode/plugins/*.js|ts`, global `~/.config/opencode/plugins/`, or config `plugin` npm packages. Plugin function `async ({project,client,$,directory,worktree}) => ({ event: async ({event}) => ... })` observes bus events; hooks `tool.execute.before/after` are declared. This is a future plugin integration path if SSE not used. Do not install user project hooks silently or claim this implementation needs to modify user source.

Authentication: official `OPENCODE_SERVER_PASSWORD` HTTP basic auth and optional `OPENCODE_SERVER_USERNAME` (default `opencode`). Existing bindings should be reused; never put credentials in a URL, event log, or exported session.

Sources:
- https://opencode.ai/docs/server/
- https://opencode.ai/docs/plugins/
- https://github.com/anomalyco/opencode/blob/v1.19.5/packages/web/src/content/docs/server.mdx
- https://github.com/anomalyco/opencode/blob/v1.19.5/packages/web/src/content/docs/plugins.mdx
- https://github.com/anomalyco/opencode/blob/v1.19.5/packages/sdk/js/src/gen/types.gen.ts
- https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/server/routes/instance/httpapi/groups/event.ts

## Required honesty for both

File-watcher fallback is always usable without provider credentials and must use a non-agent observed-source identity, labeled “file change / inferred task.” DOM mutation plus correlated file event supports an animation, not proof of the agent's intention. Test events need explicit lifecycle/outcome evidence or a separate `swarmwatch run --kind test -- <command>` wrapper with real process exit code. Running tests in this environment validates adapters with schema fixtures/mock SSE; it does not establish a real authenticated provider run unless explicitly performed and reported.
