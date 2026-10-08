# apps/desktop — 셸 지침

셸은 호스트 메인 창의 React 프론트엔드다. 모듈 iframe을 띄우고, 브리지 메시지를 검증해 Rust `host_invoke`로 넘긴다. 루트 [AGENTS.md](../../AGENTS.md) 규칙을 모두 따르며, 여기서는 추가 규칙만 적는다.

호스트(Rust) 작업은 [src-tauri/AGENTS.md](src-tauri/AGENTS.md)를 본다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| 추가 | `@tauri-apps/api`는 셸(`apps/desktop/src`)에서만 쓴다. 모듈·패키지에서는 금지한다(MOD-005). | [modules.md](../../docs/spec/modules.md#4-규칙) |
| BRG-001 | 알려진 모듈 iframe의 contentWindow와 모듈 origin에서 온 메시지만 처리하고, 모듈 id는 iframe 매핑으로 판정한다. | [bridge-protocol.md](../../docs/spec/bridge-protocol.md#5-규칙) |
| BRG-003 | `hello` 10초 타임아웃 시 로드 오류 화면을 띄운다. | 같은 문서 |
| BRG-006 | 알 수 없거나 잘못된 메시지는 무시하고 내용 없이 debug 로그만 남긴다. | 같은 문서 |
| BRG-007 | 1MB 초과 메시지는 `INVALID_ARGS`로 거절한다. | 같은 문서 |
| BRG-009 | `fs.dropped`는 fs 캡이 있는 활성 모듈에만 보낸다. | 같은 문서 |
| CAP-008 | 셸의 권한 검사는 보조일 뿐이다. 최종 검사는 Rust가 한다. | [capabilities.md](../../docs/spec/capabilities.md#6-규칙) |
| SEC-002 | 셸 문서에 모듈 스크립트를 주입하지 않는다. 모듈은 모듈 origin iframe으로만 띄운다. | [security.md](../../docs/spec/security.md#3-규칙) |
| UI-001~008 | 셸 UI도 디자인 규칙을 모두 따른다. | [design-system.md](../../docs/spec/design-system.md#8-규칙) |
| GEN-007 | About/크레딧 화면의 저자 표기를 지우거나 약화하지 않는다. | [process.md](../../docs/spec/process.md#5-규칙) |

## keepAlive 관리

- `ui.keepAlive: true` 모듈은 화면을 전환해도 iframe을 숨긴 채 유지한다. 최대 3개이며 LRU로 내린다.
- 숨기거나 보일 때 `module.visibility` 이벤트를 보낸다.
- 모듈이 숨겨지거나 내려가면 호스트가 창 상태(항상 위, 전체화면)를 되돌린다.
- 상세: [modules.md 생명주기](../../docs/spec/modules.md#3-생명주기)

## 작업 체크리스트

- [ ] 브리지 처리 코드를 바꿨다면 BRG-001·006·007 셸 단위 테스트를 갱신했다
- [ ] 새 화면 문구가 UI-007을 따른다
- [ ] 테마 전환이 열린 모듈 iframe에 즉시 반영된다
- [ ] dev 전용 화면(UI 갤러리)이 릴리스 빌드에 포함되지 않는다
- [ ] `pnpm verify` 통과
