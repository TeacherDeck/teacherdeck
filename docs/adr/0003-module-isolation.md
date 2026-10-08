# ADR-0003: 모듈은 다른 origin의 iframe에서 postMessage 브리지로만 호스트 호출

- 상태: 승인됨
- 날짜: 2026-10-08
- 결정자: 신민성, 정영주

## 맥락

모듈은 외부 기여자가 만들 수 있고 앱과 별도로 배포된다. 버그가 있거나 악의적인 모듈이 Tauri IPC로 OS 기능에 직접 닿으면 안 된다. 동시에 모듈은 Fluent UI와 WASM을 쓸 수 있을 만큼 자유로워야 한다.

## 결정

- 모듈은 셸과 다른 origin(`deckmod` 커스텀 프로토콜)의 iframe에서 실행한다.
- 모듈은 `postMessage` 브리지로만 셸에 요청한다. 셸이 요청을 검증해 Rust `host_invoke`로 넘긴다.
- 모듈은 Tauri IPC에 직접 닿을 수 없다.

## 결과

- 브리지 형식: [bridge-protocol.md](../spec/bridge-protocol.md). 서빙: [catalog.md](../spec/catalog.md#3-서빙). 보안 규칙: [security.md](../spec/security.md).
- 셸은 메시지 출처를 iframe 매핑으로 판정한다(BRG-001). Rust는 매 호출 권한을 검사한다(CAP-008).
- iframe에 `allow-same-origin`을 주는 것은 origin이 분리되어 있을 때만 안전하다(SEC-002). Phase 4에서 모듈 origin에서 IPC에 닿을 수 없음을 검증한다(SEC-004).
- 대용량 데이터는 브리지 대신 리소스 URL로 오간다(CAP-003).

## 대안

- **모듈을 셸 문서에 직접 로드**: 빠르지만 모듈이 IPC 전체에 접근한다.
- **모듈마다 별도 Tauri 창(webview)**: 격리는 좋지만 메모리가 늘고 하나의 덱 UI로 통합하기 어렵다.
- **sandbox iframe(`allow-same-origin` 없음)**: 격리는 더 강하지만 opaque origin이라 Worker·WASM 로드와 리소스 서빙이 불편하다.
