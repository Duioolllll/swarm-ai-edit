# Changelog

## Unreleased — 0.1.0 MVP

첫 소스 배포를 준비하는 기능과 문서입니다. npm 패키지나 GitHub Release가 이미 게시되었다는 의미는 아닙니다.

### Added

- 프레임워크 독립 `watch`, URL 없는 파일 관찰, 기본 dev/demo의 no-AI 실행 경로.
- `watch`의 agent 옵션 사전 거부, 명시적 `dev --allow-agents`, `SWARMWATCH_NO_AI=1` 차단.
- Vue/Svelte/Astro·서버 template·markup·style·data·asset 확장자, bounded local-diff byte/line 통계.
- 메모리 한정 source snapshot, exact/fallback/null 통계 구분, 분석 원문 미저장.
- 수동 classic `/bridge.js`, 실제 파일 trigger ID와 DOM delta 연결, 추정 source attribution.
- React/Vite 없는 Plain HTML demo와 실제 범용 파이프라인 스크린샷.
- Node CLI, loopback HTTP/WebSocket, chokidar 감시와 SQLite 기록.
- React + Vite 개발 계측 plugin, source mapping, 검증된 iframe bridge.
- 실제 파일/HMR/DOM delta에 연결한 커서·선택·텍스트·이미지·삭제 trace.
- 명시적 opt-in의 공식 Codex JSONL·OpenCode v1 SSE; 기본 관찰은 agent 호출 없음.
- viewport 전환, event stream, 변경 파일, 테스트·빌드 결과와 세션 export.
- 이벤트 기반 Replay, pause/resume, 1×/2×/4×, agent/type 필터.
- 실제 React demo, 모듈·Chromium·Playwright 테스트와 실행 스크린샷.
- 소스 배포·사용·아키텍처·adapter·검증 문서와 원작자 표기.

### Release scope

지원 배포 방식은 전체 소스 체크아웃입니다. 인증된 AI 공급자 실행, Next.js 전용 자동 DOM mapping, 과거 화면 복원과 npm 배포는 지원·검증 범위에 포함되지 않습니다. 파일 관찰 자체는 프레임워크와 무관하며 지원 확장자를 기준으로 동작합니다. full reload 초기 DOM은 baseline이고 범용 script가 앱의 갱신 runtime을 대신하지 않습니다. 기본 관찰의 무AI 호출 범위는 SwarmWatch 기능이며 별도 명령·앱·도구의 비용을 보장하지 않습니다. [현재 제한](README.md#현재-제한)

### Credits

모션 콘셉트의 원작자 **[Joel Califa](https://github.com/califa)**의 [Swarm](https://califa.github.io/swarm-site/), 참고 프로젝트 제작자 **[Dhvanil / @DhvanilPatel](https://github.com/DhvanilPatel)**의 [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors)에 감사를 표합니다. 원작 코드·에셋은 포함하지 않았으며 본 프로젝트의 MIT는 원작에 적용되지 않습니다. [전체 출처](docs/credits.md)
