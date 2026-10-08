# .github — CI/CD 지침

GitHub Actions 워크플로, CODEOWNERS, Dependabot 설정이 있다. 루트 [AGENTS.md](../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다. 워크플로와 CODEOWNERS는 Phase 7에서 만든다.

## 규칙

정의: [ci.md 3절](../docs/spec/ci.md#3-규칙)

| ID | 요약 |
|---|---|
| CI-001 | `pull_request_target`를 쓰지 않는다. |
| CI-002 | 모든 action을 전체 커밋 SHA로 고정하고 버전 주석을 단다. |
| CI-003 | workflow `permissions`는 최소로 둔다(기본 `contents: read`). |
| CI-004 | 서명 시크릿은 `release` environment에만 두고 태그 트리거 릴리스 잡에서만 접근한다. |
| CI-005 | CI 검증은 로컬 `pnpm verify`와 같은 명령을 쓴다. |
| CI-006 | workflow 변경은 CODEOWNERS 리뷰를 필수로 한다. |
| SEC-009 | 비밀값을 워크플로나 레포에 두지 않는다. ([security.md](../docs/spec/security.md#3-규칙)) |

`.github/workflows/**`와 `.github/CODEOWNERS`는 보호 경로다. 변경은 보안 설정 변경에 해당하므로 정지 조건(GEN-005)으로 다룬다. 키 관리는 [keys.md](../docs/security/keys.md)를 본다.

## 작업 체크리스트

- [ ] 새 action은 SHA로 고정했고 `# vX.Y.Z` 주석이 있다
- [ ] 잡별 `permissions`가 최소다
- [ ] 시크릿을 쓰는 잡은 `release` environment와 태그 트리거로 제한했다
- [ ] 검증 단계는 `pnpm verify`를 그대로 호출한다
- [ ] `check-security`가 통과하고, actionlint가 있으면 실행했다
