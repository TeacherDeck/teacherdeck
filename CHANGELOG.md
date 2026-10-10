# 변경 기록

이 파일은 앱(호스트·셸) 변경을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다. 모듈 변경은 각 모듈의 `CHANGELOG.md`에 기록합니다.

## [Unreleased]

### 추가

- 거버넌스 문서, 규격(`docs/spec`), ADR 0001~0008, 에이전트 지침(`AGENTS.md`)
- 개발 툴체인: pnpm 워크스페이스, TypeScript strict, ESLint(규칙 ID 포매터), vitest, Prettier, Cargo 워크스페이스, cargo-deny
- 검증 장치: `pnpm verify`·`verify:fast`·`gen`, 검사기 8종과 위반 샘플 자체 테스트, lefthook(커밋 메시지·DCO 검사)
- 합성 테스트 데이터 생성기(`pnpm synthetic`)
- deck-core: 매니페스트 모델·검증, 호환성 해석기, 카탈로그 인덱스·seq 검사, `.deckmod` 검증기, 핸들 테이블, `ErrorCode`
- deck-codegen: `schema/module.schema.json`, `schema/catalog.schema.json`, SDK·셸 TS 타입 생성
- 호스트(Tauri 2): Mica 창, 단일 실행, 로깅, `deckmod` 프로토콜, `host_invoke` 권한 검사, 캡 4종(system·storage·fs·window), updater(키 설정 전)
- `@deck/sdk`(브리지 클라이언트, mock host), `@deck/ui`(Fluent 기반 공통 컴포넌트)
- 셸: 덱 홈·카테고리·검색, 모듈 화면(keepAlive), 설정(테마·업데이트), 정보·크레딧, UI 갤러리(개발용)
- 모듈 파이프라인: `pnpm new:module`, `pack:module`, `bundle:modules`, 레퍼런스 모듈 `timer`
- CI·릴리스 워크플로, Dependabot, CODEOWNERS, Claude Code 가드레일(보호 경로 훅, 스킬 3종)
- main 머지 정책: PR + `verify` 필수, 승인은 권장(ADR-0010, CI-006)
- `@deck/ui` WinUI 컨트롤: InfoBar, ProgressBar/Ring, ContentDialog, TextBox, NumberBox, ComboBox, RadioButtons, ToggleSwitch, CheckBox, ListView, HyperlinkButton, 타입 램프, PageHeader, SettingsGroup(ADR-0011)

### 변경

- `@deck/ui` 카드·SettingsExpander를 WinUI 모양과 동작으로 맞춤(그림자 제거, 4px 반경, 반투명 카드 배경, 머리글 전체로 펼침)
- 폰트를 시스템 폰트(Segoe UI Variable, 맑은 고딕)로 바꾸고 Pretendard 번들 제거. 셸과 모듈의 글꼴이 같아짐
- 모듈은 UI를 `@deck/ui`에서만 가져옴(MOD-010 강화)
