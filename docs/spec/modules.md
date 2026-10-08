# 모듈 (modules)

모듈은 덱에 올라가는 도구 하나를 담은 웹 번들(HTML/JS/WASM)이다([ADR-0002](../adr/0002-module-architecture.md)). 이 문서는 매니페스트 포맷, 모듈 구성, 생명주기, MOD 규칙을 정의한다.

## 1. 매니페스트 (`module.json`)

```jsonc
{
  "$schema": "../../schema/module.schema.json",
  "manifestVersion": 1,
  "id": "timer",
  "name": "타이머",
  "description": "수업용 타이머",          // 80자 이하
  "version": "0.1.0",                      // semver
  "category": "classroom",                 // classroom | file | image | document | utility
  "icon": "icon.svg",
  "entry": "index.html",
  "authors": [{ "name": "신민성", "github": "banatic" }],
  "requires": { "storage": "^1.0", "window": "^1.0" },
  "optional": {},
  "ui": { "keepAlive": true }             // 기본 false
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `$schema` | 아니오 | 편집기 검증용. 패키징 시 무시한다. |
| `manifestVersion` | 예 | 정수. 현재 `1`. |
| `id` | 예 | MOD-002 형식. 디렉터리명과 같다. `_`로 시작할 수 없다([catalog.md](catalog.md#3-서빙)). |
| `name` | 예 | 사용자에게 보이는 이름(한국어). |
| `description` | 예 | 80자 이하. |
| `version` | 예 | semver([versioning.md](versioning.md)). |
| `category` | 예 | `classroom`, `file`, `image`, `document`, `utility` 중 하나. |
| `icon` | 예 | 패키지 내부 상대 경로의 SVG. |
| `entry` | 예 | 패키지 내부 상대 경로의 HTML. |
| `authors` | 예 | 1개 이상. 각 항목은 `name`(필수), `github`(선택). |
| `requires` | 예 | 캡 이름 → semver 범위. 빈 객체를 허용한다. |
| `optional` | 예 | 캡 이름 → semver 범위. 빈 객체를 허용한다. |
| `ui.keepAlive` | 아니오 | 기본 `false`. |

- `additionalProperties: false`다. 카테고리나 필드를 추가하는 것은 스펙 변경이다(DOC-002, GEN-005).
- `requires`·`optional`의 키는 레지스트리(`schema/capabilities.json`)에 있는 캡이어야 하며, 같은 캡이 양쪽에 동시에 올 수 없다.
- `entry`·`icon`은 패키지 내부 상대 경로다. 절대 경로와 `..`를 허용하지 않는다.
- 원천은 deck-core의 Rust 구조체(serde + schemars)이며 `schema/module.schema.json`은 생성물이다(Phase 3에서 생성).

## 2. 모듈 구성

```
modules/<id>/
├─ module.json
├─ package.json          # name "@deck-module/<id>", private: true, "deckTemplate": <템플릿 버전>
├─ index.html            # entry
├─ icon.svg
├─ CHANGELOG.md
├─ src/
│  ├─ main.tsx
│  └─ **/*.test.ts(x)    # MOD-015
├─ AGENTS.md, CLAUDE.md  # 선택 (MOD-016)
```

모듈은 `pnpm new:module <id>`로 `modules/_template`에서 만든다(MOD-001). 레퍼런스 모듈은 `modules/timer`다(Phase 6).

## 3. 생명주기

1. **발견**: 호스트가 기본 모듈 인덱스와 설치된 모듈 인덱스를 읽는다([catalog.md](catalog.md)).
2. **해석**: 호환성 해석기가 모듈별 상태와 사용할 버전을 정한다([versioning.md](versioning.md#3-호환성-해석-알고리즘)).
3. **로드**: 셸이 모듈 origin의 iframe을 만든다([security.md](security.md), SEC-002).
4. **핸드셰이크**: 모듈이 `hello`를 보내고 셸이 `init`으로 응답한다([bridge-protocol.md](bridge-protocol.md), BRG-003).
5. **활성**: 모듈이 `req`로 캡을 호출한다. 호스트는 매 호출마다 권한을 검사한다(CAP-008).
6. **숨김**: 다른 화면으로 전환하면, `ui.keepAlive: true`인 모듈은 iframe을 숨긴 채 유지하고 `module.visibility` 이벤트를 보낸다. 동시에 유지되는 keepAlive 모듈은 최대 3개(LRU)다. 그 외 모듈은 언로드한다.
7. **언로드**: iframe을 제거한다. 호스트는 모듈이 바꾼 창 상태(항상 위, 전체화면)를 되돌린다([capabilities.md](capabilities.md)).

## 4. 규칙

- **MOD-001** [MUST] 모듈은 `pnpm new:module <id>`로만 만든다. — 강제: `check-modules`(필수 구성·템플릿 마커)
- **MOD-002** [MUST] id는 `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`이고 디렉터리명과 같다. 최초 릴리스 후 변경하지 않는다. — 강제: 스키마(Phase 3에서 구현), `check-modules`
- **MOD-003** [MUST] 필수 파일: `module.json`, `package.json`(name `@deck-module/<id>`, private), `index.html`, `src/main.tsx`, `icon.svg`, `CHANGELOG.md`. — 강제: `check-modules`
- **MOD-004** [MUST] `module.json`은 `schema/module.schema.json`을 통과해야 하며, 스키마에 없는 필드를 쓰지 않는다. — 강제: 스키마 `additionalProperties: false`(Phase 3에서 구현)
- **MOD-005** [MUST NOT] import 허용 범위는 `@deck/sdk`, `@deck/ui`, 모듈 내부, 라이선스 검사를 통과한 의존성뿐이다. `@tauri-apps/*`, 다른 모듈, `apps/*`, 패키지 내부 경로는 import하지 않는다. — 강제: eslint `no-restricted-imports`
- **MOD-006** [MUST] 호스트 기능은 `@deck/sdk`로만 호출하고, 호출하는 모든 캡을 `requires` 또는 `optional`에 선언한다. — 강제: SDK 런타임 거부(Phase 5에서 구현), 호스트 CAP-008(Phase 4에서 구현)
- **MOD-007** [MUST] optional 캡은 `deck.has(cap)`로 확인한 뒤 사용하고, 없으면 `CapabilityGate`로 "앱 업데이트 후 사용 가능"을 표시한다. — 강제: SDK 미확인 호출 경고 로그(Phase 5에서 구현), [manual]
- **MOD-008** [MUST NOT] 외부 네트워크 요청을 하지 않는다. — 강제: 모듈 CSP `connect-src 'self'`(Phase 4에서 구현)
- **MOD-009** [MUST NOT] 영속 데이터에 `localStorage`, `indexedDB`, `document.cookie`, `caches`를 쓰지 않는다. storage 캡만 쓴다. — 강제: eslint `deck/no-web-storage`
- **MOD-010** [MUST] UI는 `@deck/ui`와 Fluent UI v9 컴포넌트·토큰만 쓴다(UI-001~003). — 강제: eslint
- **MOD-011** [MUST] 파일을 일괄 처리하는 도구는 `ToolLayout` 골격을 따른다(UI-008). — 강제: [manual]
- **MOD-012** [MUST] `authors`에 실제 기여자를 기록하고 기존 저자를 제거하지 않는다. — 강제: 스키마 `minItems: 1`(Phase 3에서 구현), [manual]
- **MOD-013** [MUST] 사용자에게 보이는 변경은 버전 bump와 모듈 CHANGELOG를 동반한다(VER-004). — 강제: `check-modules`(현재 버전의 CHANGELOG 항목), CI의 base 브랜치 대비 버전 비교(Phase 7에서 구현)
- **MOD-014** [SHOULD NOT] 메인 스레드를 50ms 이상 막지 않는다. 무거운 연산은 Web Worker 또는 WASM으로 옮긴다. — 강제: [manual]
- **MOD-015** [MUST] 순수 로직은 vitest 단위 테스트를, 호스트 연동은 SDK mock host 테스트를 갖춘다. — 강제: `check-modules`(테스트 파일 존재)
- **MOD-016** [MAY] 모듈 전용 지침이 필요하면 모듈 디렉터리에 AGENTS.md와 CLAUDE.md를 함께 둔다(GEN-002 준수). — 강제: `check-docs`(쌍 존재)
