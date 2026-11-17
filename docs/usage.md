# 사용 설명서

## 기본 파일 관찰

Node.js 24+에서 저장소 루트의 `npm ci`, `npm run build`를 마친 뒤 실행합니다.

```bash
node packages/cli/dist/index.js watch --project /absolute/path/my-app
```

Preview URL이나 프레임워크·API 키 없이 동작합니다. 실제 변경만 이벤트로 저장하고, 파일 종류·크기·line 변경을 로컬에서 계산합니다. `metadata.analysis.engine=local-diff`이며 source snapshot은 한도 내 메모리에만 유지합니다. snippet·diff 원문·hash는 분석 이벤트에 저장하지 않습니다. 정확·replacement fallback·계산 불가(`null`)를 구분합니다. 지원 확장자·제한과 개인정보 안내는 [파일 관찰](file-watch.md)을 보세요.

`npm run demo:plain`은 React·Vite가 없는 HTML 샘플을 5180에서 실행합니다. `examples/plain-app/content.html`을 수정하면 예제의 작은 refresh runtime이 DOM을 갱신하고 범용 bridge가 변경을 관찰합니다. `npm run dev`와 `npm run demo`는 React + Vite 예제를 5173에서 실행합니다. 모두 `watch`이며 Demo는 실제 파일 변경을 기다리고 가상의 AI·성공 이벤트를 만들지 않습니다.

## 실제 Preview와 범용 bridge

```bash
# 기존 서버 연결
node packages/cli/dist/index.js watch --project /absolute/path/my-app \
  --url http://127.0.0.1:5173

# 대상 프로젝트에서 개발 서버도 시작
node packages/cli/dist/index.js watch --project /absolute/path/my-app \
  --url http://127.0.0.1:5173 -- npm run dev -- --host 127.0.0.1
```

`--url` 없이 `--` 명령을 전달하면 Preview 기본값은 `http://127.0.0.1:5173`입니다. 실제 포트가 다르면 URL을 지정하세요. SwarmWatch는 임의 프레임워크를 설치하거나 서버 명령을 추측하지 않습니다. `Ctrl+C`는 직접 시작한 child process를 종료하고 기존 서버는 유지합니다.

범용 관찰은 대상 앱의 개발 HTML/layout에 수동으로 추가합니다.

```html
<script src="http://127.0.0.1:4317/bridge.js"></script>
```

포트가 다르면 script도 맞추세요. 대상 CSP/X-Frame-Options는 개발 환경에서 script 로딩과 iframe 표시를 허용해야 합니다. script는 classic JavaScript이며 framework/module loader를 요구하지 않습니다. 원본 파일 자동 주입은 없습니다. 운영 환경에는 넣지 마세요.

대시보드 **Instrumentation connected** 후 파일 변경과 실제 DOM delta가 함께 관찰되면 애니메이션이 나타납니다. 범용 bridge는 정확한 파일 소유권을 자동으로 알아내지 못하므로 mapping은 추정입니다. 실제 소유 파일을 아는 요소에 `data-sw-file="templates/navbar.html"`, 선택적으로 `data-sw-component="Navbar"`를 지정할 수 있습니다. 사용자가 제공한 attribute도 작성자·원인 증명은 아닙니다.

full reload 이후 초기 화면은 새 baseline입니다. bridge는 앱의 HMR·갱신 runtime을 대신하지 않습니다. 파일만 감지되거나 DOM이 그대로면 임의 영역에 커서를 표시하지 않습니다. 일반 클릭·입력은 관찰 구간을 닫고 scroll/resize는 baseline만 갱신합니다.

## 선택적 React + Vite 계측

Vite plugin은 serve transform에서 실제 JSX DOM tag에 source attribute를 삽입해 더 정확한 연결을 제공합니다. 소스 파일을 직접 수정하지 않고 운영 build에는 적용하지 않습니다.

```bash
cd /absolute/path/my-app
npm install -D /absolute/path/swarm-ai-edit/packages/vite-plugin
```

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swarmwatch } from '@swarmwatch/vite-plugin';
export default defineConfig({
  plugins: [swarmwatch(), react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
```

Vite plugin과 범용 script를 같은 페이지에 중복 설치하지 마세요. 별도로 시작한 Vite와 다른 대시보드 포트는 `swarmwatch({dashboardOrigin:'http://localhost:4400'})`로 설정합니다. 같은 프로토콜·포트의 localhost와 127.0.0.1 alias를 허용합니다. CLI가 앱을 시작하면 dashboard origin을 child 환경으로 전달합니다. CSS-to-element 연결은 Vite에서도 추정입니다.

## CLI와 에이전트

```bash
node packages/cli/dist/index.js --help
```

| 옵션 | 의미 |
| --- | --- |
| `watch --project PATH` | 프레임워크 독립 로컬 파일 관찰, agent 옵션 금지 |
| `dev --project PATH` | 호환 개발 명령; agent 연결은 별도 명시적 opt-in 필요 |
| `--url URL` | 선택적 loopback HTTP Preview; 서버 명령만 있으면 기본 :5173 |
| `--port NUMBER` | 대시보드 포트, 기본 4317 |
| `--data-dir PATH` | SQLite 폴더, 기본 `<project>/.swarmwatch` |
| `--demo` | 실제 예제를 Demo로 표시 |
| `--test-command COMMAND` | 지정한 로컬 검사 명령 실행·exit status 기록 |
| `--build-command COMMAND` | 지정한 로컬 빌드 명령 실행·exit status 기록 |
| `dev --allow-agents --codex PROMPT` | 설치·인증된 Codex `exec --json` 시작, 토큰 사용 가능 |
| `dev --allow-agents --opencode URL` | 기존 로컬 OpenCode v1 SSE 구독, 외부 agent 작업은 별도 비용 가능 |
| `-- COMMAND ARGS...` | 프로젝트 디렉터리에서 명시적 개발 명령 실행 |

`watch`는 `--allow-agents`, `--codex`, `--opencode`를 서버·프로세스·adapter 시작 전에 거부합니다. 환경 변수 `SWARMWATCH_NO_AI=1`은 `dev`에서도 해당 opt-in을 거부합니다. 관찰·분석은 LLM을 호출하지 않지만 별도 AI 도구, 전달한 명령과 앱의 API 사용 비용까지 차단하지는 않습니다.

명시적으로 agent 실행을 원하는 경우에만:

```bash
node packages/cli/dist/index.js dev --allow-agents \
  --project /absolute/path/my-app --url http://127.0.0.1:5173 \
  --codex 'Add an accessible Navbar component'

# 별도 터미널의 프로젝트에서 시작한 OpenCode v1 서버에 연결
opencode serve --hostname 127.0.0.1 --port 4096
node packages/cli/dist/index.js dev --allow-agents \
  --project /absolute/path/my-app --url http://127.0.0.1:5173 \
  --opencode http://127.0.0.1:4096
```

Codex는 wrapper가 시작한 한 thread의 공식 JSONL만 지원합니다. 기존 interactive CLI 자동 연결·private session scan·협업 receiver thread별 커서는 미지원입니다. OpenCode는 upstream session ID가 없는 파일 이벤트를 unassigned로 남기며 연결 gap 동안의 이벤트 복구는 보장하지 않습니다. 인증은 기존 `OPENCODE_SERVER_PASSWORD`와 선택적 `OPENCODE_SERVER_USERNAME` 환경 변수입니다. 실제 인증된 provider 실행은 미검증이며 공식 schema fixture·mock SSE로 검증했습니다. [조사 근거](adapter-research.md)

## 테스트·빌드 상태 기록

```bash
node packages/cli/dist/index.js watch --project /absolute/path/my-app \
  --test-command 'npm test' --build-command 'npm run build'
```

명령은 실제로 실행되며 둘은 독립적으로 시작될 수 있습니다. 결과는 지정한 **명령 프로세스의 종료 상태**이며 assertion 개수·테스트가 실제 하나 이상 실행됐는지 파싱하지 않습니다. 비밀 값을 명령 문자열에 넣지 마세요. 일반 agent adapter의 test/build 분류는 명령명 heuristic이며 복합 shell 구문으로 성공을 꾸미지 않습니다.

## Pause, Replay, export

라이브 Pause는 애니메이션을 멈추고 이벤트 수집은 계속합니다. Replay에서는 저장된 세션을 선택하고 1×/2×/4×, 시간 탐색, 종류·출처 필터를 사용할 수 있습니다. WebSocket은 sequence 이후 기록을 복구하고 export는 세션 JSON을 엽니다.

과거 HTML·CSS·미디어 snapshot은 기록하지 않습니다. Replay의 iframe은 현재 앱이고 overlay는 당시 측정 geometry입니다. 원본 화면을 완전히 복원한다고 주장하지 않습니다. DOM 직접 텍스트가 포함될 수 있으니 `data-sw-private`로 민감 영역을 제외하고 export를 검토하세요.

[검증 결과](test-results.md) · [배포·브라우저 준비](deployment.md) · [아키텍처](architecture.md)
