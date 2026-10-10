# ADR-0011: `@deck/ui`를 WinUI 컨트롤 체계로 맞추고 모듈 UI 경로를 하나로 한다

- 상태: 승인됨
- 날짜: 2026-10-10
- 결정자: 신민성, 정영주

## 맥락

부트스트랩 때 만든 `@deck/ui` 컴포넌트는 7개뿐이었다. 그중 WinUI에 대응하는 컨트롤은 SettingsCard와 SettingsExpander 둘이었고, 이 둘도 실제 WinUI와 모양·동작이 달랐다.

- **모양:** 그림자와 8px 반경이 들어갔다. WinUI 카드는 그림자 없이 1px 테두리, 4px 반경, 반투명 배경이다.
- **크기:** 제목이 24px이고, 섹션 제목에 WinUI 단계에 없는 16px을 썼다.
- **SettingsExpander:** 셰브런 버튼만 눌러야 펼쳐지고 아이콘이 →에서 ↓로 바뀌었다. WinUI는 머리글 전체가 토글이고 ↓에서 ↑로 바뀐다.

모듈은 Fluent v9를 직접 import할 수 있었다. 그래서 바이브코딩으로 만든 모듈마다 Fluent 기본값(웹 앱 외관)이 섞일 위험이 있었다.

폰트에도 문제가 있었다. Pretendard는 셸에서만 로드되고 origin이 다른 모듈 iframe에는 로드되지 않아, 셸과 모듈의 글꼴이 달랐다.

## 결정

- `@deck/ui`가 WinUI 이름과 props를 따르는 컨트롤을 제공한다.
  - InfoBar, ProgressBar, ProgressRing, ContentDialog
  - TextBox, NumberBox, ComboBox, RadioButtons, ToggleSwitch, CheckBox
  - ListView, HyperlinkButton
  - 타입 램프: Caption, Body, BodyStrong, Subtitle, Title, TitleLarge, Display
  - 페이지 패턴: PageHeader, SettingsGroup
- WinUI와 이미 같은 Fluent 컴포넌트(Button, ToggleButton, Tooltip)와 스타일 도구(`makeStyles`, `mergeClasses`, `tokens`)는 `@deck/ui`가 그대로 다시 내보낸다.
- 모듈은 UI를 `@deck/ui`에서만 import한다. 아이콘은 `@fluentui/react-icons`에서 가져온다. `@fluentui/react-components`를 직접 import하는 것은 금지한다(MOD-010 강화).
- 카드는 WinUI 브러시(CardBackgroundFillColorDefault, CardStrokeColorDefault)를 쓴다. 해당하는 Fluent 토큰이 없으므로 theme 객체에 추가 키(`deckCardFill` 등)로 넣는다. 기존 `ThemePayload.tokens`에 담겨 전달되므로 브리지 포맷은 바뀌지 않는다.
- 폰트는 시스템 폰트만 쓴다.
  - 본문: Segoe UI Variable Text → Segoe UI → 맑은 고딕
  - 20px 이상: Segoe UI Variable Display
  - Pretendard 번들은 제거한다.

## 결과

- 셸과 모듈이 같은 폰트와 같은 카드 모양을 갖는다. 앱 번들에서 폰트 용량이 빠진다.
- 새 컨트롤이 필요하면 모듈에서 Fluent를 쓰지 말고 `@deck/ui`에 추가한다(UI-006).
- 다음 작업으로 남긴다.
  - 시스템 강조색 반영
  - 전자칠판용 터치 밀도(큰 컨트롤)
  - 모듈 간 vendor 청크 공유. 커스텀 프로토콜 변경이므로 정지 조건이다.

## 대안

- **Fluent 직접 사용 유지:** 작업량은 적지만 모듈마다 외관이 갈라진다.
- **Pretendard를 모듈에도 번들:** 모듈마다 용량이 늘고 WinUI 외관과도 다르다.
