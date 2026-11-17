# 검증 결과

실행일: 2026-11-17 (Asia/Seoul). Linux, Node.js 24.22.1, npm 11.9.0, 시스템 Chromium에서 실행했습니다. 정확한 의존성 버전과 artifact integrity는 package-lock.json에 고정되어 있습니다.

| 검사 | 결과 | 확인한 범위 |
| --- | --- | --- |
| `npm ci` | 통과 | lockfile 기반 재설치, 체크섬·TLS 검증 유지 |
| `npm run build` | 통과 | core/server/Vite plugin/CLI/dashboard 실제 빌드 |
| `npm run typecheck` | 통과 | 전체 제품 workspace strict TypeScript 검사 |
| `npm run build -w @swarmwatch/example` | 통과 | 실제 React 앱 production build |
| `npm test` | 42개 통과, 8개 파일 | core 4, server 7, analyzer 6, adapters 9, CLI guard 3, plugin 5, Chromium bridge 5, watch integration 3 |
| `npm run test:e2e` | 3개 통과 | React/Vite와 Plain HTML의 실제 파일·DOM pipeline, Preview 없는 Vue/Svelte 파일 관찰 |
| `npx --no-install swarmwatch --help` | 통과 | 로컬 CLI bin 연결과 도움말 |
| `npm run demo` + HTTP 요청 | 통과 | 실제 dashboard state, preview HTML, demo 표기, 초기 가짜 작업 0개 |

E2E는 테스트 자체가 생성한 Navbar.tsx와 App.tsx의 import를 추가하고, 실제 Vite 앱에 새 버튼이 나타나는지 확인합니다. watcher의 file.created, HMR ID가 있는 measured DOM, Navbar 커서 표시를 검사합니다. 다음으로 CSS를 수정하고 해당 버튼의 style.changed가 CSS 파일에 inferred로 연결되는지 확인하며, 같은 버튼의 텍스트를 다시 수정해 별도 이벤트가 생기는지 검사합니다.

이어서 Pause 시 실제 CSS animation-play-state 정지와 Resume, 실제 테스트 프로세스 종료의 test.passed 기록, 세션 export/historicalDom:false/중복 없는 event ID, 브라우저 offline 동안의 파일 변경과 reconnect catch-up, Replay·4×·필터·Mobile Preview, localhost 주소의 bridge 연결, 파일 삭제를 검사합니다. 수정한 App/CSS와 임시 Navbar는 finally에서 복구·제거합니다. 의도적인 파일 제거 과정에 Vite의 일시적인 module reload 경고가 출력될 수 있으며, 복구 후 앱 소스는 원래 상태입니다.

Server 테스트는 SQLite 종료 후 재개, 재전송 중복, agent와 file observer 귀속, HMR-before-watcher buffer, CSS watcher보다 DOM이 빠른 경우, 실제 파일 생성·수정·삭제, secret/symlink 배제, HTTP Host·Origin·WS token·연결 복구를 검사합니다. Bridge의 Chromium 테스트는 초기 baseline 억제, 같은 요소 반복 수정의 고유 ID, CSS/삭제 좌표, 잘못된 origin 거부, HMR 직후 사용자 클릭과 일반 상태 변경의 작업 오인 방지를 검사합니다. Adapter는 공식 형태 fixture와 실제 로컬 mock SSE로 lifecycle·결과·중복·재연결을 검사합니다.

실행 결과 이미지:

- [Live + 관측 커서](../artifacts/swarmwatch-live.png)
- [Replay](../artifacts/swarmwatch-replay.png)
- [Mobile Preview](../artifacts/swarmwatch-mobile-preview.png)
- [범용 HTML · 로컬 분석과 DOM 관찰](../artifacts/swarmwatch-local-watch.png)
- [Preview 없는 Vue/Svelte 파일 관찰](../artifacts/swarmwatch-file-only.png)

미검증/미지원: 실제 provider 인증 Codex/OpenCode 작업, Next.js, 외부 사이트, 대규모 장시간 부하, 과거 HTML/CSS/미디어 snapshot 복원. 세션 replay는 이벤트·geometry 기록이며 원래 과거 화면 재현이 아닙니다. 테스트 명령 exit code는 test runner assertion 개수를 증명하지 않습니다. HMR/파일 시간 상관관계도 정확한 AI 인과관계를 증명하지 않습니다.

이 결과는 명시된 Linux 환경에서의 실행 근거입니다. 다른 OS 및 실제 provider 인증 실행까지 검증한 결과는 아닙니다.

## 소스 배포 재검증

2026-11-17에 커밋된 소스만 새 디렉터리에 Git clone하여 검증했습니다. 기존 dist 출력 없이 `npm ci` → 전체 build → 타입 검사 → 28개 모듈/브리지 테스트를 통과했습니다. 소스에 포함된 CLI launcher로 초기 설치의 bin link를 만들고 `npx --no-install swarmwatch --help`와 실제 파일 변경 Playwright 통합 테스트 1개도 통과했습니다. 일반 registry의 `npx swarmwatch` 패키지를 검증한 결과는 아닙니다.

## 프레임워크 독립 watch 검증

기본 모드를 `watch`로 변경한 후 전체 build·typecheck, 모듈/브라우저 테스트 42개와 E2E 3개가 통과했습니다. 위 새 체크아웃 검증은 이전 소스 배포 준비 시점의 근거이며, 현재 파일 감지 확장 결과는 이 절의 검사입니다.

- CLI는 `watch`의 Codex/OpenCode/agent opt-in 옵션을 실제 프로세스 시작 전에 거부합니다. `SWARMWATCH_NO_AI=1`이면 명시적인 legacy dev opt-in도 거부합니다.
- Vue/Svelte/Astro와 백엔드 소스·템플릿 파일의 분류, 최소 line diff, 동일 내용 재기록 중복 억제, 생성·삭제, 메모리·파일·계산량 제한을 검사합니다. source snippet이나 hash가 이벤트에 포함되지 않는 것도 검사합니다.
- Preview URL 없이 시작한 실제 서버의 no-AI 상태와 빈 Preview를 검사합니다. Vue/Svelte runtime을 설치하지 않고 해당 소스를 기록·표시하는 브라우저 E2E가 통과했습니다.
- 실제 Plain HTML의 content.html 수정 → local-diff 이벤트 → generic bridge → 실제 DOM → 관측 커서를 검사합니다. 두 번째 수정도 별도 trigger로 복구되며 일반 클릭은 개발 이벤트로 기록하지 않습니다. 해당 브라우저 시나리오에서는 loopback 외 HTTP 요청이 없었습니다.
- generic bridge는 실제 파일 event ID가 있어야 하며, source mapping이 없으면 `inferred`로 남습니다. script만 Preview origin에서 접근 가능하고 API는 다른 Origin에 계속 403으로 응답하는지 검사합니다.

이 검증은 SwarmWatch의 기본 관찰 경로가 AI 공급자를 호출하지 않는다는 범위입니다. 사용자가 실행한 임의 개발 명령, 앱 자체와 별도 AI 에이전트의 사용량까지 제한하는 sandbox는 아닙니다.
