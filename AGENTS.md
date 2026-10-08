# TeacherDeck — 에이전트 작업 지침

이 파일은 이 레포에서 일하는 모든 AI 에이전트와 사람의 출발점이다. 규범 원천은 [`docs/spec`](docs/spec/README.md)이며, 이 파일은 규칙 ID, 한 줄 요약, 링크만 담는다(DOC-004). 이 파일과 spec이 다르면 spec이 맞다.

## 프로젝트

TeacherDeck은 교사들이 자주 쓰는 작은 Windows 도구(이미지 크롭, 파일명 일괄변환, 개인정보 마스킹, 문서 변환, 타이머 등)를 하나의 앱("덱")에 모듈로 계속 쌓아 가는 무료 오픈소스 프로젝트다. 한 번 설치하면 업데이트로 새 도구를 계속 받는다. 학교 PC(관리자 권한 없음, 망분리, 저사양, 전자칠판 출력)에서도 가볍고 빠르게 동작해야 한다.

**제품 약속: 모든 처리는 PC 안에서 하며, 파일과 개인정보는 외부로 나가지 않는다.** ([privacy.md](docs/spec/privacy.md))

## 용어집

| 용어 | 뜻 |
|---|---|
| 호스트 | Tauri 2 Rust 프로세스. 네이티브 코드는 여기에만 있다. |
| 셸 | 호스트 메인 창의 React 프론트엔드. `@tauri-apps/api`를 쓸 수 있는 유일한 곳이다. |
| 모듈 | 도구 하나를 담은 웹 번들(HTML/JS/WASM). 셸과 다른 origin의 iframe에서 실행된다. |
| 기본 모듈 | 설치본에 동봉된 모듈. 포맷은 일반 모듈과 같다. |
| 캡(capability) | 호스트가 모듈에 제공하는 버전 붙은 범용 기능 묶음. 예: `storage`, `fs`. |
| 브리지 | 모듈 ↔ 셸 `postMessage` 프로토콜. 모듈은 이것으로만 호스트를 호출한다. |
| 핸들 | 파일·폴더를 가리키는 불투명 문자열. 모듈은 경로 대신 핸들만 본다. |
| 카탈로그 | 모듈 버전 목록을 담은 `index.json`. 기본 모듈과 원격 배포가 같은 형식을 쓴다. |
| `.deckmod` 패키지 | 모듈 하나의 한 버전을 담은 zip. |

## 레포 지도

```
AGENTS.md, CLAUDE.md          루트 지침 (이 파일)
apps/desktop/src/             셸 (React)
apps/desktop/src-tauri/       호스트 (Rust): caps/, protocol.rs, bridge.rs, capabilities/(ACL)
crates/deck-core/             순수 Rust 로직 (Tauri 의존 금지)
packages/sdk/                 @deck/sdk: 모듈용 브리지 클라이언트
packages/ui/                  @deck/ui: Fluent 기반 공통 컴포넌트
modules/_template/, timer/    모듈 템플릿, 레퍼런스 모듈
schema/                       생성물: 매니페스트·카탈로그 스키마, capabilities.json
tools/checks/                 verify 검사기와 자체 테스트
tools/eslint-plugin-deck/     규칙 ID를 출력하는 커스텀 린트
tools/hooks/, tools/scripts/  Claude Code 훅, gen·new-module·pack 스크립트
fixtures/synthetic/           합성 테스트 데이터만
docs/spec/                    규범 문서 (규칙 정의)
docs/adr/                     아키텍처 결정 기록
```

아직 없는 디렉터리(셸, 호스트, SDK, UI, 모듈)는 부트스트랩 Phase 3~6에서 생긴다.

## 작업별 필독 문서

| 작업 | 먼저 읽을 문서 |
|---|---|
| 모듈 추가·수정 | [modules/AGENTS.md](modules/AGENTS.md), [modules.md](docs/spec/modules.md), [bridge-protocol.md](docs/spec/bridge-protocol.md) |
| 호스트 기능(캡) 추가·변경 | [apps/desktop/src-tauri/AGENTS.md](apps/desktop/src-tauri/AGENTS.md), [capabilities.md](docs/spec/capabilities.md), [versioning.md](docs/spec/versioning.md) |
| 공통 UI | [packages/ui/AGENTS.md](packages/ui/AGENTS.md), [design-system.md](docs/spec/design-system.md) |
| 셸 | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md) |
| CI·릴리스 | [.github/AGENTS.md](.github/AGENTS.md), [ci.md](docs/spec/ci.md), [security.md](docs/spec/security.md) |
| 규격 변경 | [process.md](docs/spec/process.md) (DOC-002) |

하위 디렉터리의 `AGENTS.md`는 이 파일의 규칙을 추가·강화만 한다(GEN-002).

## 일반 규칙 (GEN)

정의: [process.md](docs/spec/process.md#5-규칙)

| ID | 요약 |
|---|---|
| GEN-001 | 스펙·스키마·검사기를 코드에 맞춰 고치지 않는다. 스펙 변경은 DOC-002로만. |
| GEN-002 | 하위 AGENTS.md는 상위 규칙을 추가·강화만 한다. 충돌 시 정지. |
| GEN-003 | 완료 전 `pnpm verify` 통과. 억제 주석·skip·검사 완화로 우회하지 않는다. |
| GEN-004 | `crates/*`, `apps/desktop`, `packages/*` 런타임 의존성 추가는 사람 승인. 라이선스 allowlist 통과. |
| GEN-005 | 정지 조건에 해당하면 즉시 멈추고 제안서로 보고한다(아래). |
| GEN-006 | 생성물(`schema/**`, `**/generated/**`, spec 생성 표)을 손으로 고치지 않는다. |
| GEN-007 | About 화면, AUTHORS, LICENSE*, SPDX 헤더, 모듈 authors의 저자 표기를 지우거나 약화하지 않는다. |
| GEN-008 | 모든 소스 파일(코드·설정)에 SPDX 헤더를 둔다. Markdown 제외. |
| GEN-009 | Conventional Commits + `Signed-off-by`. 커밋 하나에 관심사 하나. |
| GEN-010 | 식별자·커밋 메시지는 영어, 문서·UI 문구는 한국어. |

## 정지 조건 (GEN-005)

다음에 해당하면 **구현하지 말고 멈춘 뒤** [제안서 형식](docs/spec/process.md#2-정지-조건과-제안서)으로 보고한다.

- 새 캡 추가, 또는 캡 major 변경
- 매니페스트·브리지·카탈로그 포맷 변경
- 보안 설정(CSP, Tauri ACL, updater, 커스텀 프로토콜) 변경
- 라이선스·저작자 표기 파일 변경
- 규칙 충돌 발견
- GEN-004에 해당하는 의존성 추가
- 사용자 파일을 삭제하거나 덮어쓰는 동작 도입

## 꼭 기억할 규칙 (요약)

| ID | 요약 | 정의 |
|---|---|---|
| MOD-005 | 모듈은 `@deck/sdk`, `@deck/ui`, 모듈 내부, 허가된 의존성만 import한다. | [modules.md](docs/spec/modules.md#4-규칙) |
| MOD-009 | 모듈은 `localStorage` 등 웹 저장소 대신 storage 캡만 쓴다. | [modules.md](docs/spec/modules.md#4-규칙) |
| CAP-002 | 캡은 경로를 주고받지 않고 핸들만 쓴다. | [capabilities.md](docs/spec/capabilities.md#6-규칙) |
| BRG-001 | 셸은 모듈 id를 iframe 매핑으로 판정하고 메시지 내용의 자기 신고를 믿지 않는다. | [bridge-protocol.md](docs/spec/bridge-protocol.md#5-규칙) |
| UI-002 | 색·간격·반경·그림자·폰트를 하드코딩하지 않는다. | [design-system.md](docs/spec/design-system.md#8-규칙) |
| PRV-003 | 로그·에러에 경로·파일명·사용자 데이터를 남기지 않는다. | [privacy.md](docs/spec/privacy.md#4-규칙) |
| PRV-004 | 테스트·문서에 실존 인명·학교명·연락처를 쓰지 않는다. | [privacy.md](docs/spec/privacy.md#4-규칙) |
| PRV-006 | 원본 덮어쓰기·삭제를 기본 동작으로 하지 않는다. | [privacy.md](docs/spec/privacy.md#4-규칙) |
| SEC-009 | 비밀값(키, 토큰)을 레포에 두지 않는다. | [security.md](docs/spec/security.md#3-규칙) |

전체 규칙 목록: [규칙 인덱스](docs/spec/README.md#5-규칙-인덱스)

## Definition of Done

- [ ] `pnpm verify` 통과 (GEN-003)
- [ ] 새 동작에 테스트가 있다
- [ ] 정지 조건 해당 변경은 사람 승인을 받았다 (GEN-005)
- [ ] 관련 spec·AGENTS.md·README를 갱신했다 (DOC-003)
- [ ] 사용자에게 보이는 모듈 변경은 버전 bump + CHANGELOG (MOD-013)
- [ ] 로그·에러·테스트에 개인정보가 없다 (PRV-003, PRV-004)
- [ ] Conventional Commits + `Signed-off-by` (GEN-009)

상세: [process.md](docs/spec/process.md#4-definition-of-done)

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `pnpm verify` | 전체 검증(CI와 같음). 완료 전 필수 |
| `pnpm verify:fast` | lint + typecheck + check-modules (pre-commit) |
| `pnpm gen` | 생성물 갱신(규칙 인덱스, Phase 3부터 스키마·TS 타입) |
| `pnpm check:<이름>` | 검사기 하나만 실행(gen, modules, spdx, versions, docs, security, licenses, suppressions) |
| `pnpm sync-versions` | 앱 버전을 Cargo.toml에 반영 (VER-001) |
| `pnpm synthetic` | 합성 테스트 데이터 생성 (PRV-004) |
| `pnpm new:module <id>` | 새 모듈 생성 (MOD-001, Phase 6부터) |
| `pnpm pack:module` | `.deckmod` 패키지 생성 (Phase 6부터) |
| `pnpm tauri dev` / `pnpm tauri build` | 앱 실행 / 설치본 빌드 (Phase 4부터) |
| `git commit -s` | DCO 서명 커밋 (GEN-009) |
