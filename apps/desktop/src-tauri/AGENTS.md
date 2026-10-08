# apps/desktop/src-tauri — 호스트(Rust) 지침

호스트는 캡 구현, `deckmod` 커스텀 프로토콜, `host_invoke` 디스패치와 권한 검사를 담당한다. 상위 [apps/desktop/AGENTS.md](../AGENTS.md)와 루트 [AGENTS.md](../../../AGENTS.md) 규칙을 모두 따른다. 순수 로직은 `crates/deck-core`([crates/AGENTS.md](../../../crates/AGENTS.md))에 두고, 여기서는 OS 연동만 한다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| CAP-001 | 캡은 범용 프리미티브로 만든다. 도구 전용 메서드는 금지한다. 기존 캡 조합과 WASM을 먼저 검토한다. | [capabilities.md](../../../docs/spec/capabilities.md#6-규칙) |
| CAP-002 | 경로를 받거나 반환하지 않는다. 핸들만 쓴다. | 같은 문서 |
| CAP-003 | 1MB 초과 바이너리는 브리지가 아니라 `deckmod` 리소스 URL로 보낸다. | 같은 문서 |
| CAP-004 | 추가는 minor, 그 외는 major다. major는 이전 핸들러를 유지하고 ADR을 쓴다. | 같은 문서 |
| CAP-005 | 새 캡과 major 변경은 사람 승인을 받는다(정지 조건). | 같은 문서 |
| CAP-006 | 인자·결과는 Rust 구조체 + ts-rs로 정의한다. `serde_json::Value`는 디스패치 경계에서만 쓴다. | 같은 문서 |
| CAP-007 | 에러는 `ErrorCode` + 메시지로 반환한다. 메시지에 경로·파일명·사용자 데이터를 넣지 않는다. | 같은 문서 |
| CAP-008 | 권한 검사(설치·활성, 선언 캡, 버전)를 매 호출마다 Rust에서 한다. | 같은 문서 |
| CAP-009 | 캡마다 정상·권한 거부·잘못된 인자 테스트를 둔다. | 같은 문서 |
| SEC-001 | 셸 webview는 로컬 번들만 로드하고 CSP를 둔다. | [security.md](../../../docs/spec/security.md#3-규칙) |
| SEC-003 | Tauri ACL은 메인 창에만 최소 권한으로 준다. fs/shell/http 플러그인 권한을 프론트에 주지 않는다. | 같은 문서 |
| SEC-004 | 모듈 origin에서 IPC에 닿을 수 없음을 검증하는 절차를 유지한다. | 같은 문서 |
| SEC-005 | `deckmod`는 정규화 후 모듈 루트 하위만 서빙한다. `..`·인코딩 우회·심볼릭 링크를 거부하고 CSP·nosniff를 붙인다. | 같은 문서 |
| SEC-007 | 릴리스 빌드에서 devtools를 끈다. | 같은 문서 |
| SEC-008 | updater는 서명을 검증하고 자동 재시작하지 않는다. | 같은 문서 |
| SEC-010 | Win32 FFI는 별도 모듈로 분리하고 안전성 주석을 단다. | 같은 문서 |
| PRV-003 | 로그는 로깅 헬퍼로만 남기고 경로·파일명·사용자 데이터를 남기지 않는다. | [privacy.md](../../../docs/spec/privacy.md#4-규칙) |
| PRV-005 | 임시 파일은 temp 헬퍼로만 만든다. | 같은 문서 |
| PRV-007 | 모듈 데이터는 모듈 id로 격리한다. | 같은 문서 |

`capabilities/`(ACL), `tauri.conf.json`, `src/protocol.rs`의 CSP를 바꾸는 것은 보안 설정 변경이므로 **정지 조건**이다(GEN-005).

## 파일 지도

| 위치 | 내용 |
|---|---|
| `src/lib.rs` | 앱 조립: 창·Mica, 로깅, 모듈 저장소, 프로토콜, 명령, 드래그 앤 드롭 |
| `src/origins.rs` | 셸·모듈 origin 상수(SEC-002) |
| `src/protocol.rs` | `deckmod` 프로토콜 경로 검증·헤더(SEC-005) |
| `src/bridge.rs` | `host_invoke`와 권한 검사(CAP-008) |
| `src/caps/` | 캡 핸들러. `route()`가 레지스트리와 1:1로 대응한다 |
| `src/modules.rs` | 기본 모듈 로드·검증·해석, 메모리 서빙 |
| `src/storage.rs`, `src/platform.rs` | storage 영속화, OS 정보·Mica·난수·temp·로깅 |
| `src/probe.rs` | 디버그 전용 SEC-004 프로브([sec-004.md](../../../docs/security/sec-004.md)) |
| `capabilities/main.json`, `tauri.conf.json` | ACL·CSP·번들 설정(보호 파일, 정지 조건) |

## 캡 추가 절차

[capabilities.md 3절](../../../docs/spec/capabilities.md#3-캡-추가변경-절차)을 따른다. 요약:

1. **정지하고 제안서를 쓴다**(GEN-005). 캡 이름, 메서드·타입, 버전 영향, 보안·개인정보 영향, 대안 검토를 담는다.
2. 승인을 받은 뒤 DOC-002 순서로 진행한다.
3. 구조체 정의 + ts-rs export → 레지스트리 상수 등록 → `src/caps/<cap>.rs` 구현 → 테스트 → `pnpm gen`.

## 보안 체크리스트

- [ ] 핸들을 경로로 바꾸는 코드는 핸들 테이블 한 곳에만 있다
- [ ] 핸들 소유자(모듈 id, 세션)를 매번 확인한다
- [ ] 경로 정규화 후 허용 루트 하위인지 확인한다(심볼릭 링크 포함)
- [ ] 에러 메시지와 로그에 경로·파일명·사용자 입력이 없다
- [ ] 원본 파일을 덮어쓰거나 지우지 않는다(PRV-006). 필요하면 정지 조건으로 처리한다
- [ ] 새 `unsafe`가 없다. 있다면 FFI 모듈 안에 있고 `// SAFETY:` 주석이 있다
- [ ] 정상·권한 거부·잘못된 인자 테스트가 있다(CAP-009)
