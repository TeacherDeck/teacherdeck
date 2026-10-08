# crates — 순수 Rust 로직 지침

`crates/deck-core`는 매니페스트, 호환성 해석기, 카탈로그 모델, `.deckmod` 검증기, 핸들 테이블 같은 순수 로직을 담는다. 루트 [AGENTS.md](../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| 추가 | Tauri와 OS 의존 크레이트를 쓰지 않는다. 플랫폼 연동은 `apps/desktop/src-tauri`에서 한다. | 이 문서 |
| SEC-010 | `#![forbid(unsafe_code)]`를 둔다. | [security.md](../docs/spec/security.md#3-규칙) |
| 추가 | 라이브러리 코드에서 panic하지 않는다(`unwrap`, `expect`, 인덱스 panic 금지). 오류는 `Result`로 반환한다. 테스트 코드는 예외다. | 이 문서 |
| CAP-006 | 공개 타입에는 `serde` + `schemars`/`ts-rs` derive를 붙인다. | [capabilities.md](../docs/spec/capabilities.md#6-규칙) |
| VER-005 | 호환성 판정은 deck-core 해석기 함수 하나로만 한다. | [versioning.md](../docs/spec/versioning.md#4-규칙) |
| SEC-006 | 패키지 검증(zip-slip, 크기, SHA256SUMS)을 테스트로 보장한다. | [security.md](../docs/spec/security.md#3-규칙) |
| GEN-003 | `#[allow(...)]`, `#[ignore]`로 검사를 우회하지 않는다. | [process.md](../docs/spec/process.md#5-규칙) |
| GEN-006 | 생성된 스키마·TS 타입을 손으로 고치지 않는다. 원천 타입을 고치고 `pnpm gen`을 실행한다. | 같은 문서 |

## 작업 체크리스트

- [ ] 모든 공개 함수에 단위 테스트가 있다(테스트 의무)
- [ ] 해석기를 바꿨다면 [versioning.md 3절](../docs/spec/versioning.md#3-호환성-해석-알고리즘)과 테이블 테스트를 함께 확인했다
- [ ] 공개 타입을 바꿨다면 DOC-002 절차를 따랐고 `pnpm gen`을 실행했다
- [ ] 새 의존성은 사람 승인을 받았다(GEN-004)
- [ ] `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test` 통과
