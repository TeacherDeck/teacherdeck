# 변경 기록

이 파일은 앱(호스트·셸) 변경을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다. 모듈 변경은 각 모듈의 `CHANGELOG.md`에 기록합니다.

## [Unreleased]

## [0.2.2] - 2026-10-11

### 수정

- 덱의 도구를 Enter·Space로 열 수 있도록 하고 카테고리를 바꿀 때 검색어 초기화
- 퀵캡처 도구줄을 모니터 안에 배치하고 아주 작은 영역도 이동·캡처할 수 있도록 보완
- 마지막 캡처 세션을 끝낼 때 숨겨진 메인 창을 복원해 앱에 다시 접근할 수 있도록 수정
- 회의록 초안·스크롤 위치, 지도일 배정 결과 보존과 작은 창의 날짜 편집 흐름 보완
- 이미지 연속 저장·실패 재시도·자동 압축과 명렬표의 반별 학생 대응 오류 수정
- 타이머 숫자와 버튼 겹침, 키보드 오작동, PC 시각 변경에 따른 시간 오차 수정

## [0.2.1] - 2026-10-10

### 수정

- 퀵캡처의 별도 도구 창을 제거하고 원본처럼 하나의 투명 영역 창과 작은 도구줄로 복원
- Tauri 이벤트 수신을 현재 창으로 제한해 캡처 창 상태가 섞이는 문제 수정
- 캡처 영역 좌표에서 도구줄·테두리를 제외하고 이동·크기·DPI 변경 시 변환
- 회의록 기록·화자·입력창 배치, 지도일 달력의 휴일·주말·고정·수행 색상과 편집 흐름 복원
- 퀵캡처 설정을 두 묶음으로 줄이고 실제 키 입력·색 선택·설정 자동 적용 복원
- 공통 제목·본문의 브라우저 기본 여백 제거

## [0.2.0] - 2026-10-10

### 수정

- 공통 루트의 가로 넘침 처리가 세로 휠 스크롤을 가로막는 문제 수정, 셸 메뉴·프레임 높이 보완
- 회의록 입력 중 기존 기록 재렌더링·닫힌 내보내기 본문 생성을 줄이고 이전 화자·안건 집계 보완

### 추가

- 원본 프로그램과 대조한 회의록·지도일 배정기 기능 확장
- 이미지 일괄 압축, 사진명렬표 원본 사진 추출, 드래그·회전·반전 이미지 자르기 기본 모듈
- 승인된 출력 전용 clipboard 1.0과 회의록의 서식 유지 복사
- 공통 Image·ImageCropPreview 컨트롤과 실제 이미지 Worker·문서 추출 검증
- 퀵캡처 기본 모듈과 capture/overlay/global-shortcut 1.0: 고정 영역·툴바·전역 키·트레이·단발 캡처 세션
- fs 1.2: 명시적으로 기억한 폴더에 새 캡처 파일만 저장하고 권한 해제·폴더 교체를 검사
- 보조 창의 정확한 ACL과 모듈 소유자 메타데이터 이벤트, 승인된 Windows 의존성·한정 라이선스 예외

## [0.1.1] - 2026-10-10

### 변경

- 회의록의 참석자 등록·회의 시작·화자 목록·연속 입력 흐름을 기존 도구에 맞춰 복원
- 지도일 배정기를 명단과 달력 중심으로 재구성하고, 날짜 선택으로 제외·고정·수동 교체를 즉시 적용
- 공통 TextBox 표시 행 수 지원과 SettingsExpander 머리글 키보드 접근성 개선
- 공동작업자의 자체 제목 표시줄과 Node 타입 정의 업데이트 통합, 메인 셸의 창 조작 권한 6개 반영

## [0.1.0] - 2026-10-10

### 추가

- 회의록·지도일 배정기 기본 모듈과 공통 TextBox 입력 조합 이벤트 지원
- fs 1.1: 제한된 파일 읽기, 새 결과 폴더와 파일 저장, 64KiB 순차 쓰기, 명시적 취소·수명 관리
- 호스트 내부 파일·폴더 권한 분리, 연결 파일 거부, 기존 파일을 보존하는 결과 게시

### 변경

- 모듈마다 독립 origin을 사용하고 셸 브리지가 iframe과 정확한 origin을 함께 검증
- SDK 0.2.0의 `readChunks`·`writeBlob`으로 전송·취소·자원 정리 제공

## 초기 기반

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

- 창을 테두리 없이 바꾸고 셸이 상단바를 직접 그림(끌어서 이동, 더블클릭 최대화, WinUI 캡션 버튼)
- `@deck/ui` 카드·SettingsExpander를 WinUI 모양과 동작으로 맞춤(그림자 제거, 4px 반경, 반투명 카드 배경, 머리글 전체로 펼침)
- 폰트를 시스템 폰트(Segoe UI Variable, 맑은 고딕)로 바꾸고 Pretendard 번들 제거. 셸과 모듈의 글꼴이 같아짐
- 모듈은 UI를 `@deck/ui`에서만 가져옴(MOD-010 강화)
