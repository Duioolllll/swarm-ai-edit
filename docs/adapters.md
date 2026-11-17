# Adapter 개발 가이드

Adapter는 실제 관찰을 공통 이벤트로 옮깁니다. 모델의 의도나 미지원 기능을 만들어내는 계층이 아닙니다. 현재 구현은 `packages/cli/src/adapters.ts`에 있으며 interface를 통해 collector와 분리합니다. 런타임 npm plugin 자동 발견 기능은 아직 없습니다. 새 adapter를 구현한 뒤 CLI 옵션에서 명시적으로 연결하세요.

## 최소 계약

```ts
interface AdapterContext {
  project: string;       // realpath인 허용 프로젝트 디렉터리
  sessionId: string;     // SwarmWatch가 생성한 현재 세션
  emit: (event: EventInput) => unknown;
}
interface AgentAdapter {
  ingest(raw: unknown): EventInput[];
  finish(): EventInput[];
}
```

`ingest`는 모르는 payload를 무시하고 공식 스키마의 allowlist 필드만 읽습니다. `finish`는 수집 종료·연결 해제를 보고할 수 있지만 모델의 작업 성공을 주장해서는 안 됩니다. transport 연결 성공만으로 에이전트를 등록하지 마세요. 안정된 upstream session/thread ID로 identity를 만들고 중복 lifecycle/tool 이벤트는 bounded set으로 제거하세요.

## EventInput

실제 타입과 검증은 `packages/core/src/index.ts`의 `EventInputSchema`가 기준입니다.

| 필드 | 계약 |
| --- | --- |
| `eventId` | 1–120자, 재전송 시 같은 의미의 이벤트에는 안정된 ID 권장 |
| `sessionId` | 현재 SwarmWatch 세션, 1–120자 |
| `agentId` | 관찰된 thread/session identity, 1–120자; 작성자 불명은 unassigned |
| `timestamp` | ISO datetime |
| `eventType` | 아래 열거형 중 하나 |
| `filePath` | 선택, 프로젝트 기준 상대 POSIX 경로, 최대 1024자 |
| `componentName` | 선택, 최대 200자; 확실한 근거가 없으면 생략 |
| `status` | 최대 100자, observed/running/completed/failed/disconnected 등 |
| `source` | `agent-hook` / `file-watcher` / `runtime` |
| `confidence` | `reported` / `inferred` / `measured` |
| `metadata` | 제한된 안전한 부가정보; 원문 통째 저장 금지 |

이벤트 종류:

```text
agent.started  agent.finished  task.started  task.completed
file.created   file.modified   file.deleted
component.detected  component.updated  style.changed
test.started   test.passed     test.failed
build.started  build.completed  error.detected
```

`source=agent-hook`는 공식 agent event transport의 관찰을 뜻하며, 모든 CLI에 공통 Hook API가 존재한다는 뜻은 아닙니다. 파일 관찰은 `file-observer`, `file-watcher`, `inferred`를 사용합니다. DOM geometry는 `runtime`, `measured`지만 mapping·원인 추정은 `metadata.mapping`, `metadata.reason`으로 별도로 설명합니다.

## 안전한 경로·metadata

`adapterFilePath(project, input)`는 realpath confinement, 삭제된 파일의 가장 가까운 기존 부모, symlink 탈출, 상대 경로와 sensitive path를 검증합니다. 파일 이벤트는 검증된 경로가 없으면 발행하지 마세요. collector도 세션과 상대 경로를 다시 검증합니다.

안전한 metadata의 예는 upstream item ID, command 종류, 정수 exit code, adapter 버전, 연결 상태입니다. 프롬프트, 메시지, 사고 과정, command 문자열·출력, 원본 diff, 인증 헤더는 저장하지 마세요. collector의 `redact`는 비밀 키 이름과 일부 문자열 패턴을 제한하지만 완전한 비밀 탐지기가 아닙니다.

테스트·빌드 결과는 명시적 실행 결과에서만 만드세요. 현재 adapter의 command-name 분류는 heuristic입니다. 복합 shell 명령의 최종 exit status는 내부 테스트 성공의 근거가 아니므로 결과 분류에서 제외합니다. 알 수 없는 exit status나 generic tool completion으로 `test.passed`를 만들지 마세요. exit 0 역시 테스트가 하나 이상 실행되었음을 보장하지 않으므로 UI·문서에서 그 범위를 설명하세요.

## 현재 adapter의 범위

- **Codex:** `codex exec --json` JSONL의 thread/turn/item lifecycle, 성공한 file_change, 제한된 command 분류. 한 wrapper당 한 thread. 협업 receiver task 연결·interactive attach는 미지원.
- **OpenCode v1:** 프로젝트 `directory`로 scope한 `/event` SSE, 실제 session/tool/file 이벤트. upstream `file.edited`에는 session ID가 없어 unassigned. Basic auth는 환경 변수로만 전달합니다. 재연결 backoff와 upstream gap 경고가 있으며 gap 동안의 이벤트 복구는 보장하지 않습니다.
- **File observer:** 에이전트 인증 없이 동작. 파일 작성자와 내부 의도는 알 수 없습니다.

공식 자료와 조사한 스키마 버전은 [adapter-research.md](adapter-research.md)에 있습니다. 해당 문서의 future integration 제안은 구현된 CLI 기능과 구별하세요. 현재 CLI는 JSONL 파일 ingest나 `run` subcommand를 제공하지 않습니다.

## UI 및 DOM bridge와의 연결

Adapter 이벤트는 직접 DOM 좌표를 만들지 않습니다. Vite plugin이 삽입한 `data-sw-file`, `data-sw-component`, `data-sw-id`와 실제 브라우저의 geometry를 사용합니다. 민감한 요소는 `data-sw-private`로 제외합니다. 애플리케이션에서 이 instrumentation attribute를 위조하거나 변경하면 mapping 신뢰도가 떨어집니다.

새 framework bridge는 정확한 parent origin·Window·nonce를 확인해야 합니다. 무차별 `postMessage('*')`, 교차 출처 iframe DOM 접근, 임의 HTML/스크립트 replay는 사용하지 마세요. 초기 render·scroll·resize·일반 입력 변화는 개발 작업으로 만들어내지 않습니다. HMR 관찰 구간과 대응 파일 이벤트가 없는 target은 상태 패널에만 남기거나 발행하지 않습니다.

## 테스트

`packages/cli/src/adapters.test.ts`의 방식으로 정상·미지원·중복 payload, 실패/불명 exit, 경로 탈출, symlink, 비밀 포함 출력 배제, 여러 identity, transport reconnect를 검증하세요. mock/fixture 통과와 실제 인증된 provider 실행은 별개의 검증입니다. 새로운 provider를 실제 실행하지 않았다면 그 한계를 기록하세요.
