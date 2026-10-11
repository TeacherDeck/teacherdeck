# 네이티브 도구 원본 흐름 검토

조사일: 2026-10-11. 읽기 전용 조사이며 실제 변환·네트워크 변경·메시지 입력/등록 시험은 하지 않았다. [캡·승인 제안](../proposals/native-tools-next.md)과 함께 읽는다.

## 1. 출처와 추적 범위

| 도구 | 조사한 원천 | 식별 상태 |
|---|---|---|
| 문서 형식 바꾸기 | `docs/PRODUCT_PLAN.md` 3절·Microsoft 공식 SaveAs/AutomationSecurity·Hancom HwpAutomation | 새 도구 요구. 이 PC의 네 프로그램 CLSID 등록 확인. 실제 COM 실행 미확인 |
| 네트워크 루틴 | `D:/codex_work/network_routine/README.md`, `network_routine.py`, `requirements.txt`, 기존 테스트 파일의 존재 | APP_VERSION 1.4.0; HEAD `9bcae0084339fec77b1d4f48da167eaf44f340ee` |
| CoolReserve | `D:/chatgpt_work/CoolReserve/README.md`, `server.py`, `app/engine.py`, `app/workflows.py`, `app/windows.py`, `app/gentoo.py`, `requirements.txt`, `public-release.json` | 로컬 폴더는 Git 저장소가 아니므로 HEAD 확인 불가. 읽은 소스의 범위로만 판단 |

CoolReserve dist·사용자 outputs·인증/설정 파일을 조사하지 않았다. README의 과거 실사용/검사 건수는 원본 프로젝트의 보고이며 이번 작업의 검증 결과가 아니다.

## 2. 원래 경험을 보존할 대응표

| 도구·기능 | 원래 동작 | TeacherDeck 화면·호스트 대응 | 완료 판단 |
|---|---|---|---|
| Office 입력/출력 | 기존 문서를 실제 앱에서 새 형식 저장 | 파일 드롭 → 자동 대상 형식 → 저장폴더 → 일괄변환. 비표준 항목만 해결 | 새 포맷의 실제 파일 재열기, 원본 SHA 동일 |
| Office 매크로 | XLS/PPT/DOC에 매크로가 있을 수 있음 | 매크로 감지 항목만 보존 포맷 선택 안내. 기본 형식에 조용히 삭제하지 않음 | macro-enabled 출력과 코드 실행 억제 확인 |
| 네트워크 프로필 | 내부 IP/마스크/게이트웨이/DNS; 외부 DHCP | 상단 어댑터/현재상태, 프로필 카드, 내부망/외부망 수동 버튼 | 입력한 필드만 변경; 실제 상태 재조회 |
| 자동 판단 | 시간표만 / 시간표+이름 / 이름만 | 같은 모듈의 기준 선택, 불필요 입력 비활성화 | 원본 `current_decision_info`와 동일 판정 |
| Wi-Fi 근거 | 연결 SSID가 우선, 주변 단독 일치; 모호하면 fallback 또는 유지 | 현재 판단 배지와 근거, 위치 권한 안내 | 권한없음/모호를 임의 내부망으로 정하지 않음 |
| 요일 일과 | 기본 출퇴근시각을 각 요일에 적용, 요일별 수정 | 기본 시각+요일별 펼침 표 | 자정넘김·붙는 구간까지 원본 기준 |
| 수동 전환 | 적용 후 현재 판단구간 자동 덮어쓰기 차단 | 수동 버튼 바로 실행·유지 상태 표시 | 구간 변경에만 우선 해제 |
| 저장/지금검사 | 저장 및 반영은 task 동기화; 지금검사는 저장 설정 | 하단 주 버튼 저장 및 반영, 보조 지금 검사; dirty 표시 | 미저장 상태에서 검사로 몰래 저장하지 않음 |
| 앱 종료 후 자동 | 부팅/로그온/잠금해제/콘솔복귀/Wi-Fi/시간경계 | 고정 background runner; 상세 등록상태는 펼침 영역 | 창종료·재부팅 후도 재검사 |
| 권한/업데이트 | 원본은 앱 전체 관리자와 자체 exe 교체 | 일반 TeacherDeck+좁은 UAC helper, 앱 업데이트로 통합 | UAC거부 명확, 원본작업 자동 삭제 없음 |
| CoolReserve 첫 연결 | 로그인+조직도 전체표시, 계정 불러오기·동명이인 확인 | 초기 연결 안내와 조직도 계정 불러오기 유지 | 실제 계정 binding 없으면 등록 차단 |
| 세 입력방식 | 새 메시지 / 예약표 가져오기 / 자료로 만들기 | 한 모듈의 입력 방식 선택과 공통 미리보기 | 원본 Excel/CSV/붙여넣기·열이름 해석 유지 |
| 공동 수신/제목 | 복수 수신 계정; 제목 선택, 공란 실제 입력 | 공통 편집 및 목록의 제목없음 표시 | 표시문구를 실제 제목으로 넣지 않음 |
| 반복·중식 | 반복 일정; 일반 템플릿 기본, 중식 선택프리셋 | 일반 업무와 중식 양식 선택을 보존 | 배정 계산기로 임의 바꾸지 않음 |
| 자료 동기화 | 열/기간/문구 템플릿·수신자 검증·변경 preview/commit | 수정필요 항목만 해결하고 확정 | 등록 시도된 업무는 삭제/재생성으로 재등록 못함 |
| 예약등록 | 순차 입력→읽기 대조→보내기→작성창 종료 | 등록가능N/수정필요M → 한 번 최종 등록 → 진행 | 기본은 등록요청완료, 도착확인으로 과장하지 않음 |
| 재등록 방지 | begin_submit 영속 이력; 불명은 잠금 | 등록요청완료/확인완료/불명 상태와 잠금 유지 | crash/restart/보관함 복원에서도 이력 유지 |
| 준비 복구/중지 | 보내기 전 제한된 오류만1회; F8/중지 | 안전한 준비재개와 같은 cancel flag | 보낸 뒤 자동 retry 없음, 접수예약 취소 아님 |
| 예약목록 대조 | 기본 manual, 선택적 자동 대조 mode | 해당 adapter 지원 시 선택옵션 유지 | 자동대조 실패는 다음건 보류; 기본 flow 강제 추가검수 없음 |
| Google 시트 | 원본은 선택적 OAuth 직접 연결 | 로컬 Excel/CSV/붙여넣기 우선; 직접연결 승인 전 비활성 | 개인정보/네트워크 규칙 충돌을 숨기지 않음 |
| 보관함 | 지난 메시지 정리·복원과 등록 이력 유지 | 같은 도구의 보관함 유지 | 이력 삭제로 중복등록 해제하지 않음 |

## 3. 원본 코드에서 특히 지킬 조건

- network_routine `normalize_internal_commands`/`external_commands`: 내부 DNS만 입력했을 때 IP를 유지하고 외부망은 IP와 DNS 모두 DHCP로 전환한다.
- `current_decision_info`: schedule에서는 주변 scan 생략, 연결 이름 우선, 주변 내부/외부 동시 감지의 경우 hybrid는 시간표·wifi_only는 유지다.
- `persist_collected`/`manual_apply`/`save_and_apply`/`reconcile_button_clicked`: 설정이 상태판단에 영향을 줄 때 이력 초기화, 수동 적용은 저장하지만 작업 재등록을 생략, 저장 및 반영은 등록 동기화, 지금검사는 dirty일 때 거부한다.
- `sync_tasks`: 모드에 필요한 schedule/Wi-Fi만 등록하고 startup/logon/unlock/console는 유지한다. 원본 legacy task 삭제는 새 TeacherDeck이 자동으로 수행하지 않는다.
- CoolReserve `Runner._run`: inspect는 read-only, prepare는 보내지 않음, register는 읽기 대조/첨부 freshness 뒤 begin_submit 영속화·submit한다. manual이면 needs_review를 UI의 등록요청완료로 보여주고 계속한다. 선택 대조 실패는 멈춘다.
- `Runner._run` 준비 복구: Gentoo/register의 PreparationTransient만 최대1회, 원래 내용·프로필·첨부를 다시 확인한다. submit 중 예외는 uncertain, 자동재시도 금지다.
- `WorkflowService.preview`/`commit`: 같은 날짜·차시의 등록시도 및 원본에서 사라진 업무를 재생성/자동취소하지 않는다.
- `windows.py`/`gentoo.py`: 실제 대상 창·계정·읽기 증거를 사용하며 숨은 프로토콜/DB쓰기/고정 좌표로 예약을 만들지 않는다. 각 기관/버전의 읽기 불가능한 화면은 지원했다고 가정하지 않는다.

## 4. 화면을 간단하게 만드는 범위

기능 제거가 아니라 조건부 표시로 정리한다. 네트워크는 현재상태/수동전환 → 내부프로필 → 자동기준·요일 → 저장의 한 화면이고 작업상세·최근결과는 펼침 영역이다. CoolReserve는 연결준비 → 입력방식 → 공통미리보기 → 등록/중지 → 결과를 유지하며 고급연결/선택적 결과대조는 필요할 때 펼친다. 서로 독립한 신규 모듈로 기능을 흩어 원래 한 작업을 여러 도구로 왕복하게 만들지 않는다.

## 5. 남은 검증

실제 COM worker·네트워크 adapter·Gentoo adapter를 아직 실행하지 않았다. 원본 tests를 현재 환경에서 다시 실행하지 않았으므로 소스 조사만으로 회귀 통과나 배포 완료를 말하지 않는다. 새 호스트 계약 승인 후 합성 테스트, 실제 파일/Windows 화면, 별도 허가된 네트워크/본인 한건 예약 시험을 구별해 증거를 남긴다.
