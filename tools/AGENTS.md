# tools — 검사기·린트·훅·스크립트 지침

이 디렉터리에는 규격 위반을 기계적으로 드러내는 장치가 있다: `checks/`(verify 검사기), `eslint-plugin-deck/`(커스텀 린트), `hooks/`(Claude Code 훅), `scripts/`(gen, new-module, pack-module, bundle-modules, sync-versions). 루트 [AGENTS.md](../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| 추가 | 모든 검사기·린트 오류는 `[규칙ID] 메시지 (정의: docs/spec/xxx.md)` 형식으로 출력한다. | [spec/README.md](../docs/spec/README.md#3-규칙-정의-문법) |
| 추가 | 검사기를 추가하거나 바꾸면 `checks/__tests__/violations/`에 해당 규칙의 위반 샘플과 "그 규칙 ID로 실패한다"는 자체 테스트를 둔다. | [ci.md](../docs/spec/ci.md#1-pnpm-verify) |
| GEN-001 | 코드를 통과시키려고 검사기를 완화하지 않는다. 검사 범위를 줄이거나, 예외를 넓히거나, 오류를 경고로 낮추지 않는다. | [process.md](../docs/spec/process.md#5-규칙) |
| GEN-003 | 억제 allowlist에는 사유를 적은 항목만 둔다. allowlist는 보호 파일이다. | 같은 문서 |
| GEN-006 | 생성기의 출력물을 손으로 고치지 않는다. 생성기를 고친다. | 같은 문서 |
| PRV-004 | 위반 샘플과 테스트 데이터에도 실존 인명·학교명·연락처를 쓰지 않는다. | [privacy.md](../docs/spec/privacy.md#4-규칙) |

`tools/checks/**`, `tools/eslint-plugin-deck/**`, `tools/hooks/**`는 보호 경로다(`.github/CODEOWNERS`). 수정이 필요하면 GEN-001에 따라 멈추고 보고한다. 단, 사람이 승인한 작업에서 검사를 **강화**하는 변경은 할 수 있다.

## 작업 체크리스트

- [ ] 출력 형식이 `[규칙ID] 메시지 (정의: …)`이다
- [ ] 위반 샘플이 해당 규칙 ID로 실패하는 테스트가 있다
- [ ] 정상 샘플이 통과하는 테스트가 있다(오탐 방지)
- [ ] `pnpm verify` 통과
