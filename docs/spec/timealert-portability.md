# TimeAlert 백업·사진 이동 (main 전용)

[ADR-0026](../adr/0026-timealert-portability.md), [승인 제안 1번](../proposals/classroom-portability-presentation.md)을 따른다. 모듈 캡이나 일반 DB API를 추가하지 않는다.

## 입력·세션

`school_data_open_timealert({password})`는 main label과 로컬 셸 origin을 검사한 뒤 네이티브 선택기로 `.teacherbackup`을 읽는다. 취소는 null이다. 암호 UTF-8 1~1,024바이트, 파일512MiB 이하, 헤더는 `TIMEALERT|1|7|YYYY-MM-DD|120000\n`이다. salt16·IV12 뒤의 ZIP은 AES-256-GCM으로 인증되어야 한다. 인증 실패를 틀린 암호나 손상 중 하나로 구체적으로 추측하지 않는다.

ZIP 실제 해제 합계1GiB, 최대20,002개 파일, 사진 하나16MiB/합계256MiB, DB512MiB 이하이다. `database/timealert.db`, 선택적 `database/timealert.db-wal`, `photos/`의 직접 자식 파일만 허용한다. 경로 탈출·중복·연결 파일·불명확한 압축·SQLite 표·기본값·숨김/생성 열·외래키 대상/작용·인덱스 열/순서/고유성/부분 여부·Room 식별자 불일치·스키마7 이외의 입력을 적용 전에 거부한다. DB7의 미편집 정보는 호스트 내부에 보존하고 셸에는 공통 자료와 개수·경고만 공개한다.

동시 열린 원작 세션은 하나이며 새 열기가 이전 세션을 묵시적으로 버리지 않는다. `school_data_close_timealert({sessionHandle})`는 해당 세션의 앱 소유 임시 데이터만 해제한다. 종료 시에도 정리한다. 비밀 암호·DB 경로·비공개 행·사진 원본 경로는 로그·모듈·셸 결과에 포함하지 않는다.

## 적용·출력

`school_data_apply_timealert({sessionHandle,expectedRevision,studentLinks})`는 기존 자료에 검토한 투영을 추가한다. importedStudentId→existingStudentId는 교사가 명시한 연결만 사용하며 이름으로 자동 병합하지 않는다. 잘못된 링크·보관 학기 편집·사진 상한·revision 경합은 적용을 거부한다. 성공 후에만 revision을 증가시키고 같은 세션 중복 적용은 거부한다.

`school_data_export_timealert({sessionHandle?,expectedRevision,password})`는 호스트의 현재 저장 자료와 사진을 새 백업에 담는다. 미저장 화면 초안은 포함하지 않는다. 원작 세션이 있으면 보존 DB의 알려진 변경만 반영하고 나머지 표·열·Room 식별자·기존 관계를 보존한다. 세션이 없으면 알려진 학교 자료로 새 DB7을 만든다. 실제 출력에 담긴 사진을 참조하는 과거 절대 경로만 basename으로 재배치하여 원작 PhotoStore의 고정 photos 디렉터리에서 읽게 한다. 사진 행의 식별자·thumbnailVersion·source와 누락 사진 참조는 유지한다. 원본 OS 경로를 열지 않는다. SQLite snapshot이 WAL의 최신 상태를 단일 DB에 포함하고 새 salt/IV로 암호화한다. 폴더 선택 취소는 false이며 append-new 파일 게시만 사용한다. 오류·취소로 사용자 원본이나 공통 자료를 삭제·덮어쓰지 않는다.

`school_data_import_roster_photos({sessionHandle?,semesterId,expectedRevision,matches})`는 세션이 없으면 네이티브 XLSX 선택과 호스트 사진 세션을 만들고, 세션이 있으면 명시한 대응만 적용한다. 사진은 불투명 key로 식별하며 OS 경로를 사용하지 않는다. 미리보기·명부 검토·사진 선택이 끝나기 전에는 저장하지 않는다. 대상 학기와 revision을 다시 검사하며 다른 학기의 학생 사진이나 보관 학기의 학생 변경은 거부한다.

학교 자료의 부분 일과 시작 교시는 선택적 `fromPeriod`, 날짜를 넘긴 수업 이동은 선택적 `targetDate`로 보존한다. 두 필드가 없는 기존 JSON은 이전 의미를 유지한다. 원작의 쉬는 시간·점심·사적 메모·교실별 시간표 추가 필드는 원형 보존 대상으로 안내하며 현재 공통 화면이 모두 편집한다고 표시하지 않는다.

### 표현할 수 없는 출력 변경

DB7에 대응 필드가 없는 날짜별 `weeklyTableId` 선택은 `INVALID_ARGS`로 출력 전에 거부한다. 원작에 연결된 학생·학기·학적·수업·수업의 학생 연결·일과·주간표·변경 기록 삭제도 비공개 자식 기록의 cascade 삭제를 막기 위해 거부한다. 같은 날짜의 요일 대체·임시 일과 중 한 항목을 취소하면 해당 알려진 변경 행만 제거하며 다른 종류의 변경은 보존한다. 일반 주간표 이름과 담임 그룹의 사용자 지정 표시 이름은 원작에 대응 열이 없어 원작 표현으로 복원된다.

사진명렬표는 XLSX 32MiB·XML 합계16MiB·사진/대응 최대1,000개를 사용한다. 기존 OOXML 원천 규칙의 유일한 앵커만 자동 선택하고 겹친 사진·동명이인·일반 표의 불명확한 좌표는 직접 선택하도록 남긴다. 사진 원본은 호스트가 보관하고 셸에는 불투명 key와 최대8KiB PNG 미리보기만 전달한다. 적용 세션은 최초 revision에 고정되며 경합 뒤 최신 revision으로 재지정하지 않는다. 오류에는 세션을 유지하고 성공이나 명시적 닫기 뒤 해제한다.

## 한계

지원되는 원천은 현재 원작 DB7/TIMEALERT v1이다. Android 실기와 이전 DB 마이그레이션은 검증 결과가 없으면 호환 완료로 표기하지 않는다. 알림·오늘 시간표·출결 기록 구현은 별도 단계다.
