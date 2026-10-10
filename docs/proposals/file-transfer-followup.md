# 파일 전송 후속 승인 제안

상태: **2026-10-10 두 보완안 사용자 승인·구현 완료**. 승인 답변: “두 보완안 승인”. [개발 현황](../DEVELOPMENT_STATUS.md)에 구현과 검증 결과를 기록했다. 아래는 승인 당시 제안의 기록이다. [기존 공통 기반 제안](module-foundations.md)의 1차 fs 1.1.0 승인은 새 결과 폴더·핸들·청크 읽기·취소·원본 보호를 포함했다. 당시 조건이었던 **POST 본문의 수신 전/중 메모리 제한**이 현재 플랫폼 API에서 충족되지 않아 아래 대체 계약을 별도로 승인받았다.

## 플랫폼 확인 결과

`Cargo.lock`의 Tauri 2.12.1, Wry 0.57.0을 기준으로 로컬 의존성 소스를 확인했다.

- Wry `src/webview2/mod.rs:1054`는 앱 핸들러 전에 `prepare_request`를 호출한다. `:1144–1163`은 WebView2 Content IStream을 1,024바이트씩 EOF까지 제한 없이 Vec에 누적한다. `:1173`에서 `Request<Vec<u8>>`를 만들고 `:1094`에서 앱 핸들러에 전달한다.
- Tauri `src/app.rs:2270,2337`의 동기/비동기 사용자 프로토콜 API 모두 `Request<Vec<u8>>`를 받는다. async responder로 바꿔도 요청 본문의 선행 전체 할당은 그대로다.
- 따라서 우리 `protocol.rs`에서 본문 256KiB를 검사하거나 POST를 거부해도 **이미 할당된 후**다. Content-Length 검사 역시 사용자 핸들러에 도달한 뒤이므로 수신 중 상한이 아니다. 기존 GET 전용 프로토콜도 악의적인 body를 할당 전에 거부하는 전역 방어를 갖췄다는 뜻은 아니다.

## 제안: 쓰기에 한정한 인증 브리지 청크 예외

- 정지 조건: 승인된 공개 fs 계약의 수정과 CAP-003 규격 변경(DOC-002). 새 캡·브리지 envelope 포맷 변경은 없다.
- 배경: 사용자 프로토콜 POST는 명시한 메모리 조건을 충족하지 못한다. 파일 쓰기를 위해 Wry 포크·Win32 COM 가로채기·새 런타임 의존성을 먼저 도입하는 것은 범위가 크다.
- 제안: `/_uploads` POST와 `FileWrite.uploadUrl`을 제외하고 fs 1.1.0에 `writeChunk`를 추가한다. 읽기는 기존 제안의 제한된 리소스 GET을 유지한다. 파일 전체 base64/배열을 한 번에 전송하지 않는다. **출력 파일의 순차 쓰기만** CAP-003의 제한된 브리지 청크 예외로 명시한다.
- 검토한 대안: POST 수신 후 검사로 한도 달성을 주장하는 안은 제외한다. Wry 수정 또는 native IStream 제한은 추가 보안·의존성·unsafe 검토가 필요한 후속 대안이다. 현재 SDK/셸/Rust 브리지를 쓰는 청크는 새 의존성이 없고 이미 사용 중인 프레임 출처 판정과 Rust 권한 검사를 재사용한다.
- 영향: fs 1.1.0, SDK 0.2.0의 미출시 초안을 수정한다. deck=1과 BRG-007의 1MiB 상한, 매니페스트·카탈로그 형식은 유지한다. 원본 삭제/덮어쓰기 권한과 임의 경로는 추가하지 않는다.
- 필요한 승인: 프로젝트 소유자가 **64KiB 순차 쓰기 청크의 브리지 전송 예외**, 아래 writeChunk 계약, POST 제거를 승인한다. 아래 origin 분리는 별개의 보안 승인 단위다.

```ts
type FileWrite = { writeId: string; chunkBytes: 65536 };
type WriteChunkArgs = { writeId: string; offset: number; data: number[] };
type WriteChunkResult = { nextOffset: number };
// beginWrite/commitWrite/abortWrite는 기존 제안 유지
// fs.writeChunk(args): Promise<WriteChunkResult>
```

### 한도와 상태 계약

SDK는 Blob.slice로 최대 65,536바이트만 읽고 바이트 배열을 만들어 **이전 응답 이후** 다음 청크를 호출한다. u8 JSON 배열의 최악 길이는 `4×65536+1 = 262145`바이트다(모든 원소 255, 쉼표 포함). writeId는 최대 128 ASCII 문자, offset은 512MiB 이하 정수로 제한하므로 전체 args도 약 263KiB 이내다. envelope까지 별도로 검사하되 1MiB 제한은 올리지 않는다. Rust는 배열 길이·각 값의 정수/u8 범위·offset·소유자·활성 캡/버전을 검증하고 최대 64KiB 버퍼만 변환한다. 결과는 nextOffset뿐이며 사용자 파일 내용/이름/경로를 로그에 남기지 않는다.

write 상태 잠금 아래 expectedOffset과 직전 청크(offset·바이트)를 유지한다. expectedOffset의 새 청크만 append한다. 응답 손실로 직전 청크를 재전송하면 바이트 동일성을 확인해 기존 nextOffset을 반환한다. 다른 offset·다른 바이트·예상 총크기 초과는 INVALID_ARGS다. 동시 writeChunk는 순서가 보장되지 않으면 거부하고 메모리에 대기 청크를 쌓지 않는다. SDK 재시도는 직전 청크 하나에 한정한다.

abortWrite는 호스트 상태를 실제로 취소한다. 기존 SDK cancel이 응답을 버리는 것만으로 디스크 작업이 멈췄다고 간주하지 않는다. writeChunk 완료 전 abort가 잠금을 얻으면 청크를 쓰지 않고, 쓰기가 먼저 완료되면 다음 청크 전에 취소한다. commit과 abort는 같은 상태 잠금에서 단일 결과로 확정한다. 게시가 끝난 파일은 취소 때문에 삭제하지 않는다.

앱 전용 temp에서 쓰고 승인된 새 결과 폴더에만 게시한다. 볼륨이 다르면 호스트가 소유한 게시 준비물로 제한된 복사 후 같은 볼륨에서 덮어쓰기 없는 원자적 게시를 한다. 소유한 작업 파일과 새 결과 폴더 경계를 매번 확인하고 심볼릭 링크/reparse point 교체를 거부한다. 사용자 추가·수정 파일, 원본, 완료 결과는 잔여 정리 대상으로 삼지 않는다. PRV-005의 좁은 게시 준비물 예외는 기존 1차 승인 범위를 따른다.

이 계약은 정상 SDK 사용의 청크·대기열 메모리를 제한한다. 기존 `host_invoke`는 JSON을 역직렬화한 뒤 크기를 검사하며 기존 Wry도 body를 먼저 누적한다. **악성 모듈이 보내는 모든 IPC/HTTP 요청의 전역 메모리 절대 상한을 보장하지 않는다.** 이 더 큰 목표는 플랫폼 수준 제한을 별도 검토해야 한다.

승인 후 변경 파일: 새 ADR, `docs/spec/capabilities.md`의 CAP-003 제한 예외와 파일 쓰기 계약, SDK/모듈 문서, `crates/deck-core/src/caps/fs.rs` 및 레지스트리, 생성기 타입 export, 호스트 fs/출력 서비스, SDK client/index, 청크/순서/취소/크기/권한 테스트. `pnpm gen`으로 생성물을 갱신한다. `protocol.rs`에는 업로드 POST를 구현하지 않는다.

## 제안: 모듈별 독립 origin 보안 계약

- 정지 조건: 커스텀 프로토콜·CSP 보안 설정 및 브리지 규격의 출처 판정 변경(GEN-005).
- 배경: 현재 `origins.rs`는 모든 모듈을 `http://deckmod.localhost`에서 제공하고 `ModuleHost.tsx`는 `allow-scripts allow-same-origin`과 여러 keepAlive iframe을 사용한다. root가 같은 구조의 합성 브라우저 시험에서 sibling DOM 읽기를 재현했다: 다른 origin의 parent 아래 같은 origin 두 child에 실제와 같은 sandbox를 적용하고, child A가 `window.parent.frames[1].document`의 합성 marker를 읽었다(`target/parallel-qa/isolation/`). 이는 **동등한 브라우저 구조의 재현**이며 실제 Tauri 앱의 토큰 탈취 공격을 실행한 결과는 아니다. 토큰에 소유자를 기록하는 것만으로 sibling 접근을 차단한다고 보장할 수 없다.
- 제안: 모듈별 origin을 예약된 하위 호스트 `http://deckmod.<id>.modules.localhost`로 분리한다. 예: `http://deckmod.meeting-note.modules.localhost/meeting-note/0.1.0/index.html`. 논리 URI는 `deckmod://<id>.modules.localhost/<id>/<version>/<path>`다. 기존 경로 구조를 유지해 host id와 path id를 모두 검증하고 일치하지 않으면 거부한다. id는 기존 모듈 식별자 검증과 DNS label 허용 범위의 교집합을 사용한다. 기존 id 규칙은 3–32자의 소문자/숫자/하이픈이며 label에 적합하다.
- 검토한 대안: opaque sandbox origin은 메시지 origin이 `null`이 되어 인증 계약을 더 크게 바꾼다. 별도 scheme을 모듈마다 등록하면 동적 등록/유지 부담이 있다. `http://<id>.deckmod.localhost`는 현재 Wry `deckmod.` prefix 처리에 맞지 않는다.
- 영향: Wry `src/custom_protocol_workaround.rs:12–18,23–34`는 `deckmod://`를 `http://deckmod.`로 치환하고 `src/webview2/mod.rs:1007–1010`은 `http://deckmod.*` 필터를 등록한다. 따라서 `deckmod://meeting-note.modules.localhost/meeting-note/0.1.0/index.html` ↔ `http://deckmod.meeting-note.modules.localhost/meeting-note/0.1.0/index.html`로 왕복하며 기존 `deckmod` scheme 등록 하나로 처리된다. 제안 URL은 기존 scheme 처리에 맞는 후보이며 Windows 실제 로딩/자산/fetch/worker 테스트가 최종 조건이다. 웹 번들 포맷과 deck=1은 유지하되 origin 계약은 새 보안 승인 사항이다.
- 필요한 승인: 프로젝트 소유자가 이 정확한 origin 생성·host/path 검증·셸 CSP·프레임별 브리지 매핑 변경을 별도로 승인한다. Tauri ACL/fs 플러그인/네트워크 권한 확대는 포함하지 않는다.

### 최소 변경과 토큰 권한

- `origins.rs`: `module_origin(id)`/module_url 생성. `protocol.rs`, `lib.rs`: 복원된 논리 URI authority가 **정확히** `<valid-id>.modules.localhost`인지 검사한다. userinfo·port·추가 label·후행 점·알 수 없는 id는 거부하고, 설치된 실행 가능 모듈/서빙 버전 및 path id와 대조한다. 예약 리소스도 해당 module origin 아래에서만 제공한다. Wry의 광범위 prefix 필터 자체를 권한 검사로 믿지 않는다.
- `tauri.conf.json`: 셸 frame-src와 모듈 아이콘 img-src에 유효한 선두 wildcard source `http://*.modules.localhost`를 사용한다. 새 모듈마다 CSP 변경/승인 없이 동일한 예약 호스트 계약 안에서 실행할 수 있다. 이 source는 `http://tauri.localhost`, `http://ipc.localhost`, 일반 `http://*.localhost`를 포함하지 않는다. 다만 CSP는 `deckmod.<id>`의 label 구조까지 검사하지 않으므로 **호스트의 정확한 authority·installed/path 검사와 프레임별 정확한 origin 검사**를 함께 적용한다. bare `deckmod.localhost`는 기존 debug probe처럼 별도로 필요한 대상에만 남긴다. 모듈 CSP의 connect-src/script-src/img-src `'self'`는 해당 독립 origin을 따르며 외부 통신 허용을 늘리지 않는다.
- `ModuleBridge.ts`, `ModuleHost.tsx`, `App.tsx`: 프레임 등록 시 검증된 entry URL의 정확한 origin을 저장하고 수신 event.source **및 해당 origin**을 함께 검사한다. 응답 targetOrigin도 프레임별 origin이다. 임의 suffix만 보고 모듈 id를 인증하지 않는다.
- SDK `protocol.ts`/공개 origin 상수와 테스트는 고정 단일 origin을 제거하거나 하위호환 폐기 정책을 명시한다. 현재 SDK client의 응답 검사는 **셸 origin과 parent source**이므로 이를 넓히지 않는다. `ShellInfo.moduleOrigin`은 bare 호스트/probe용 의미를 유지하거나 새 optional origin pattern 필드를 추가하되 Rust 원천·생성기로 갱신한다. 설치 모듈의 실제 실행 origin은 host가 생성한 entryUrl이 기준이다.
- SEC-004 probe/보안 검사기/문서/테스트의 단일 origin 전제도 수정한다. 기존 모듈 CSP·권한을 완화해 통과시키지 않는다. 이 작업은 security ADR/spec 이후 코드·생성·버전/CHANGELOG 순서다.

읽기 토큰은 OS 난수 128비트 이상, 모듈 id·앱 세션·프레임 세대·원본 열린 파일·read-only·만료에 묶는다. 토큰은 인증된 openRead에서만 발급하고 URL에 파일명/경로를 넣지 않는다. GET offset/length 최대 256KiB, HEAD 본문 없음; 토큰 소유 origin/host·활성 선언 fs/version·프레임 세대·5분 미사용 만료를 매 요청 재검사한다. closeRead/언로드/제거/세션 종료에 즉시 무효화한다. 숨김 keepAlive는 유효 세대 유지, LRU 언로드는 폐기한다. 응답은 no-store/no-referrer/nosniff, URL·토큰을 로그에 남기지 않는다. 전체 파일을 Vec로 읽지 않는다.

## 승인 단위와 완료 증거

1. 기존 승인된 읽기/출력 상태 서비스를 계속 구체화한다. POST 수신 상한이 검증됐다고 보고하지 않는다.
2. 브리지 쓰기 예외를 승인받은 뒤 64KiB 경계·최악 JSON 크기·권한/offset/중복·디스크 부족·취소 경쟁·다른 볼륨·원본 해시 불변을 검증한다.
3. 독립 origin은 합성 브라우저 재현 결과와 함께 별도 승인한다. 서로 다른 모듈 DOM 접근 거부, 타 모듈 토큰 URL 거부, 위조 source/origin 거부, 정상 모듈 SDK와 SEC-004를 Windows에서 확인한다.
4. 각 구현 완료는 `pnpm verify`와 실제 입력→새 결과 저장/다시 열기 증거로 판단한다. 문서 초안만으로 실행·호환·보안 검증 완료를 선언하지 않는다.
