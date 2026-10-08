# CI/CD (ci)

로컬 검증 파이프라인(`pnpm verify`), GitHub Actions 워크플로, CI 규칙을 정의한다.

## 1. `pnpm verify`

CI는 로컬과 같은 명령을 쓴다(CI-005). 모든 검사기는 다음 형식으로 출력한다.

```
[규칙ID] 메시지 (정의: docs/spec/xxx.md)
```

| 단계 | 내용 | 대표 규칙 |
|---|---|---|
| `check-gen` | `pnpm gen` 재실행 후 git diff 없음 확인 (스키마, TS 타입, 레지스트리 표, 규칙 인덱스, third-party) | GEN-006, CAP-006, CAP-010 |
| `lint` | ESLint flat config + `tools/eslint-plugin-deck`. modules·packages에 `linterOptions.noInlineConfig: true` | MOD-005, MOD-009, MOD-010, UI-001~003, GEN-003 |
| `typecheck` | `tsc -b` strict | — |
| `test` | vitest (sdk, ui, shell, modules, tools/checks 자체 테스트) | MOD-015, BRG-001~009 |
| `cargo` | `fmt --check`, `clippy --workspace -- -D warnings`, `test --workspace` | GEN-003, CAP-009 |
| `cargo deny check` | licenses, bans, advisories, sources | SEC-011, GEN-004 |
| `check-modules` | 스키마, 필수 파일, id = 디렉터리명, authors, CHANGELOG, 테스트 존재 | MOD-001~004, MOD-012, MOD-013, MOD-015 |
| `check-spdx` | 소스 파일 SPDX 헤더 | GEN-008 |
| `check-versions` | 앱 버전 동기화 | VER-001 |
| `check-docs` | AGENTS.md ↔ CLAUDE.md 쌍, 규칙 ID 정의 유일성, 참조된 ID 존재, 상대 링크 유효, 루트 AGENTS.md 200줄 이하 | DOC-004, MOD-016 |
| `check-security` | tauri.conf(CSP, devtools, ACL), workflow 스캔(`pull_request_target`, SHA 고정, permissions, environment) | SEC-001, SEC-003, SEC-007, CI-001~004 |
| `check-licenses` | npm 의존성 라이선스 allowlist | SEC-011 |
| `check-suppressions` | `#[allow(`, `#[ignore]`, `@ts-ignore` 등 억제 구문 탐지. 사유가 적힌 allowlist 항목만 허용하며 allowlist는 보호 파일이다. | GEN-003 |

- `pnpm verify:fast` = lint + typecheck + check-modules. lefthook pre-commit에서 실행한다.
- 검사기 자체 테스트: `tools/checks/__tests__/violations/`에 규칙별 위반 샘플을 두고, 각 검사기가 해당 규칙 ID로 실패하는지 테스트한다. 검사기가 조용히 통과하는 회귀를 막기 위해서다.
- 구현: `tools/scripts/verify.ts`(단계 목록), `tools/checks/`(검사기), `tools/eslint-plugin-deck/`(커스텀 린트와 규칙 ID 포매터). 한 단계가 실패해도 나머지를 모두 실행하고 요약을 출력한다.

## 2. 워크플로 (Phase 7에서 구현)

| 파일 | 트리거 | 내용 |
|---|---|---|
| `ci.yml` | PR, main push | `windows-latest`, `permissions: contents: read`, `pnpm verify`, `tauri build` 스모크 |
| `release.yml` | 태그 `v*` | environment `release`, tauri-action, `TAURI_SIGNING_*` 시크릿, draft release + `latest.json`. Authenticode 서명은 `TODO(human): SignPath` |

`dependabot.yml`은 cargo, npm, github-actions를 갱신한다.

## 3. 규칙

- **CI-001** [MUST NOT] `pull_request_target`를 쓰지 않는다. — 강제: `check-security` workflow 스캔
- **CI-002** [MUST] 모든 action은 전체 커밋 SHA로 고정하고 버전 주석을 단다. — 강제: `check-security`
- **CI-003** [MUST] workflow `permissions`는 최소로 한다(기본 `contents: read`). — 강제: `check-security`
- **CI-004** [MUST] 서명 시크릿은 `release` environment에만 두고 태그 트리거 릴리스 잡에서만 접근한다. — 강제: `check-security`
- **CI-005** [MUST] CI 검증은 로컬 `pnpm verify`와 같은 명령을 쓴다. — 강제: workflow 리뷰
- **CI-006** [MUST] workflow 변경은 CODEOWNERS 리뷰를 필수로 한다. — 강제: CODEOWNERS(Phase 7에서 구현), ruleset(사람 설정)
