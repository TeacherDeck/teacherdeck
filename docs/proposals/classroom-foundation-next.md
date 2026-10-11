# 제안: 공통 학급·시간표 자료와 작은 교실 도구

상태: A 승인 및 구현 중. 2026-10-11에 사용자가 school-data 1.0과 학교 자료에 한정한 PRV-007 공유 예외를 명시 승인했다. B 전체 TimeAlert 백업 호환과 C 별도 확장 창은 미승인 범위로 남긴다. 상세 결정은 [ADR-0020](../adr/0020-school-data.md), 계약은 [학교 자료 명세](../spec/school-data.md)를 따른다. 원본 근거와 알려진 한계는 [time_alert 계약 조사](../reviews/time-alert-classroom-contracts.md)에 기록했다.

A 구현 범위에는 원본 표준 XLSX 명부·기본 주간 시간표의 수동 교환과 TeacherDeck 학교 자료 자체 JSON 오류복구가 포함된다. XLSX의 사진 자동 등록·전체 학기 구조의 무손실 왕복이나 B의 TimeAlert 전체 백업 호환으로 표시하지 않는다. 기존 ZIP/사진 추출 OOXML 코드와 journaled append-new 출력만 재사용하며 새 런타임 의존성을 추가하지 않는다. 최종 검증은 통합 담당자가 수행한다.

- 정지 조건: 새 캡(CAP-005/GEN-005), 공통 자료에 한정한 개인정보 격리 정책 명세(DOC-002/PRV-007), 후속 확장 표시 창의 보안 설정, 백업용 호스트 의존성(GEN-004)이 각각 구현 전 승인 대상이다.
- 배경: 우리 반·내 수업 학생·사진·학년도/학기·일과표/시간표를 한 번 등록해 여러 도구에서 사용해야 한다. 현재 storage는 모듈마다 격리되어 이를 대신할 수 없다. 원본 앱과 같은 XLSX/.teacherbackup 파일을 수동 교환해야 한다.
- 제안: 아래의 자료 권한·타입·흐름을 승인 후 DOC-002 순서로 구현한다. 시간표 조회·편집·파일 교환까지 포함하며 일정 알림 예약은 이번 범위에 넣지 않는다.
- 검토한 대안: 기존 storage 키 공유는 PRV-007 위반이고 사진·전체 백업을5MiB 저장소에 넣을 수 없다. 파일을 도구마다 다시 고르는 방식은 임시 작업에는 유효하지만 공통 명부를 해결하지 못한다. JS/WASM 파서는 XLSX·배정에는 유효하나 자동 공유 권한의 대안이 아니다. Android SQLite DB를 모든 모듈에 제공하면 연락처·메모까지 불필요하게 노출하므로 사용하지 않는다.
- 영향: 아래 세 승인 묶음은 독립적으로 구현·검증한다. 일반 req/res 브리지 외피, 기존 매니페스트/카탈로그 구조, fs/window 현재 동작은 유지한다. 앱·SDK minor, 새 캡1.0, 새 모듈0.1과 CHANGELOG는 실제 구현 시 확정한다.
- 필요한 승인: 공통 자료 읽기 캡과 제한된 격리 예외(A), 파일 호환 어댑터와 필요한 호스트 의존성(B), 확장 표시 창(C)의 구체 계약. 배정 순수 로직과 임시 명단 도구는 기존 캡으로 진행 가능하다.

## A. 공통 자료: school-data 1.0 읽기 캡

캡 이름은 `school-data`를 제안한다. 특정 배정이나 time_alert 파서를 호출하지 않는 범용 학교 자료 접근 기능이다. 소유는 셸의 공통 설정이고, 모듈은 읽기만 한다. 학생·시간표 수정은 공통 설정에 모아 검증과 파일 호환을 일관되게 적용한다.

### 사용자가 보는 흐름

공통 설정의 학급 자료에서 학년도·학기, 우리 반, 내 수업, 학생/사진, 일과표/시간표를 관리한다. 자료가 없어도 앱·다른 도구 사용을 막지 않는다. 학교 미등록은 내부 기본 학교를 사용한다.

각 도구 위쪽에서 `등록한 자료 사용 / 이번 작업에만 사용`을 고른다. 등록 자료가 있으면 첫 선택을 기본으로 한다. 처음 공통 명단을 연결하는 한 번의 행위에서 학기·우리 반/수업·허용 필드·도구 이름을 보여주고 확인한다. 이 선택이 해당 도구의 명시적 허용이다. 공통 등록 자체로 모든 모듈 권한을 주지 않는다. 이름/번호/학적·사진·시간표의 허용은 구분하며 자리·발표·모둠·역할 도구에는 연락처·생일·출결·메모를 제공하지 않는다.

임시 작업은 번호+이름 붙여넣기·직접 입력·기존 fs로 선택한 파일을 사용한다. 임시 대상은 공통 자료에 자동 등록하지 않는다. 저장한 작업은 모듈별 storage의 작업 스냅샷이며 공통 자료가 아니다. 작업 종료 시 저장하지 않은 자료는 해제한다. 공통 자료로 등록하는 동작은 공통 설정의 명시적 등록 흐름으로만 진행한다.

### 메서드와 결과 타입

모든 인자·결과는 승인 후 Rust 구조체/enum에서 생성한다. 아래는 검토용 계약이고 JSON 자유 형식·SQL·파일 경로를 허용하지 않는다.

| 메서드                 | 인자                                                                           | 결과                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `status`               | 없음                                                                           | 해당 모듈 소유 `AccessStatus { permitted, contexts: ContextSummary[], scopes: Scope[], revision }`. 미허용이면 빈 목록, 학생 정보 없음 |
| `requestAccess` (long) | `RequestedAccess { kinds: ContextKind[], scopes: Scope[], remember: boolean }` | 셸의 신뢰 UI에서 학기·대상을 고른 후 `AccessGrant { grantHandle, scopes, contexts, persistent }` 또는 null                             |
| `listContexts`         | `{ grantHandle }`                                                              | 허용된 `ContextSummary { contextId, semesterId, kind, label, memberCount, revision }[]`                                                |
| `readRoster`           | `{ grantHandle, contextId, expectedRevision? }`                                | `RosterSnapshot { snapshotId, revision, semester, context, students: StudentSummary[] }`                                               |
| `readTimetable`        | `{ grantHandle, semesterId, expectedRevision? }`                               | `TimetableSnapshot { snapshotId, revision, semester, divisions, dayTemplates, weeklyTables, dayOverrides, dateOverrides }`             |
| `openPhoto`            | `{ grantHandle, snapshotId, photoHandle }`                                     | 제한된 `{ resourceHandle, url, size, mimeType, chunkBytes }`; 인증된 동일 모듈 origin의 읽기 리소스                                    |
| `closePhoto`           | `{ resourceHandle }`                                                           | unit                                                                                                                                   |
| `revokeAccess`         | `{ grantHandle }`                                                              | unit. 허용·리소스 폐기, 공통 자료·이미 저장한 작업 결과 삭제 없음                                                                      |

`ContextKind = homeroom | division`, `Scope = roster-basic | photos | timetable`. `StudentSummary = { studentId, enrollmentId, grade, classNumber, studentNumber, displayStudentCode, name, status, photoHandle? }`. 생일·연락처·원본 경로·개인 메모는 타입 자체에서 제외한다. `semester = { semesterId, academicYear, term, startDate, endDate, archived, readOnly }`. 사진 스코프가 없으면 photoHandle도 생략한다.

시간표 구조는 원본 2축·기간 전체 대체·학교별 요일대체·부분 임시 일과표·MOVE/CANCEL/ADD와 changeGroupId를 보존하는 명시적 타입으로 정의한다. reminderEnabled 등 알림 필드는 호환 저장소에는 남기되 이 읽기 결과에서 제외한다. 시험/행사 등을 포함한 실제 날짜 해석이 필요한 화면에서는 호환 어댑터와 순수 엔진이 제공할 항목을 조사한 뒤 명세를 완성하며, 위 최소 타입만으로 모든 일정 상황을 지원한다고 주장하지 않는다.

### 권한·수명·상한

- grantHandle은 불투명·모듈 소유, contextId/학생 ID는 범위 조회용 식별자일 뿐 권한을 주지 않는다. 다른 모듈의 grant·스냅샷·사진을 전달해도 거부한다. 선언 캡·버전·실행 가능 여부·grant·scope·context를 매 호출 검사한다.
- 기록을 필요로 하지 않는 캡이므로 공통 저장소에서 출결/메모를 읽는 메서드는 없다. 별도 기록 도구는 별도 좁은 권한 제안 후 추가한다.
- snapshot은 읽은 revision의 당시 이름/번호/학적을 고정한다. 새 revision은 명시적 새 읽기에서만 반영한다. 자료 변경 중 이미 읽은 스냅샷과 이후 결과를 자동 섞지 않는다. 확정 배정/발표 이력에는 당시 정보를 별도 보존한다.
- 기억한 grant는 앱 재실행 시 소유자·범위·context를 다시 검사한다. 미기억 grant는 세션 종료/언로드에 폐기한다. 기억했더라도 origin 인증용 실행 토큰·리소스 URL은 새로 발급한다. 권한 해제는 이미 사용자가 저장한 작업 스냅샷을 되돌려 삭제하는 기능으로 표시하지 않는다.
- 사진은 바이너리를 JSON에 넣지 않고 CAP-003의 인증 읽기 방식 재사용을 제안한다. 이를 위한 리소스 경로 권한 추가가 필요하다면 승인 문서에 정확히 명시한다. 임의 URL·외부 origin·파일 경로 금지.
- 첫 버전 제안 상한: context당 학생1,000명, semester당 수업100개, 일과표32개·표당64슬롯, 주간표32개·표당105칸, 날짜 override2,000개. 사진 원본당16MiB/총256MiB, 읽기 리소스 모듈당4개, 5분 미사용 만료. 단일 응답은 브리지 크기 한도 이내. 초과는 자르지 않고 실패하며 실제 time_alert 합성 큰 자료 검증에서 상한을 확정한다.
- PRV-007에 공통 자료의 명시적 권한 예외만 추가한다. 다른 모듈의 storage 읽기나 일반 파일/DB 공유로 확대하지 않는다. 로그에는 ID·개수·오류 코드만 기록한다.

변경 예정 파일: `docs/adr/` 신규 ADR, `docs/spec/capabilities.md`, `privacy.md`, 필요시 `security.md`, `crates/deck-core/src/caps/`, `apps/desktop/src-tauri/src/caps/`, 공통 자료 저장 서비스, `packages/sdk/src/`의 생성 API, 셸 설정 UI. 생성물은 `pnpm gen`으로만 갱신한다. 테스트는 허용/거부/위조/철회/재시작/스냅샷 revision/바이너리 수명과 입력 상한을 포함한다.

## B. 같은 파일을 수동 교환하는 호환 어댑터

XLSX는 기존 fs1.2 선택 읽기·새 폴더 출력으로 처리한다. 이미 있는 파일의 덮어쓰기·삭제나 자동 동기화는 도입하지 않는다. 양식 저장은 원본 자산의 입력/안내 시트 형태를 유지하는 새 파일이다. 격자·이전 목록·사진명렬표를 따로 검증한다.

백업은 단순 명단 JSON으로 바꾸지 않는다. 셸이 선택한 .teacherbackup을 앱 소유 staging에서 해독하고 SQLite 원형과 사진을 보존한 뒤, 공통 설정의 필요한 데이터만 projection한다. 미편집 테이블·컬럼·Room identity·enum·null·사진 바이트를 보존한다. 지원 버전에서 허용한 표·컬럼만 트랜잭션 패치하고 원래 스키마로 새 TIMEALERT v1 백업을 만든다. Windows 전용 자리/모둠/발표/역할 이력을 Android DB에 임의 테이블로 추가하지 않는다. 그 이력은 모듈 storage에 별도 저장한다.

원본 형식은 PBKDF2-HMAC-SHA256120,000회·AES256-GCM128태그·salt16/iv12·ZIP(SQLite/WAL/사진). 원본이 header AAD를 사용하지 않으므로 호환 출력을 바꾸지 않는다. 미래 DB 버전은 편집/재내보내기를 거부하며 원본을 보존한다. 버전1~7은 원본 migration chain과 exported Room schemas로 검증한 범위를 UI에 표시한다. 사진 경로의 Android 재연결은 별도 왕복 기준을 통과해야 한다.

GEN-004 승인 분리: SQLite와 암호화를 호스트에 도입하려면 기존 workspace의 zip/sha2를 재사용할 위치와 새 의존성의 정확 버전·기능·라이선스·Windows 빌드 영향을 먼저 정한다. 현재 host에는 SQLite/PBKDF2/AES-GCM 의존성이 없다. 이 초안은 라이브러리 선택을 확정하거나 해당 의존성을 추가하는 승인이 아니다. B 구현 전 `rusqlite`/RustCrypto 또는 Windows CNG 대안의 구체 버전·API·배포 크기 비교를 후속 제안으로 완성한다. 잘못된 암호·GCM 미인증 plaintext·ZIP/WAL 손상에서 공통 자료를 교체하지 않는다.

## C. 학생 화면: 복제와 확장

복제 모드는 모듈의 학생용 보기와 기존 window.setFullscreen으로 가능하다. 교사 화면에서 잠금/제외·이유·집계·메모를 제거한 공개 모델을 별도로 만든다. 창을 복제하면 OS가 같은 화면을 출력한다.

확장 모드는 현재 window1.0의 alwaysOnTop/fullscreen만으로 두 번째 창을 만들 수 없다. 별도 공개 창을 승인 후 추가해야 한다. 제안할 window minor 계약은 `listDisplays() → DisplaySummary[]`, `openPresentation({displayHandle, kind}) → PresentationHandle`, `updatePresentation({presentationHandle, revision, payload: PublicResult})`, `closePresentation({presentationHandle})`다. payload는 자리/발표/모둠/역할의 허용 필드 enum·구조체이며 rawHTML/JS/URL·사진 원본 경로를 받지 않는다. 교사 조작창과 다른 display 선택, 공개 결과만 전달, 창 닫힘/연결 끊김/모듈 언로드 정리, 모니터 분리·DPI 변화·빈 화면 안전 복구가 필요하다.

구체적 Tauri window ACL·origin·프로토콜·상한은 C를 구현할 때 별도 제안으로 확정한다. C 승인 전 두 화면 지원을 완료로 표시하지 않는다. 학생 기기 접속·웹 서버·QR·네트워크 공유는 범위에 없다.

## D. 승인과 독립적으로 진행 가능한 모듈 작업

기존 `storage`, `fs`, `window`, `clipboard`로 임시 명단 도구와 순수 엔진을 완성할 수 있다. 신규 모듈은 `pnpm new:module`로 만들고 완결된 화면·테스트·저장까지 구현한다. 준비중 스켈레톤을 메뉴에 노출하지 않는다. 캡을 쓰지 않은 공통 등록 가짜 UI도 넣지 않는다.

| 작은 도구             | 입력→결과와 핵심 불변식                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 자리 배치             | 명단→좌석 행/열·통로·불가 좌석·앞줄·고정/제외→배치→직접 교환→확정. 교사의 고정·제외를 무시하지 않고 충돌 원인 설명            |
| 발표자 뽑기           | 명단·이번 대상→총 수행횟수 최소 후보→선정/재추첨→발표 완료. 완료 이벤트만 집계, 건너뛰기/취소/미리보기는0회                   |
| 모둠 만들기           | 명단→모둠 수/크기·고정·제외·분리→편성→이동/교환→확정. 교사 고정 우선, 나머지 인원 균등 soft 조건. 탐색 시간초과와 불가능 구분 |
| 역할·당번 나누기      | 명단→역할별 필요인원·고정/제외→총횟수 작은 대상부터 선정→직접 수정→수행 완료. 전체 학생을 반드시 배정하지 않음                |
| 일과/시간표 순수 엔진 | 원본의 2축 우선순위·부분 일과표·기간 전체대체·맞바꿈 그룹을 합성 모델로 이식·검증. 알림 예약 없음                             |
| 파일 호환 파서        | 기존 모듈/허가된 의존성으로 처리 가능한 XLSX 해석·양식 생성·경고·원본 기대값 비교. 전체 백업은 B의 후속 승인/검증까지 분리    |

모든 배정 도구에 `등록한 자료 사용 / 이번 작업에만 사용`의 위치·명칭을 동일하게 적용하되 A 구현 전에는 임시 작업만 실제 제공한다. 원본 프로토타입 UI·저장 방식은 전면 이식하지 않는다. `@deck/ui` 컨트롤·토큰·키보드 조작을 사용하고 실제 화면·DPI·테마를 검증한다. 수행 완료는 eventId로 중복 집계를 막고, 미리보기/확정표 생성 자체로 실제 수행 총횟수를 늘리지 않는다. 명단이 바뀌어도 이전 이력의 이름/번호는 당시 스냅샷을 유지한다.

완료 증거는 원본 파일 왕복, 권한·수명 테스트, 순수 로직 불변식, 임시/공통 전환, 복제/확장 실제 화면, `pnpm verify`, Windows 패키지 검증이다. 이 문서는 구현 완료나 승인 기록을 대신하지 않는다.
