# 제안: TimeAlert 백업 호환과 확장 모니터 학생 화면

상태: 2026-10-11 사용자 승인. 사용자가 1번에 “승인한다. 그리고 add-capability 무시하고 바로바로 해라”, 2번에 “제안대로 확장 화면 구현 승인”이라고 답했다. 아래 범위를 구현하며 같은 범위의 승인을 반복 요청하지 않는다. 기존 공통 자료 A, JSON 복구, PNG 출력 승인도 유지한다.

## 1. TimeAlert 백업과 사진 이동

- 정지 조건: GEN-004 런타임 의존성, GEN-005 main ACL 명령 추가, DOC-002 학교 자료 계약 추가.
- 배경: 같은 XLSX를 읽는 현재 기능으로는 원작의 전체 DB·사진·기록을 옮길 수 없다. 공통 JSON도 사진 파일을 포함하지 않는다.
- 제안: 신뢰 셸의 학교 자료 화면에서 원작 `.teacherbackup`을 선택하고 암호를 입력한다. 호스트가 원래 TIMEALERT v1 형식(PBKDF2-HMAC-SHA256 120,000회, salt16/IV12, AES-256-GCM 태그16, ZIP)을 읽는다. 인증에 성공하기 전에는 DB·사진·공통 자료에 적용하지 않는다. 암호와 원문은 로그에 남기지 않는다.
- 원본의 DB·WAL·사진을 앱 소유 작업 영역에 보존하고, 알려진 학교·명부·수업·시간표를 공통 자료로 투영한다. 원작 DB의 미편집 표·열·연락처·메모·Room 식별자는 유지한다. 새 백업을 만들 때 알려진 변경만 트랜잭션으로 반영하고 새로운 salt/IV를 쓴다. 사용자 원본은 덮어쓰거나 삭제하지 않는다. 사진을 포함한 새 PC 이동도 이 형식으로 처리한다.
- 학기 변경은 새 학생을 무조건 생성하지 않고 기존 학생을 명시적으로 연결하는 미리보기를 제공한다. 이름만 같다고 자동 병합하지 않는다. 사진명렬표 XLSX는 사진 대응을 검토한 뒤 공통 명부와 함께 등록할 수 있게 하며, 독립 사진 추출 기능을 유지한다.
- 직접 추가할 호스트 의존성: `rusqlite =0.40.2` (`bundled`, `backup`, `limits`, 기본 기능 끔), `aes-gcm =0.10.3` (`aes`, `alloc`, 기본 기능 끔), `pbkdf2 =0.12.2` (`hmac`, 기본 기능 끔), `sha2 =0.10.9`를 `sha2_compat` 별칭으로 사용. 기존 sha2 0.11·zip·getrandom을 교체하지 않는다. rusqlite는 MIT, RustCrypto는 MIT/Apache-2.0이며 동봉 SQLite/libsqlite3-sys의 실제 고지를 확인한다. 라이선스 allowlist 확대가 필요하면 해당 파일·버전만 별도 보고한다.
- main 전용 명령: `school_data_open_timealert`(선택·암호·검증 → 세션 핸들과 요약), `school_data_apply_timealert`(세션·expectedRevision·명시적 적용), `school_data_export_timealert`(세션·현재 revision·새 암호 → 새 파일 저장), `school_data_close_timealert`(앱 소유 임시 세션 해제), `school_data_import_roster_photos`(선택한 XLSX·대상 학기·expectedRevision → 대응 검토). main label/local origin을 매 호출 확인하며 다른 모듈·보조 창에는 허용하지 않는다. 파서 내부 상태·DB 경로·암호는 모듈 브리지로 보내지 않는다.
- 상한: 암호 UTF-8 1KiB, 입력 백업 512MiB, 해제 합계 1GiB, 사진 1개 16MiB/합계256MiB, 동시에 열 수 있는 백업 1개. 과대한 입력·경로 탈출·중복 ZIP 이름·인증 실패·손상 SQLite/WAL·미래 스키마를 적용 전에 거부한다. 압축 해제 크기는 실행 중 누적 검사한다. 예상 크기는 설치본을 실제 빌드한 뒤 기록하며 추정치로 완료 처리하지 않는다.
- 검토한 대안: JSON으로 변환하면 미편집 정보가 사라진다. 셸에 전체 DB와 암호를 장기 보관하거나 모듈에 DB를 공개하는 방식은 채택하지 않는다. Windows CNG 직접 호출은 별도 unsafe 경계를 더 늘리므로 검증된 RustCrypto를 쓴다.
- 영향: 앱·SDK minor, 기존 학교 자료 읽기 API는 하위 호환. 외부 전송·자동 동기화 없음. 현재 Android 원작 스키마7부터 합성 DB 및 실제 Android 왕복을 검증하고, 구버전 지원은 원작 마이그레이션 검증을 통과한 버전만 표기한다. 미검증 버전을 지원된다고 표시하지 않는다.
- 필요한 승인: 위 정확한 직접 의존성 네 개, 다섯 main 명령과 대응 ACL, TimeAlert 백업·사진 호환 계약.

공식 라이브러리 근거: [rusqlite 0.40.2](https://docs.rs/crate/rusqlite/0.40.2), [aes-gcm 0.10.3](https://docs.rs/crate/aes-gcm/0.10.3), [pbkdf2 0.12.2](https://docs.rs/crate/pbkdf2/0.12.2). 원작 바이트 계약은 [조사 기록](../reviews/time-alert-classroom-contracts.md)을 따른다.

## 2. 교사용 창과 분리된 학생 화면

- 정지 조건: GEN-005 보조 창 ACL 추가, DOC-002 window minor 계약과 SEC-003 예외.
- 배경: 복제 화면은 현재 전체화면으로 가능하지만 확장 모니터에는 공개 결과만 보여 주는 별도 창이 필요하다.
- 제안: `window` 1.1에 `listDisplays`, `openPresentation`, `updatePresentation`, `closePresentation`을 추가한다. 화면·발표 핸들은 호스트가 발급하고 모듈 소유권을 매번 검증한다. 모듈은 화면 좌표·URL·HTML·JS를 지정하지 않는다.
- 공개 payload는 자리 배치·발표자·모둠·역할의 네 타입으로 제한한다. 제목·학생 표시 이름/번호·자리/모둠/역할 결과만 허용하며 연락처·메모·제외 사유·과거 집계는 넣지 않는다. 사진·외부 주소·임의 스타일은 이번 범위에서 제외한다. 인원 최대1,000명, 문자열 하나120자, 전체512KiB, 단조 증가 revision, 모듈당 창 하나·앱 전체 최대4개다.
- 창 label은 `presentation-*`, 문서는 고정 로컬 셸 `/presentation`이다. ACL은 `core:event:allow-listen`, `core:event:allow-unlisten`, `allow-presentation-ui-state`, `allow-presentation-ui-close` 네 개만 허용한다. UI state/close는 실제 창 label과 호스트의 살아 있는 소유 세션을 대조한다. 일반 host_invoke, 파일·클립보드·네트워크·모듈 로드는 허용하지 않는다. 기존 CSP를 완화하지 않는다.
- 교사가 모니터를 골라 공개 결과를 띄우며, 명시적으로 갱신한 결과만 전달한다. Escape·닫기·모듈 언로드·권한 상실 시 창을 정리한다. 화면 분리·혼합DPI·복제/확장 전환 시 잘못된 화면에 비공개 내용이 나가지 않도록 공개 화면을 비우고 다시 선택하도록 한다.
- 검토한 대안: 원래 창 전체화면은 확장 요구를 충족하지 못한다. 학생 기기·서버·QR 연결은 요구 범위 밖이다. 새 런타임 의존성 없이 기존 Tauri 창 API를 사용한다.
- 영향: 앱·SDK minor, 해당 네 모듈은 기존 requires window ^1.0을 유지하고 런타임 버전 1.1 이상에서 확장 화면을 활성화한다. 버전/CHANGELOG를 갱신한다. 실제 두 모니터가 없으면 모델 검증과 실기 미검증을 구분한다.
- 필요한 승인: window1.1의 네 메서드, 고정 로컬 공개 창과 네 ACL 권한, 위 공개 자료 범위.

## 검증과 완료 기준

승인 후 ADR → spec → Rust 원천/생성 → 구현·권한 거부/수명/용량/복구 테스트 → 모듈 UI와 버전 → `pnpm verify` → Windows 앱/배포 구성 검증 순서로 진행한다. Android 양방향 복원, 실제 두 모니터와 사진 포함 새 PC 이동은 각각의 증거가 있어야 완료로 기록한다.
