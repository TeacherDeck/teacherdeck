# packages/sdk — `@deck/sdk` 지침

`@deck/sdk`는 모듈이 호스트를 호출하는 유일한 통로인 브리지 클라이언트다. 프레임워크와 무관해야 한다. 루트 [AGENTS.md](../../AGENTS.md) 규칙을 모두 따르며 아래 규칙을 추가한다.

## 규칙

| ID | 요약 | 정의 |
|---|---|---|
| 추가 | React 등 UI 프레임워크와 `@tauri-apps/*`에 의존하지 않는다. | 이 문서 |
| 추가 | 캡 인자·결과·`ErrorCode` 타입은 `src/generated/`의 생성 타입만 쓴다. 같은 타입을 손으로 정의하지 않는다(GEN-006). | 이 문서 |
| 추가 | 공개 API는 하위호환을 유지한다. 깨지는 변경은 SDK major bump와 ADR이 필요하다. | 이 문서 |
| BRG-002 | `window.parent`에서 온 셸 origin 메시지만 처리한다. | [bridge-protocol.md](../../docs/spec/bridge-protocol.md#5-규칙) |
| BRG-003 | 로드 후 10초 안에 `hello`를 보낸다. `init` 전에는 `req`를 보내지 않는다. | 같은 문서 |
| BRG-004 | `req.id`는 UUID이고, 모든 `req`는 정확히 하나의 `res`를 받는다. 기본 타임아웃은 30초다. | 같은 문서 |
| BRG-005 | job 패턴(progress·cancel) 형식을 지킨다. | 같은 문서 |
| BRG-007 | 1MB 초과 메시지는 보내기 전에 `INVALID_ARGS`로 거절한다. | 같은 문서 |
| MOD-006 | 미선언 캡 호출은 즉시 `PERMISSION_DENIED`로 거절한다. | [modules.md](../../docs/spec/modules.md#4-규칙) |
| MOD-007 | `deck.has()` 확인 없이 optional 캡을 부르면 경고 로그를 남긴다. | 같은 문서 |
| VER-006 | 지원 브리지 프로토콜 버전과 SDK semver를 노출한다. | [versioning.md](../../docs/spec/versioning.md#4-규칙) |

## 사용법

```ts
import { connect } from "@deck/sdk";
const deck = await connect();            // hello → init (BRG-003)
await deck.storage.set("key", value);    // 선언한 캡만 호출 가능 (MOD-006)
if (deck.has("fs")) await deck.fs.pickFiles(); // optional 캡 (MOD-007)
```

모듈 테스트는 `@deck/sdk/testing`의 `createMockHost`를 쓴다. 프로토콜 정의는 `src/protocol.ts`, 생성 타입은 `src/generated/`(손으로 고치지 않는다)에 있다.

## 작업 체크리스트

- [ ] mock host 계약 테스트가 BRG-001~009를 커버한다
- [ ] 생성 타입이 바뀌었다면 `pnpm gen` 결과를 커밋했다
- [ ] 공개 API 변경을 SDK CHANGELOG에 적었다
- [ ] `pnpm verify` 통과
