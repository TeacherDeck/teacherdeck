# 작업 절차 (process)

이 문서는 모든 작업에 공통으로 적용되는 절차와 GEN·DOC 규칙을 정의한다. 규칙 정의 문법과 전체 규칙 인덱스는 [README.md](README.md)를 본다.

## 1. 일반 작업 절차

1. 작업 종류를 정하고 [루트 AGENTS.md](../../AGENTS.md)의 "작업별 필독 문서"를 읽는다.
2. 작업이 [정지 조건](#2-정지-조건과-제안서)(GEN-005)에 해당하는지 확인한다. 해당하면 구현하지 않고 제안서를 쓴다.
3. 구현한다. 하위 디렉터리의 `AGENTS.md` 규칙을 함께 따른다(GEN-002).
4. 테스트를 추가하고 `pnpm verify`를 통과시킨다(GEN-003).
5. 동작이 바뀌었으면 관련 문서를 같은 변경에서 갱신한다(DOC-003).
6. 관심사 하나당 커밋 하나로 커밋한다(GEN-009).
7. [Definition of Done](#4-definition-of-done)을 확인한 뒤 완료를 선언한다.

## 2. 정지 조건과 제안서

GEN-005의 정지 조건에 해당하면 즉시 멈추고 아래 형식의 제안서로 보고한다. 사람이 승인하기 전에는 해당 변경을 커밋하지 않는다.

```
## 제안: <제목>
- 정지 조건: <GEN-005의 어느 항목인지>
- 배경: 왜 필요한가
- 제안: 무엇을 어떻게 바꾸는가 (파일, 타입, 버전)
- 검토한 대안: 기존 캡 조합, 모듈 측 WASM, 변경하지 않는 경우
- 영향: 버전(앱·캡·모듈·프로토콜), 보안, 개인정보, 하위호환
- 필요한 승인: 누가 무엇을
```

## 3. 스펙 변경 절차 (DOC-002)

규격(매니페스트, 브리지, 캡, 카탈로그, 규칙)을 바꾸는 변경은 한 PR 안에서 다음 순서를 지킨다.

1. ADR 작성 또는 갱신 (`docs/adr/`)
2. `docs/spec` 갱신
3. Rust 원천 타입 갱신 (해당 시)
4. `pnpm gen` 실행
5. 린트·검사기·테스트 갱신
6. 버전 bump ([versioning.md](versioning.md))
7. CHANGELOG 갱신
8. 관련 `AGENTS.md`의 규칙 요약 갱신

## 4. Definition of Done

- [ ] `pnpm verify`가 통과한다(GEN-003).
- [ ] 새 동작에 테스트가 있다.
- [ ] 정지 조건에 해당하는 변경은 사람 승인을 받았다(GEN-005).
- [ ] 관련 spec·`AGENTS.md`·README를 갱신했다(DOC-003).
- [ ] 사용자에게 보이는 모듈 변경은 버전 bump와 CHANGELOG를 동반한다(MOD-013).
- [ ] 로그·에러·테스트에 개인정보가 없다(PRV-003, PRV-004).
- [ ] 커밋이 Conventional Commits 형식이고 `Signed-off-by`가 있다(GEN-009).

## 5. 규칙

### GEN — 일반

- **GEN-001** [MUST NOT] 스펙·스키마·검사기를 코드에 맞춰 고치지 않는다. 코드와 spec이 다르면 코드가 틀린 것이다. 스펙 변경은 DOC-002로만 한다. — 강제: 훅(보호 경로)(Phase 7에서 구현), CODEOWNERS(Phase 7에서 구현)
- **GEN-002** [MUST] 하위 AGENTS.md는 상위 규칙을 추가·강화만 한다. 충돌을 발견하면 정지한다. — 강제: [manual]
- **GEN-003** [MUST] 완료 선언 전 `pnpm verify`를 통과한다. 우회 목적의 `eslint-disable`, `@ts-ignore`/`@ts-expect-error`, `#[allow(...)]`, 테스트 skip/only/`#[ignore]`, 검사 완화를 쓰지 않는다. — 강제: eslint `noInlineConfig`, `ban-ts-comment`, vitest 린트, `check-suppressions`
- **GEN-004** [MUST] `crates/*`, `apps/desktop`, `packages/*`에 런타임 의존성을 추가하려면 사람 승인을 받는다. 모든 의존성은 라이선스 allowlist를 통과해야 한다. — 강제: cargo-deny, `check-licenses`, [manual]
- **GEN-005** [MUST] 정지 조건. 다음 경우 즉시 멈추고 제안서로 보고한다.
  - 새 캡 추가, 또는 캡 major 변경
  - 매니페스트·브리지·카탈로그 포맷 변경
  - 보안 설정(CSP, Tauri ACL, updater, 커스텀 프로토콜) 변경
  - 라이선스·저작자 표기 파일 변경
  - 규칙 충돌 발견
  - GEN-004에 해당하는 의존성 추가
  - 사용자 파일을 삭제하거나 덮어쓰는 동작 도입

  — 강제: 훅(보호 경로)(Phase 7에서 구현), [manual]
- **GEN-006** [MUST NOT] 생성물(`schema/**`, `**/generated/**`, spec의 생성 표)을 손으로 수정하지 않는다. 생성기를 고치고 `pnpm gen`을 실행한다. — 강제: `check-gen`(재생성 후 diff), 훅(Phase 7에서 구현)
- **GEN-007** [MUST NOT] About/크레딧 화면, AUTHORS, LICENSE*, SPDX 헤더, 모듈 authors의 저자 표기를 삭제하거나 약화하지 않는다. — 강제: 훅(Phase 7에서 구현), `check-spdx`, About 화면 테스트(Phase 5에서 구현)
- **GEN-008** [MUST] 모든 소스 파일에 SPDX 헤더를 둔다. 대상은 코드·설정 파일이며 Markdown 문서는 제외한다. 헤더 형식은 [README.md](README.md#4-spdx-헤더)를 따른다. — 강제: `check-spdx`
- **GEN-009** [MUST] Conventional Commits 형식과 `Signed-off-by`를 지킨다. 커밋 하나에 관심사 하나만 담는다. — 강제: lefthook commit-msg, CI(Phase 7에서 구현)
- **GEN-010** [MUST] 식별자·커밋 메시지는 영어로, 문서·UI 문구는 한국어로 쓴다. — 강제: [manual]

### DOC — 문서

- **DOC-001** [MUST] 아키텍처·규격·보안에 영향을 주는 결정은 ADR로 남긴다. — 강제: [manual] 리뷰
- **DOC-002** [MUST] 스펙 변경 절차를 한 PR 안에서 순서대로 지킨다: ADR → spec → Rust 원천 타입 → `pnpm gen` → 린트·검사기·테스트 → 버전 bump → CHANGELOG → 관련 AGENTS.md 요약 갱신([3절](#3-스펙-변경-절차-doc-002)). — 강제: [manual], `check-gen`
- **DOC-003** [MUST] 동작이 바뀌면 같은 변경에서 관련 AGENTS.md·spec·README를 갱신한다. — 강제: [manual]
- **DOC-004** [MUST NOT] AGENTS.md와 skill 파일에 spec 본문을 복사하지 않는다. 규칙 ID, 한 줄 요약, 링크만 둔다. — 강제: `check-docs`(spec 문단 중복 탐지는 경고만 출력)
