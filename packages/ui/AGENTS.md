# packages/ui — `@deck/ui` 지침

`@deck/ui`는 Fluent UI React v9를 감싼 공통 컴포넌트와 토큰을 제공한다. 셸과 모듈이 같은 외관을 갖게 하는 곳이다. 루트 [AGENTS.md](../../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| UI-001 | Fluent UI React v9 외 컴포넌트 라이브러리를 추가하지 않는다. | [design-system.md](../../docs/spec/design-system.md#8-규칙) |
| UI-002 | 스타일 값은 Fluent 토큰과 `@deck/ui` 토큰만 쓴다. | 같은 문서 |
| UI-003 | 아이콘은 `@fluentui/react-icons`만 쓴다. | 같은 문서 |
| UI-004 | `DeckProvider` 기본값은 투명 루트 배경이다. Win10은 불투명으로 폴백한다. | 같은 문서 |
| UI-005 | 키보드 조작, 포커스 표시, 텍스트 150%·DPI 200%, WCAG AA를 지킨다. | 같은 문서 |
| UI-007 | 문구는 해요체로 쓰고, 버튼은 동작어로, 오류는 사과 없이 쓴다. | 같은 문서 |
| UI-008 | 일괄 처리 골격은 `ToolLayout`으로 제공한다. | 같은 문서 |
| 추가 | Fluent 컴포넌트를 감쌀 때 Fluent의 접근성 속성과 키보드 동작을 지우지 않는다. | 이 문서 |
| 추가 | `@tauri-apps/*`와 `@deck/sdk` 내부 경로에 의존하지 않는다. 셸 이벤트는 props로 받는다. | 이 문서 |

## 파일 지도

- `src/tokens/`: 폰트 스택·의미 토큰·테마 변환. 원시 스타일 값을 둘 수 있는 유일한 곳(UI-002 린트 예외)
- `src/components.tsx`: 공통 컴포넌트
- `src/index.ts`의 `COMPONENTS`: 갤러리 등록 목록. 컴포넌트를 export하면 여기에도 추가해야 테스트가 통과하고, 셸 갤러리(`apps/desktop/src/pages/Gallery.tsx`)에 샘플이 없으면 typecheck가 실패한다

## 컴포넌트 추가 절차

1. [design-system.md 6절](../../docs/spec/design-system.md#6-deckui-컴포넌트)에 없는 패턴인지 확인한다. 새 공통 패턴이면 spec에 먼저 추가한다(DOC-003).
2. Fluent v9 컴포넌트를 조합해 만든다. 하드코딩한 스타일 값이 없어야 한다.
3. **UI 갤러리에 등록한다.** `COMPONENTS`에 이름을 추가하고 `Gallery.tsx`의 `SAMPLES`에 예시를 넣는다. light/dark와 텍스트 배율별로 보인다.
4. 키보드 조작과 포커스를 확인하고 테스트를 쓴다.
5. `pnpm verify`를 통과시킨다.
