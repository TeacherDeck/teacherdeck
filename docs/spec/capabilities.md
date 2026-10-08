# 호스트 캡 (capabilities)

캡(capability)은 호스트가 모듈에 제공하는, 버전이 붙은 범용 기능 묶음이다. 네이티브 코드는 호스트에만 있고 캡을 통해서만 모듈에 노출된다([ADR-0002](../adr/0002-module-architecture.md)).

## 1. 설계 원칙

1. **범용 프리미티브.** 특정 도구 전용 메서드를 만들지 않는다(CAP-001). 예를 들어 "출석부 PDF 만들기"가 아니라 "파일 선택"과 "결과 저장"을 제공한다.
2. **먼저 대안을 검토한다.** 새 캡을 만들기 전에 기존 캡 조합이나 모듈 측 WASM/JS로 해결할 수 없는지 확인한다.
3. **경로 대신 핸들.** 모듈은 파일 경로를 보지 않는다. 호스트가 발급한 불투명 핸들만 다룬다(CAP-002).
4. **대용량은 브리지 밖으로.** 1MB를 넘는 바이너리는 `deckmod` 리소스 URL로 주고받는다(CAP-003, [catalog.md](catalog.md#3-서빙)).
5. **매 호출 권한 검사.** 설치·활성 여부, 선언 캡, 버전을 Rust에서 매번 확인한다(CAP-008).
6. **오류에 개인정보 없음.** `ErrorCode`와 일반 메시지만 반환한다(CAP-007, PRV-003).

## 2. v1 레지스트리

> 이 표는 Phase 1에서 수기로 작성했다. Phase 4에서 Rust 레지스트리의 생성물로 전환한다(CAP-010). 전환 후에는 손으로 고치지 않는다(GEN-006).

| 캡 | 버전 | 메서드 |
|---|---|---|
| `system` | 1.0.0 | `info() → { appVersion, os: { name, version, build }, locale }` |
| `storage` | 1.0.0 | `get(key) → value \| null`, `set(key, value)`, `delete(key)`, `keys() → string[]` |
| `fs` | 1.0.0 | `pickFiles({ multiple?, filters? }) → FileHandleInfo[]`, `pickFolder() → FolderHandleInfo \| null`, `stat(handle)`, `reveal(handle)` |
| `window` | 1.0.0 | `setAlwaysOnTop(bool)`, `setFullscreen(bool)` |

### 2.1 `storage`

- key는 `^[A-Za-z0-9._-]{1,128}$`이다.
- 값은 JSON이며 직렬화 후 256KB 이하다. 모듈당 합계는 5MB 이하다.
- 저장 위치는 `app_data/module-data/<id>/storage.json`이며 원자적으로 쓴다(temp 파일 + rename).
- 모듈 데이터는 모듈 id로 격리한다(PRV-007).

### 2.2 `fs`

- `FileHandleInfo = { handle, name, ext, size, modifiedAt }`
- `FolderHandleInfo`의 필드는 Phase 4에서 Rust 원천으로 확정한다. 경로는 포함하지 않는다.
- 핸들은 불투명 랜덤 문자열이며 (모듈 id, 앱 세션) 범위에서만 유효하다. 다른 모듈이나 다음 세션에서 쓰면 `PERMISSION_DENIED` 또는 `NOT_FOUND`를 반환한다.
- 경로는 절대 반환하지 않는다. `name`은 사용자가 고른 파일의 표시용 이름이며 로그에 남기지 않는다(PRV-003).
- v1에는 파일 내용을 읽거나 쓰는 메서드가 없다. [5절](#5-예정-캡)을 본다.

### 2.3 `window`

- 모듈이 숨겨지거나 언로드되면 호스트가 창 상태를 원래대로 되돌린다.

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

| 후보 | 방향 |
|---|---|
| `fs` minor 확장 | 파일 내용 읽기(핸들 → `deckmod` 리소스 URL, `_` 예약 경로 사용)와 결과 저장(저장 대화상자 → 새 핸들, 쓰기)을 추가한다. 1MB 초과 쓰기의 전송 방식(분할 전송 또는 리소스 업로드 엔드포인트)은 미정이다. 원본 덮어쓰기는 PRV-006을 따른다. |
| `pdf` | 병합·분할·페이지 회전은 모듈 측 JS/WASM으로 먼저 해결한다. 호스트 캡은 네이티브 렌더링이 꼭 필요한 경우에만 "핸들 + 페이지 → 렌더 결과 리소스 URL" 형태의 범용 메서드로 둔다. |
| `image` | 크롭·리사이즈·포맷 변환은 모듈 측 WASM으로 먼저 해결한다. 호스트 캡은 OS 코덱이 필요한 포맷(예: HEIC) 디코딩 같은 범용 변환에 한정한다. |
| `ocr` | Windows 내장 OCR처럼 네이티브에만 있는 기능이다. "이미지 핸들 → 텍스트 블록" 형태의 범용 메서드로 둔다. 네트워크 OCR은 금지한다(PRV-001). |
| `office` | hwp/xls 등 변환은 별도 helper 프로세스(Office/한글 COM)를 쓴다. "핸들 + 대상 포맷 → 결과 핸들" 형태의 범용 변환 메서드로 두고, 원본은 건드리지 않는다(PRV-006). |
| `roster` | 여러 모듈이 같은 학생 명단을 쓰는 요구다. 모듈 간 데이터 공유는 PRV-007(모듈별 격리)과 충돌하므로, 사용자가 명시적으로 허용한 경우에만 읽기를 허락하는 방식으로 설계한다. 실존 인명은 테스트에 쓰지 않는다(PRV-004). |

## 6. 규칙

- **CAP-001** [MUST] 캡은 범용 프리미티브로 설계한다. 특정 도구 전용 메서드를 만들지 않는다. 먼저 기존 캡 조합이나 모듈 측 WASM으로 해결할 수 없는지 검토한다. — 강제: [manual] 리뷰, add-capability skill(Phase 7에서 구현)
- **CAP-002** [MUST NOT] 파일 경로를 인자로 받거나 결과로 반환하지 않는다. 핸들만 쓴다. — 강제: 타입 리뷰, 테스트(Phase 4에서 구현)
- **CAP-003** [MUST NOT] 대용량 바이너리(>1MB)를 브리지로 보내지 않는다. `deckmod` 리소스 URL을 쓴다. — 강제: 브리지 크기 제한 BRG-007(Phase 5에서 구현)
- **CAP-004** [MUST] 버전 규칙: 메서드·선택 인자·결과 필드 추가는 minor, 그 외는 major다. major 변경 시 이전 major 핸들러를 최소 2회의 앱 minor 릴리스 동안 유지하고 ADR을 쓴다. — 강제: [manual], 레지스트리 diff 리뷰
- **CAP-005** [MUST] 새 캡이나 major 변경은 사람 승인을 받는다(GEN-005). — 강제: 훅(레지스트리 생성물 보호)(Phase 7에서 구현), [manual]
- **CAP-006** [MUST] 모든 메서드 인자·결과는 Rust 구조체로 정의하고 ts-rs로 TS 타입을 export한다. `serde_json::Value`는 디스패치 경계에서만 쓴다. — 강제: `check-gen`(캡 타입 생성은 Phase 4에서 구현)
- **CAP-007** [MUST] 에러는 `ErrorCode` enum과 메시지로 반환하며, 메시지에 경로·파일명·사용자 데이터를 넣지 않는다(PRV-003). — 강제: 테스트(Phase 4에서 구현), [manual]
- **CAP-008** [MUST] 모듈 권한 검사(설치·활성 여부, 선언 캡, 버전)는 Rust에서 매 호출마다 수행한다. 셸 검사는 보조일 뿐이다. — 강제: 권한 거부 테스트(Phase 4에서 구현)
- **CAP-009** [MUST] 각 캡은 정상·권한 거부·잘못된 인자 테스트를 갖춘다. — 강제: [manual] 리뷰, 커버리지 보고(Phase 4에서 구현)
- **CAP-010** [MUST] `capabilities.md`의 레지스트리 표와 `schema/capabilities.json`은 Rust 레지스트리에서 생성한다. — 강제: `check-gen`(레지스트리 생성기는 Phase 4에서 구현)
