# ADR-0004: 디자인은 Windows 11 Fluent 2, Fluent UI React v9

- 상태: 승인됨
- 날짜: 2026-10-08
- 결정자: 신민성, 정영주

## 맥락

여러 사람이 AI 에이전트와 함께 모듈을 만들면 화면이 제각각이 되기 쉽다. 교사는 Windows 기본 앱과 비슷한 외관을 익숙하게 느낀다. 전자칠판·TV 출력과 고배율 환경도 고려해야 한다.

## 결정

- Windows 11 Fluent 2를 따르고, PowerToys 설정 앱의 구조(좌측 내비게이션, SettingsCard)를 레퍼런스로 한다.
- 구현은 Fluent UI React v9와 `@fluentui/react-icons`로 한다. 공통 패턴은 `@deck/ui`로 감싼다.

## 결과

- 규칙과 상세: [design-system.md](../spec/design-system.md) (UI-001~008).
- 다른 컴포넌트 라이브러리는 쓰지 않는다(UI-001). 스타일 값은 토큰으로만 쓴다(UI-002).
- Fluent v9의 Griffel 런타임 스타일 주입 때문에 모듈 CSP에 `style-src 'unsafe-inline'`이 필요하다.

## 대안

- **Fluent UI Web Components**: 프레임워크 무관이지만 v9 React만큼 컴포넌트가 충분하지 않다.
- **범용 라이브러리(MUI 등)**: Windows 11 외관과 거리가 멀다.
