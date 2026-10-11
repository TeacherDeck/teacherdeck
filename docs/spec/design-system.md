# 디자인 시스템 (design-system)

Windows 11 Fluent 2를 따르고 PowerToys 설정 앱 구조를 레퍼런스로 한다([ADR-0004](../adr/0004-design-system.md)). 구현은 Fluent UI React v9와 `@fluentui/react-icons`로 하며, `@deck/ui`가 WinUI 컨트롤 이름과 모양으로 감싼다([ADR-0011](../adr/0011-winui-aligned-deck-ui.md)).

## 1. 화면 구조

- **상단바**: 창은 테두리 없음(`decorations: false`)이고 셸이 상단바를 직접 그린다(`apps/desktop/src/TitleBar.tsx`). 높이 40px, 왼쪽은 뒤로 버튼(돌아갈 화면이 있을 때만, WinUI TitleBar BackButton, Alt+←·마우스 뒤로 버튼과 같은 기록), 앱 아이콘과 이름이고 오른쪽은 WinUI 캡션 버튼(최소화·최대화/복원·닫기, 46px, Segoe Fluent Icons, 닫기는 빨간 hover)이다. 버튼을 뺀 영역은 Tauri 드래그 영역이라(버튼은 드래그 영역 밖에 둔다) 끌면 창이 움직이고 더블클릭하면 최대화된다. 그림자·둥근 모서리·크기 조절·스냅은 OS가 유지한다. 최대화 버튼 hover 시 스냅 레이아웃 메뉴는 뜨지 않는다(Tauri 한계, Win+Z는 동작).
- **시작 화면**: 셸이 앱 정보와 모듈 목록을 받는 동안 셸 안에서 그린다(별도 창 없음). 덱 카드가 펼쳐지는 짧은 애니메이션을 보여 주고 로딩이 끝나면 바로 홈으로 넘어간다. 고정 대기 시간은 두지 않고 최소 표시 시간만 둔다. 업데이트로 새 도구가 생긴 뒤 첫 실행에는 새 도구 수를 알린다.
- **좌측 내비게이션 레일**: 홈(덱), 카테고리, 설정, 정보. 모듈 화면에서는 숨겨 도구가 창 너비를 모두 쓰고, 상단바의 뒤로 버튼으로 나간다. 선택 항목 왼쪽에 강조 막대(pill)가 있고, 선택이 바뀌면 막대가 새 항목으로 미끄러져 이동한다(WinUI NavigationView).
- **우측 콘텐츠**
  - 홈(덱): 위에서부터 인사·날짜와 검색(Ctrl+F), 즐겨찾기(별을 누른 순서), 카테고리별 전체 도구 그리드. 즐겨찾기가 없으면 즐겨찾기 묶음은 숨긴다. 검색 중에는 결과 그리드 하나만 보인다. 일반 카드는 아이콘(32px, 아이콘이 없거나 로드에 실패하면 카테고리 아이콘), 이름, 두 줄 설명으로 구성한다. 즐겨찾기는 작은 아이콘·이름으로 빠르게 여는 짧은 카드이며 설명은 키보드 포커스와 마우스 hover의 툴팁으로 제공한다. 일반 카드의 생략된 설명도 같은 방식으로 읽을 수 있다. 두 종류 모두 해석기 상태 배지([versioning.md](versioning.md#ui-배지))·새 도구 배지·별 토글을 유지한다. 즐겨찾기·본 도구 목록은 셸 저장소에 모듈 id만 저장한다([ADR-0029](../adr/0029-compact-tool-workspaces.md)).
  - 카테고리: 해당 카테고리 카드 그리드와 검색.
  - 모듈 화면: 작은 메타데이터 행(아이콘·이름·버전·상태)과 iframe. 작업 제목 h1은 모듈의 `PageHeader`가 맡는다. 정보 행은 줄바꿈 가능하며 상태·로드 오류를 숨기지 않는다.
  - 설정: SettingsCard / SettingsExpander 패턴. 테마(시스템/라이트/다크)와 애니메이션 효과(켬/끔)를 고른다.
  - 정보: About/크레딧 화면([5절](#5-about크레딧-화면)).

### 셸 모션

셸 모션은 WinUI 패턴을 따른다([ADR-0024](../adr/0024-shell-motion-and-home.md)).

| 상황               | 모션                                                                             | 시간·곡선                              |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| 레일 선택 변경     | 강조 막대가 새 항목으로 이동                                                     | `durationNormal`, `curveDecelerateMid` |
| 레일로 페이지 전환 | Entrance: 새 페이지가 `deckTokens.motionPageOffset`만큼 아래에서 올라오며 나타남 | `durationGentle`, `curveDecelerateMax` |
| 카드로 모듈 열기   | Drill-in: 모듈 화면이 살짝 작은 크기에서 커지며 나타남                           | `durationSlow`, `curveDecelerateMax`   |
| 카드 그리드 등장   | 카드가 `deckTokens.motionStagger` 간격으로 순서대로 나타남(앞 8장까지만 지연)    | `durationGentle`, `curveDecelerateMid` |
| 카드 hover·누름    | 테두리 강조와 함께 살짝 떠오름, 누르면 살짝 작아짐                               | `durationFaster`, `curveEasyEase`      |

- 이전 화면의 퇴장 애니메이션은 두지 않는다. 새 화면만 들어온다.
- 모듈 iframe 자체에는 모션을 걸지 않는다. 셸의 모듈 레이어만 움직인다.
- OS의 `prefers-reduced-motion`(Windows "애니메이션 효과" 끔)이나 설정의 "애니메이션 효과" 끔이면 모든 셸 모션을 끝난 상태로 바로 그린다.

## 2. 토큰과 테마

모듈 `icon.svg`는 48×48 좌표와 일정한 바탕·여백·획을 사용하며 도구의 핵심 기능을 서로 다른 실루엣으로 표현한다. 기본 모듈에 템플릿의 빈 사각형을 남기지 않는다. 모듈 아이콘은 독립 이미지이므로 외부 문서의 `currentColor`에 의존하지 않는다. 앱 UI 아이콘은 기존 Fluent 아이콘과 테마 토큰을 따른다. 이름과 상태 문구는 아이콘·색을 보완한다([ADR-0029](../adr/0029-compact-tool-workspaces.md)).

- 원천은 Fluent v9 theme이다. 셸이 light/dark theme을 만들고 CSS 변수 세트(`--deck-*`)로 직렬화해 `init`과 `theme.changed`로 모듈에 전달한다([bridge-protocol.md](bridge-protocol.md)).
- 모듈의 `DeckProvider`가 같은 theme으로 `FluentProvider`를 구성한다.
- 색·간격·반경·그림자·폰트 패밀리는 토큰으로만 쓴다(UI-002).
- Fluent에 없는 WinUI 브러시는 theme 객체의 추가 키로 둔다: `deckCardFill`(CardBackgroundFillColorDefault, 반투명), `deckCardFillHover`, `deckCardStroke`(CardStrokeColorDefault), `deckFontFamilyDisplay`. 다른 토큰과 함께 `ThemePayload.tokens`로 전달되며, 코드에서는 `deckTokens.cardFill` 등으로 쓴다.
- 반경: 페이지 안 요소(카드, 목록, 입력)는 4px(`deckTokens.cardRadius`), 대화상자·플라이아웃·셸 콘텐츠 프레임은 8px(`deckTokens.overlayRadius`)이다. 카드에는 그림자를 쓰지 않는다.

## 3. Mica와 배경

- 셸 창은 투명 배경에 `window-vibrancy`로 Mica를 적용한다. 셸 루트와 iframe 배경은 투명하다.
- 표면(카드, 패널)은 Fluent 레이어 토큰으로 표현한다.
- Windows 10에서는 Mica가 없으므로 불투명 배경으로 폴백한다. 이 정보는 `ThemePayload.mica`로 모듈에 전달된다.
- Mica는 Windows 테마를 따른다. 설정에서 Windows와 다른 테마(예: Windows는 다크, 앱은 라이트)를 고르면 대비가 깨지므로 셸과 모듈 모두 불투명 배경으로 폴백한다(`ThemePayload.mica = false`).
- 구현 시 `banatic/Hypercool`의 기존 Mica 구현(`src-tauri/src/commands/window.rs` 등)을 참고했다. TeacherDeck은 `window-vibrancy`의 Mica API만 써서 `unsafe` 없이 구현한다(`src-tauri/src/platform.rs`).

## 4. 폰트

- 본문 스택: `"Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif`. 한글은 맑은 고딕으로 표시된다(Windows 11 설정 앱과 같다).
- 20px 이상(Subtitle 이상): `"Segoe UI Variable Display", ...`
- UI 폰트는 번들하지 않는다. 셸과 모듈 iframe이 같은 시스템 폰트를 쓰므로 외관이 같다. PDF 원문 렌더링만 [ADR-0018](../adr/0018-pdf-resource-notices.md)의 한정 대체 글꼴 자산을 사용한다. CDN 폰트는 금지한다(PRV-001, MOD-008).
- 타입 램프(WinUI): Caption 12/16, Body 14/20, BodyStrong 14/20, Subtitle 20/26, Title 28/36, TitleLarge 40/52, Display 68/92. `@deck/ui`의 같은 이름 컴포넌트로 쓴다.
- 화면 제목(h1)은 덱·카테고리·설정·정보·도구 화면 모두 Subtitle(20/26)로 같게 쓴다. 도구는 `PageHeader`가 이 크기를 쓴다. 내비 레일(Body 14)과 비율을 맞추고, 화면을 옮길 때 제목 크기가 바뀌지 않게 한다.

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

| 컴포넌트                    | WinUI 대응                           | 용도                                                                             |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `DeckProvider`              | —                                    | 셸이 보낸 theme으로 `FluentProvider` 구성, 투명 루트 배경 기본값                 |
| `PageHeader`                | 페이지 제목                          | Subtitle(20px) 제목과 설명 한 줄                                                 |
| `ToolLayout` (+ `.Section`) | —                                    | 일괄 처리 도구 골격: 입력 → 옵션 → 미리보기 → 실행 → 결과                        |
| `SettingsGroup`             | 설정 그룹 머리글                     | BodyStrong 머리글 + 4px 간격 카드 묶음                                           |
| `SettingsCard`              | SettingsCard                         | 한 줄 설정 항목. `action`(오른쪽 컨트롤) 또는 `onClick`(카드 전체 버튼 + 셰브런) |
| `SettingsExpander`          | SettingsExpander                     | 머리글 전체로 펼침, 셰브런 ↓/↑, 안의 SettingsCard는 들여쓴 평면 행               |
| `CapabilityGate`            | InfoBar                              | optional 캡이 없을 때 "앱 업데이트 후 사용 가능" 알림                            |
| `EmptyState`                | —                                    | 빈 화면과 다음 행동 안내                                                         |
| `DropZone`                  | —                                    | 드롭 영역 표시용. 실제 드롭은 셸 이벤트 `fs.dropped`로 받는다.                   |
| `PresentationControls`      | SettingsExpander + ComboBox + Button | 모니터 선택·공개 결과 열기·명시 갱신·닫기. 창 종료·연결 변경 시 재선택 안내      |

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

`SettingsExpander`는 선택 `expanded`와 `onExpandedChange`로 제어할 수 있다. 지정하지 않으면 `defaultExpanded`로 시작해 스스로 펼침 상태를 관리한다. 제어 상태에서도 머리글의 네이티브 버튼·`aria-expanded`와 별도 action의 키보드 동작을 유지한다.

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
- **UI-009** [MUST] 모션은 `transform`·`opacity`만 움직이고 Fluent `duration*`·`curve*` 토큰과 `@deck/ui` 모션 토큰으로 쓰며, `prefers-reduced-motion`과 셸의 애니메이션 효과 설정을 존중한다. 레이아웃 속성(크기·위치·여백)을 애니메이션하지 않고, 모듈 iframe에 모션을 걸지 않는다([1절 셸 모션](#셸-모션)). — 강제: [manual]
