---
name: add-capability
description: 모듈이 쓸 새 호스트 기능(캡)이 필요하거나 기존 캡을 바꿔야 할 때 사용한다. "호스트에 기능 추가", "새 캡", "파일 저장 기능이 필요해" 같은 상황에서 발동한다.
---

# 캡 추가·변경 절차

새 캡과 major 변경은 정지 조건이다(GEN-005, CAP-005). **1단계는 반드시 멈추고 제안서를 쓰는 것이다.** 사람이 승인하기 전에는 코드를 쓰지 않는다.

## 1. 제안서 (정지)

[process.md 2절](../../../docs/spec/process.md#2-정지-조건과-제안서) 형식으로 다음을 담아 보고한다.

- 캡 이름과 메서드, 인자·결과 타입
- 버전 영향: 새 캡인가, minor(추가)인가, major인가(CAP-004)
- 보안 영향: 경로를 노출하지 않는가(CAP-002), 대용량 읽기와 fs 1.1의 제한된 쓰기 청크가 CAP-003을 따르는가
- 개인정보 영향: 로그·에러에 사용자 데이터가 없는가(PRV-003), 원본을 건드리지 않는가(PRV-006)
- 검토한 대안: 기존 캡 조합, 모듈 측 JS/WASM(CAP-001)
- [capabilities.md 5절 예정 캡](../../../docs/spec/capabilities.md#5-예정-캡)과의 관계

## 2. 승인 후 (DOC-002 순서)

1. ADR 작성(`docs/adr/`)
2. spec 갱신(`docs/spec/capabilities.md`)
3. Rust 원천: `crates/deck-core/src/caps/`에 인자·결과 타입(CAP-006), `caps::REGISTRY`에 캡·버전·메서드(VER-002)
4. 호스트 구현: `apps/desktop/src-tauri/src/caps/<cap>.rs`, `caps::route`에 연결. 등록 누락은 `every_registry_method_has_a_route` 테스트가 잡는다
5. 테스트: 정상·권한 거부·잘못된 인자(CAP-009)
6. `crates/deck-codegen/src/main.rs`의 SDK 그룹에 새 타입 추가 → `pnpm gen`(CAP-010)
7. `packages/sdk/src/client.ts`에 타입 있는 헬퍼 추가 + SDK 테스트
8. CHANGELOG, [src-tauri/AGENTS.md](../../../apps/desktop/src-tauri/AGENTS.md) 요약 갱신
9. `pnpm verify`
