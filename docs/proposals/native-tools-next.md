# 제안: 문서 형식 변환·네트워크 루틴·CoolReserve 네이티브 연결

- 정지 조건: 새 캡(CAP-005), 호스트 런타임 의존성(GEN-004), 외부 앱으로의 메시지 전달과 개인정보 약속의 해석 충돌(GEN-002/GEN-005). 자동 네트워크 변경을 위한 관리자 helper·작업 등록과 배포 설정도 승인 범위에 포함한다.
- 배경: [제품 계획](../PRODUCT_PLAN.md)의 세 도구는 브라우저 JS/WASM만으로 원래 핵심 동작을 수행할 수 없다. 단순 확장자 변경, 앱이 열린 동안만 작동하는 네트워크 설정, 범용 클릭 매크로는 대체물이 아니다.
- 제안: 아래의 제한된 캡 계약을 승인한 뒤 ADR → spec → Rust 타입 → 생성 → 구현 순서로 진행한다. 이 문서는 승인 전 제안이며 레지스트리·CSP·ACL·원본 저장소를 수정하지 않았다.
- 검토한 대안: fs/storage만 사용하면 문서의 COM 저장·OS IP 변경·다른 앱 조작이 불가능하다. WASM은 XLSX/PPTX/HWPX의 구조 읽기에 유용하지만 기존 바이너리 형식과 설치 앱의 서식 호환을 대체하지 못한다. Python 웹 서버를 iframe에 그대로 넣는 방식은 origin·IPC·개인정보 규칙을 만족하지 않는다.
- 영향: 새 캡은 각각 1.0.0, SDK는 공개 API 추가로 minor, 앱과 사용자 모듈은 기능 추가에 맞춰 minor 이상을 올린다. 브리지/매니페스트/카탈로그 포맷 변경은 제안하지 않는다. 현재 cap requires 해석기로 구형 호스트를 차단한다. 생성 표를 직접 고치지 않는다.
- 필요한 승인: 프로젝트 소유자가 아래 세 캡의 정확한 메서드·권한·의존성, 제한된 helper 실행/자동 네트워크 변경, 명시적 메시지 전달 예외를 승인한다. 실제 메시지 보내기나 이 PC의 네트워크 변경 시험은 구현 승인과 구별한다.

## 1. 조사 범위와 현 PC

2026-10-11 읽기 전용 조사 기준이다. 원래 흐름의 출처·보존 목록은 [원본 흐름 검토](../reviews/native-tools-original-workflows.md)에 있다.

| 항목 | 확인한 사실 | 아직 확인하지 않은 것 |
|---|---|---|
| 한글·Excel·PowerPoint·Word | HKCR에서 HWPFrame.HwpObject, Excel.Application, PowerPoint.Application, Word.Application의 CLSID 등록이 모두 존재 | COM 인스턴스 생성 성공, 앱 버전/비트수, 실제 변환, 한글 접근 승인 정책 |
| network_routine | 소스 1.4.0, 저장소 HEAD `9bcae0084339fec77b1d4f48da167eaf44f340ee` | 현재 작업 등록·실제 어댑터 상태·권한 변경 성공 |
| CoolReserve | 로컬 소스·README·core/engine/workflows/Gentoo adapter·공개 파일 allowlist | 이 폴더의 Git HEAD(로컬 Git 저장소 아님), 원격 최신 SHA, 현재 로그인 계정·화면 연결 |

등록된 ProgID만으로 지원 완료를 표시하지 않는다. 이 조사에서는 앱 실행, 메시지 입력/발송, 네트워크 변경, 스케줄러 등록, 시스템 프로그램 설치, 인증 파일 읽기를 하지 않았다.

## 2. `office` 1.0.0 — 설치 앱으로 새 형식 저장

| 메서드 | 인자 | 결과 |
|---|---|---|
| `availability` | `{}` | `{providers: OfficeProviderStatus[]}`; provider=hancom/excel/powerpoint/word, registered/ready/blocked, 지원 포맷 enum; 경로 없음 |
| `convert` (long) | `{sourceHandle, batchId, targetFormat, suggestedName}` | `{file: FileHandleInfo, provider, targetFormat, validation: OfficeValidation, warnings: OfficeWarningCode[]}` |

`targetFormat`은 hwpx/xlsx/xlsm/pptx/pptm/docx/docm의 고정 enum이다. 원래 요구는 HWP→HWPX, XLS→XLSX, PPT→PPTX이고 DOC→DOCX를 같은 흐름에 포함하는 안이다. 매크로가 발견되면 손실을 묵인하지 않는다. 기본 xlsx/pptx/docx로 자동 제거하지 않고 해당 항목을 멈춰 보존 포맷 xlsm/pptm/docm을 제시한다. 문서 내용을 Markdown으로 재작성하지 않는다.

호스트는 기존 fs 선택/읽기 핸들과 결과 `batchId`의 소유권·형식을 확인한다. 허가된 원본을 호스트 전용 임시 작업물로 준비하고 별도 고정 helper 프로세스가 새 인스턴스에서 COM Open/SaveAs를 수행한다. 모듈은 COM ProgID·경로·스크립트·명령줄을 보내지 못한다. 생성 결과는 기존 새 파일 게시 서비스의 append-new-only 방식으로 저장하며 원본·동명 결과를 덮어쓰지 않는다. helper에 전달하는 경로는 호스트 내부 전용이고 캡 결과에는 노출하지 않는다.

한 번에 문서 한 개, 앱 전체 변환 한 개, 기존 fs 512MiB/결과 작업 한도를 상한으로 한다. 120초 제한을 기본으로 두고 사용자 승인창이 있으면 기다리는 상태를 표시한다. 취소·시간 초과 시 자신이 시작한 helper와 자신이 만든 앱 인스턴스만 정리한다. 이미 열린 사용자 Excel/한글 프로세스를 taskkill로 종료하지 않는다. 취소 이후 완료 결과를 삭제하지 않는다.

Excel/Word/PowerPoint는 문서 매크로 실행 억제·읽기 전용 열기·외부 링크 업데이트 억제를 적용하고, 지원하는 옵션과 제한을 앱별 시험으로 확인한다. Excel `AutomationSecurityForceDisable`은 Excel 4.0(XLM) 매크로를 억제하지 않으므로 XLM/보안 승인창은 차단·수동 해결로 남긴다. DisplayAlerts=false만으로 보안을 보장하지 않는다. [Microsoft AutomationSecurity](https://learn.microsoft.com/en-us/office/vba/api/excel.application.automationsecurity), [Workbook.SaveAs](https://learn.microsoft.com/en-us/office/vba/api/excel.workbook.saveas), [Presentation.SaveAs](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.saveas).

한글은 [공식 HwpAutomation 안내](https://developer.hancom.com/en-us/hwpautomation)에 따라 Open/SaveAs와 반환값을 검사한다. 파일 접근 승인창을 임의 클릭으로 없애거나 보안 DLL을 몰래 설치하지 않는다. 첫 버전은 사용자가 접근 허용을 확인하는 경로를 제공한다. 자동화 보안모듈 배포가 필요하면 DLL 정확한 출처·해시·아키텍처·라이선스·레지스트리 범위를 별도 승인한다.

결과 검증은 대상 형식 시그니처/ZIP 필수 part 검사와 설치 앱의 다시 열기를 결합한다. 합성 입력에서 본문·표·수식·시트·슬라이드·이미지·주석·머리글과 페이지/슬라이드 렌더를 비교한다. 포맷 변환의 구조 성공과 모든 서식의 동일성은 구별한다. 암호/손상/지원 밖 문서는 실패 항목만 남겨 다시 시도할 수 있게 한다.

## 3. `network` 1.0.0 — 프로필과 제한된 자동 판단

일반 네트워크 어댑터·IPv4 프로필·조건부 적용 프리미티브다. 임의 명령/PowerShell/schtasks XML 실행 캡을 만들지 않는다. UI는 `network-routine` 한 모듈에 모두 둔다.

| 메서드 | 인자 | 결과 |
|---|---|---|
| `adapters` | `{}` | `AdapterInfo[]` (`adapterHandle`, 표시 이름, 타입, 사용 가능 여부) |
| `inspect` | `{adapterHandle, scanWifi:boolean}` | IPv4/DNS/DHCP 상태, 연결/주변 SSID, 위치 권한 상태; 사용자 표시값은 로그 제외 |
| `saveProfile` | `{adapterHandle, internal: Ipv4Patch, external:{address:"dhcp",dns:"dhcp"}}` | `{profileHandle,revision}` |
| `configureRoutine` (long) | `{profileHandle, revision, enabled, rules: NetworkRules}` | `{routineHandle,status: RoutineStatus}` |
| `status` | `{routineHandle?}` | 저장 설정·revision·판단/근거·수동 우선 구간·각 트리거 등록 상태·일반 오류 코드 |
| `evaluate` (long) | `{routineHandle}` | 저장 revision을 기준으로 판단 및 허용된 자동 적용 결과 |
| `apply` (long) | `{profileHandle,mode:"internal"|"external",revision}` | 적용 뒤 읽은 상태와 `manualOverrideSegment`; 실패는 성공 처리하지 않음 |
| `stopRoutine` (long) | `{routineHandle}` | `{stopped:true}`; 소유한 자동 작업만 해제, 현재 IP는 그대로 |

`Ipv4Patch`는 IPv4 주소/마스크 쌍·선택 게이트웨이·0~2 DNS의 구조화 타입이다. DNS만 입력하면 IP는 건드리지 않는다. 빈 필드를 모두 지우기로 해석하지 않는다. 이름만 받은 어댑터를 명령 문자열로 결합하지 않고 OS 식별 핸들을 매 실행 검증한다.

`NetworkRules`는 decisionMode=schedule/hybrid/wifi-only, 요일별 enabled/start/end(7일), internalNames/externalNames의 SSID 집합이다. 전체 이름 최대 각64개·SSID 최대32 UTF-8바이트·중복 내외부 이름 금지. 판단 우선순위는 원본 테스트와 대조한다: 연결 SSID → 주변 단독 일치 → 혼합 모드의 시간표 fallback, 이름만 모드의 모호/불일치는 유지. `schedule`이면 주변 Wi-Fi 검색을 하지 않는다. 야간 경계·합쳐지는 시간 구간·판단 구간이 바뀔 때 수동 우선 해제를 보존한다.

설정/프로필은 소유 모듈로 격리한 호스트 저장소에 보관하고 백그라운드 runner가 같은 schema/core를 읽는다. revision이 달라지면 실행 거부 후 재검토한다. TeacherDeck 메인 프로세스는 일반 권한을 유지하고 네트워크 적용·자동 작업 등록만 고정된 관리 helper에서 UAC 승인으로 수행한다. 학교 정책이 거부하면 상태 조회·설정 편집은 유지하며 자동 전환을 완료했다고 표시하지 않는다.

자동 루틴은 창 종료·PC 재시작 후에도 동작한다. 부팅/로그온/잠금해제/콘솔복귀/해당 Wi-Fi 연결·해제/시간표 경계의 여섯 종류 트리거를 고정 레시피로 등록한다. 사용자 지정 실행파일/인자/이벤트 XML을 받지 않는다. 모드와 관련 없는 트리거는 등록하지 않고 앱 소유 task namespace만 검사/제거한다. 고정 runner 경로·관리 권한·업데이트와 작업의 버전 동기화·자동 중단(권한 revoke/모듈 제거/설정 없음)을 ADR에 넣는다. 앱 종료 후 실행권한은 모듈 설치·권한/설정 revision을 다시 읽어 확인한다.

원본의 관리자 Program Files 설치와 자동 exe 교체기를 복제하지 않는다. 설치본의 고정 helper와 TeacherDeck 업데이트 정책으로 통합한다. 이것은 네트워크 전환의 기능을 빼는 것이 아니라 업데이트/배포 경로를 단일화하는 변경이다. 원본 프로그램의 작업을 삭제/이관하지 않는다. 기존 자동화가 감지되면 중복 전환 위험을 보여주고 사용자가 원본 자동화를 끈 뒤 새 루틴을 켠다.

## 4. `messaging` 1.0.0 — 사용자가 고른 외부 앱의 예약 메시지

범용 키/마우스 매크로보다 좁은 구조화 예약 메시지 프리미티브다. 첫 provider는 `gentoo`만 고정 allowlist한다. 모듈이 executable 경로·좌표·UIA selector·임의 키 입력·DB/비공개 프로토콜을 전달할 수 없다. 기존 CoolReserve 업무 코어가 가져오기/반복/템플릿/중복 잠금을 맡고, 고정 provider adapter가 앱 조작을 맡는다.

| 메서드 | 인자 | 결과 |
|---|---|---|
| `connect` (long) | `{provider:"gentoo"}` | `{connectionHandle,capabilities,ready,versionSupport}`; 사용자가 시작한 연결만 |
| `recipients` (long) | `{connectionHandle}` | `{recipientHandle,displayName,department,accountLabel}[]`; 계정 식별 증거 유지 |
| `plan` | `{connectionHandle,messages:ScheduledMessage[],mode:"simulate"|"inspect"|"prepare"|"register"}` | `{planHandle,preview,expiresAt,issues}`; immutable 내용/수신자/첨부 identity |
| `start` (long) | `{planHandle,confirmation?}` | `{runHandle}`; register는 한 번의 명시적 최종 등록 동작·호스트 확인에 묶음 |
| `status` | `{runHandle}` | 건별 단계/초안/등록요청완료/확인완료/중단/불명, 진행 수, privacy-safe 오류 |
| `cancel` | `{runHandle}` | `{requested:true}`; 현재 Windows 호출 후 중지, 이미 접수된 예약 취소 아님 |

`ScheduledMessage`는 `{id,recipients:recipientHandle[],title?:string,body:string,scheduledAt,attachmentHandles:string[],contentRevision}`이다. 시간은 KST 기준 최소10분 후~3개월, 전체 UI 작업목록500건을 유지한다. 개별 plan은 최대500건 및 직렬화512KiB 이하, 텍스트 합계256KiB 이하로 모두 검증하고 넘치면 UI에서 안전한 하위 묶음으로 나눈다. 조용히 잘라내지 않는다. 첨부 경로 열은 즉시 실행 경로로 쓰지 않고 사용자가 고른 fs 핸들에 명시적으로 연결한다.

조직도 전체 계정·동명이인·본인 연결 증거를 검증하고 제목 공란을 보존한다. 새 메시지/예약표/자료로 메시지 만들기/중식 선택 프리셋/반복/보관함을 한 모듈에 유지한다. 기본 정상 결과는 **등록 요청 완료**이며 수신함 도착이나 기관 서버 접수 조회를 성공 조건으로 꾸미지 않는다. 기존 선택 예약목록 대조 모드도 provider capability가 있을 때 유지한다.

보내기 전 수신자·제목·본문·예약시각·첨부를 다시 읽어 대조한다. 원본의 준비 단계에서만 최대1회 복구를 유지하고 보내기 이후 자동 재시도는 하지 않는다. `begin_submit` 이력은 버튼 누르기 전에 영속화한다. crash/restart/uncertain/보관함 복원/원본업무 삭제 후 재생성에도 잠금을 유지한다. F8와 화면 중지는 같은 cancel flag로 연결한다. 잠금·배율 변경·다른 작성창·계정 변경은 fail-closed다.

원본의 Google Sheets/OAuth 직접 연결은 TeacherDeck 구현에서 비활성화한다. 로컬 Excel/CSV/붙여넣기와 일반/중식 템플릿은 보존한다. Google 직접연결을 유지하려면 별도의 네트워크·인증·제품약속 변경 승인이 필요하다.

### 개인정보 약속의 충돌을 해결할 승인

실제 예약등록은 의도한 수신자에게 본문/첨부를 전하는 업무다. 모듈이나 helper의 직접 인터넷 연결을 막아도 Gentoo에 자료를 넘기는 순간 “파일과 개인정보는 외부로 나가지 않는다”를 무조건 그대로 주장할 수 없다. PRV-001과 기존 제품약속에 사용자 의도에 따른 제한적 외부 앱 전달 예외를 ADR/spec/UI에 명시해야 한다.

권고 문구는 **“변환·분석은 PC 안에서 처리합니다. 쿨메신저 예약 등록은 사용자가 확인한 수신자·내용·첨부를 로그인한 쿨메신저로 전달합니다.”**이다. 임의 HTTP/Google 계정·원격 분석·텔레메트리 허용으로 확대하지 않는다. 이 예외 승인 없이는 모의/검토/준비 UI와 원천 통합 준비까지 가능하지만 실제 예약등록을 완료 기능으로 배포하지 않는다.

## 5. 의존성·helper 배포·원천 계약

| 범위 | 정확한 후보 | 근거와 승인 |
|---|---|---|
| Windows COM/TaskScheduler/IP/UIA FFI | `windows = "=0.62.2"` | 현재 Cargo.lock에 같은 버전 있음. 직접 런타임 의존성 추가는 GEN-004 승인 필요. 기능은 COM/Ole/Variant/TaskScheduler/IpHelper/WLAN/UIAutomation 중 필요한 것만 |
| office helper | TeacherDeck Rust 바이너리 또는 동일 호스트 실행파일의 고정 내부 worker 모드 | 새 외부 실행파일 경로를 모듈에 받지 않는다. stdin/stdout 또는 ACL 제한 pipe, 고정 schema·한도·난수 세션. helper stdout은 개인정보가 담길 수 있으므로 로그에 복사하지 않음 |
| CoolReserve 기존 adapter를 유지하는 첫 경로 | `pywinauto==0.6.9`, `comtypes==1.4.17`, `pywin32==312`, `six==1.17.0` | 원본 requirements와 정확히 일치. Python3.14 x64에서 설치 확인은 원본 README 보고이며 이번 실행 검증 아님. 관리된 helper를 제작하는 경우 runtime/라이선스/해시 전체 승인 필요 |
| network_routine 독립판의 Python 의존성 | 현재 `pywin32>=311` → 릴리스 제작 시 `pywin32==312` 후보 | 상한 없는 원본 요구를 정확 버전 산출물로 고정하는 별도 원천 변경. 이번 문서에서 원본 수정/설치하지 않음 |

우선 Office와 네트워크는 Rust 고정 worker를 권고한다. CoolReserve는 608개 Python/70개 JS 검사라는 원본 보고를 버리고 급히 전면 Rust 재작성하기보다, 같은 코어·adapter를 유지한 관리 helper와 웹 모듈을 먼저 패키징한다. Python runtime의 정확 patch 버전/배포 해시/라이선스와 standalone helper 방식이 아직 확정되지 않았으므로 설치된 임의 Python 경로를 호출하는 방식은 승인안에 포함하지 않는다. helper 패키지 잠금이 완성될 때까지 배포 완료를 주장하지 않는다.

CoolReserve와 network_routine 원천 저장소에 공통 순수 코어·TeacherDeck 프론트엔드·브리지 adapter·기존 독립판 adapter를 둔다. TeacherDeck은 같은 소스의 tag/SHA에서 만든 `.deckmod`와 관련 helper의 정확 버전/sha256만 소비한다. 다른 구현 복사본을 TeacherDeck 안에서 따로 발전시키지 않는다. 원천의 authors/license는 보존한다.

원천 태그의 산출물에는 기존 module.json/requires, SHA256SUMS, `.deckmod`, helper version/hash/지원 OS·아키텍처의 내부 provenance를 둔다. TeacherDeck의 소비 잠금 파일은 내부 빌드 입력이며 공개 매니페스트/카탈로그 포맷을 늘리지 않는다. 고정 산출물 hash 대조 → `.deckmod` 검사 → cap 호환 해석 → 번들에 같은 바이트 포함을 자동 검증한다. source-repo 개선과 소비 변경은 연결된 PR로 리뷰하며 아직 원격 저장소 push/release를 하지 않는다.

## 6. 승인 뒤 완료 증거

1. 세 캡의 정상/권한거부/잘못된인자·다른모듈핸들·revision 불일치·취소/시간초과 검사.
2. Office 합성 HWP/XLS/PPT/DOC 실제 SaveAs·새 파일 재열기·시그니처·원본 SHA 유지·표/수식/이미지 렌더 비교. 암호/손상/XLM/매크로보존·사용자 열린 앱 유지 검사.
3. 네트워크 원본 순수 판단 테스트 이식: Wi-Fi 우선/모호/권한없음, 야간/중첩 경계, 수동유지/구간변경, dirty 설정의 지금검사 차단. disposable 테스트 어댑터/별도 허가 환경에서 적용·6트리거·창종료·재부팅·UAC거부·앱 업데이트 검사.
4. CoolReserve 원본 합성 테스트와 UI 회귀·수신자 동일성·공란제목·복수수신·내용변경/첨부변경 차단·중복잠금·불명 후 재시도 차단·F8 중지·restart recovery. 실제 메시지는 사용자에게 승인받은 본인 시험계정/한건으로만 별도 검증.
5. 세 모듈의 실제 Windows 화면에서 원래 핵심 흐름·입력수·DPI/테마/키보드 검토, `pnpm verify`, 설치본/권한/오프라인/helper 버전/산출물 동일성 검사. 이 문서는 제안 완료이며 도구 구현·실사용 검증 완료가 아니다.
