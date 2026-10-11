# time_alert 학급·시간표·파일 계약 조사

조사일: 2026-10-11. TeacherDeck 기준: `0f65516`. 원본: 로컬 `time_alert`, SHA `2dd12adf85aadbc02794dd6ed4d91e6e1c3b6b2b`, 조사 시 working tree 변경 없음. 원본을 수정하지 않았다. 이 문서는 소스 조사 결과이며 Android↔Windows 실제 왕복 검증 결과가 아니다.

원본 상대 경로의 기준은 `time_alert/app/src/main/java/com/timealert/teacher/`다. 원본 경로·학교 식별 정보·실제 학생 자료를 저장소에 복사하지 않는다.

## 1. 핵심 경험과 호환 기준

| 원래 동작 / 근거                                                      | TeacherDeck에서 유지할 경험                                                              | 주의할 계약                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `feature/students/RosterImportViewModel.kt`, `RosterImportSheet.kt`   | 우리 반 / 내 수업을 대상으로 XLSX 선택 → 명단·사진 미리보기 → 등록 → 추가·갱신·연결 요약 | 사진 포함 선택, 기존 자료 변경 미리보기, 다른 학년·반 행의 제외 안내                                                               |
| `core/data/StudentRepository.kt`                                      | 한 학생을 여러 분반에서 사용                                                             | 학기·학년·반·번호로 대조. 이름만으로 합치지 않음. 파일 내 같은 학번은 뒤의 값, 같은 학번의 다른 이름은 정정으로 처리하는 원본 정책 |
| 같은 저장소의 `importToHomeroom`                                      | 파일에 없는 기존 학생·기록 보존                                                          | 원본의 `overwrite=true`도 담임 학생을 삭제하지 않음. 파일에 없는 학생을 남기고 경고                                                |
| 같은 저장소의 `importToDivision`                                      | 분반의 현재 명단 교체                                                                    | 파일에 없는 분반 연결만 해제, 전역 학생 레코드는 보존. 학기별 과거 확정 기록은 별도 스냅샷 유지                                    |
| `feature/timetable/ImportTimetableViewModel.kt`                       | 파일 선택·표 붙여넣기 → 해석 미리보기 → 등록 → 완료 확인                                 | 파일 선택만으로 저장하지 않음. 오류 화면 안에서 같은 양식을 저장해 다시 시도                                                       |
| `feature/timetable/PasteTimetableSheet.kt`                            | 표를 통째로 붙여넣고 방향 자동 해석                                                      | 입력 수정 시 이전 미리보기 폐기. 등록 후 완료 화면을 사용자가 닫음                                                                 |
| `feature/timetable/TimetableViewModel.kt`                             | 주간 보기·직접 편집·수업 도장으로 여러 칸 배치·가져오기 되돌리기                         | 원본의 과목 기준 분반 묶기에는 정보 손실 한계가 있음. 아래 3절 참고                                                                |
| `core/engine/DayScheduleResolver.kt`                                  | 일과표와 수업 배치를 함께 적용                                                           | 일과 시각과 수업 배치의 2축. 일정 조회·편집 범위에서 유지. 알림 예약 제외                                                          |
| `core/export/TimetableImageExporter.kt`                               | 격자 XLSX와 PNG로 내보내기                                                               | 원본 XLSX는 기본 주간 시간표. 특정 주 날짜 변경 내보내기로 혼동하지 않음                                                           |
| `core/backup/BackupManager.kt`, `feature/settings/BackupViewModel.kt` | 암호 입력 → 전체 백업 파일 가져오기 / 같은 형식으로 내보내기                             | 백업 전체 DB·사진·미편집 기록 보존. 파일 교환이며 자동 동기화 없음                                                                 |

## 2. 데이터의 정확한 경계

`core/database/entity/SchoolEntities.kt`, `StudentEntities.kt`, `TimetableEntities.kt`에서 확인했다.

| 원본 테이블 / 핵심 필드                                                                                                                                     | 의미 / 보존 요구                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `school`: id, name, educationOfficeCode?, schoolCode?, isDefault, displayOrder, active                                                                      | 학교를 등록하지 않아도 내부 기본 학교로 시작                                                                                |
| `academic_year`: id, year; `semester`: id, academicYearId, schoolId, type, startDate, endDate, archived, readOnly                                           | 학년도·학기·학교 식별을 명단과 일정의 공통 문맥으로 사용                                                                    |
| `student`: id, name, birthday?, createdAt, archived                                                                                                         | 학기를 넘어 유지되는 학생 마스터                                                                                            |
| `student_enrollment`: id, studentId, semesterId, grade, classNumber, studentNumber, displayStudentCode, status, validFrom, validTo?, muteAbsenceStreakAlert | 학기별 학적. status는 ACTIVE / TRANSFERRED_IN / TRANSFERRED_OUT / HIDDEN. 교실 배정 모듈에는 알림 설정·생일을 제공하지 않음 |
| `division`: id, semesterId, subjectName, divisionName, classroom?, colorToken?, attendanceEnabled, temporary, reminderEnabled, kind, gradeLevel?            | REGULAR / AFTER_SCHOOL / CLUB. temporary 수업은 명단·출결 회차 없이 그날 쓰는 수업이며 새 도구의 임시 명단과 다른 개념      |
| `division_enrollment`: id, divisionId, studentEnrollmentId, validFrom, validTo?                                                                             | (divisionId, studentEnrollmentId) unique. 원본 현재 조회는 기간을 사용하지 않음. 임의로 완전한 역사 명부라고 해석하지 않음  |
| `student_photo`: id, studentId, originalFilePath, thumbnailVersion, source?                                                                                 | 호환 DB에는 원본 필드 보존. Windows 모듈에는 경로 대신 사진 핸들/인증 리소스만 제공                                         |
| `day_schedule_template` + `period_slot`                                                                                                                     | NORMAL / TEMPORARY 일과표. CLASS / BREAK / LUNCH / HOMEROOM / CUSTOM 슬롯. 교시 번호는 비수업 슬롯에서 null 가능            |
| `weekly_table` + `weekly_entry`                                                                                                                             | BASE / RANGED 표. RANGED는 기간 안에서 BASE 전체를 대체, 일부 칸 패치가 아님                                                |
| `day_override`                                                                                                                                              | 학교·날짜·종류 unique. 요일 대체와 임시 일과표를 동시에 적용 가능. 임시 일과표는 fromPeriod 이후 부분 적용 가능             |
| `date_override`                                                                                                                                             | MOVE / CANCEL / ADD. 맞바꾸기는 같은 changeGroupId의 MOVE 2건. 그룹 단위 되돌리기                                           |
| `exam_period`, `calendar_memo` 등                                                                                                                           | 현재 편집하지 않는 데이터라도 백업에서 제거하면 안 됨. 날짜 메모는 학기와 독립                                              |

`AppDatabase.kt`의 현재 Room 스키마는 7이고 31개 엔티티를 포함한다. `app/schemas/.../1.json`부터 `7.json`까지 버전별 스키마가 있다. 출결·수업 회차·수업 기록·학생 메모·상담·연락처·감독·행사·창체·비정규 수업도 백업 보존 대상이다. 교실 배정 도구에 이 정보의 읽기 권한을 자동으로 주지 않는다.

`core/database/Converters.kt`: LocalDate/LocalTime/LocalDateTime은 ISO 문자열, Instant는 epoch milliseconds, DayOfWeek는 1~7 정수다. SQL 컬럼 이름·enum 문자열·null·기본값·FK·인덱스·`room_master_table`·`PRAGMA user_version`까지 호환 계약에 포함한다.

## 3. 같은 XLSX 입력·출력

`core/office/StandardTemplates.kt`, `XlsxReader.kt`, `NeisRosterReader.kt`, `NeisRosterImporter.kt`, `TimetablePasteParser.kt`, `TimetableImageExporter.kt`가 원천이다.

- 학생 명단: 시트 이름 `학생 명단`, 열 `학년 / 반 / 번호 / 이름`. 머리글 앞 제목 행 허용. 공백·별표 제거 후 이름/성명/학생이름/학생명, 반/학급/반명, 번호/출석번호/학생번호를 받아들임. 분리 숫자 열이 없으면 5자리 학번(학년1·반2·번호2) 지원. 범위는 학년1~9, 반·번호1~99.
- 시간표 현재 양식: 시트 `시간표`, 첫 행 빈 칸+월~금, 첫 열 교시, 수업 셀 `과목 반 교실`. 공강은 빈 칸. 제공 자산의 입력 시트·작성 안내 시트도 함께 보존할 대상이다.
- 이전 시간표 양식: `요일 / 교시 / 과목 / 분반 / 교실` 목록형도 유지. 교시는1~15, 요일은월~일, 중복 요일·교시는 먼저 나온 수업을 남기고 경고.
- 알려진 한계: 목록형 파서는 `분반` 열을 결과에 싣지 않는다. 격자 파서의 ParsedLesson도 subject+hint이고, 등록은 과목 이름으로 분반을 묶는다. 원본 격자 XLSX가 항상 분반 ID까지 무손실 왕복하는 것은 아니다. 같은 파일을 읽는 범위와 무손실 전체 백업을 구분해서 검증해야 한다.
- 일반 XlsxReader는 workbook 관계를 통해 첫 선언 시트를 찾고 sharedStrings·inlineStr·병합 셀을 해석한다. 펼친 ZIP 합계32MiB, 최대20,000행·512열. 사진 전용 reader는 sheet1/drawing1에 더 강하게 의존한다.
- 사진 명렬표: 학생 텍스트 셀을 명단의 기준으로 삼아 사진 없는 학생도 유지. 사진 앵커와 같은 열·다음 행 학생 매칭 후 순서·거리 폴백. 폴백을 확정 매칭으로 조용히 취급하지 않음. 미연결 사진도 독립 추출 결과에 보존해야 함.
- 내보낸 시간표 XLSX는 같은 격자형·스타일로 재입력할 수 있고 기본 주간표를 담는다. 전체 일정 예외·일과 시각·명부를 전부 담는 형식은 아니다.

## 4. .teacherbackup 바이트 계약

`core/backup/BackupManager.kt`가 정의한 형식이다.

1. UTF-8 평문 한 줄: `TIMEALERT|1|<DB스키마버전>|<YYYY-MM-DD>|120000\n`.
2. salt 16바이트, IV 12바이트.
3. PBKDF2WithHmacSHA256, iterations는 헤더, 256비트 키.
4. AES/GCM/NoPadding, 인증 태그128비트. 암호문은 ZIP payload다. 원본은 header를 AAD에 넣지 않는다. Windows가 AAD를 새로 추가하면 원본 앱이 복원하지 못함.
5. ZIP: `database/timealert.db`, 존재 시 `database/timealert.db-wal`, `photos/<원본파일명>`. 원본 주석과 달리 실제 createBackup 코드는 SHM을 추가하지 않는다.
6. 백업 직전 WAL FULL checkpoint. 복원은 형식·DB 버전 사전 확인 후 임시 추출하고 DB 교체. 원본 UI는 복원 후 앱 재시작을 안내한다.

Windows에서는 선택한 백업을 덮어쓰지 않는다. 앱 소유 staging에서 GCM 인증을 끝까지 확인한 뒤에만 읽고, 허용 ZIP 엔트리·개수·누적크기·중복·경로침범을 검사한다. DB/WAL 일관성을 확인하고 미지원 표를 재생성하지 않는다. DB 버전과 Room 메타데이터를 보존하며 지원 버전의 알려진 필드만 명시적 트랜잭션으로 바꾼다. 새 파일에는 새 salt/IV를 쓰므로 암호문 바이트 동일성은 비교 기준이 아니다. 복호화한 논리 테이블·사진 바이트·미편집 필드 동일성을 검사한다.

DB의 사진 경로는 Android 내부 경로 문자열이므로 Windows가 직접 열 경로로 사용하면 안 된다. 승인 후 정확한 사진 매핑·원본 앱의 파일 경로 재연결을 소스·Android 왕복으로 검증한다. 원본 앱 전체 백업의 사진 호환을 이 조사만으로 통과 처리하지 않는다.

## 5. 교실 도구 아이디어 출처와 수정 요구

오늘의교실과 우리반스튜디오의 `src/core.js`, `src/app.js`를 읽기만 했다. 개인정보 자료·시연 명단은 가져오지 않았다. UI 전체·JSON 저장 형식을 그대로 이식하지 않는다.

| 도구        | 참고 가능한 실제 로직                                                                        | 사용자 요구에 맞춰 바꿀 부분                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 자리 배치   | 사용 불가 좌석, 학생 고정, 앞줄·분리, 자리 교환 후 불변식 검사, 확정 이력에 당시 이름 보존   | 고정·제외 우선. 실패를 조건 불가능과 탐색 시간초과로 구분. 직접 수정도 조건 검사                                                         |
| 발표자 뽑기 | pendingPick과 실제 drawEvents 분리, baseCounts+발표 완료 횟수, 라운드 제외, 총횟수 최소 후보 | 선정·재추첨·건너뛰기로 횟수 증가 금지. 발표 완료와 되돌리기에 이벤트 ID·중복 방지                                                        |
| 모둠 만들기 | 고정 학생·고정 모둠·분리 조건·정원·직접 이동/교환·이전 조합 회피                             | 원본은 고정 모둠 크기도 floor/ceil 균등에 맞아야 함. TeacherDeck은 교사 고정이 균등보다 우선이므로 균등을 soft 조건으로 낮춤             |
| 역할·당번   | 업무 정원·고정·제외·직접 교환·이력 스냅샷                                                    | 원본은 역할별횟수·업무 weight 비용+모든 학생 배정. 기본은 실제 수행 총횟수 최소부터 필요한 인원만 선발. 역할별 균등·업무부담은 선택 조건 |
| 학생 화면   | 공개 payload를 별도 구성                                                                     | 교사 메모·제외 이유·집계·연락처는 payload에 금지. 로컬 복제/확장만 지원                                                                  |

## 6. 완료를 입증할 최소 검사

합성 명단·사진·시간표·DB만 사용한다. 등록되지 않은 명단으로도 네 도구의 입력→조건→결과→저장 흐름을 먼저 검증할 수 있다.

- 같은 학생의 다중 수업·학기 전환·동명이인·이름 정정·전출/숨김·파일 중복 정책 검사.
- 정상/부분 임시 일과표 × 기본/기간표 × 요일 대체 × 이동/맞교환/취소/추가의 기존 순수 엔진 기대값 비교.
- 원본 양식 자산+서로 다른 합성 사진을 넣은 XLSX의 원본/TeacherDeck 결과 비교. 이전 목록형의 분반 누락도 명시적 기대값.
- 원본 Android 생성→Windows 열기/알려진 필드 수정→새 .teacherbackup 생성→Android 복원. 역방향도 확인. 버전1~7의 마이그레이션 체인·Room 검증까지 통과 전 지원 버전 확정 금지.
- 출결·메모·연락처·감독 등 미편집 테이블, null·enum·외래키·사진 바이트·인덱스·Room identity 보존 비교.
- 잘못된 암호·GCM 태그·손상 WAL·ZIP 중복/경로침범/팽창·미지원 미래 버전·실패 중단에서 기존 자료 불변.
- 총횟수 균등보다 교사 고정 우선, 초안/재추첨으로 집계 변화 없음, 수행 완료 중복 없음, 명단 갱신 후 이전 결과의 당시 정보 보존.
- 키보드·150% 글자·200% DPI·밝고 어두운 테마·복제/확장 실제 화면 확인. 전체 통합 담당자가 `pnpm verify` 수행.

구현 승인 대상은 [공통 기반 제안서](../proposals/classroom-foundation-next.md)에서 분리한다.

## 7. 임시 명단 도구 구현 중간 검증

2026-10-11 기준 발표자·역할·모둠의 임시 명단 기능을 구현했다. 새 공유 권한·time_alert 백업 어댑터·별도 확장 출력 창은 이 검증 범위에 포함하지 않는다. 세 모듈은 기존 storage/fs/window 캡만 사용하며 첫 진입에는 명단 입력을 먼저 제공한다.

- 명단1,000명, 발표·역할 실제 완료 기록10,000건, 역할100개·필요인원 합계1,000명으로 입력과 백업 디코더 상한을 통일했다.
- 한 번의 선정·배정과 UI 갱신에서 총횟수 맵을 재사용한다. 합성 1,000명+10,000기록 선정 약1ms, 전원 역할배정 약38~84ms, 1,000명 모둠 편성 약2~4ms를 현재 PC의 Vitest에서 측정했다. 이 수치는 학교 PC 성능 보장이 아니다.
- 모둠은 고정 모둠 크기를 균등보다 우선하며 학생 분리·고정 충돌·수동 이동·교환을 검증한다. 1,000명·200쌍 분리 조건의 합성 편성도 검사한다.
- 반복 이력 문자열을 사전·정수 튜플로 무손실 보존하고 기존 storage 한도 안에서 세대별 청크와 최종 참조 전환으로 저장한다. 구 단일 JSON 읽기를 유지하며 손상 자료는 명시적 확인 후 복구 저장이 성공했을 때만 잠금을 푼다.
- 1,000명 모둠 명단의 확정 이력20건은 합성 자료에서 압축512,858바이트로 왕복했다. 전체 저장 한도와 각 청크 크기를 검사하고 저장 실패 시 이전 자료를 유지한다. 기록을 조용히 줄이지 않는다.
- 세 도구의 최초 입력·선정/배정·실제 완료/확정·되돌리기·공개 화면·손상 복구에 UI 테스트를 추가했다. 통합 담당자가 실제 브라우저와 전체 `pnpm verify`를 마무리한다.

## 8. 승인된 공통 자료 A의 파일 교환 검증

2026-10-11 공통 자료 A 구현은 `school-data`의 명부·수업·시간표와 도구별 읽기 허용을 포함한다. 원본 XLSX의 ZIP 읽기는 기존 호스트 zip 구현을, XML 해석과 사진 명렬표 학생 텍스트 추출은 기존 photo-extract의 DOMParser·명부 해석을 재사용했다. 표준 XLSX 출력은 같은 시트명·열 순서로 새 파일을 만들며 원본 파일을 바꾸지 않는다.

- 원본 `nextclass_student_roster_template.xlsx`를 읽기 전용으로 해석해 첫 시트 학생 명단 7행·학생 2명·경고 0건을 확인했다.
- 원본 `nextclass_timetable_template.xlsx`를 읽기 전용으로 해석해 첫 시트 시간표 13행·수업 2개·경고 0건을 확인했다. 원본 자산·명단·학교 정보는 저장소에 복사하지 않았다.
- 합성 검사로 네임스페이스·공유 문자열·인라인 문자열·학번·목록형/격자형/전치형/병합 셀 시간표, OPC 루트 상대 관계 경로, ZIP 경로 침범·DTD 거부를 검증한다. 기존 목록형의 분반 열 누락은 TeacherDeck에서 보존하는 차이로 명시한다.
- 네이티브 파일 선택 취소·가져오기 미리보기 취소는 기존 자료를 보존하고, 확인 뒤에만 명부를 적용한다. 권한·revision·재시작·사진 snapshot 격리·손상본 별도 보존과 명시 복구를 호스트 범위 검사로 검증했다.
- 부모의 실제 브라우저 검사에서 2학급·3명 등록, 휠 스크롤과 120% 확대를 확인했다. 통합 검증과 최종 설치본 검사는 전체 작업 담당자가 수행한다.

이 결과는 표준 명부·주간 시간표 XLSX의 지원 증거다. 사진 바이너리 자동 연결, Android 전체 백업 왕복, 암호화 `.teacherbackup`, 별도 확장 창과 알람은 포함하지 않는다. 기존 XLSX의 모든 시각적 스타일을 그대로 복제했다고 주장하지 않는다.
