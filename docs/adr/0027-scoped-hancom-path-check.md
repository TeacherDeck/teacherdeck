# ADR-0027: 한글 자동화의 작업용 파일만 허용하는 경로 확인 모듈

상태: 승인 후 구현·실제 합성 변환 검증 완료 (2026-10-11, 아래 제한 범위 적용)

## 배경과 승인

한글 COM의 합성 HWP fixture는 `SaveAs`에서 120초 동안 응답하지 않았다. 실제 화면 관측으로 해당 합성 파일의 접근 확인창이 원인임을 확인했다. 사용자는 반복 승인 대신 자동 변환을 요청했으며 공식 `RegisterModule` 경로를 이용하는 최소 구현을 승인했다. 보안창 자동 클릭, 모든 경로 허용, 전역 보안 수준 변경은 승인하지 않았다.

현재 호출 경로와 과거 실패 증거는 [후속 진단](../reviews/hancom-save-timeout-followup-2026-10-11.md)에 보존한다. 이 ADR의 구현 승인과 실제 변환 성공 검증은 구별한다.

## 공식 근거와 독립 구현

- [한컴 Automation 문서](https://developer.hancom.com/en-us/hwpautomation)는 공식 보안 모듈 예제를 제공한다. 개인의 비상업적 Automation 사용과 상용 솔루션 라이선스를 구별하며, 예제 파일의 무제한 재배포 허가는 확인되지 않았다.
- [한컴 기술 답변](https://forum.developer.hancom.com/t/topic/3206)은 HKCU `Software\HNC\HwpAutomation\Modules`의 REG_SZ 값 이름을 `RegisterModule("FilePathCheckDLL", 값이름)`에 전달하며 한글과 동일한 32비트 DLL이 필요함을 설명한다.
- [후속 기술 답변](https://forum.developer.hancom.com/t/topic/3209)은 `Modules\Uses`가 불필요하고 빈 등록 이름은 해제라는 점, `IsAccessiblePath` export의 필요성을 설명한다.

공식 ZIP의 실제 `.cpp`는 4인자 `__stdcall` 콜백이고 프로젝트는 `_MBCS`이다. 오래된 `.h`의 3인자 선언은 채택하지 않는다. 예제 DLL은 무조건 TRUE를 반환하므로 사용·동봉하지 않는다. 공식 ABI만 참조한 std-only Rust `cdylib`을 독립 작성한다. 현재 설치된 한글은 x86이다. 다른 비트수 설치에는 맞지 않는 DLL을 강제로 로드하지 않는다.

## 결정

별도 크레이트는 `apps/desktop/src-tauri/hancom-security`에 두고 호스트와 동일한 워크스페이스 버전·lint를 따른다. 네이티브 경계이므로 순수 `crates/*`에 두지 않는다. 추가 런타임 의존성은 없다.

1. 호스트는 기존 승인된 읽기 핸들에서 원본을 자체 임시 작업 폴더로 복사한다. 한글에 전달하는 파일은 작업용 입력 사본과 새로운 결과 파일 두 개뿐이다. 합성 fixture는 자기 신규 파일 한 개만 허용한다.
2. 기존 Office 작업 그룹은 직접 시작한 새 한글 자식과 별도 검증을 통과한 새 COM 서버만 소유한다. DLL 연결 전에 편집창의 Hwp PID가 소유 자식과 일치하고 정확한 작업 그룹에 속하며 살아 있음을 다시 확인하고 프로세스 핸들을 보존한다. 기존 사용자의 Office 프로세스에는 등록·종료를 수행하지 않는다.
3. 빌드 시 독립 x86 DLL의 PE machine과 정확한 `IsAccessiblePath` export를 검사한다. DLL 바이트는 호스트에 내장하고 자기 임시 폴더에 `create_new`로 복사한다. 동봉 산출물의 SHA-256과 현재 소스 해시가 다르면 검증을 실패시킨다.
4. 128비트 난수 작업 token과 worker PID를 담은 파일명·고유 HKCU 값 이름을 한글 시작 전에 준비한다. 시작 시 module 목록을 캐시하는 설치에 대응하는 수명 분리이며, 현재 실패의 확정 원인이라는 뜻은 아니다. 기존 값이 있으면 덮어쓰지 않는다. `Uses`, 공용 보안 설정, HKLM, 보안 제품 설정은 변경하지 않는다. 등록 실패 시 허용 범위를 확대하지 않는다.
5. 준비 단계에는 pipe가 없으므로 DLL이 먼저 로드되더라도 접근을 거부한다. 활성화 뒤 새 Hwp PID의 소유 Job·생존 상태를 검증하고 process handle을 고정한 후에만 pipe를 시작한다. DLL은 pipe 서버의 실제 worker PID, 서버는 클라이언트의 실제 Hwp PID를 Win32로 확인한다. 파일명은 시작 전에는 알 수 없는 Hwp PID를 포함하지 않지만 실제 process 인증은 서버에서 유지한다. token, 작업 프로세스, 만료된 세션을 다른 호출자의 주장으로 대체하지 않는다. 첫 pipe 인스턴스 충돌과 원격 클라이언트는 거부한다.
6. 공식 ANSI 문자열은 ACP 변환 실패 시 거부한다. Unicode 문자열은 드라이브 접두어의 확실한 바이트 형태로만 구별한다. 외부 포인터는 `ReadProcessMemory`로 제한된 길이만 읽으며 잘못된 포인터·문자열·frame은 거부한다.
7. 허용 경로는 두 개의 정확한 절대 경로다. 상대경로, UNC, device, URL, ADS, `..`, 비정규 separator 및 reparse point를 거부한다. 모든 부모 폴더를 삭제 공유 없는 핸들로 고정한다. 입력은 읽기 잠금·단일 hardlink·파일 ID로 고정하고 결과를 재열 때 채택한 파일 ID가 바뀌면 거부한다. 디렉터리 접두어 전체를 허용하지 않는다.
8. callback·server는 NOWAIT I/O와 짧은 제한 시간을 사용한다. 응답을 읽었다는 acknowledgment 후 연결을 끊어 응답 유실을 막는다. 작업 종료·취소·시간 초과로 pipe가 사라지면 callback는 FALSE를 반환한다. 부모는 자식 종료 후에도 고유 등록값을 정리하며 값의 token·worker PID·작업 폴더가 바뀌었으면 삭제하지 않는다. 원래 있던 사용자 값을 복구할 필요가 없도록 처음부터 건드리지 않는다.
9. HWPX 결과는 동일한 소유 인스턴스에서 다시 열고 본문을 원본 사본과 비교한다. 원본 선택 파일의 해시는 기존 변환 경계가 다시 확인한다. 서식 보존은 별도 합성 결과 구조 검사로 검증한다.

## 같은 작업 환경에서 한글 시작 (2026-10-11 후속)

실제 등록 실패를 추적하니 `LoadLibraryW` 전의 등록값 조회가 `ERROR_FILE_NOT_FOUND`로 끝났다. 같은 순간 새로 연 실행기 키에서는 값이 있었지만 한글이 연 키의 복제 핸들에서는 없었다. 사용자 SID·키의 native 이름·조회 이름이 같고 32/64비트 보기에서도 값이 유지됐다. 이 관측만으로 운영체제 내부의 격리 구현을 단정하지 않는다.

초기 프로토타입에서는 등록된 `Hwp.exe -Automation`을 작업자의 자식으로 직접 실행하고 `-Embedding`을 함께 전달한 뒤 COM으로 연결하니 동일 DLL의 `RegisterModule`과 로드가 성공했다. 실행 인수는 [한컴 등록 안내](https://forum.developer.hancom.com/t/regserver-com/1689/2)와 COM이 `-Embedding`을 추가하는 [Microsoft LocalServer32 문서](https://learn.microsoft.com/en-us/windows/win32/com/localserver32)를 따른다. 이후 진단에서는 편집창 외에 COM 활성화가 시작한 별도의 한글 서버가 남는 것도 확인했다. 직접 실행만으로 모든 서버의 소유권과 정리가 보장된다는 뜻은 아니다.

생산 경로는 고정 ProgID의 32비트 COM 등록에서 한글 실행 파일을 확인한다. 기존 한글이 실행 중이면 먼저 닫도록 안내하고 작업을 시작하지 않는다. 고유 등록값을 준비한 뒤 작업 그룹 안의 작업자가 `-Automation -Embedding`으로 새 자식을 시작한다. 자식은 작업자의 Job을 상속하고 살아 있는 자식 핸들을 유지한다. 최대 10초 동안 고정 한글 ROT 이름의 객체를 조회하여 편집창 PID가 소유 자식과 일치하는지 확인한 다음 그 객체를 해제한다. ROT 객체는 준비 확인에만 쓰며 파일 접근 모듈을 등록하는 Automation 객체로 채택하지 않는다. 설치 파일의 정적 분석에서도 ROT 게시가 class factory 등록보다 먼저 일어날 수 있으므로 둘의 준비 상태를 동일시하지 않는다.

이후 고정 ProgID의 `CoCreate`로 Automation 객체를 얻고 COM 편집창 PID가 살아 있는 소유 자식과 정확히 일치하는지 다시 확인한다. 활성화 직전 process snapshot과 실제 `CoCreate` 시작·종료 시각으로 별도 서버 후보를 제한한다. 소유 자식을 제외한 새로운 Hwp가 없으면 그대로 진행한다. 하나이면 생성 시각이 해당 활성화 구간 안에 있고 등록된 실행 파일·정확한 `-Automation -Embedding` 인수·작업자와 같은 사용자 SID 및 session이 일치하며 보이는 최상위 창이 없어야 한다. 보존한 동일 process handle로 Job에 편입한다. 후보가 여러 개이거나 검증이 실패하면 문서 작업을 시작하지 않는다. 등록·문서 작업·Quit는 이 단계와 소유 편집창의 Job 검증이 끝난 뒤에만 허용한다. HWND 입력 조작이나 승인창 자동 클릭은 사용하지 않는다.

설치된 한글 13.0.0.3189의 Automation은 성공한 `RegisterModule`의 `VT_BOOL` 출력에 `+1`을 기록했다. 일반 변환 API는 이 값을 FALSE로 해석했으므로 정확한 `VT_BOOL`에서는 원래 Boolean 값을 직접 읽어 0만 FALSE로 처리한다. 실제 0 반환을 성공으로 바꾸거나 DLL 로드만으로 등록 성공을 대신하지 않는다. `Open`의 생략할 형식 인자와 `SaveAs`의 생략할 추가 인자는 빈 BSTR 대신 COM의 missing 값을 전달한다. 같은 설치의 `SaveAs`는 NULL 빈 BSTR을 문자열로 읽다 충돌했으며 callback의 실제 호출은 기존 x86 4인자 `__stdcall` ABI와 일치했다.

작업 종료 시 부모는 해당 Job의 종료를 요청하고 `ActiveProcesses == 0`이 될 때까지 최대 5초 확인한다. 이전 작업의 비동기 종료 중 다음 HWP 항목이 시작되어 기존 한글로 판정되는 일을 막는다. 이 확인에 실패하면 정리 완료로 보고하지 않는다.

## 정확한 FFI 예외

추가 `unsafe_code` 예외는 `apps/desktop/src-tauri/src/hancom_gate.rs`와 `apps/desktop/src-tauri/hancom-security/src/ffi.rs` 두 파일뿐이다. 전자는 고정 HKCU 등록·정확한 파일/프로세스 핸들·인증된 pipe를 담당한다. 후자는 고정 callback ABI·제한된 포인터 읽기·pipe client만 담당한다. 각 unsafe 블록에는 수명·버퍼·소유권 설명을 둔다. 공유 protocol은 `forbid(unsafe_code)`를 유지한다. 기존 FFI 파일 외의 전역 예외는 추가하지 않는다.

## 검증 및 제한

잘못된 포인터, ANSI/Unicode, 경로 우회, 길이·frame·PID, hardlink, 원본 잠금, 결과 교체, 잘못된 peer, 응답·연속 연결·만료·등록 충돌·정리를 회귀 검사한다. 실제 Office 검증에는 합성 문서만 쓴다. 보안창이나 OS UI는 자동 조작하지 않는다. 변환·서식·취소 정리가 실제 검증되기 전에는 HWPX 실기 완료로 보고하지 않는다.

서명되지 않은 DLL 로드 자체가 조직 정책에 의해 차단되면 안전한 오류로 종료한다. 보안 정책을 완화하거나 공식 allow-all 예제로 우회하지 않는다. 다른 비트수 한글 지원과 앱 강제 종료 뒤 남을 수 있는 실패 폐쇄된 고유 등록값의 정리는 별도 검증 항목이다.

별도 COM 서버를 Job에 편입하기 전에 `CoCreate` 또는 소유권 검증 도중 작업자가 시간 초과·취소로 종료되면 아직 소유하지 못한 SCM 서버가 남을 수 있다. 동일 이미지·인수로 동시에 시작한 외부 자동화 호출과의 인과관계도 이 검증만으로 완전히 구별하지 못한다. 확인하지 못한 프로세스를 이름·PID 목록만으로 종료하는 우회는 하지 않는다.

초기 2026-10-11 합성 진단에서는 x86 DLL 경계·단독 로드/export 4개와 호스트 경로/pipe/고유 등록 수명 7개 회귀가 통과했지만 COM 시작 후 등록과 시작 전 등록 모두 FALSE로 관측됐고 직후 snapshot에는 DLL이 없었다. 이후 등록값 조회 단계와 Boolean 해석, 선택 인자, 서버 수명 문제를 각각 구분했다.

같은 날 수정된 생산 경로를 사용하는 `office_synthetic --provider hancom`의 실제 합성 검증은 두 차례 통과했다. 보고서 ID는 `132478e49398b78efb24acb72d844b7c`와 `40cde93ad25fce2a4360ab151234b85e`이며 두 보고서 모두 `success: true`, `stage: validation`이다.

- 새 합성 HWP 생성 → 생산 `run_office`의 HWPX 저장 → 제공자 재열기·본문 비교·원본 SHA-256 유지 → strict ZIP 검증이 완료됐다. 각 HWPX는 ZIP 항목 11개·XML 8개였으며 한국어·영어 본문을 담은 3문단과 각 문단의 굵게·18pt 서식을 검사했다. 각 실행 뒤 살아 있는 Hwp가 남지 않았다.
- 첫 보고서의 원본 SHA-256은 `77934d65328490bc4795efeca8d8e0d2bfa81d710848b0a72fc818b4861e697d`, 결과 SHA-256은 `23794e77f99d11aaf4815e20ed3b7f25b79bbe95a5681dd98a20abd37767e2c4`이다. 독립 Python XML 검사도 첫 결과의 본문·서식 구조를 확인했다.
- 첫 보고서의 fixture에 대한 `--hancom-stop-proof`는 `timeoutCleanup`, `cancellationCleanup`, `sourcePreserved`가 모두 true였고 8,442ms에 종료됐다. 시간 초과는 소유 자식 직접 실행 뒤에, 취소는 별도 서버의 Job 편입이 끝난 `guards-begin` 단계에 주입했다. 이 검증은 위의 COM 활성화·검증 도중 편입 전 정리 한계를 해소했다는 증거가 아니다.

이 결과는 해당 설치의 합성 문서 변환·본문/서식 구조·정상 종료와 지정한 취소·시간 초과 지점의 증거다. 렌더링 화면의 배치나 실제 사용자 문서의 표·그림·수식 보존을 검증하지는 않았다. 전체 레포 검증은 별도로 확인한다. 성공 증거와 재현 명령은 [변환 검수](../reviews/hancom-conversion-2026-10-11.md), 과거 실패는 [후속 진단](../reviews/hancom-save-timeout-followup-2026-10-11.md)에 연결한다.
