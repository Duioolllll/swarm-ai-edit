# SwarmWatch 배포 가이드

0.1.0 MVP의 지원 배포 단위는 **전체 Git 저장소**입니다. CLI, Node 서버, dashboard 빌드와 Vite plugin이 하나의 체크아웃에 있어야 합니다. npm 패키지 게시나 원격 SaaS 운영을 전제로 하지 않습니다.

## 실행 환경

- Node.js **24 이상**, npm. 검증 버전은 `.node-version`과 [검증 결과](test-results.md)에 있습니다.
- 설치 시 npm registry 접근. 파일 관찰 모드는 외부 AI API나 별도 DB 서비스가 필요하지 않습니다.
- 읽을 수 있는 로컬 프로젝트와 실행 중인 로컬 웹 앱.
- dashboard 4317, 예제 Vite 앱 5173의 비어 있는 loopback 포트.
- 기본 저장 위치 `<project>/.swarmwatch` 또는 `--data-dir`의 쓰기 권한.

Linux와 시스템 Chromium에서 검증했습니다. 다른 OS는 프로세스 그룹 종료와 브라우저 경로를 별도로 검증해야 합니다.

## 소스 설치

```bash
git clone https://github.com/Duioolllll/swarm-ai-edit.git
cd swarm-ai-edit
npm ci
npm run build
npm run build -w @swarmwatch/example
npm run demo
```

`npm ci`는 lockfile을 사용하며 core → server → plugin → CLI → dashboard 순서로 빌드합니다. 실행 시에도 `packages/`와 `apps/dashboard/dist/`의 상대 위치를 유지하세요. 특정 `dist/`만 복사하면 서버와 dashboard 연결이 깨집니다.

대상 Vite 앱 연결은 [README](../README.md#내-프로젝트-연결)와 [상세 사용법](usage.md)에 있습니다. 로컬 plugin은 빌드된 체크아웃에 대한 링크이므로 디렉터리를 이동·삭제하면 다시 설치해야 합니다.

## 준비 상태 확인

```bash
curl --fail --silent http://127.0.0.1:4317/api/state \
  | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const s=JSON.parse(b);console.log({sessionId:s.sessionId,projectName:s.projectName,previewUrl:s.previewUrl,demo:s.demo})})'
curl --fail --silent http://127.0.0.1:5173/ --output /tmp/swarmwatch-preview.html
```

대시보드에서 **Instrumentation connected**를 확인하세요. 허가된 프로젝트 파일을 실제로 수정했을 때 HMR·DOM 이벤트와 커서가 나타나는지 확인합니다. 초기 페이지가 보인 것만으로 변경 시각화를 검증했다고 판단하지 않습니다. `/api/state`의 로컬 WebSocket token 전체를 로그에 남기지 마세요.

## 포트와 기존 서버

```bash
node packages/cli/dist/index.js dev --project /absolute/path/my-app \
  --url http://127.0.0.1:5173 --port 4400 \
  --data-dir /absolute/path/swarmwatch-data
```

기존 개발 서버는 SwarmWatch 종료 시 유지됩니다. 별도로 시작한 앱의 plugin에는 `swarmwatch({dashboardOrigin:'http://localhost:4400'})`를 설정하세요. 같은 프로토콜·포트의 localhost와 127.0.0.1 별칭만 허용합니다. SwarmWatch가 앱을 시작하면 필요한 origin을 child 환경에 전달합니다.

## 검증용 브라우저

일반 실행은 사용자의 브라우저를 사용합니다. **자동화 테스트**에는 Chromium 실행 파일이 필요합니다.

```bash
# Linux에서 고정된 Playwright 버전에 맞는 Chromium 준비
npx --no-install playwright install --with-deps chromium
export CHROMIUM_PATH="$(node --input-type=module -e 'import {chromium} from "@playwright/test"; console.log(chromium.executablePath())')"
npm run typecheck
npm test
npm run test:e2e
```

시스템 Chromium이 `/usr/bin/chromium`에 있으면 다운로드와 환경 변수 지정은 생략합니다. `--with-deps`는 OS 패키지 설치 권한이 필요하며, 권한이 없으면 관리자가 설치한 Chromium을 지정하세요. 현재 검증은 시스템 Chromium 사용 결과이며 위 다운로드 절차를 이 클라우드에서 실행한 것은 아닙니다.

E2E는 4317/5173을 사용하고 예제 소스에 임시 Navbar를 추가한 뒤 복구합니다. 다른 사용자의 프로세스를 강제 종료하지 말고 직접 시작한 demo를 먼저 중지하세요.

## 업데이트·중지·롤백

1. 실행 터미널에서 `Ctrl+C`로 SwarmWatch와 소유한 child process를 중지합니다.
2. 현재 Git commit과 로컬 변경을 기록하고 `.swarmwatch`를 별도 위치에 백업합니다.
3. 검증한 새 commit/tag를 체크아웃하고 `npm ci && npm run build`를 실행합니다. 로컬 변경을 덮어쓰거나 강제 reset하지 마세요.
4. CLI를 다시 시작해 HTTP·bridge·실제 파일 변경을 확인합니다.
5. 실패하면 중지 후 이전 commit에서 설치·빌드를 반복합니다. SQLite 형식이 변경되었다면 해당 버전의 데이터 백업을 사용합니다.

SQLite 백업은 프로세스를 중지한 뒤 데이터 디렉터리 전체를 복사하세요. 열린 프로세스와 socket은 재시작 후 유지되지 않습니다. 세션은 로컬 개인정보를 포함할 수 있으므로 저장소나 공개 릴리스 아카이브에 넣지 않습니다.

## 배포 범위와 npm 게시

SwarmWatch는 로컬 개발 파일과 Preview를 관찰하는 도구입니다. loopback 바인딩을 유지하세요. 정적 호스팅이나 공개 서버에 dashboard만 배포하는 방식은 지원하지 않습니다. 원격 접근·사용자 인증·테넌트 격리는 구현되지 않았습니다.

workspace는 현재 `private:true`로 잘못된 npm 게시를 방지합니다. 일반 npm 배포는 다음 작업을 별도로 완료해야 합니다.

- dashboard 자산을 server 패키지에 포함하고 패키지 기준 경로로 로딩하기
- core/server/plugin/CLI의 files·prepack·버전 의존성 구성하기
- 빈 디렉터리에 tarball만 설치해 CLI·plugin·실제 pipeline 검증하기
- 패키지 이름·scope의 소유권과 게시 인증 확인하기

이 가이드는 npm 게시나 GitHub Release 발행 자체를 수행하지 않습니다. 소스 배포 시 [Credits](credits.md), [Third-party notices](third-party-notices.md), [LICENSE](../LICENSE)를 함께 유지하세요.
