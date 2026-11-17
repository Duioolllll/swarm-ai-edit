# 검증 결과

실행일: 2026-11-17 (Asia/Seoul). Linux, Node.js 24.22.1, npm 11.9.0, 시스템 Chromium에서 실행했습니다. 정확한 의존성 버전과 artifact integrity는 package-lock.json에 고정되어 있습니다.

| 검사 | 결과 | 확인한 범위 |
| --- | --- | --- |
| `npm ci` | 통과 | lockfile 기반 재설치, 체크섬·TLS 검증 유지 |
| `npm run build` | 통과 | core/server/Vite plugin/CLI/dashboard 실제 빌드 |
| `npm run typecheck` | 통과 | 전체 제품 workspace strict TypeScript 검사 |
| `npm run build -w @swarmwatch/example` | 통과 | 실제 React 앱 production build |
| `npm test` | 28개 통과, 5개 파일 | core 4, server 7, adapters 9, plugin 8 (실제 Chromium bridge 3개 포함) |
| `npm run test:e2e` | 1개 통과 | 아래 실제 소스 변경 시나리오 |
| `npx --no-install swarmwatch --help` | 통과 | 로컬 CLI bin 연결과 도움말 |
| `npm run demo` + HTTP 요청 | 통과 | 실제 dashboard state, preview HTML, demo 표기, 초기 가짜 작업 0개 |

E2E는 테스트 자체가 생성한 Navbar.tsx와 App.tsx의 import를 추가하고, 실제 Vite 앱에 새 버튼이 나타나는지 확인합니다. watcher의 file.created, HMR ID가 있는 measured DOM, Navbar 커서 표시를 검사합니다. 다음으로 CSS를 수정하고 해당 버튼의 style.changed가 CSS 파일에 inferred로 연결되는지 확인하며, 같은 버튼의 텍스트를 다시 수정해 별도 이벤트가 생기는지 검사합니다.

이어서 Pause 시 실제 CSS animation-play-state 정지와 Resume, 실제 테스트 프로세스 종료의 test.passed 기록, 세션 export/historicalDom:false/중복 없는 event ID, 브라우저 offline 동안의 파일 변경과 reconnect catch-up, Replay·4×·필터·Mobile Preview, localhost 주소의 bridge 연결, 파일 삭제를 검사합니다. 수정한 App/CSS와 임시 Navbar는 finally에서 복구·제거합니다. 의도적인 파일 제거 과정에 Vite의 일시적인 module reload 경고가 출력될 수 있으며, 복구 후 앱 소스는 원래 상태입니다.

Server 테스트는 SQLite 종료 후 재개, 재전송 중복, agent와 file observer 귀속, HMR-before-watcher buffer, CSS watcher보다 DOM이 빠른 경우, 실제 파일 생성·수정·삭제, secret/symlink 배제, HTTP Host·Origin·WS token·연결 복구를 검사합니다. Bridge의 Chromium 테스트는 초기 baseline 억제, 같은 요소 반복 수정의 고유 ID, CSS/삭제 좌표, 잘못된 origin 거부, HMR 직후 사용자 클릭과 일반 상태 변경의 작업 오인 방지를 검사합니다. Adapter는 공식 형태 fixture와 실제 로컬 mock SSE로 lifecycle·결과·중복·재연결을 검사합니다.

실행 결과 이미지:

- [Live + 관측 커서](../artifacts/swarmwatch-live.png)
- [Replay](../artifacts/swarmwatch-replay.png)
- [Mobile Preview](../artifacts/swarmwatch-mobile-preview.png)

미검증/미지원: 실제 provider 인증 Codex/OpenCode 작업, Next.js, 외부 사이트, 대규모 장시간 부하, 과거 HTML/CSS/미디어 snapshot 복원. 세션 replay는 이벤트·geometry 기록이며 원래 과거 화면 재현이 아닙니다. 테스트 명령 exit code는 test runner assertion 개수를 증명하지 않습니다. HMR/파일 시간 상관관계도 정확한 AI 인과관계를 증명하지 않습니다.

이 결과는 명시된 Linux 환경에서의 실행 근거입니다. 다른 OS 및 실제 provider 인증 실행까지 검증한 결과는 아닙니다.
