# 기여 안내

TeacherDeck에 관심을 가져 주셔서 고마워요. 기여하기 전에 이 문서를 읽어 주세요.

## 시작하기

1. [AGENTS.md](AGENTS.md)에서 프로젝트 구조, 용어, 작업별 필독 문서를 확인해요.
2. 하려는 작업의 규격 문서([docs/spec](docs/spec/README.md))를 읽어요.
3. 큰 변경(새 캡, 포맷 변경, 보안 설정 변경)은 코드를 쓰기 전에 이슈로 먼저 제안해 주세요([정지 조건](docs/spec/process.md#2-정지-조건과-제안서)).

## 새 도구(모듈) 추가

[modules/AGENTS.md의 모듈 추가 절차](modules/AGENTS.md#모듈-추가-절차)를 따라 주세요. 모듈은 반드시 `pnpm new:module <id>`로 만들어요.

## 커밋 규칙

### Conventional Commits

```
<type>(<scope>): <summary>

feat(timer): add presentation mode shortcut
fix(sdk): reject requests sent before init
docs(spec): clarify resolver tie-break rule
```

- type: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`
- 커밋 메시지와 코드 식별자는 영어, 문서와 UI 문구는 한국어로 써요(GEN-010).
- 커밋 하나에는 관심사 하나만 담아요(GEN-009).

### DCO (Developer Certificate of Origin)

모든 커밋에 `Signed-off-by`가 있어야 해요. `git commit -s`로 커밋하면 자동으로 붙어요.

```
Signed-off-by: 홍길동 <gildong@example.com>
```

서명은 [DCO 1.1](https://developercertificate.org/)에 동의한다는 뜻이에요. 기여한 코드를 이 프로젝트의 라이선스(GPL-3.0-only + 추가조항)로 제출할 권리가 있다는 확인이에요.

## 개인정보 금지 (PRV-004)

테스트, 문서, 스크린샷, 예제, 이슈에 **실존 인물의 이름, 학교명, 연락처, 실제 학생 파일**을 쓰지 마세요. `fixtures/synthetic/`의 합성 데이터나 `홍길동`, `010-0000-0000` 같은 명백한 가상값만 써요.

## 완료 기준

PR을 열기 전에 다음을 확인해 주세요.

- `pnpm verify`가 통과해요.
- 새 동작에 테스트가 있어요.
- 동작이 바뀌었다면 관련 문서를 같은 PR에서 갱신했어요.

전체 체크리스트: [Definition of Done](docs/spec/process.md#4-definition-of-done)

## AI 에이전트를 쓰는 경우

이 프로젝트는 AI 에이전트와 함께 코드를 쓰는 것을 전제로 설계했어요.

- 에이전트가 [AGENTS.md](AGENTS.md)와 하위 디렉터리의 `AGENTS.md`를 읽고 따르게 해 주세요. Claude Code는 `CLAUDE.md`를 통해 자동으로 읽어요.
- 규칙 ID(예: `MOD-005`)로 표시된 규칙을 어긴 PR은 머지할 수 없어요. 검사기가 `[규칙ID]` 형식으로 위반을 알려 줘요.
- 검사를 통과하려고 검사기·스펙을 고치거나 억제 주석을 넣지 마세요(GEN-001, GEN-003).
- PR 작성자는 에이전트가 만든 코드도 직접 이해하고 책임져요. DCO 서명은 사람이 해요.
