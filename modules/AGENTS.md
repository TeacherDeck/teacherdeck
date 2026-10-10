# modules — 모듈 작업 지침

이 디렉터리에는 덱에 올라가는 도구(모듈)가 있다. 새 도구를 만드는 작업 대부분이 여기서 일어난다. 루트 [AGENTS.md](../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다.

모범 사례는 레퍼런스 모듈 `modules/timer`다. 새 모듈을 만들기 전에 timer의 구조와 규칙 ID 주석을 먼저 읽는다. Claude Code에서는 `add-module` 스킬이 이 절차를 안내한다.

| timer 파일 | 보여 주는 패턴 |
|---|---|
| `src/main.tsx` | `connect()` 후 `DeckProvider`로 렌더(BRG-003, UI-004) |
| `src/timer.ts` + `timer.test.ts` | 호스트 없이 테스트하는 순수 로직(MOD-015) |
| `src/recent.ts` + `recent.test.ts` | storage 캡 사용과 `createMockHost` 테스트(MOD-009, MOD-015) |
| `src/App.tsx` | `@deck/ui`만 쓰는 UI(InfoBar, ToggleSwitch, SettingsCard, Display, TextBox), 키보드 조작, window 캡(MOD-010, UI-005) |

## 모듈 추가 절차

1. **필독 문서를 읽는다**: 이 파일, [modules.md](../docs/spec/modules.md), [bridge-protocol.md](../docs/spec/bridge-protocol.md), [design-system.md](../docs/spec/design-system.md).
2. **필요한 캡을 확인한다.** [capabilities.md v1 레지스트리](../docs/spec/capabilities.md#2-v1-레지스트리)에 있는 캡만 쓸 수 있다. 없는 기능이 필요하면:
   - 먼저 모듈 안의 JS/WASM으로 해결할 수 있는지 본다(CAP-001).
   - 그래도 호스트 기능이 필요하면 **멈추고 제안서를 쓴다**(GEN-005). 캡을 직접 만들지 않는다.
3. **생성한다**: `pnpm new:module <id>`(MOD-001). 디렉터리를 손으로 만들거나 다른 모듈을 복사하지 않는다.
   - id 형식: `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`(MOD-002). 최초 릴리스 후 바꾸지 않는다.
4. **매니페스트를 채운다**: `name`, `description`(80자 이하), `category`, `authors`, `requires`, `optional`(MOD-004, MOD-012).
5. **구현한다.**
   - 호스트 호출은 `@deck/sdk`로만 하고, 호출하는 캡은 모두 선언한다(MOD-006).
   - optional 캡은 `deck.has()`로 확인하고 없으면 `CapabilityGate`를 보여 준다(MOD-007).
   - UI는 `@deck/ui`에서만 가져오고 아이콘만 `@fluentui/react-icons`에서 가져온다(MOD-010). 컨트롤 목록은 [design-system.md 6절](../docs/spec/design-system.md#6-deckui-컴포넌트)을 본다. 파일 일괄 처리 도구는 `ToolLayout`을 쓴다(MOD-011).
   - 무거운 연산은 Web Worker나 WASM으로 옮긴다(MOD-014).
6. **테스트를 쓴다**: 순수 로직은 vitest, 호스트 연동은 SDK mock host(MOD-015). 테스트 데이터는 합성 데이터만 쓴다(PRV-004).
7. **검증한다**: `pnpm verify`(GEN-003).
8. **완료 체크리스트**(아래)를 확인한다.

## 규칙 요약

정의: [modules.md 4절](../docs/spec/modules.md#4-규칙)

| ID | 등급 | 요약 |
|---|---|---|
| MOD-001 | MUST | `pnpm new:module <id>`로만 만든다. |
| MOD-002 | MUST | id 형식을 지키고 디렉터리명과 같게 한다. 릴리스 후 변경 금지. |
| MOD-003 | MUST | 필수 파일: `module.json`, `package.json`, `index.html`, `src/main.tsx`, `icon.svg`, `CHANGELOG.md`. |
| MOD-004 | MUST | `module.json`은 스키마를 통과하고 스키마에 없는 필드를 쓰지 않는다. |
| MOD-005 | MUST NOT | `@deck/sdk`, `@deck/ui`, 모듈 내부, 허가된 의존성 외에는 import하지 않는다. `@tauri-apps/*`, 다른 모듈, `apps/*` 금지. |
| MOD-006 | MUST | 호스트 기능은 `@deck/sdk`로만 호출하고, 호출하는 캡은 모두 선언한다. |
| MOD-007 | MUST | optional 캡은 `deck.has()` 확인 후 쓰고, 없으면 `CapabilityGate`를 보여 준다. |
| MOD-008 | MUST NOT | 외부 네트워크 요청을 하지 않는다. |
| MOD-009 | MUST NOT | `localStorage`, `indexedDB`, `document.cookie`, `caches`를 쓰지 않는다. storage 캡만 쓴다. |
| MOD-010 | MUST | UI는 `@deck/ui`에서만, 아이콘은 `@fluentui/react-icons`에서만 가져온다. Fluent 직접 import 금지. |
| MOD-011 | MUST | 파일 일괄 처리 도구는 `ToolLayout` 골격을 따른다. |
| MOD-012 | MUST | `authors`에 실제 기여자를 적고 기존 저자를 지우지 않는다. |
| MOD-013 | MUST | 사용자에게 보이는 변경은 버전 bump와 CHANGELOG를 동반한다. |
| MOD-014 | SHOULD NOT | 메인 스레드를 50ms 이상 막지 않는다. |
| MOD-015 | MUST | vitest 단위 테스트와 mock host 테스트를 갖춘다. |
| MOD-016 | MAY | 모듈 전용 지침은 모듈 디렉터리에 AGENTS.md + CLAUDE.md 쌍으로 둔다. |

관련 규칙: UI-001~008([design-system.md](../docs/spec/design-system.md#8-규칙)), PRV-003·004·006([privacy.md](../docs/spec/privacy.md#4-규칙)), VER-004([versioning.md](../docs/spec/versioning.md#4-규칙)).

## 완료 체크리스트

- [ ] `pnpm new:module`로 생성했다
- [ ] `module.json`이 스키마를 통과하고 `authors`가 정확하다
- [ ] 호출하는 모든 캡이 `requires`/`optional`에 있다
- [ ] optional 캡 경로에 `deck.has()`와 `CapabilityGate`가 있다
- [ ] 금지된 import, 웹 저장소, 외부 네트워크가 없다
- [ ] 하드코딩한 색·간격·폰트가 없다
- [ ] 문구가 UI-007(해요체, 동작어 버튼, 사과 없는 오류)을 따른다
- [ ] 키보드만으로 조작할 수 있다(UI-005)
- [ ] 원본 파일을 덮어쓰거나 지우지 않는다(PRV-006)
- [ ] 단위 테스트와 mock host 테스트가 있고 합성 데이터만 쓴다
- [ ] 버전을 올리고 모듈 `CHANGELOG.md`를 갱신했다
- [ ] `pnpm verify` 통과
