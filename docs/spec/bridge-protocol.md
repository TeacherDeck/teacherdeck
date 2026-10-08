# 브리지 프로토콜 (bridge-protocol)

모듈 iframe과 셸이 `postMessage`로 주고받는 메시지 형식을 정의한다. 모듈은 이 브리지로만 호스트를 호출하며 Tauri IPC에 직접 닿을 수 없다([ADR-0003](../adr/0003-module-isolation.md)).

```
모듈 iframe ──postMessage──▶ 셸(React) ──Tauri IPC: host_invoke(module_id, cap, method, args)──▶ 호스트(Rust)
   (@deck/sdk)   ◀──────────────          ◀────────────────────────────────────────────────
```

## 1. 메시지 형식 (v1)

```ts
type Envelope = { deck: 1 } & (
  | { kind: "hello"; sdk: string }                                   // module → shell
  | { kind: "init"; module: { id: string; version: string };         // shell → module
      host: { app: string; caps: Record<string, string> };            // cap → 제공 버전
      granted: string[];                                              // 이 모듈이 호출 가능한 캡
      theme: ThemePayload }
  | { kind: "req"; id: string; cap: string; method: string; args: unknown }
  | { kind: "res"; id: string; ok: true; result: unknown }
  | { kind: "res"; id: string; ok: false; error: DeckError }
  | { kind: "cancel"; id: string }
  | { kind: "evt"; topic: string; payload: unknown }
);
type DeckError = { code: ErrorCode; message: string; details?: unknown };
type ErrorCode =
  | "PERMISSION_DENIED" | "CAPABILITY_UNAVAILABLE" | "VERSION_MISMATCH"
  | "INVALID_ARGS" | "NOT_FOUND" | "CANCELLED" | "TIMEOUT" | "BUSY" | "INTERNAL";
type ThemePayload = { mode: "light" | "dark"; mica: boolean; tokens: Record<string, string> };
```

- `ErrorCode`와 캡 인자·결과 타입의 원천은 Rust다. TS 타입은 `pnpm gen`이 `packages/sdk/src/generated/`에 생성한다(`ErrorCode`·`DeckError`는 deck-core `error.rs`, 캡 인자·결과 타입은 deck-core `caps/`가 원천이다). 위 블록은 설명용이며, 생성물과 다르면 이 문서를 고치는 것이 아니라 DOC-002 절차를 밟는다.
- `granted`는 매니페스트의 `requires`·`optional` 중 호스트가 실제로 만족시키는 캡 목록이다.
- 셸은 모듈 요청을 검증한 뒤 Rust 커맨드 `host_invoke(module_id, cap, method, args)`로 넘긴다. `module_id`는 iframe 매핑으로 셸이 정한다(BRG-001).

### 오류 코드

| 코드 | 의미 |
|---|---|
| `PERMISSION_DENIED` | 모듈이 선언하지 않았거나 허가받지 않은 캡·핸들을 사용했다. |
| `CAPABILITY_UNAVAILABLE` | 호스트에 없는 캡·메서드다. |
| `VERSION_MISMATCH` | 캡 버전이 선언 범위를 만족하지 않는다. |
| `INVALID_ARGS` | 인자 형식이 잘못됐거나 메시지가 크기 제한을 넘었다. |
| `NOT_FOUND` | 대상(핸들, 키 등)이 없다. |
| `CANCELLED` | `cancel`로 취소됐다. |
| `TIMEOUT` | 시간 안에 응답하지 않았다. |
| `BUSY` | 동시에 처리할 수 없는 상태다. |
| `INTERNAL` | 호스트 내부 오류다. |

`message`에는 경로·파일명·사용자 데이터를 넣지 않는다(CAP-007, PRV-003).

## 2. 핸드셰이크

```
module                     shell
  │── hello {sdk} ──────────▶│   로드 후 10초 이내
  │◀───────── init {...} ────│
  │── req ... ──────────────▶│   init 수신 후에만
```

시간 안에 `hello`가 오지 않으면 셸은 해당 모듈에 로드 오류 화면을 띄운다.

## 3. 요청·응답과 장시간 작업

- `req.id`는 모듈 세션 내 고유 UUID다. 모든 `req`는 정확히 하나의 `res`를 받는다.
- SDK 기본 타임아웃은 30초다. 시간을 넘기면 SDK는 `TIMEOUT` 오류로 완료한다. 레지스트리에서 `long`으로 표시된 메서드는 예외다.
- 장시간 작업(job) 패턴은 다음과 같다. v1에서는 형식만 예약한다.
  - 진행률: `evt` topic `job.progress`, payload `{ id, done, total }`
  - 취소: `{ kind: "cancel", id }` → 원래 `req`가 `CANCELLED`로 완료된다.
  - 결과: 원래 `req`의 `res`로 받는다. job id는 req id와 같다.

## 4. 이벤트 (v1)

| topic | 방향 | payload | 수신 대상 |
|---|---|---|---|
| `theme.changed` | shell → module | `ThemePayload` | 모든 로드된 모듈 |
| `fs.dropped` | shell → module | 드롭된 파일의 `FileHandleInfo[]` | `fs` 캡이 있는 활성 모듈 |
| `module.visibility` | shell → module | `{ visible: boolean }` | keepAlive 모듈 |
| `job.progress` | shell → module | `{ id, done, total }` | 해당 job을 요청한 모듈 |

`fs.dropped` payload(`DroppedFiles`)는 Rust 원천에서 생성한다. `module.visibility`는 `{ visible: boolean }`이다.

## 5. 규칙

- **BRG-001** [MUST] 셸은 `event.source`가 알려진 모듈 iframe의 contentWindow이고 `event.origin`이 모듈 origin인 메시지만 처리한다. 모듈 id는 iframe 매핑으로 판정하며, 메시지 내용의 자기 신고를 믿지 않는다. — 강제: 셸 단위 테스트(`apps/desktop/src/bridge/ModuleBridge.test.ts`)
- **BRG-002** [MUST] 모듈(SDK)은 `window.parent`에서 온, 셸 origin의 메시지만 처리한다. — 강제: SDK 테스트(`packages/sdk/src/client.test.ts`)
- **BRG-003** [MUST] 모듈은 로드 후 10초 안에 `hello`를 보낸다. 셸은 `init`으로 응답한다. `init` 수신 전에는 `req`를 보내지 않는다. 시간 초과 시 셸은 로드 오류 화면을 띄운다. — 강제: SDK 구현, 셸 테스트
- **BRG-004** [MUST] `req.id`는 모듈 세션 내 고유한 UUID다. 모든 `req`는 정확히 하나의 `res`를 받는다. 기본 타임아웃은 30초(SDK 측, `TIMEOUT`)이며, 레지스트리에서 `long`으로 표시된 메서드는 예외다. — 강제: SDK 테스트(`packages/sdk/src/client.test.ts`)
- **BRG-005** [MUST] 장시간 작업(job) 패턴: 진행률은 `evt job.progress {id, done, total}`로, 취소는 `{kind:"cancel", id}`로 하고 결과는 원래 `res`로 받는다. job id는 req id와 같다. v1에서는 형식만 예약한다. — 강제: 스펙(이 문서)
- **BRG-006** [MUST] 알 수 없는 kind나 잘못된 형식의 메시지는 무시하고 내용 없이 debug 로그만 남긴다. 알 수 없는 캡·메서드에는 `CAPABILITY_UNAVAILABLE`을 반환한다. — 강제: SDK·셸 테스트
- **BRG-007** [MUST] 메시지는 JSON 직렬화 가능해야 하며 1MB를 넘지 않는다. 초과 시 `INVALID_ARGS`를 반환한다. — 강제: SDK·셸 검사와 테스트
- **BRG-008** [MUST] 프로토콜 버전은 정수 필드 `deck`이다. 깨지는 변경 시 증가시키고, 셸은 N과 N-1을 지원한다. — 강제: [manual]
- **BRG-009** [MUST] v1 이벤트는 `theme.changed`, `fs.dropped`(fs 캡이 있는 활성 모듈에만), `module.visibility`, `job.progress`다. 새 이벤트 추가는 스펙 변경이다. — 강제: TS 유니온 타입(`EVENT_TOPICS`, `EventPayloads`)
