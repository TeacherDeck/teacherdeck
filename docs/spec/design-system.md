# 디자인 시스템 (design-system)

Windows 11 Fluent 2를 따르고 PowerToys 설정 앱 구조를 레퍼런스로 한다([ADR-0004](../adr/0004-design-system.md)). 구현은 Fluent UI React v9와 `@fluentui/react-icons`로 한다.

## 1. 화면 구조

- **좌측 내비게이션 레일**: 홈(덱), 카테고리, 설정, 정보.
- **우측 콘텐츠**
  - 홈: 모듈 카드 그리드와 검색. 카드에 해석기 상태 배지를 표시한다([versioning.md](versioning.md#ui-배지)).
  - 모듈 화면: 헤더(아이콘·이름·버전·상태)와 iframe.
  - 설정: SettingsCard / SettingsExpander 패턴. 테마(시스템/라이트/다크)를 고른다.
  - 정보: About/크레딧 화면([5절](#5-about크레딧-화면)).

## 2. 토큰과 테마

- 원천은 Fluent v9 theme이다. 셸이 light/dark theme을 만들고 CSS 변수 세트(`--deck-*`)로 직렬화해 `init`과 `theme.changed`로 모듈에 전달한다([bridge-protocol.md](bridge-protocol.md)).
- 모듈의 `DeckProvider`가 같은 theme으로 `FluentProvider`를 구성한다.
- 색·간격·반경·그림자·폰트 패밀리는 토큰으로만 쓴다(UI-002).

## 3. Mica와 배경

- 셸 창은 투명 배경에 `window-vibrancy`로 Mica를 적용한다. 셸 루트와 iframe 배경은 투명하다.
- 표면(카드, 패널)은 Fluent 레이어 토큰으로 표현한다.
- Windows 10에서는 Mica가 없으므로 불투명 배경으로 폴백한다. 이 정보는 `ThemePayload.mica`로 모듈에 전달된다.
- 구현 시 `banatic/Hypercool`의 기존 Mica 구현(`src-tauri/src/commands/window.rs` 등)을 먼저 읽고 맞춘다(Phase 4).

## 4. 폰트

- 스택: `"Segoe UI Variable Text", "Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif`
- Pretendard는 npm 패키지로 로컬 번들한다(OFL-1.1). Segoe UI는 시스템 폰트이므로 번들하지 않는다.
- CDN 폰트는 금지한다(PRV-001, MOD-008).

## 5. About/크레딧 화면

GPLv3의 Appropriate Legal Notices를 겸한다. 다음을 모두 보여 준다.

- 앱 이름·버전, 저작권, 무보증 고지, LICENSE 전문 보기
- 제7조(b) 저자 표기(`LICENSE-ADDITIONAL-TERMS`의 문구 그대로)
- 모듈별 저자(매니페스트 `authors` 집계)
- 서드파티 라이선스 목록(빌드 시 cargo-about과 npm 라이선스 수집으로 `generated/third-party.json` 생성)

이 화면의 저자 표기를 지우거나 약화하지 않는다(GEN-007).

## 6. `@deck/ui` 컴포넌트

부트스트랩 범위의 컴포넌트는 다음과 같다(Phase 5에서 구현).

| 컴포넌트 | 용도 |
|---|---|
| `DeckProvider` | 셸이 보낸 theme으로 `FluentProvider` 구성, 투명 루트 배경 기본값 |
| `ToolLayout` (+ `ToolLayout.Section`) | 일괄 처리 도구 골격: 입력 → 옵션 → 미리보기 → 실행 → 결과 |
| `SettingsCard` | 한 줄 설정 항목 |
| `SettingsExpander` | 펼침형 설정 묶음 |
| `CapabilityGate` | optional 캡이 없을 때 "앱 업데이트 후 사용 가능" 표시 |
| `EmptyState` | 빈 화면과 다음 행동 안내 |
| `DropZone` | 드롭 영역 표시용. 실제 드롭은 셸 이벤트 `fs.dropped`로 받는다. |

셸 dev 빌드에만 "UI 갤러리" 화면을 두어 모든 `@deck/ui` 컴포넌트를 light/dark와 텍스트 배율별로 보여 준다.

## 7. 문구

UI-007을 따른다. 예시:

| 상황 | 좋은 예 | 나쁜 예 |
|---|---|---|
| 버튼 | 변환 | 변환하기 시작 |
| 완료 알림 | 3개 파일을 변환했어요. | 작업이 성공적으로 완료되었습니다! |
| 오류 | 파일이 다른 프로그램에서 열려 있어요. 닫고 다시 시도해 주세요. | 죄송합니다. 오류가 발생했습니다. |
| 빈 화면 | 파일을 끌어 놓거나 "파일 선택"을 눌러 주세요. | 파일 없음 |

## 8. 규칙

- **UI-001** [MUST NOT] Fluent UI React v9 외의 컴포넌트 라이브러리를 추가하지 않는다. — 강제: eslint `no-restricted-imports`, GEN-004
- **UI-002** [MUST NOT] 색·간격·반경·그림자·폰트 패밀리를 하드코딩하지 않는다. Fluent 토큰과 `@deck/ui` 토큰만 쓴다. — 강제: eslint `deck/no-raw-style-values`
- **UI-003** [MUST] 아이콘은 `@fluentui/react-icons`만 쓴다(모듈 `icon.svg` 제외). — 강제: eslint
- **UI-004** [MUST] 셸과 모듈의 루트 배경은 투명(Mica)이고, 표면은 레이어 토큰으로 표현한다. Win10에서는 불투명으로 폴백한다. — 강제: `DeckProvider` 기본값(Phase 5에서 구현), [manual]
- **UI-005** [MUST] 키보드만으로 전부 조작할 수 있고, 포커스가 보이며, 텍스트 150%·DPI 200%에서 잘림이 없고, 대비가 WCAG AA를 만족한다. — 강제: [manual] 체크리스트, 가능 시 axe 테스트(Phase 5에서 구현)
- **UI-006** [MUST NOT] `@deck/ui`에 있는 패턴을 모듈에서 재구현하지 않는다. 없으면 `@deck/ui`에 추가를 제안한다. — 강제: [manual]
- **UI-007** [MUST] 문구 규칙.
  - 해요체로 짧게 쓴다.
  - 버튼은 동작어를 쓰고("변환", "저장"), 같은 동작은 흐름 내내 같은 이름을 쓴다(버튼 "변환" → 알림 "변환했어요").
  - 오류는 원인과 해결을 한 문장으로 쓰고 사과하지 않는다.
  - 빈 화면은 다음 행동을 안내한다.

  — 강제: [manual]
- **UI-008** [MUST] 일괄 처리 도구는 `ToolLayout`(입력 → 옵션 → 미리보기 → 실행 → 결과) 골격을 따른다. — 강제: [manual]
