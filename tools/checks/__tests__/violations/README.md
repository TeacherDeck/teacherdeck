# 위반 샘플

검사기 자체 테스트의 입력이에요([ci.md](../../../../docs/spec/ci.md#1-pnpm-verify)). 일부러 규칙을 어긴 파일이므로 레포 전체 검사(lint, typecheck, test, check-*)에서는 제외돼요.

- `<규칙ID>/<샘플>`: 해당 규칙 ID로만 실패해야 해요. 디렉터리는 작은 레포 루트, 파일은 단일 샘플이에요.
  - `.ts`/`.tsx`: `modules/sample/src/` 아래 파일로 간주해 ESLint로 검사해요.
  - `.txt`: 커밋 메시지예요.
- `_valid/`: 오탐이 없는지 확인하는 정상 샘플이에요.
- `_runtime/`: 스키마는 통과하지만 호스트(Rust) 검증에서 실패하는 매니페스트예요. `lib.test.ts`가 써요.
- 새 샘플을 추가하면 `violations.test.ts`가 자동으로 찾아 검사해요. 새 규칙 ID 디렉터리는 `CHECKER_FOR`에 검사기를 연결해야 해요.
