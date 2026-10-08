---
name: add-module
description: TeacherDeck에 새 도구(모듈)를 추가하거나 기존 모듈을 고칠 때 사용한다. "새 도구 만들어줘", "모듈 추가", "○○ 기능 도구" 같은 요청에서 발동한다.
---

# 모듈 추가 절차

규칙 본문은 복사하지 않는다(DOC-004). 각 단계의 규칙 ID와 링크를 따라 읽는다.

## 1. 필독

- [modules/AGENTS.md](../../../modules/AGENTS.md) — 모듈 추가 절차와 MOD 규칙 요약
- [docs/spec/modules.md](../../../docs/spec/modules.md), [bridge-protocol.md](../../../docs/spec/bridge-protocol.md), [design-system.md](../../../docs/spec/design-system.md)
- 모범 사례: `modules/timer` (`src/timer.ts` 순수 로직, `src/presets.ts` 호스트 연동, `src/App.tsx` UI)

## 2. 필요한 캡 확인

- [capabilities.md 2절](../../../docs/spec/capabilities.md#2-v1-레지스트리)의 캡만 쓸 수 있다.
- 없는 기능이 필요하면 모듈 안의 JS/WASM으로 해결할 수 있는지 먼저 본다(CAP-001).
- 그래도 호스트 기능이 필요하면 **멈추고 add-capability 스킬로 제안서를 쓴다**(GEN-005).

## 3. 생성

```powershell
pnpm new:module <id> --name "<이름>" --category <classroom|file|image|document|utility>
pnpm install
```

- 디렉터리를 손으로 만들거나 다른 모듈을 복사하지 않는다(MOD-001).
- id 형식은 MOD-002를 따른다.

## 4. 구현

- `module.json`: description(80자 이하), `requires`/`optional`(MOD-004, MOD-006)
- 호스트 호출은 `deck.*`만(MOD-006). optional 캡은 `deck.has()` + `CapabilityGate`(MOD-007)
- 저장은 `deck.storage`만(MOD-009). 외부 네트워크 금지(MOD-008)
- UI는 `@deck/ui` + Fluent, 스타일은 토큰만(MOD-010, UI-002). 일괄 처리 도구는 `ToolLayout`(MOD-011)
- 원본 파일 덮어쓰기·삭제 금지(PRV-006). 로그에 파일명·경로 금지(PRV-003)
- 문구는 UI-007

## 5. 테스트

- 순수 로직: vitest 단위 테스트
- 호스트 연동: `@deck/sdk/testing`의 `createMockHost`(MOD-015)
- 테스트 데이터는 합성 데이터만(PRV-004, `pnpm synthetic`)

## 6. 완료

- [ ] `pnpm verify` 통과(GEN-003). 실패 메시지의 `[규칙ID]`를 따라 spec을 읽고 코드를 고친다. 검사기·스펙을 고치지 않는다(GEN-001)
- [ ] 버전과 `CHANGELOG.md` 갱신(MOD-013)
- [ ] [modules/AGENTS.md 완료 체크리스트](../../../modules/AGENTS.md#완료-체크리스트) 확인
- [ ] 커밋: `git commit -s`, Conventional Commits(GEN-009)
