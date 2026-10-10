# 디자인 시스템 (design-system)

Windows 11 Fluent 2를 따르고 PowerToys 설정 앱 구조를 레퍼런스로 한다([ADR-0004](../adr/0004-design-system.md)). 구현은 Fluent UI React v9와 `@fluentui/react-icons`로 하며, `@deck/ui`가 WinUI 컨트롤 이름과 모양으로 감싼다([ADR-0011](../adr/0011-winui-aligned-deck-ui.md)).

## 1. 화면 구조

- **상단바**: 창은 테두리 없음(`decorations: false`)이고 셸이 상단바를 직접 그린다(`apps/desktop/src/TitleBar.tsx`). 높이 40px, 왼쪽은 앱 아이콘과 이름이고 오른쪽은 WinUI 캡션 버튼(최소화·최대화/복원·닫기, 46px, Segoe Fluent Icons, 닫기는 빨간 hover)이다. 버튼을 뺀 영역은 Tauri 드래그 영역이라 끌면 창이 움직이고 더블클릭하면 최대화된다. 그림자·둥근 모서리·크기 조절·스냅은 OS가 유지한다. 최대화 버튼 hover 시 스냅 레이아웃 메뉴는 뜨지 않는다(Tauri 한계, Win+Z는 동작).
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
- Fluent에 없는 WinUI 브러시는 theme 객체의 추가 키로 둔다: `deckCardFill`(CardBackgroundFillColorDefault, 반투명), `deckCardFillHover`, `deckCardStroke`(CardStrokeColorDefault), `deckFontFamilyDisplay`. 다른 토큰과 함께 `ThemePayload.tokens`로 전달되며, 코드에서는 `deckTokens.cardFill` 등으로 쓴다.
- 반경: 페이지 안 요소(카드, 목록, 입력)는 4px(`deckTokens.cardRadius`), 대화상자·플라이아웃·셸 콘텐츠 프레임은 8px(`deckTokens.overlayRadius`)이다. 카드에는 그림자를 쓰지 않는다.

## 3. Mica와 배경

- 셸 창은 투명 배경에 `window-vibrancy`로 Mica를 적용한다. 셸 루트와 iframe 배경은 투명하다.
- 표면(카드, 패널)은 Fluent 레이어 토큰으로 표현한다.
- Windows 10에서는 Mica가 없으므로 불투명 배경으로 폴백한다. 이 정보는 `ThemePayload.mica`로 모듈에 전달된다.
- 구현 시 `banatic/Hypercool`의 기존 Mica 구현(`src-tauri/src/commands/window.rs` 등)을 참고했다. TeacherDeck은 `window-vibrancy`의 Mica API만 써서 `unsafe` 없이 구현한다(`src-tauri/src/platform.rs`).

## 4. 폰트

- 본문 스택: `"Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif`. 한글은 맑은 고딕으로 표시된다(Windows 11 설정 앱과 같다).
- 20px 이상(Subtitle 이상): `"Segoe UI Variable Display", ...`
- 폰트는 번들하지 않는다. 셸과 모듈 iframe이 같은 시스템 폰트를 쓰므로 외관이 같다. CDN 폰트는 금지한다(PRV-001, MOD-008).
- 타입 램프(WinUI): Caption 12/16, Body 14/20, BodyStrong 14/20, Subtitle 20/26, Title 28/36, TitleLarge 40/52, Display 68/92. `@deck/ui`의 같은 이름 컴포넌트로 쓴다.

## 5. About/크레딧 화면

GPLv3의 Appropriate Legal Notices를 겸한다. 다음을 모두 보여 준다.

- 앱 이름·버전, 저작권, 무보증 고지, LICENSE 전문 보기
- 제7조(b) 저자 표기(`LICENSE-ADDITIONAL-TERMS`의 문구 그대로)
- 모듈별 저자(매니페스트 `authors` 집계)
- 서드파티 라이선스 목록(빌드 시 cargo-about과 npm 라이선스 수집으로 `generated/third-party.json` 생성)

이 화면의 저자 표기를 지우거나 약화하지 않는다(GEN-007).

## 6. `@deck/ui` 컴포넌트

모듈은 UI를 `@deck/ui`에서만 가져온다(MOD-010). 이름과 props는 WinUI를 따른다. 입력 컨트롤은 WinUI Header에 해당하는 `header`를 반드시 받는다. `header`는 접근성 이름으로도 쓰이며, SettingsCard 안에서는 `showHeader={false}`로 숨긴다. 새 컴포넌트는 `COMPONENTS`에 추가해야 하고, 셸 UI 갤러리에 없으면 typecheck가 실패한다.

**페이지 패턴**

| 컴포넌트                    | WinUI 대응       | 용도                                                                             |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `DeckProvider`              | —                | 셸이 보낸 theme으로 `FluentProvider` 구성, 투명 루트 배경 기본값                 |
| `PageHeader`                | 페이지 제목      | Title(28px) 제목과 설명 한 줄                                                    |
| `ToolLayout` (+ `.Section`) | —                | 일괄 처리 도구 골격: 입력 → 옵션 → 미리보기 → 실행 → 결과                        |
| `SettingsGroup`             | 설정 그룹 머리글 | BodyStrong 머리글 + 4px 간격 카드 묶음                                           |
| `SettingsCard`              | SettingsCard     | 한 줄 설정 항목. `action`(오른쪽 컨트롤) 또는 `onClick`(카드 전체 버튼 + 셰브런) |
| `SettingsExpander`          | SettingsExpander | 머리글 전체로 펼침, 셰브런 ↓/↑, 안의 SettingsCard는 들여쓴 평면 행               |
| `CapabilityGate`            | InfoBar          | optional 캡이 없을 때 "앱 업데이트 후 사용 가능" 알림                            |
| `EmptyState`                | —                | 빈 화면과 다음 행동 안내                                                         |
| `DropZone`                  | —                | 드롭 영역 표시용. 실제 드롭은 셸 이벤트 `fs.dropped`로 받는다.                   |

**컨트롤**

| 컴포넌트                            | WinUI 대응                                                           | 용도                                                                        |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Button`, `ToggleButton`, `Tooltip` | Button(AccentButton = `appearance="primary"`), ToggleButton, ToolTip | Fluent 그대로 다시 내보냄                                                   |
| `HyperlinkButton`                   | HyperlinkButton                                                      | 글자 모양 보조 동작. URL을 열지 않는다                                      |
| `InfoBar`                           | InfoBar                                                              | 오류·완료·안내. 토스트 대신 쓴다                                            |
| `ProgressBar`, `ProgressRing`       | ProgressBar, ProgressRing                                            | 일괄 처리 진행(값 없으면 불확정), 대기 표시                                 |
| `ContentDialog`                     | ContentDialog                                                        | 확인 대화상자. 결과 `primary`/`secondary`/`none`. 덮어쓰기 확인(PRV-006)    |
| `TextBox`, `NumberBox`              | TextBox, NumberBox                                                   | 텍스트(여러 줄 가능), 범위 제한 숫자                                        |
| `ComboBox`, `RadioButtons`          | ComboBox, RadioButtons                                               | 하나 고르기(많으면 ComboBox, 2~5개면 RadioButtons)                          |
| `ColorPicker`                       | ColorPicker                                                          | 테두리 등 사용자 선택 색. 색 견본을 눌러 OS 색 선택창에서 지정              |
| `ToggleSwitch`, `CheckBox`          | ToggleSwitch(켬/끔 표시), CheckBox                                   | 즉시 적용 설정, 선택 항목                                                   |
| `ListView`                          | ListView                                                             | 파일 목록 등. 선택 없음/하나/여러 개, 빈 목록 안내                          |
| `Image`                             | Image                                                                | 로컬 이미지 미리보기. 대체 설명 필수, 크기·채우기 방식 선택                 |
| `ImageCropPreview`                  | Canvas + Image + Thumb                                               | 이미지 좌표의 사각형 선택·이동·크기 조절. 드래그와 방향키, 대체 설명·머리글 |

**타입 램프**: `Caption`, `Body`, `BodyStrong`, `Subtitle`, `Title`, `TitleLarge`, `Display`([4절](#4-폰트)). `secondary`로 보조 글자색을 쓴다.

**스타일 도구**: `makeStyles`, `mergeClasses`, `tokens`, `deckTokens`.

`TextBox`는 `onKeyDown`, `onCompositionStart`, `onCompositionEnd`로 실제 입력 요소의 키보드·한글 조합 이벤트를 전달한다. `inputRef`는 한 줄/여러 줄 입력 요소를 가리키며 포커스 복귀와 텍스트 선택에 사용한다. 결과를 선택해 복사할 때는 `readOnly`를 사용한다. `multiline` 입력의 기본 표시 행 수는 `rows`로 지정한다. 조합 중 Enter를 기록 확정으로 처리하지 않는 업무 규칙은 사용 모듈에서 검사한다.

셸 dev 빌드에만 "UI 갤러리" 화면을 두어 모든 `@deck/ui` 컴포넌트를 light/dark와 텍스트 배율별로 보여 준다.

## 7. 문구

UI-007을 따른다. 예시:

| 상황      | 좋은 예                                                        | 나쁜 예                           |
| --------- | -------------------------------------------------------------- | --------------------------------- |
| 버튼      | 변환                                                           | 변환하기 시작                     |
| 완료 알림 | 3개 파일을 변환했어요.                                         | 작업이 성공적으로 완료되었습니다! |
| 오류      | 파일이 다른 프로그램에서 열려 있어요. 닫고 다시 시도해 주세요. | 죄송합니다. 오류가 발생했습니다.  |
| 빈 화면   | 파일을 끌어 놓거나 "파일 선택"을 눌러 주세요.                  | 파일 없음                         |

## 8. 규칙

- **UI-001** [MUST NOT] Fluent UI React v9 외의 컴포넌트 라이브러리를 추가하지 않는다. — 강제: eslint `no-restricted-imports`, GEN-004
- **UI-002** [MUST NOT] 색·간격·반경·그림자·폰트 패밀리를 하드코딩하지 않는다. Fluent 토큰과 `@deck/ui` 토큰만 쓴다. — 강제: eslint `deck/no-raw-style-values`
- **UI-003** [MUST] 아이콘은 `@fluentui/react-icons`만 쓴다(모듈 `icon.svg` 제외). — 강제: eslint
- **UI-004** [MUST] 셸과 모듈의 루트 배경은 투명(Mica)이고, 표면은 레이어 토큰으로 표현한다. Win10에서는 불투명으로 폴백한다. — 강제: `DeckProvider` 기본값, [manual]
- **UI-005** [MUST] 키보드만으로 전부 조작할 수 있고, 포커스가 보이며, 텍스트 150%·DPI 200%에서 잘림이 없고, 대비가 WCAG AA를 만족한다. — 강제: [manual] 체크리스트, axe 자동 테스트는 미구현
- **UI-006** [MUST NOT] `@deck/ui`에 있는 패턴을 모듈에서 재구현하지 않는다. 없으면 `@deck/ui`에 WinUI 대응 컨트롤로 추가를 제안한다. — 강제: [manual], 모듈의 Fluent 직접 import 금지(MOD-010)
- **UI-007** [MUST] 문구 규칙.
  - 해요체로 짧게 쓴다.
  - 버튼은 동작어를 쓰고("변환", "저장"), 같은 동작은 흐름 내내 같은 이름을 쓴다(버튼 "변환" → 알림 "변환했어요").
  - 오류는 원인과 해결을 한 문장으로 쓰고 사과하지 않는다.
  - 빈 화면은 다음 행동을 안내한다.

  — 강제: [manual]

- **UI-008** [MUST] 일괄 처리 도구는 `ToolLayout`(입력 → 옵션 → 미리보기 → 실행 → 결과) 골격을 따른다. — 강제: [manual]
