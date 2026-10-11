# 학교 공통자료 (school-data 1.0)

[ADR-0020](../adr/0020-school-data.md), [승인 제안서 A](../proposals/classroom-foundation-next.md)에 따른 셸 소유 자료다. PRV-007의 예외는 이 명세의 명시적 grant를 가진 읽기에 한정한다. 일반 모듈 storage·사용자 파일·다른 도구 기록을 공유하지 않는다.

## 자료와 수정

`SchoolDataDocument`는 version1·revision, 학기, 학생 master, 학기별 enrollment, 우리 반/수업 context의 enrollment 연결, 사진 metadata, 시간표를 갖는다. 학적은 학기·학년·반·번호로 중복을 검사하고 동일 이름은 허용한다. 학생 이름·학적 외 개인정보 필드는 타입에서 제외한다. 날짜는 ISO YYYY-MM-DD, 시간은 자정부터 분, 요일은1~7이다. 기간표는 시작·끝 날짜를 모두 가지며 기본 주간표와 별도로 보존한다. 날짜 override는 요일 대체와 일과표·주간표 선택을 따로 가진다. 날짜별 수업 변경은 MOVE/CANCEL/ADD와 changeGroupId를 보존한다.

셸은 `school_data_load/save`로 관리하며 저장은 expectedRevision이 일치할 때만 원자적으로 적용한다. 실패·손상 자료는 빈 자료로 자동 교체하지 않는다. 학생/학적/수업 연결에 없는 식별자와 서로 다른 학기 연결을 거부한다. 보관한 학기는 읽기 전용으로 표시하고 내용을 바꾸지 않도록 검사한다. revision은 자료가 바뀔 때만 증가한다.

학교 저장 자료의 손상·읽기 실패는 학교 기능만 오류 상태로 만들고 앱 시작과 다른 도구 사용을 막지 않는다. 일반 저장·권한 요청은 잠그며 trusted JSON 선택과 명시적 확인을 거친 복구만 허용한다. 복구 전 app-owned 손상본을 별도 새 파일로 보존하고, 원자저장 성공 뒤에만 잠금을 해제한다. 복구에서는 이전 grants를 모두 폐기한다. 사진 metadata는 기존 호스트 소유 사진 파일의 크기·파일 유효성을 확인할 수 있을 때만 연결한다. JSON이 사진 바이너리까지 복원한다고 표시하지 않는다.

최대 학기32개·학생10,000명·enrollment20,000개·context1,000개, context별 학생1,000명, 학기별 수업100개, 일과표32개/64교시, 주간표32개/105칸, 날짜 override·변경 각각2,000개다. 문자열 이름40자·이름표80자, 사진 한 장16MiB·합계256MiB다. 저장 JSON과 trusted 명령 입력은32MiB 이하, 모듈 조회 응답은 기존 브리지 상한 이내로 제한한다. 상한을 넘으면 자료를 자르지 않고 실패한다.

## 모듈 읽기 계약

`status`는 본인 grants·scopes·context summaries·revision만 반환한다. 미허용이면 학생이나 타 모듈의 권한 정보를 반환하지 않는다. `requestAccess`는 kinds/scopes/remember를 받고 long 요청으로 셸 확인을 기다린다. 본인 모듈의 실행 권한을 재검사한 뒤 신뢰 셸에서 학기·context·scope를 선택한다. 요청하지 않은 scope·kind를 추가할 수 없다. 취소·언로드·확인 대기 만료에는 grant를 발급하지 않는다. contexts가 없으면 허용할 수 없으며 자료 등록 안내를 제공한다.

`listContexts({grantHandle})`, `readRoster({grantHandle,contextId,expectedRevision?})`, `readTimetable({grantHandle,semesterId,expectedRevision?})`는 소유 모듈·기억 여부·context·scope·현재 자료를 매번 검사한다. revision 불일치는 BUSY로 반환하고 재읽기를 요구한다. 명부 snapshot은 당시 학기·context·학적·이름을 고정하며 사진 scope가 없으면 photoHandle을 생략한다. 시간표는 허용된 학기·context에 필요한 수업만 projection한다. 출결·생일·연락처·관찰 기록·다른 도구 기록·원본 경로를 반환하지 않는다.

`openPhoto({grantHandle,snapshotId,photoHandle})`는 사진 scope와 같은 소유자·grant의 살아 있는 snapshot을 요구하고 불투명 resourceHandle·인증URL·크기·mimeType·청크크기를 반환한다. `closePhoto({resourceHandle})`로 해제한다. JPEG·PNG·WebP만 수용하며 사진4개/모듈·5분 미사용 만료와 기존 offset/length 최대256KiB 읽기를 유지한다. URL 요청에서도 소유 모듈 origin·활성 캡·grant·scope를 검사하고 철회 이후 읽기를 거부한다. 사진 리소스는 기존 fs 선택 권한으로 바뀌지 않는다.

명부 snapshot은 모듈별 최대16개·생성 후5분으로 제한한다. 사진 id와 grant/resource 토큰은 호스트가 생성한32자리 소문자16진수다. context id가 같은 값으로 학기나 종류를 바꿔도 기존 grant의 의미가 확장되지 않는다. 철회·언로드에서 리소스에는 즉시 거부 tombstone을 두고 기존 파일 읽기 세션을 닫은 뒤 제거하여 fs 통로로의 재해석 경합을 막는다.

`revokeAccess({grantHandle})`는 본인 grant·snapshot·사진 리소스를 폐기한다. 신뢰 셸은 전체 grants를 확인하고 철회할 수 있다. 기억한 grant만 앱 재시작에 복원하고 복원 이후 매 조회에서 context 존재와 범위를 다시 확인한다. 일시 grant와 모든 snapshot/사진 리소스는 언로드에 폐기한다. 이미 교사가 모듈 작업에 저장한 snapshot을 철회로 삭제하지 않는다.

## 셸 전용 명령과 화면

자료 관리의 학기·명부·우리 반/수업·일과표·시간표 편집과 권한 확인은 main 창의 셸 origin만 사용한다. module payload의 자기 신고나 module iframe이 보낸 승인 메시지를 신뢰하지 않는다. `school_data_pending/resolve_access/grants/revoke_grant/import_photo`는 native Webview label과 URL을 검사한다. 신뢰 화면에서 도구 이름·학기·대상·읽기 필드·기억 여부를 보여준다. 사진 선택은 네이티브 picker에서 사용자 선택 파일을 읽기만 하며 호스트 소유 사진 저장소에 새 식별자로 복사한다.

trusted 명령은 `load`, `save`, `pending`, `resolve_access`, `grants`, `revoke_grant`, `import_photo`, `read_backup`, `recover`, `read_workbook`, `write_workbook`의11개이며 모두 `school_data_` 접두사를 쓴다. JSON 복구와 XLSX picker도 동일 native label/origin 검사를 적용한다. 명부와 허용 context 목록은50개 단위로 표시하며 검색으로 좁힐 수 있다. 학기 추가 이후 관리 패널을 접고 명부 입력을 먼저 보여준다.

네 교실 도구는 등록 자료 사용을 기본 선택으로 제시하고 이번 작업에만 사용을 고를 수 있다. 선택한 context를 명시적으로 읽어 새 작업 명단에 적용하며 기존 수행/확정 이력을 보존한다. 공유 미허용이나 미등록 상태가 도구의 임시 명단 사용을 막지 않는다. 요청 거부·취소·조회 실패로 기존 작업을 바꾸지 않는다.

## 검증과 호환 범위

합성 자료로 동명이인·복수 수업·학기 전환·중복 학적·기간표·요일 대체·MOVE/CANCEL/ADD 구조를 검사한다. 다른 모듈 grant·잘못된 scope·철회·재시작·언로드·revision 경합·잘못된 식별자·손상 저장·사진 scope와 리소스 origin을 검사한다. 순수 명부 도구의 기존 임시 작업 회귀와 셸의 입력→저장→권한 확인→명부 연결 흐름도 확인한다.

XLSX는 원본의 첫 선언 시트·workbook 관계·sharedStrings·inlineStr·병합 셀을 해석한다. 기존 사진 추출의 검증된 DOMParser/관계/명부 코드를 재사용하며 DTD·외부 관계·ZIP 내부 루트 탈출을 거부한다. 합법 OPC root-relative 관계(`/xl/...`)는 ZIP 내부에서만 정규화한다. native ZIP 읽기는 모든 엔트리의 실제 압축 해제 합계32MiB·최대4,096개, XML 하나4MiB·XML 합계16MiB, 표20,000행·512열·100,000셀로 제한한다. 파일을 고른 뒤 학생/수업 수·처음20줄·경고를 미리 보여주고 명시적으로 적용한다. native 선택 취소와 미리보기 취소·읽기 실패로 기존 자료를 바꾸지 않는다.

학생 파일은 원본 표준 학년/반/번호/이름과 머리글 별칭,5자리 학번, 사진명렬표 학생 텍스트를 읽는다. 원본 가로 요일 격자·전치 격자·기존 목록형 시간표와 병합 교시 그룹을 읽는다. 목록형의 분반 열은 원본 Android 파서가 버리던 값이지만 TeacherDeck에서는 별도 수업 이름에 보존한다. 알려진 학급 표기와 일치하는 학생만 연결하며 새 수업의 명부는 교사가 확인한다. 원본 학생·격자 시간표와 같은 열·시트 이름으로 양식과 현재 기본 자료를 XLSX로 내보낸다. inline string으로 써 수식처럼 시작하는 이름도 실행하지 않는다. native 폴더 선택 후 기존 journaled append-new 출력으로 원자 게시하고 같은 이름은 새 번호를 붙여 원본 파일을 보존한다.

XLSX 사진 바이너리는 자동 등록하지 않으며 파일 사진 수와 학생별 사진 선택 안내를 표시한다. XLSX는 기본 주간표만 담으며 학기 전체 구조·일과 시각·날짜 변경·학생 master/수업 연결·사진의 무손실 백업으로 표시하지 않는다. 원본 TimeAlert의 Android DB/.teacherbackup 전체 호환(B), 알림, 별도 확장 창(C)은 이번 구현에 포함하지 않는다.
