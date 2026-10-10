# 모듈 공통 기반 승인 제안

상태: **1차 파일 입출력은 2026-10-10 사용자 승인, 2차 이후는 미승인**. 사용자의 승인 답변은 “1차 파일 입출력 구현 승인”이다. 작성일: 2026-10-10. 제품 요구 수용과 아래 API·보안 변경 승인은 구분한다. [process.md](../spec/process.md)의 제안서 형식으로 승인 단위를 나눴다. 독립적인 회의록·지도일 계산의 모듈 개발은 이 제안 승인에 종속시키지 않는다.

승인 후 플랫폼 조사에서 POST 본문이 앱 핸들러 전에 전체 할당되는 제약을 확인했다. 필요한 차이는 [파일 전송 후속 제안](file-transfer-followup.md)으로 분리했고, 사용자는 “두 보완안 승인”으로 64KiB 인증 브리지 쓰기와 모듈별 origin을 승인했다. 아래 1차 내용은 최초 제안의 기록이다. 실제 계약은 [ADR-0013](../adr/0013-module-origin-isolation.md), [ADR-0014](../adr/0014-bounded-file-transfers.md), [capabilities.md](../spec/capabilities.md)를 따른다. 원본 보호·폴더 범위·취소·권한 제한에 대한 기존 승인은 유지한다.

## 최초 제안 당시 구현 근거

- `apps/desktop/src-tauri/src/caps/fs.rs`의 `Op`는 pickFiles/pickFolder/stat/reveal뿐이다. 파일 읽기·결과 저장은 없다. `crates/deck-core/src/caps/fs.rs`도 같은 타입을 정의한다.
- `AppState.handles`는 `HandleTable<PathBuf, OsRng>`다. 파일/폴더 종류와 읽기/쓰기 권한은 별도 타입으로 구분되어 있지 않다. 기존 핸들을 곧바로 임의 쓰기 대상으로 확대하면 안 된다.
- `protocol.rs`는 GET/HEAD만 허용하며 `lib.rs::serve`는 검증된 모듈 번들의 메모리 바이트만 제공한다. 사용자 파일용 예약 경로는 아직 구현되지 않았다. `respond`는 `Vec<u8>`를 사용하므로 파일 전체를 이 응답에 담으면 대용량 메모리 문제가 생긴다.
- SDK `client.ts`의 공개 `fs`와 Rust 레지스트리는 fs 1.0.0이다. SDK 0.1.0, 앱 0.0.0이다. 브리지 인자는 SDK·셸·Rust에서 1MiB 제한을 받는다. 실제 바이너리는 브리지 밖으로 보내야 한다(CAP-003).
- `ModuleBridge.ts`의 cancel은 클라이언트에 CANCELLED를 보내고 늦은 결과를 버릴 뿐, 호스트 작업을 중단하지 않는다. 이 동작으로 쓰기 취소가 구현됐다고 주장할 수 없다.
- storage는 모듈별 JSON 저장(값 256KiB, 합계 5MiB)이다. 공통 DB·명부·시간표 서비스는 없다. storage를 다른 모듈에서 읽게 만드는 우회는 PRV-007에 어긋난다.

## 제안: 1차 — 파일 읽기와 새 결과 저장(fs 1.1.0)

- 정지 조건: 사용자 파일용 `deckmod` 커스텀 프로토콜 확장(보안 설정 변경). fs 메서드 추가 자체는 minor지만 프로토콜 보안 경계를 바꾸므로 GEN-005 승인을 먼저 받는다.
- 배경: 파일명 정리·사진 추출·변환의 공통 첫 의존성이다. 임의 경로·원본 변경 없이 큰 입력을 읽고 새 결과를 저장해야 한다.
- 제안: fs 1.1.0에 아래 메서드를 추가한다. 사용자 선택 폴더 안에 **새 결과 폴더**를 만들고, 그 안의 새 파일만 작성한다. 원본 이름 변경/이동/덮어쓰기/삭제, 이미 존재하는 출력 파일 덮어쓰기는 제외한다. 다이얼로그 취소는 null, 작업 취소는 CANCELLED다.
- 검토한 대안: 기존 fs+storage만으로는 파일 바이트에 접근하지 못한다. 브리지 base64/청크는 CAP-003 방향과 어긋나고 직렬화 메모리를 늘린다. 모듈 JS/WASM 변환은 유지하되 입출력만 호스트에 둔다. 전체 파일 GET/POST는 현재 Vec 응답 구조에서 메모리 상한을 보장하기 어려워 제한된 바이너리 청크 엔드포인트를 선택한다.
- 영향: 기존 fs 1.0 메서드 동작 유지. 앱 첫 minor 0.1.0, SDK 0.2.0, fs 1.1.0을 제안한다(통합 릴리스 번호는 담당자가 확정). 브리지 deck=1, manifestVersion·카탈로그 포맷은 유지한다. 사용 모듈은 requires.fs `^1.1.0` 및 minor bump/CHANGELOG. CSP·ACL의 권한 확대와 새 런타임 의존성은 이 승인에 포함하지 않는다.
- 필요한 승인: 프로젝트 소유자가 아래 fs API, 예약 리소스 경로의 제한된 GET/POST, 새 결과 폴더만 쓰는 정책과 한도에 한정해 구현 승인한다. 플랫폼 검증 결과 추가 CSP/ACL/의존성이 필요하면 해당 차이만 별도 제안한다.

### TypeScript 계약 초안

실제 계약은 승인 후 Rust 구조체와 ts-rs 생성물로 만든다. 아래는 문서 초안이며 SDK 구현이 아니다.

```ts
type FileRead = { readId: string; size: number; chunkBytes: number; url: string };
type OutputBatch = { batchId: string; folder: FolderHandleInfo };
type FileWrite = { writeId: string; chunkBytes: number; uploadUrl: string };
interface Fs11 {
  openRead(args: { handle: string }): Promise<FileRead>;
  closeRead(args: { readId: string }): Promise<void>;
  createOutputFolder(args: { parentHandle: string; suggestedName: string }): Promise<OutputBatch>;
  beginWrite(args: { batchId: string; suggestedName: string; size: number }): Promise<FileWrite>;
  commitWrite(args: { writeId: string }): Promise<FileHandleInfo>;
  abortWrite(args: { writeId: string }): Promise<void>;
  closeOutputFolder(args: { batchId: string }): Promise<void>;
}
```

SDK 추가 편의 함수 `readChunks`/`writeBlob`은 위 계약과 같은 권한·한도를 따르며 `AbortSignal` 취소 시 closeRead/abortWrite를 호출한다. `deck.call` 제네릭을 우회해 미등록 메서드를 시험하는 구현은 하지 않는다.

### 전송·권한·한도

1. 읽기는 `/_resources/<불투명 토큰>`의 GET/HEAD로 제공한다. GET은 offset과 length를 받고 **256KiB 이하**만 반환한다. 토큰은 인증된 브리지 openRead에서 생성하고, 모듈 id·앱 세션·열린 모듈 세대·원본 핸들·읽기 전용에 묶는다. 파일명이나 경로를 URL에 넣지 않는다. 같은 모듈 origin에 여러 도구가 있으므로 Origin/URL의 module id만을 인증으로 믿지 않는다. 충분한 OS 난수 토큰이 권한이며 브리지 외에 토큰을 발급하지 않는다. 로그에도 토큰 URL을 남기지 않는다.
2. 쓰기는 별도 `/_uploads/<불투명 토큰>` POST만 허용한다. 요청은 256KiB 이하의 raw binary이며 순번/offset을 검증한다. 중복 offset 재전송은 동일 바이트 확인 후 동일 결과로 응답하고 서로 다른 바이트는 INVALID_ARGS로 거부한다. 토큰은 해당 writeId 전용이며 읽기 토큰으로 쓰기할 수 없다. 다른 모듈 토큰 추측·이전 세션 토큰·비활성/제거 모듈 토큰은 거부한다. 매 리소스 호출에 설치/활성 상태·선언 캡·버전과 grant 유효성을 Rust에서 재확인한다.
3. 파일/폴더 핸들과 output batch/write/read 권한 테이블을 종류별로 분리한다. pickFiles·드롭은 read 권한만 준다. pickFolder는 createOutputFolder의 부모 선택에만 쓰며 해당 폴더의 기존 자식 파일을 쓰거나 열거하는 권한을 주지 않는다. 언로드/제거·세션 종료 시 관련 토큰과 미완성 쓰기를 폐기한다. 단순 탭 숨김은 사용 중인 읽기/쓰기 작업을 유지하되 권한 확대는 없다.
4. 초안 한도: 파일당 512MiB, 모듈당 활성 읽기 4개/쓰기 1개, 앱 활성 쓰기 2개, 작업당 결과 파일 2,000개·합계 2GiB, 토큰 미사용 5분 만료. 이 제한은 저사양 기준의 시작값이며 측정 후 별도 문서 변경으로 조정한다. 초과는 INVALID_ARGS, 동시 작업 초과는 BUSY로 일반 메시지만 반환한다.
5. Rust의 Vec 요청/응답은 청크만 담는다. 요청 본문 제한을 OS/WebView가 **수신 전 또는 제한된 수신 과정에서** 적용 가능한지 Windows 실측한다. 수신 후 길이 검사만으로는 악성 거대 body의 메모리 제한을 증명하지 못한다. 플랫폼이 이를 보장하지 못하면 POST 방식을 출시하지 않고 제한된 호스트 중계 전송의 별도 제안으로 돌아간다. 모듈 전체 arrayBuffer 변환은 파서 자체 한도를 별도로 지켜야 하며 파일 크기 상한이 JS 전체 메모리 상한을 뜻하지 않는다.
6. 사용자가 선택한 파일의 변경/삭제와 읽기 도중 크기 변경을 감지하고 NOT_FOUND/INTERNAL로 중단한다. 동일 openRead 동안 호스트가 열린 파일과 초기 metadata를 고정해 다른 경로로 바뀐 파일을 조용히 읽지 않는다. 심볼릭 링크·Windows reparse point·부모 변경은 거부하고 출력 경계는 매 쓰기/게시 시 재검증한다.

### 저장·충돌·취소

- suggestedName은 경로가 아니라 단일 이름이다. 절대경로/구분자/`..`/예약 장치명/끝 점·공백을 거부한다. 확장자 보존은 도구의 명시된 규칙을 따른다. 같은 이름은 호스트에서 연번을 붙여 새 이름으로 예약하고 실제 결과 이름을 반환한다. 대소문자 충돌도 검사하며 생성 시 create-new의 원자적 배타성을 사용한다.
- 미완성 바이트는 앱 전용 TempArea에만 둔다. commitWrite는 예상 크기·완료 청크를 검증하고 flush한 뒤 새 결과 파일로 게시한다. 앱 temp와 목적지 볼륨이 다를 수 있으므로 단순 rename 성공을 전제하지 않는다. 호스트 소유 새 결과 폴더에 예약된 비최종 파일로 제한된 복사를 하고, 같은 볼륨의 **덮어쓰기 없는** 원자적 게시를 사용한다. 이 폴더의 작업 중 파일 보관 예외는 PRV-005에 대한 ADR/spec의 좁은 수정 대상으로 승인에 명시한다.
- 취소와 commit은 write 상태 잠금 아래 하나의 승자만 가진다. commit 이전 취소면 최종 파일 없음, 게시가 먼저 완료됐으면 성공 결과를 보존한다. 이미 완료된 결과를 취소 때문에 삭제하지 않는다. abortWrite는 호스트가 방금 만든 미완성 temp/게시 준비물만 정리하며 사용자가 추가·수정한 파일이나 기존 파일은 지우지 않는다. 이름 예약·청크만료·실패·재시작 잔여 정리도 같은 소유 확인을 적용한다.
- 1차는 원래 req 취소로 호스트가 중단된다고 가정하지 않는다. 명시적 abortWrite가 실제 취소 계약이다. 향후 BRG-005 job 취소를 호스트에 연결할 때 별도 IPC 계약·승인 여부를 확인한다. UI는 게시 직후 취소를 성공한 파일 삭제로 표시하지 않는다.

### 승인 후 바뀔 파일과 순서

ADR → `docs/spec/{capabilities,catalog,security,privacy}.md`(예약 경로·PRV-005 제한 예외) → `crates/deck-core/src/{caps/fs.rs,caps/mod.rs,handles.rs}` 및 코드 생성기의 타입 export → 호스트 `src/{caps/fs.rs,caps/mod.rs,state.rs,protocol.rs,lib.rs}`와 새 리소스/출력 서비스 → SDK `src/{client.ts,index.ts}`와 검사·테스트 → `pnpm gen` → 버전/CHANGELOG/관련 AGENTS·README. 생성물 직접 편집은 금지한다. ACL/CSP 변경 필요성이 생기면 구현 전 추가 승인한다.

## 제안: 2차 — 공통 자료와 time_alert 호환

- 정지 조건: 새 `school-data` 캡(가칭 1.0.0), PRV-007의 사용자 동의 공유 예외, 호환 어댑터에 필요한 호스트 런타임 의존성.
- 배경: 등록 명부/사진/시간표를 재사용하되 임시 사용과 관찰 기록의 격리를 지켜야 한다.
- 제안: **자동 공통 등록을 기본 선택으로 표시하되 해제 가능**하게 한다. 가져오기 확인 화면에 저장 위치·이용 도구·필드를 설명하고 확정 시 등록한다. 등록 없이 이번 작업만 사용하면 메모리/모듈 전용 storage만 사용한다. 공통 등록과 도구별 읽기 동의는 분리한다. 처음 읽을 때 셸이 해당 도구의 요청 필드를 보여 주며 허용·거부/해제를 관리한다. 공유 캡 선언은 동의를 대체하지 않는다. 동기화/계정/서버는 없다.
- 검토한 대안: 각 모듈 storage만 사용하면 중복 등록과 변경 불일치가 생긴다. 모든 DB를 공유하면 필요 없는 개인정보가 노출된다. 읽기 전용 범위별 스냅샷을 발급하는 별도 호스트 서비스가 권고안이다.
- 영향: 앱·SDK minor와 school-data 1.0.0, 해당 모듈 minor bump. manifest의 기존 requires/optional로 선언하며 포맷 변경은 없다. 학생 identity, 학기 enrollment, 확정 기록 snapshot을 분리한다. 이름만으로 병합하지 않으며 과거 배정·출결·기록의 이름/학급/번호를 명부 수정으로 바꾸지 않는다.
- 필요한 승인: 1차와 분리해서 데이터 모델·동의 UI·허용 필드·저장 엔진/의존성을 확정한 후 요청한다. 이 문서는 school-data 구현 승인을 동시에 요구하지 않는다.

```ts
type DataScope = "roster.basic" | "roster.photos" | "schedule";
type StudentIdentity = { studentId: string; name: string };
type Enrollment = {
  enrollmentId: string;
  studentId: string;
  semesterId: string;
  grade: number;
  classNumber: number;
  studentNumber: number;
  status: string;
};
type RecordSnapshot = {
  revision: string;
  enrollmentId: string;
  name: string;
  classNumber: number;
  studentNumber: number;
};
interface SchoolDataDraft {
  requestAccess(args: { scopes: DataScope[] }): Promise<{ grantId: string } | null>;
  readSnapshot(args: {
    grantId: string;
    scope: DataScope;
    semesterId: string;
  }): Promise<{ revision: string; resourceUrl: string }>;
}
```

관찰 기록은 위 scope에 없다. 기록 도구가 필요하면 별도 scope/API 제안을 만든다. 가져오기/수정은 셸 공통 설정에서 우선 제공하며 임의 모듈의 공통 DB 쓰기 권한을 먼저 열지 않는다. grant는 모듈/세션/허용 필드에 묶이고 해제 즉시 새 접근을 차단한다. 이미 도구에 제공된 데이터 회수를 보장한다고 표현하지 않는다.

### 호환 어댑터의 수용 기준

읽기 전용 확인 원천: `D:/codex_work/time_alert/app/src/main/java/com/timealert/teacher/core/backup/BackupManager.kt`, `core/database/entity/StudentEntities.kt`, `core/database/AppDatabase.kt`, `app/schemas/`. 현재 백업은 `TIMEALERT|1|<DB 버전>|<날짜>|120000\n` + salt 16바이트 + IV 12바이트 + AES-256-GCM 암호문 ZIP이며 PBKDF2WithHmacSHA256, 태그 128비트다. ZIP은 `database/timealert.db`, 존재 시 WAL, `photos/`를 담는다. 암호는 로그/storage에 저장하지 않는다.

표준 XLSX 명부/시간표/사진명렬표 수용·출력은 먼저 합성 golden 입력으로 확정한다. `.teacherbackup`은 별도 3차 구현으로 취급한다. XLSX만 지원하면서 백업 호환 완료라고 말하지 않는다. SQLite DB를 모듈에 직접 노출하지 않고 호스트 어댑터가 허용 필드만 제공한다. 해석하지 못하는 테이블/열/기록/사진/식별자를 보존하고 time_alert로 재반입해 왕복 비교한다. 지원하지 않는 DB 버전은 새 DB로 덮어 복원하지 않고 중단한다. 사진 원본과 기록용 축소본은 구분한다. 전출입/학기 전환/이름 같은 학생/사진 누락을 합성 fixture로 검증한다. 암호·ZIP 폭탄·KDF 과다 반복·경로 탈출·미지원 형식은 크기/시간 제한으로 거부한다. 암호화/SQLite/ZIP 의존성의 정확한 이름·버전·라이선스는 후속 제안에 적고 이번 승인에 포괄하지 않는다.

## 제안: 후속 OS 연동은 개별 승인

QuickCapture는 선택 영역 캡처·DPI·오버레이·한정된 전역 단축키를 위한 별도 캡 제안이다. Office는 설치된 한글/Excel/PowerPoint의 허용 형식 변환만 제공하고 매크로 실행 차단·취소·helper 종료·원본 보호를 검증한다. CoolReserve는 기존 저장소의 업무 코어/태그 산출물/해시를 유지하고 쿨메신저 대상 창과 예약 등록 작업만 한정한다. 불확실한 등록을 재시도해 중복 메시지를 만드는 동작을 금지하는 계약이 필요하다. 이 셋에 임의 실행·임의 창 조작·전체 디스크 접근 권한을 함께 부여하지 않는다. 네트워크 루틴도 관리자 작업과 네트워크 권한을 별도 제안한다. 위 후속 캡의 이름·API·의존성·배포 계약은 **이번 1차 승인에 포함되지 않는다**.

## 최소 검증 행렬과 개발 순서

| 단계            | 필수 검증                                                                                                                      | 통과 증거                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1A 파일 읽기    | 정상/권한 거부/잘못된 인자, 다른 모듈·세션, 토큰 만료, GET 청크 경계, 파일 변경, 인코딩·reparse 탈출, SEC-004                  | Rust/SDK/프로토콜 검사 + Windows 실제 입력 읽기                |
| 1B 새 파일 저장 | 빈 파일·청크 누락/중복, 1MiB 브리지 유지, 제한 초과, 디스크 부족, 동명·대소문자·장치명, 다른 볼륨, 게시/취소 경쟁, 중단 재시작 | 원본 해시 불변·완성 결과 해시·미완성 잔여 정리, 실제 저장 열기 |
| 1C 파일 도구    | 새 폴더 기본, 수백 건, 실패만 재시도, 완료 결과 보존, 저사양 메모리                                                            | UI 입력→처리→결과 열기 + 메모리 피크 기록                      |
| 2 공통 자료     | 등록 기본/해제, 임시 입력, grant 거부·철회, 필드 분리, 학기 전환, 기록 snapshot                                                | 합성 자료 계약 및 실제 셸 동의 흐름                            |
| 3 호환          | XLSX golden, 백업 Android→Deck→Android, 미해석 기록 보존, 잘못된 암호·버전·ZIP/KDF 한도                                        | 표/DB/사진 의미 비교와 양쪽 앱 재반입                          |
| 4 개별 OS 캡    | QuickCapture/Office/CoolReserve 각각 승인과 환경별 검증                                                                        | 승인한 계약의 세로 기능 증거                                   |

각 구현 단계는 `pnpm verify`, 필요한 `pnpm gen`, 모듈 패키지·Windows 빌드/일반 권한 QA를 통과한 후 완료로 보고한다. 1A/1B 계약을 먼저 확정·구현하고 파일명 통합안 확정 및 사진 추출 세로 기능으로 연결한다. 공통 자료/백업/OS 계약을 기다리며 이미 가능한 회의록 입력·지도일 배정 계산 작업을 중단하지 않는다.
