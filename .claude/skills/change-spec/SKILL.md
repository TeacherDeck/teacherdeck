---
name: change-spec
description: 규격(매니페스트·브리지·카탈로그 포맷, 규칙, docs/spec)을 바꿔야 할 때 사용한다. 검사기가 실패해서 "규칙을 고치고 싶다"는 생각이 들 때도 먼저 이 스킬을 읽는다.
---

# 스펙 변경 절차 (DOC-002)

코드에 맞춰 스펙·스키마·검사기를 고치지 않는다(GEN-001). 검사기가 실패하면 대부분 코드를 고쳐야 한다. 스펙 자체가 틀렸다고 판단될 때만 이 절차를 따른다.

## 0. 정지 여부

매니페스트·브리지·카탈로그 포맷, 보안 설정, 라이선스·저작자 파일 변경은 정지 조건이다(GEN-005). [process.md 2절](../../../docs/spec/process.md#2-정지-조건과-제안서) 형식으로 제안서를 쓰고 승인을 기다린다.

## 1. 한 PR 안에서 순서대로

1. ADR(`docs/adr/0000-template.md` 복사)
2. `docs/spec/*.md` 갱신. 규칙은 [README.md 3절](../../../docs/spec/README.md#3-규칙-정의-문법) 문법으로, 담당 파일 한 곳에만 정의한다
3. Rust 원천 타입(`crates/deck-core`) 갱신
4. `pnpm gen`(규칙 인덱스·스키마·TS 타입·레지스트리 표). 생성물은 손으로 고치지 않는다(GEN-006)
5. 린트·검사기·위반 샘플(`tools/checks/__tests__/violations/<규칙ID>/`)·테스트 갱신. 검사기는 강화만 하고 완화하지 않는다
6. 버전 bump([versioning.md](../../../docs/spec/versioning.md))
7. CHANGELOG
8. 관련 AGENTS.md의 규칙 요약(ID + 한 줄 + 링크, DOC-004)

## 2. 완료

- [ ] `pnpm verify` 통과(check-docs가 규칙 ID 중복·링크·참조를 검사한다)
- [ ] 보호 파일 변경은 사람이 `DECK_GUARD=off` 세션에서 승인했다
