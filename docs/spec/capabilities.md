# 호스트 캡 (capabilities)

캡(capability)은 호스트가 모듈에 제공하는, 버전이 붙은 범용 기능 묶음이다. 네이티브 코드는 호스트에만 있고 캡을 통해서만 모듈에 노출된다([ADR-0002](../adr/0002-module-architecture.md)).

## 1. 설계 원칙

1. **범용 프리미티브.** 특정 도구 전용 메서드를 만들지 않는다(CAP-001). 예를 들어 "출석부 PDF 만들기"가 아니라 "파일 선택"과 "결과 저장"을 제공한다.
2. **먼저 대안을 검토한다.** 새 캡을 만들기 전에 기존 캡 조합이나 모듈 측 WASM/JS로 해결할 수 없는지 확인한다.
3. **경로 대신 핸들.** 모듈은 파일 경로를 보지 않는다. 호스트가 발급한 불투명 핸들만 다룬다(CAP-002).
4. **대용량 읽기는 브리지 밖으로.** 1MB를 넘는 바이너리 읽기는 `deckmod` 리소스 URL을 쓴다. fs 1.1 출력만 64KiB 이하 순차 청크를 인증 브리지로 보낸다(CAP-003, [ADR-0014](../adr/0014-bounded-file-transfers.md)).
5. **매 호출 권한 검사.** 설치·활성 여부, 선언 캡, 버전을 Rust에서 매번 확인한다(CAP-008).
6. **오류에 개인정보 없음.** `ErrorCode`와 일반 메시지만 반환한다(CAP-007, PRV-003).

## 2. v1 레지스트리

> 아래 표는 deck-core `caps::REGISTRY`(원천, VER-002)에서 `pnpm gen`이 만든다(CAP-010). 인자·결과 타입은 `packages/sdk/src/generated/`, 기계용 레지스트리는 `schema/capabilities.json`이다. `(long)` 메서드는 SDK 기본 타임아웃(30초)이 적용되지 않는다(BRG-004).

<!-- cap-registry:start -->
<!-- 생성물: `pnpm gen`(deck-core caps::REGISTRY). 손으로 고치지 마세요(GEN-006). -->
| 캡 | 버전 | 메서드 | 설명 |
|---|---|---|---|
| `global-shortcut` | 1.0.0 | `status` | 등록 단축키 조회 |
|  |  | `register` | register |
|  |  | `replace` | replace |
|  |  | `unregister` | unregister |
| `overlay` | 1.0.0 | `status` | 영역 창 현재 상태 |
|  |  | `create` | create |
|  |  | `update` | update |
|  |  | `show` | show |
|  |  | `hide` | hide |
|  |  | `close` | close |
| `capture` | 1.0.0 | `displays` | displays |
|  |  | `capture` (long) | capture |
|  |  | `arm` | arm |
|  |  | `status` | status |
|  |  | `update` | update |
|  |  | `trigger` (long) | 시작한 세션에 한 장 저장 |
|  |  | `resetSequence` | resetSequence |
|  |  | `stop` | stop |
| `clipboard` | 1.0.0 | `writeText` | 일반 텍스트 복사(256KiB 이하) |
|  |  | `writeRichText` | 구조화 서식과 일반 텍스트 복사(256KiB 이하) |
| `system` | 1.0.0 | `info` | 앱 버전, OS 이름·버전·빌드, 로캘 |
| `storage` | 1.0.0 | `get` | 키의 값, 없으면 null |
|  |  | `set` | 키에 값 저장(256KB 이하) |
|  |  | `delete` | 키 삭제 |
|  |  | `keys` | 저장된 키 목록 |
| `fs` | 1.2.0 | `pickDestination` (long) | 명시적으로 기억할 새 파일 저장 폴더 선택 |
|  |  | `destinationStatus` | 저장 폴더 권한 상태 |
|  |  | `revealDestination` | 저장 폴더 열기 |
|  |  | `revokeDestination` | 저장 폴더 권한 해제 |
|  |  | `pickFiles` (long) | 파일 선택 대화상자 → FileHandleInfo[] |
|  |  | `pickFolder` (long) | 폴더 선택 대화상자 → FolderHandleInfo \| null |
|  |  | `stat` | 핸들의 최신 정보 |
|  |  | `reveal` | 탐색기에서 파일 위치 열기 |
|  |  | `openRead` (long) | 파일 읽기 리소스 열기(256KiB 청크) |
|  |  | `closeRead` | 파일 읽기 리소스 닫기 |
|  |  | `createOutputFolder` (long) | 새 결과 폴더 만들기 |
|  |  | `beginWrite` (long) | 새 결과 파일 쓰기 시작 |
|  |  | `writeChunk` | 64KiB 이하 순차 청크 쓰기 |
|  |  | `commitWrite` (long) | 완성된 결과를 덮어쓰기 없이 게시 |
|  |  | `abortWrite` | 미완성 파일 쓰기 취소 |
|  |  | `closeOutputFolder` | 결과 폴더 작업 권한 닫기 |
| `window` | 1.0.0 | `setAlwaysOnTop` | 항상 위 켜기·끄기 |
|  |  | `setFullscreen` | 전체화면 켜기·끄기 |
<!-- cap-registry:end -->

### 2.1 `storage`

- key는 `^[A-Za-z0-9._-]{1,128}$`이다.
- 값은 JSON이며 직렬화 후 256KB 이하다. 모듈당 합계는 5MB 이하다.
- 저장 위치는 `app_data/module-data/<id>/storage.json`이며 원자적으로 쓴다(temp 파일 + rename).
- 모듈 데이터는 모듈 id로 격리한다(PRV-007).

### 2.2 `fs`

- `FileHandleInfo = { handle, name, ext, size, modifiedAt }`
- `FolderHandleInfo = { handle, name }`. 경로는 포함하지 않는다.
- `modifiedAt`은 Unix epoch 기준 밀리초다.
- 핸들은 불투명 랜덤 문자열이며 (모듈 id, 앱 세션) 범위에서만 유효하다. 다른 모듈이나 다음 세션에서 쓰면 `PERMISSION_DENIED` 또는 `NOT_FOUND`를 반환한다.
- 경로는 절대 반환하지 않는다. `name`은 사용자가 고른 파일의 표시용 이름이며 로그에 남기지 않는다(PRV-003).
- fs 1.1의 `openRead({handle})`는 `{readId,size,chunkBytes,url}`을 반환하고 `closeRead({readId})`로 닫는다. 선택·드롭 파일은 읽기 전용이고 폴더 핸들로 파일을 읽지 않는다.
- 읽기 URL은 해당 모듈 origin의 `/_resources/<32자리 난수 hex>`다. GET은 `offset`과 `length`의 음수 없는 십진 정수 쿼리를 한 번씩 받아 최대 256KiB를 반환한다. HEAD는 같은 권한·범위 검사 후 본문 없이 반환한다. 파일명·경로 노출과 전체 파일 읽기는 금지한다.
- `createOutputFolder({parentHandle,suggestedName})` → `{batchId,folder}`, `beginWrite({batchId,suggestedName,size})` → `{writeId,chunkBytes}`, `writeChunk({writeId,offset,data})` → `{nextOffset}`, `commitWrite({writeId})` → `FileHandleInfo` 순으로 저장한다. `abortWrite({writeId})`는 미완성 작업만 취소하고 `closeOutputFolder({batchId})`는 작업 권한을 닫는다.
- 쓰기는 64KiB 이하 u8 배열·순차 offset만 허용한다. 직전 동일 청크의 재전송은 같은 nextOffset을 돌려준다. 다른 offset·바이트는 거부한다. commit은 선언한 크기가 완성된 경우만 허용하고 취소와 직렬화한다. 게시 완료 이후 취소는 결과를 삭제하지 않는다. SDK cancel 메시지만으로 디스크 취소를 주장하지 않는다.
- suggestedName은 단일 이름이다. 구분자·상대/절대경로·예약 장치명·끝 점/공백을 거부한다. 충돌은 연번으로 새 이름을 예약하고 기존 사용자 파일을 수정하지 않는다. 파일/폴더/결과 작업/읽기/쓰기 권한 종류는 호스트가 구분한다.
- 파일당 512MiB, 읽기 모듈당 4개, 쓰기 모듈당 1개·앱 전체 2개, 열린 결과 작업 모듈당 4개, 결과 작업당 파일 2,000개·합계 2GiB다. 작업 한도는 beginWrite의 선언 크기를 예약하며 취소해도 예약 횟수·합계는 되돌리지 않는다. 토큰은 모듈·앱 세션·언로드 전 수명에 묶고 5분 미사용 만료를 적용한다. 언로드/세션 종료에는 폐기하고 숨긴 keepAlive 도구는 유지한다. 설치·실행 가능·선언 fs·버전과 소유 origin을 매 호출 다시 검사한다.
- 원본과 부모의 reparse point를 거부하고 열린 핸들을 유지한다. 출력은 TempArea와 호스트 소유 게시 준비물을 거쳐, 준비물의 잠금을 유지한 채 hard link로 덮어쓰기 없이 게시한다. hard link 미지원 파일시스템은 오류로 중단한다([ADR-0014](../adr/0014-bounded-file-transfers.md)).

### 2.3 `window`

- 모듈이 숨겨지거나 언로드되면 호스트가 창 상태를 원래대로 되돌린다.

## 2.4 clipboard 1.0 — 출력 전용

[ADR-0016](../adr/0016-clipboard-output.md), [승인 제안서](../proposals/clipboard-output.md)를 따른다. `writeText({text})`는 UTF-8 일반 텍스트를 기록한다. `writeRichText({plainText,blocks})`는 heading(level 1~3), paragraph, table의 rows/cells와 `{text,bold?}` run을 받아 호스트가 escape된 정적 HTML과 일반 텍스트 대체본을 기록한다. cell은 `{runs,header?}`다. 원시 HTML/CSS/URL/파일 경로, 클립보드 읽기·감시·지우기·이미지는 제공하지 않는다.

입력 text 합산과 생성 HTML+plainText 합산은 각각 256KiB, JSON은 512KiB 이하이다. block/전체 표 행 4096, 행 열 32, 전체 cell 16384, 전체 run 32768, 컨테이너당 run 64 이하로 제한한다. 빈 표·서로 다른 열 수·unknown field·NUL 및 탭/개행 외 제어 문자를 거부한다. CRLF/CR은 LF로 정규화한다. 초과 입력은 자르지 않고 INVALID_ARGS를 반환한다.

Windows에서 단일 OS 작업 스레드와 제한된 대기열을 사용한다. 시스템 clipboard cloud/history 제외는 고정 적용한다. 사용자 복사 동작에서만 호출하며 로그·오류에 텍스트를 남기지 않는다. arboard의 HTML Format 등록 실패는 일반 텍스트만 기록한 성공으로 나타날 수 있으므로 일반 완료 알림은 클립보드 쓰기 완료만 말하고, 한글/Word의 서식 유지는 실제 붙여넣기로 확인한다. 기존 CSP/ACL/브리지 포맷은 바꾸지 않는다.

## 3. 캡 추가·변경 절차

1. **정지한다.** 새 캡과 major 변경은 GEN-005 정지 조건이다. [process.md](process.md#2-정지-조건과-제안서) 형식으로 제안서를 쓴다. 제안서에는 캡 이름, 메서드와 인자·결과 타입, 버전 영향, 보안·개인정보 영향, 기존 캡 조합·WASM 대안 검토 결과를 담는다.
2. 사람 승인 후 DOC-002 절차를 밟는다.
3. Rust에 인자·결과 구조체를 정의하고 ts-rs로 export한다(CAP-006).
4. 레지스트리 상수에 캡과 버전을 등록한다(VER-002).
5. `src-tauri/src/caps/<cap>.rs`에 구현한다. 정상·권한 거부·잘못된 인자 테스트를 쓴다(CAP-009).
6. `pnpm gen`으로 레지스트리 표, `schema/capabilities.json`, SDK 타입을 갱신한다(CAP-010).

버전 규칙은 CAP-004와 [versioning.md](versioning.md)를 따른다.

## 4. 오류 처리

- 모든 오류는 `ErrorCode` enum과 메시지로 반환한다([bridge-protocol.md](bridge-protocol.md#오류-코드)).
- `serde_json::Value`는 `host_invoke` 디스패치 경계에서만 쓰고, 즉시 메서드별 인자 구조체로 역직렬화한다. 역직렬화 실패는 `INVALID_ARGS`다.

## 5. 예정 캡

다음 캡은 이번 부트스트랩 범위 밖이다. CAP-001에 따른 설계 방향만 기록하며, 도입 시 제안서와 ADR이 필요하다.

| 후보           | 방향                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs` 후속 확장 | 1.1의 선택 파일 읽기·새 결과 폴더 저장 이후 요구에 맞춰 검토한다. 기존 파일의 이름 변경·이동·덮어쓰기·삭제는 현재 API 범위에 포함하지 않는다.                                                                        |
| `pdf`          | 병합·분할·페이지 회전은 모듈 측 JS/WASM으로 먼저 해결한다. 호스트 캡은 네이티브 렌더링이 꼭 필요한 경우에만 "핸들 + 페이지 → 렌더 결과 리소스 URL" 형태의 범용 메서드로 둔다.                                        |
| `image`        | 크롭·리사이즈·포맷 변환은 모듈 측 WASM으로 먼저 해결한다. 호스트 캡은 OS 코덱이 필요한 포맷(예: HEIC) 디코딩 같은 범용 변환에 한정한다.                                                                              |
| `ocr`          | Windows 내장 OCR처럼 네이티브에만 있는 기능이다. "이미지 핸들 → 텍스트 블록" 형태의 범용 메서드로 둔다. 네트워크 OCR은 금지한다(PRV-001).                                                                            |
| `office`       | hwp/xls 등 변환은 별도 helper 프로세스(Office/한글 COM)를 쓴다. "핸들 + 대상 포맷 → 결과 핸들" 형태의 범용 변환 메서드로 두고, 원본은 건드리지 않는다(PRV-006).                                                      |
| `roster`       | 여러 모듈이 같은 학생 명단을 쓰는 요구다. 모듈 간 데이터 공유는 PRV-007(모듈별 격리)과 충돌하므로, 사용자가 명시적으로 허용한 경우에만 읽기를 허락하는 방식으로 설계한다. 실존 인명은 테스트에 쓰지 않는다(PRV-004). |

## 6. 규칙

- **CAP-001** [MUST] 캡은 범용 프리미티브로 설계한다. 특정 도구 전용 메서드를 만들지 않는다. 먼저 기존 캡 조합이나 모듈 측 WASM으로 해결할 수 없는지 검토한다. — 강제: [manual] 리뷰, add-capability skill
- **CAP-002** [MUST NOT] 파일 경로를 인자로 받거나 결과로 반환하지 않는다. 핸들만 쓴다. — 강제: 타입 리뷰(deck-core `caps/fs.rs`에 경로 필드 없음), 핸들 테이블 테스트
- **CAP-003** [MUST NOT] 대용량 바이너리(>1MB)를 브리지로 한 번에 보내지 않는다. 읽기는 `deckmod` 리소스 URL을 쓴다. fs 1.1 출력에 한해 최대 64KiB의 순차 쓰기 청크를 인증 브리지로 보낼 수 있다(ADR-0014). — 강제: 브리지 크기 제한 BRG-007, 파일 청크 검사
- **CAP-004** [MUST] 버전 규칙: 메서드·선택 인자·결과 필드 추가는 minor, 그 외는 major다. major 변경 시 이전 major 핸들러를 최소 2회의 앱 minor 릴리스 동안 유지하고 ADR을 쓴다. — 강제: [manual], 레지스트리 diff 리뷰
- **CAP-005** [MUST] 새 캡이나 major 변경은 사람 승인을 받는다(GEN-005). — 강제: 훅(레지스트리 생성물 보호), CODEOWNERS, [manual]
- **CAP-006** [MUST] 모든 메서드 인자·결과는 Rust 구조체로 정의하고 ts-rs로 TS 타입을 export한다. `serde_json::Value`는 디스패치 경계에서만 쓴다. — 강제: `check-gen`
- **CAP-007** [MUST] 에러는 `ErrorCode` enum과 메시지로 반환하며, 메시지에 경로·파일명·사용자 데이터를 넣지 않는다(PRV-003). — 강제: 호스트 브리지 테스트, [manual]
- **CAP-008** [MUST] 모듈 권한 검사(설치·활성 여부, 선언 캡, 버전)는 Rust에서 매 호출마다 수행한다. 셸 검사는 보조일 뿐이다. — 강제: 권한 거부 테스트(`src-tauri/src/bridge.rs`)
- **CAP-009** [MUST] 각 캡은 정상·권한 거부·잘못된 인자 테스트를 갖춘다. — 강제: `every_registry_method_has_a_route` 테스트, [manual] 리뷰(커버리지 보고는 미구현)
- **CAP-010** [MUST] `capabilities.md`의 레지스트리 표와 `schema/capabilities.json`은 Rust 레지스트리에서 생성한다. — 강제: `check-gen`

## 승인된 네이티브 캡처 계약 (ADR-0017)

capture 1.0.0의 displays는 불투명 displayHandle과 물리 bounds/scale/primary를 반환한다. capture({rect,settings})는 한 장을 read-only FileHandleInfo로 반환하며 기존 fs.openRead 인증 스트림으로 읽는다. base64 프레임은 브리지에 싣지 않는다.

arm({overlayHandle,shortcutHandle?,destinationGrant,settings})은 동일 소유자 핸들만 결합하고 CaptureSession을 반환한다. status({sessionHandle?})는 지정 세션 또는 현재 소유자 세션을 반환하며 없으면 null이다. update는 settings/destinationGrant/shortcutHandle을 변경한다. resetSequence와 stop은 sessionHandle을 받는다. CaptureSession은 settings,sequence,busy,lastResult?,lastError?를 제공하며 임의 callback이나 타이머 캡처는 허용하지 않는다. update의 shortcutHandle 생략은 기존 값을 유지한다.

overlay create는 rect/style/alwaysOnTop을 받는다. style은 #RRGGBB 색과 1~12px borderWidth이다. update는 rect/style/alwaysOnTop의 선택 변경, show/hide/close는 overlayHandle을 받는다. region rect 전체가 실제 캡처 영역이며 별도 toolbar 창은 포함하지 않는다. 물리 x/y 음수, right/bottom exclusive를 유지한다.

global-shortcut register는 modifiers(control/shift/alt/meta)와 정규화 key를 받고 ShortcutInfo를 반환한다. replace는 기존 shortcutHandle과 새 조합을 받아 충돌 시 기존 정상 조합을 유지한다. unregister는 핸들을 받는다. 전체 키 입력을 감시하지 않는다.

fs 1.2 pickDestination({remember})은 사용자 선택·권한 확인 뒤 DestinationGrant 또는 null을 반환한다. destinationStatus/revealDestination/revokeDestination은 grantHandle을 받는다. grant는 모듈 소유 append-new-only 권한이고 label,persistent,available만 노출한다. 기억한 권한은 매 실행 directory guard/reparse/가용성을 재검사하며 사용자 파일은 삭제하거나 덮어쓰지 않는다. grant 해제와 세션 정지에 연결 리소스를 정리한다.

물리 rect는 최소5px/최대 축16384/32Mi픽셀로 checked 검증한다. PNG 또는 JPEG 품질1~100, cursor=false만 지원한다. 이름 모드는 numbered/datetime/custom이며 custom 접두어는 80자 이하 단일 파일명이고 Windows 장치명·제어문자·경로 구분자·후행 점/공백을 거부한다. 실패는 연번을 소비하지 않는다. 저장·폴더 확인 등 host 작업은 UI 스레드를 막지 않는다.

사용자 시작한 네이티브 세션은 모듈 iframe 숨김과 독립적이다. 매 native trigger에 소유자 설치·선언 캡·버전·grant·arm 상태를 확인한다. 앱 재시작에는 자동 arm하지 않는다. 기존 authorize는 설치·실행 가능한 모듈(runnable), 선언 캡·버전을 확인하며 keepAlive의 숨겨진 iframe RPC도 가능하다. 이번 변경은 이 권한을 확대하거나 축소하지 않는다. fs 드롭 전달은 현재 활성 모듈에만, 기존 window 캡의 숨김 복원은 그대로 유지한다. 일반 RPC의 활성 여부 강제는 별도 정책 검토 항목이다. [ADR-0017](../adr/0017-native-capture-sessions.md)에 lifecycle과 창 ACL을 규정한다.

capture.trigger({sessionHandle})는 arm한 세션에 사용자 요청 한 장을 저장하고 CaptureResult를 반환한다. overlay.status({overlayHandle})는 재진입 시 rect/style/visible/alwaysOnTop을 복원한다.

fs.destinationStatus는 DestinationStatusArgs의 선택 grantHandle을 받으며 생략 시 현재 소유자의 기억한 권한을 조회한다. 조회할 권한이 없으면 null이다.

캡 이름은 최대32 ASCII 바이트이며 ^[a-z][a-z0-9]_(?:-[a-z0-9]+)_$를 따른다. 시작은 소문자이고 내부 단일 하이픈만 허용한다. leading/trailing/consecutive 하이픈은 거부한다(ADR-0017 승인 계약).

global-shortcut.status({shortcutHandle})은 소유자 검증 뒤 실제 등록된 ShortcutInfo를 조회한다. 모듈 재연결에서 적용 전 편집값과 구별하여 단축키를 복원한다.
