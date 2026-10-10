# 규격 (spec)

`docs/spec`은 TeacherDeck의 **규범 원천**이다. 에이전트용 작업 지침(`AGENTS.md`)은 이 문서들의 규칙 ID와 한 줄 요약, 링크만 담는다([ADR-0008](../adr/0008-spec-system.md)).

## 1. 문서 목록

| 파일 | 내용 | 규칙 |
|---|---|---|
| [process.md](process.md) | 작업 절차, 정지 조건, 스펙 변경 절차, DoD | GEN, DOC |
| [modules.md](modules.md) | 매니페스트 포맷, 모듈 구성, 생명주기 | MOD |
| [bridge-protocol.md](bridge-protocol.md) | 브리지 메시지 포맷, 핸드셰이크, 이벤트 | BRG |
| [capabilities.md](capabilities.md) | 캡 설계 원칙, v1 레지스트리, 추가 절차, 예정 캡 | CAP |
| [versioning.md](versioning.md) | 버전 축, 호환성 해석 알고리즘 | VER |
| [catalog.md](catalog.md) | 카탈로그 인덱스, `.deckmod` 패키지, 서빙 | (SEC·VER 참조) |
| [design-system.md](design-system.md) | 화면 구조, 토큰, Mica, 폰트, About 화면, `@deck/ui` | UI |
| [privacy.md](privacy.md) | 개인정보 원칙 | PRV |
| [security.md](security.md) | 보안 원칙, 위협 모델 요약 | SEC |
| [ci.md](ci.md) | `pnpm verify`, 워크플로, CI 규칙 | CI |

## 2. 원천 계층과 우선순위

1. **기계로 검증 가능한 규격**(매니페스트 스키마, 캡 타입·버전, 에러 코드)의 원천은 Rust 타입이다. JSON 스키마, TS 타입, 이 디렉터리의 레지스트리 표는 `pnpm gen`으로 생성한다.
2. **의미·절차 규범**의 원천은 이 디렉터리의 문서다.
3. **`AGENTS.md`**는 규칙 ID, 한 줄 요약, 링크만 담는다(DOC-004). `AGENTS.md`와 spec이 다르면 spec이 맞고 `AGENTS.md`를 고친다.
4. 루트 `AGENTS.md`가 하위 `AGENTS.md`보다 우선한다. 하위 문서는 규칙을 추가하거나 강화만 할 수 있다(GEN-002). 충돌을 발견하면 작업을 멈추고 보고한다(GEN-005).

## 3. 규칙 정의 문법

모든 규칙은 접두사가 담당하는 spec 파일 한 곳에서만 정의한다. 다른 곳에서는 ID로 참조만 한다.

```
- **MOD-005** [MUST NOT] 요약 문장. 상세 설명. — 강제: eslint `no-restricted-imports`
```

- **ID**: `PREFIX-NNN`. 접두사는 `GEN`, `DOC`, `MOD`, `CAP`, `BRG`, `VER`, `UI`, `PRV`, `SEC`, `CI`이다. 번호는 재사용하지 않는다. 폐기된 규칙은 지우지 않고 `[DEPRECATED]`로 남긴다.
- **등급**: `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)). 키워드는 영문 대문자로 쓰고 나머지는 한국어로 쓴다.
- **요약 문장**: 첫 문장이다. 규칙 인덱스와 `AGENTS.md`에 쓰인다.
- **강제**: `— 강제:` 뒤에 기계적 강제 수단을 적는다.
  - 기계화할 수 없으면 `[manual]`이라고 쓴다.
  - 아직 구현되지 않았으면 `(Phase N에서 구현)`을 붙인다. 구현되면 이 표시를 지운다.
  - `(사람 설정)`은 GitHub 웹 설정처럼 레포 밖에서 사람이 해야 하는 장치다.
- 하위 항목이 있는 규칙은 하위 목록 뒤에 빈 줄을 두고 `— 강제:` 줄을 쓴다.

검사기의 오류 메시지 형식은 `[규칙ID] 메시지 (정의: docs/spec/xxx.md)`이다.

## 4. SPDX 헤더

GEN-008에 따라 모든 소스 파일(코드·설정)의 첫머리에 다음 두 줄을 둔다. Markdown 문서와 주석을 쓸 수 없는 형식(JSON 등)은 제외한다.

```
SPDX-License-Identifier: GPL-3.0-only
Additional terms: see LICENSE-ADDITIONAL-TERMS
```

| 형식 | 주석 |
|---|---|
| `.ts` `.tsx` `.js` `.mjs` `.rs` | `// …` |
| `.css` | `/* … */` |
| `.toml` `.yml` `.yaml` `.ps1` | `# …` |
| `.html` `.svg` | `<!-- … -->` |

## 5. 규칙 인덱스

> 이 표는 `pnpm gen`이 각 spec 파일의 규칙 정의를 파싱해 만드는 생성물이다(tools/scripts/gen/rule-index.ts). 손으로 고치지 않는다(GEN-006). 원천과 다르면 `check-gen`이 실패한다.

<!-- rule-index:start -->
<!-- 생성물: `pnpm gen`(tools/scripts/gen/rule-index.ts). 손으로 고치지 마세요(GEN-006). -->
| ID | 등급 | 요약 | 강제 수단 | 정의 문서 |
|---|---|---|---|---|
| GEN-001 | MUST NOT | 스펙·스키마·검사기를 코드에 맞춰 고치지 않는다. | 훅(보호 경로), CODEOWNERS | [process.md](process.md) |
| GEN-002 | MUST | 하위 AGENTS.md는 상위 규칙을 추가·강화만 한다. | [manual] | [process.md](process.md) |
| GEN-003 | MUST | 완료 선언 전 `pnpm verify`를 통과한다. | eslint `noInlineConfig`, `ban-ts-comment`, vitest 린트, `check-suppressions` | [process.md](process.md) |
| GEN-004 | MUST | `crates/*`, `apps/desktop`, `packages/*`에 런타임 의존성을 추가하려면 사람 승인을 받는다. | cargo-deny, `check-licenses`, [manual] | [process.md](process.md) |
| GEN-005 | MUST | 정지 조건. 다음 경우 즉시 멈추고 제안서로 보고한다. | 훅(보호 경로), [manual] | [process.md](process.md) |
| GEN-006 | MUST NOT | 생성물(`schema/**`, `**/generated/**`, spec의 생성 표)을 손으로 수정하지 않는다. | `check-gen`(재생성 후 비교), 훅 | [process.md](process.md) |
| GEN-007 | MUST NOT | About/크레딧 화면, AUTHORS, LICENSE*, SPDX 헤더, 모듈 authors의 저자 표기를 삭제하거나 약화하지 않는다. | 훅, `check-spdx`, About 화면 테스트 | [process.md](process.md) |
| GEN-008 | MUST | 모든 소스 파일에 SPDX 헤더를 둔다. | `check-spdx` | [process.md](process.md) |
| GEN-009 | MUST | Conventional Commits 형식과 `Signed-off-by`를 지킨다. | lefthook commit-msg, CI `check-commits` | [process.md](process.md) |
| GEN-010 | MUST | 식별자·커밋 메시지는 영어로, 문서·UI 문구는 한국어로 쓴다. | [manual] | [process.md](process.md) |
| DOC-001 | MUST | 아키텍처·규격·보안에 영향을 주는 결정은 ADR로 남긴다. | [manual] 리뷰 | [process.md](process.md) |
| DOC-002 | MUST | 스펙 변경 절차를 한 PR 안에서 순서대로 지킨다: ADR → spec → Rust 원천 타입 → `pnpm gen` → 린트·검사기·테스트 → 버전 bump → CHANGELOG → 관련 AGENTS.md 요약 갱신(3절). | [manual], `check-gen` | [process.md](process.md) |
| DOC-003 | MUST | 동작이 바뀌면 같은 변경에서 관련 AGENTS.md·spec·README를 갱신한다. | [manual] | [process.md](process.md) |
| DOC-004 | MUST NOT | AGENTS.md와 skill 파일에 spec 본문을 복사하지 않는다. | `check-docs`(spec 문단 중복 탐지는 경고만 출력) | [process.md](process.md) |
| MOD-001 | MUST | 모듈은 `pnpm new:module <id>`로만 만든다. | `check-modules`(필수 구성·템플릿 마커) | [modules.md](modules.md) |
| MOD-002 | MUST | id는 `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`이고 디렉터리명과 같다. | 스키마, `check-modules` | [modules.md](modules.md) |
| MOD-003 | MUST | 필수 파일: `module.json`, `package.json`(name `@deck-module/<id>`, private), `index.html`, `src/main.tsx`, `icon.svg`, `CHANGELOG.md`. | `check-modules` | [modules.md](modules.md) |
| MOD-004 | MUST | `module.json`은 `schema/module.schema.json`을 통과해야 하며, 스키마에 없는 필드를 쓰지 않는다. | 스키마 `additionalProperties: false`, deck-core 매니페스트 검증 | [modules.md](modules.md) |
| MOD-005 | MUST NOT | import 허용 범위는 `@deck/sdk`, `@deck/ui`, 모듈 내부, 라이선스 검사를 통과한 의존성뿐이다. | eslint `no-restricted-imports` | [modules.md](modules.md) |
| MOD-006 | MUST | 호스트 기능은 `@deck/sdk`로만 호출하고, 호출하는 모든 캡을 `requires` 또는 `optional`에 선언한다. | SDK 런타임 거부, 호스트 CAP-008, 위반 샘플 테스트 | [modules.md](modules.md) |
| MOD-007 | MUST | optional 캡은 `deck.has(cap)`로 확인한 뒤 사용하고, 없으면 `CapabilityGate`로 "앱 업데이트 후 사용 가능"을 표시한다. | SDK 미확인 호출 경고 로그, [manual] | [modules.md](modules.md) |
| MOD-008 | MUST NOT | 외부 네트워크 요청을 하지 않는다. | 모듈 CSP `connect-src 'self'` | [modules.md](modules.md) |
| MOD-009 | MUST NOT | 영속 데이터에 `localStorage`, `indexedDB`, `document.cookie`, `caches`를 쓰지 않는다. | eslint `deck/no-web-storage` | [modules.md](modules.md) |
| MOD-010 | MUST | UI 컴포넌트·타입 램프·토큰·스타일 도구는 `@deck/ui`에서만 가져오고, 아이콘은 `@fluentui/react-icons`에서만 가져온다. | eslint `no-restricted-imports` | [modules.md](modules.md) |
| MOD-011 | MUST | 파일을 일괄 처리하는 도구는 `ToolLayout` 골격을 따른다(UI-008). | [manual] | [modules.md](modules.md) |
| MOD-012 | MUST | `authors`에 실제 기여자를 기록하고 기존 저자를 제거하지 않는다. | 스키마 `minItems: 1`, [manual] | [modules.md](modules.md) |
| MOD-013 | MUST | 사용자에게 보이는 변경은 버전 bump와 모듈 CHANGELOG를 동반한다(VER-004). | `check-modules`(현재 버전의 CHANGELOG 항목), CI의 base 브랜치 대비 버전 비교(`check-module-bumps`) | [modules.md](modules.md) |
| MOD-014 | SHOULD NOT | 메인 스레드를 50ms 이상 막지 않는다. | [manual] | [modules.md](modules.md) |
| MOD-015 | MUST | 순수 로직은 vitest 단위 테스트를, 호스트 연동은 SDK mock host 테스트를 갖춘다. | `check-modules`(테스트 파일 존재) | [modules.md](modules.md) |
| MOD-016 | MAY | 모듈 전용 지침이 필요하면 모듈 디렉터리에 AGENTS.md와 CLAUDE.md를 함께 둔다(GEN-002 준수). | `check-docs`(쌍 존재) | [modules.md](modules.md) |
| CAP-001 | MUST | 캡은 범용 프리미티브로 설계한다. | [manual] 리뷰, add-capability skill | [capabilities.md](capabilities.md) |
| CAP-002 | MUST NOT | 파일 경로를 인자로 받거나 결과로 반환하지 않는다. | 타입 리뷰(deck-core `caps/fs.rs`에 경로 필드 없음), 핸들 테이블 테스트 | [capabilities.md](capabilities.md) |
| CAP-003 | MUST NOT | 대용량 바이너리(>1MB)를 브리지로 한 번에 보내지 않는다. | 브리지 크기 제한 BRG-007, 파일 청크 검사 | [capabilities.md](capabilities.md) |
| CAP-004 | MUST | 버전 규칙: 메서드·선택 인자·결과 필드 추가는 minor, 그 외는 major다. | [manual], 레지스트리 diff 리뷰 | [capabilities.md](capabilities.md) |
| CAP-005 | MUST | 새 캡이나 major 변경은 사람 승인을 받는다(GEN-005). | 훅(레지스트리 생성물 보호), CODEOWNERS, [manual] | [capabilities.md](capabilities.md) |
| CAP-006 | MUST | 모든 메서드 인자·결과는 Rust 구조체로 정의하고 ts-rs로 TS 타입을 export한다. | `check-gen` | [capabilities.md](capabilities.md) |
| CAP-007 | MUST | 에러는 `ErrorCode` enum과 메시지로 반환하며, 메시지에 경로·파일명·사용자 데이터를 넣지 않는다(PRV-003). | 호스트 브리지 테스트, [manual] | [capabilities.md](capabilities.md) |
| CAP-008 | MUST | 모듈 권한 검사(설치·활성 여부, 선언 캡, 버전)는 Rust에서 매 호출마다 수행한다. | 권한 거부 테스트(`src-tauri/src/bridge.rs`) | [capabilities.md](capabilities.md) |
| CAP-009 | MUST | 각 캡은 정상·권한 거부·잘못된 인자 테스트를 갖춘다. | `every_registry_method_has_a_route` 테스트, [manual] 리뷰(커버리지 보고는 미구현) | [capabilities.md](capabilities.md) |
| CAP-010 | MUST | `capabilities.md`의 레지스트리 표와 `schema/capabilities.json`은 Rust 레지스트리에서 생성한다. | `check-gen` | [capabilities.md](capabilities.md) |
| BRG-001 | MUST | 셸은 `event.source`가 알려진 모듈 iframe의 contentWindow이고 `event.origin`이 그 프레임의 검증된 entryUrl에 등록된 정확한 모듈 origin인 메시지만 처리한다. | 셸 단위 테스트(`apps/desktop/src/bridge/ModuleBridge.test.ts`) | [bridge-protocol.md](bridge-protocol.md) |
| BRG-002 | MUST | 모듈(SDK)은 `window.parent`에서 온, 셸 origin의 메시지만 처리한다. | SDK 테스트(`packages/sdk/src/client.test.ts`) | [bridge-protocol.md](bridge-protocol.md) |
| BRG-003 | MUST | 모듈은 로드 후 10초 안에 `hello`를 보낸다. | SDK 구현, 셸 테스트 | [bridge-protocol.md](bridge-protocol.md) |
| BRG-004 | MUST | `req.id`는 모듈 세션 내 고유한 UUID다. | SDK 테스트(`packages/sdk/src/client.test.ts`) | [bridge-protocol.md](bridge-protocol.md) |
| BRG-005 | MUST | 장시간 작업(job) 패턴: 진행률은 `evt job.progress {id, done, total}`로, 취소는 `{kind:"cancel", id}`로 하고 결과는 원래 `res`로 받는다. | 스펙(이 문서) | [bridge-protocol.md](bridge-protocol.md) |
| BRG-006 | MUST | 알 수 없는 kind나 잘못된 형식의 메시지는 무시하고 내용 없이 debug 로그만 남긴다. | SDK·셸 테스트 | [bridge-protocol.md](bridge-protocol.md) |
| BRG-007 | MUST | 메시지는 JSON 직렬화 가능해야 하며 1MB를 넘지 않는다. | SDK·셸 검사와 테스트 | [bridge-protocol.md](bridge-protocol.md) |
| BRG-008 | MUST | 프로토콜 버전은 정수 필드 `deck`이다. | [manual] | [bridge-protocol.md](bridge-protocol.md) |
| BRG-009 | MUST | v1 이벤트는 `theme.changed`, `fs.dropped`(fs 캡이 있는 활성 모듈에만), `module.visibility`, `job.progress`다. | TS 유니온 타입(`EVENT_TOPICS`, `EventPayloads`) | [bridge-protocol.md](bridge-protocol.md) |
| VER-001 | MUST | 앱 버전의 원천은 루트 `package.json`이다. | `check-versions` | [versioning.md](versioning.md) |
| VER-002 | MUST | 캡 버전은 Rust 레지스트리 상수가 원천이다. | `check-gen` | [versioning.md](versioning.md) |
| VER-003 | MUST | 앱 버전과 캡 버전은 독립이다. | [manual] | [versioning.md](versioning.md) |
| VER-004 | MUST | 모듈 semver: 사용자에게 보이는 변경은 bump한다. | `check-modules`, CI `check-module-bumps` | [versioning.md](versioning.md) |
| VER-005 | MUST | 호환성 판정은 3절 알고리즘(deck-core의 순수 함수)으로만 한다. | 단위 테스트(`resolver.rs` 테이블 테스트) | [versioning.md](versioning.md) |
| VER-006 | MUST | SDK는 지원하는 브리지 프로토콜 버전과 자체 semver를 노출한다. | SDK 테스트 | [versioning.md](versioning.md) |
| UI-001 | MUST NOT | Fluent UI React v9 외의 컴포넌트 라이브러리를 추가하지 않는다. | eslint `no-restricted-imports`, GEN-004 | [design-system.md](design-system.md) |
| UI-002 | MUST NOT | 색·간격·반경·그림자·폰트 패밀리를 하드코딩하지 않는다. | eslint `deck/no-raw-style-values` | [design-system.md](design-system.md) |
| UI-003 | MUST | 아이콘은 `@fluentui/react-icons`만 쓴다(모듈 `icon.svg` 제외). | eslint | [design-system.md](design-system.md) |
| UI-004 | MUST | 셸과 모듈의 루트 배경은 투명(Mica)이고, 표면은 레이어 토큰으로 표현한다. | `DeckProvider` 기본값, [manual] | [design-system.md](design-system.md) |
| UI-005 | MUST | 키보드만으로 전부 조작할 수 있고, 포커스가 보이며, 텍스트 150%·DPI 200%에서 잘림이 없고, 대비가 WCAG AA를 만족한다. | [manual] 체크리스트, axe 자동 테스트는 미구현 | [design-system.md](design-system.md) |
| UI-006 | MUST NOT | `@deck/ui`에 있는 패턴을 모듈에서 재구현하지 않는다. | [manual], 모듈의 Fluent 직접 import 금지(MOD-010) | [design-system.md](design-system.md) |
| UI-007 | MUST | 문구 규칙. | [manual] | [design-system.md](design-system.md) |
| UI-008 | MUST | 일괄 처리 도구는 `ToolLayout`(입력 → 옵션 → 미리보기 → 실행 → 결과) 골격을 따른다. | [manual] | [design-system.md](design-system.md) |
| PRV-001 | MUST NOT | 호스트 외에는 네트워크 통신을 하지 않는다. | 셸·모듈 CSP, 코드 리뷰 | [privacy.md](privacy.md) |
| PRV-002 | MUST NOT | 텔레메트리, 사용 통계, 크래시 자동 전송을 하지 않는다. | 의존성 리뷰, [manual] | [privacy.md](privacy.md) |
| PRV-003 | MUST NOT | 로그와 에러 메시지에 경로·파일명·파일 내용·사용자 입력·storage 값을 남기지 않는다. | [manual] 리뷰(타입 강제 로깅 헬퍼는 미구현) | [privacy.md](privacy.md) |
| PRV-004 | MUST NOT | 테스트·문서·스크린샷·예제에 실존 인명·학교명·연락처를 쓰지 않는다. | [manual], 합성 데이터 생성기 제공 | [privacy.md](privacy.md) |
| PRV-005 | MUST | 임시 파일은 앱 전용 temp 디렉터리에 만들고 작업 종료·앱 시작에 정리한다. | temp 헬퍼 API(`TempArea`), 출력 서비스와 테스트 | [privacy.md](privacy.md) |
| PRV-006 | MUST NOT | 원본 파일 덮어쓰기·삭제를 기본 동작으로 하지 않는다. | [manual], GEN-005 | [privacy.md](privacy.md) |
| PRV-007 | MUST | 모듈 데이터는 모듈 id로 격리한다. | storage 캡 테스트 | [privacy.md](privacy.md) |
| SEC-001 | MUST | 셸 webview는 로컬 번들만 로드하며 CSP를 설정한다. | tauri.conf 검사 `check-security` | [security.md](security.md) |
| SEC-002 | MUST | 모듈은 셸 및 다른 모듈과 독립 origin에서만 서빙한다. | origin 생성·authority 검증(`origins.rs`, `protocol.rs`), 셸 브리지·CSP 테스트 | [security.md](security.md) |
| SEC-003 | MUST | Tauri ACL은 셸 main과 ADR-0017의 로컬 캡처 보조 창에만 아래 정확한 최소 권한으로 준다. | `check-security` | [security.md](security.md) |
| SEC-004 | MUST | 모듈 origin에서 Tauri IPC에 접근할 수 없어야 하며, 이를 검증하는 테스트나 절차를 유지한다. | 검증 절차 [sec-004.md](../security/sec-004.md) | [security.md](security.md) |
| SEC-005 | MUST | `deckmod` 프로토콜은 정확한 `<id>.modules.localhost` authority와 경로 id를 대조하고 정규화 후 해당 모듈 루트 하위만 서빙한다. | 프로토콜 테스트(`src-tauri/src/protocol.rs`) | [security.md](security.md) |
| SEC-006 | MUST | 패키지 설치 시 zip-slip·크기·SHA256SUMS를 검증하고, 원격 카탈로그 도입 시 서명 검증을 추가한다. | deck-core `package.rs` 테스트 | [security.md](security.md) |
| SEC-007 | MUST | 릴리스 빌드에서 devtools를 비활성화한다. | `check-security` | [security.md](security.md) |
| SEC-008 | MUST | updater는 서명을 검증하고, 자동 재시작하지 않는다(사용자 동의 후 적용). | 코드 리뷰 | [security.md](security.md) |
| SEC-009 | MUST NOT | 비밀값(키, 토큰)을 레포에 두지 않는다. | gitleaks lefthook, GitHub push protection(사람 설정), `.claude/settings.json` deny | [security.md](security.md) |
| SEC-010 | MUST | deck-core는 `#![forbid(unsafe_code)]`를 둔다. | 컴파일러, [manual] | [security.md](security.md) |
| SEC-011 | MUST | 의존성 라이선스·보안 권고 검사를 통과한다. | cargo-deny, npm license check | [security.md](security.md) |
| CI-001 | MUST NOT | `pull_request_target`를 쓰지 않는다. | `check-security` workflow 스캔 | [ci.md](ci.md) |
| CI-002 | MUST | 모든 action은 전체 커밋 SHA로 고정하고 버전 주석을 단다. | `check-security` | [ci.md](ci.md) |
| CI-003 | MUST | workflow `permissions`는 최소로 한다(기본 `contents: read`). | `check-security` | [ci.md](ci.md) |
| CI-004 | MUST | 서명 시크릿은 `release` environment에만 두고 태그 트리거 릴리스 잡에서만 접근한다. | `check-security` | [ci.md](ci.md) |
| CI-005 | MUST | CI 검증은 로컬 `pnpm verify`와 같은 명령을 쓴다. | workflow 리뷰 | [ci.md](ci.md) |
| CI-006 | MUST | main은 PR과 `verify` 통과로만 바꾼다. | ruleset(사람 설정) | [ci.md](ci.md) |
<!-- rule-index:end -->
