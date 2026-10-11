# ADR-0023: 원작 코어를 사용하는 관리 메시징 작업자

- 상태: 승인됨
- 결정일: 2026-10-11
- 관련 제안: [native-tools-next §4](../proposals/native-tools-next.md#4-messaging-100--사용자가-고른-외부-앱의-예약-메시지), [관리 실행 환경](../proposals/coolreserve-managed-runtime.md)

## 맥락

CoolReserve의 검토·수신자 대조·첨부 identity·중복 방지·제출 시도 기록은 기존 Python 코어에서 검증해 왔다. 임의 설치 Python을 호출하거나 이 로직을 Rust로 다시 작성하면 배포 재현성 또는 원작 검증을 잃는다. 예약 등록은 사용자가 확인한 정보를 로그인한 외부 앱에 전달하므로 일반 로컬 변환과 구분해야 한다.

## 결정

`messaging` 1.0.0은 connect/recipients/plan/start/status/cancel의 여섯 구조화 메서드만 제공한다. provider는 gentoo로 고정한다. 모듈은 실행파일, 경로, 계정 ID, 화면 선택자, 좌표나 임의 입력 명령을 지정하지 않는다. 호스트가 소유 모듈·세션별 불투명 핸들을 재검증하고 사용자 선택 fs 핸들을 제한된 첨부 경로로 바꾼다.

원천 CoolReserve `2c11d10008c88b8373d2277e54b468c5cd3b1191`의 Store/Runner/WindowsDriver와 업무·반복 처리기를 재사용한다. 비공개 worker adapter는 원천 저장소에 추가하고 TeacherDeck은 같은 원천 산출물의 고정 해시를 소비한다. 관리 Windows x64 CPython 3.14.8과 승인한 pywinauto/comtypes/pywin32/six만 앱 내부에 묶는다. 전역 설치·PATH·레지스트리·서비스는 변경하지 않는다. 라이선스·저작자 고지는 보존한다.

원작 Store의 `begin_submit`이 보내기 클릭 전에 SQLite FULL 동기화 트랜잭션으로 제출 시도를 기록한다. 원작의 preparing/submitting 복구, needs_review/confirmed/uncertain 잠금과 삭제 후에도 남는 시도 지문을 유지한다. 보내기 뒤에는 자동 재시도하지 않는다. 준비 단계의 식별된 일시 오류에만 원작의 최대 한 번 복구를 유지한다. F8와 화면 취소는 같은 Runner stop flag를 사용한다.

계획은 내용·예약시각·수신자 증거·첨부 identity·연결에 묶고 5분에 만료한다. register start는 한 번의 trusted shell 최종 확인과 호스트 승인 토큰을 요구한다. helper에 confirmed를 전달하는 것은 호스트만 할 수 있다. 계정 표시가 바뀌면 작업을 중단한다. 상태는 등록 요청 완료와 선택 예약목록 대조를 구분하며 도착·기관 서버 접수를 성공으로 주장하지 않는다.

최초 또는 증거 불일치 때 원작의 이미 열린 본인 작성창 대조를 요구한다. 유효한 saved self_binding은 재사용한다. 자동 연결의 첨부 reader가 무첨부만 확인한다는 원작 제한을 유지한다. 첨부 feature를 조용히 광고하거나 초안 첨부를 삭제하지 않으며, 실제 첨부 목록 대조 역할이 없으면 계획 전에 지원 한계를 안내한다. 임의 화면 선택자·원작 수동 calibration 확장은 후속 범위다.

표준 입력/출력은 [messaging spec](../spec/messaging.md)의 최대 512KiB JSON line private protocol이다. 경로·계정 identity는 이 호스트 내부 채널에만 허용하고 일반 로그로 복사하지 않는다. helper의 provider 오류 문자열·진단·SQLite·화면 선택자는 공개 결과에서 제거한다. 네트워크·Google Sheets/OAuth API는 어댑터에 연결하지 않는다.

## 개인정보 예외와 검증

UI는 “변환·분석은 PC 안에서 처리합니다. 쿨메신저 예약 등록은 사용자가 확인한 수신자·내용·첨부를 로그인한 쿨메신저로 전달합니다.”를 최종 확인에 표시한다. 이 승인으로 임의 HTTP·Google 인증·원격 분석·텔레메트리가 허용되지 않는다.

오프라인 합성 원작·어댑터 검사와 해시·라이선스·오프라인 설치 검증을 수행한다. 실제 Gentoo 조회·창 열기·예약 등록은 이번 작업의 검증 범위에서 제외한다. 실제 계정 발송은 별도 명시 승인 뒤 한 건으로 검사한다. 합성 성공을 실제 기관 앱 지원 완료로 표시하지 않는다.
