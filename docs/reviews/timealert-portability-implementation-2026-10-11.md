# TimeAlert 백업·사진 이동 구현 검토 (2026-10-11)

[승인 제안 1번](../proposals/classroom-portability-presentation.md), [ADR-0026](../adr/0026-timealert-portability.md), [명세](../spec/timealert-portability.md)를 구현했다. 검증 자료는 합성 데이터만 사용한다. 전체 verify·설치본·Android 실기는 루트 통합 결과와 분리한다.

## 원천 대조와 보존

원작 `BackupManager.kt`의 TIMEALERT v1 헤더·PBKDF2WithHmacSHA256 120,000회·salt16·IV12·AES/GCM/NoPadding 태그16 및 Room `AppDatabase/7.json`의 30개 표·공식 인덱스를 기준으로 삼았다. 현재 DB7 이외의 마이그레이션을 추측하지 않는다. 원작 복원기가 WAL을 사용하지 않으므로 SQLite backup으로 정상 WAL을 DB에 접고 출력한다.

미편집 원작 표·열·연락처·메모·Room hash·관계와 원작 사진 파일을 호스트 세션에 보존한다. 알려진 값을 트랜잭션으로 수정하고 private 자식 기록을 가진 원형 행을 삭제/재삽입하지 않는다. Room hash를 그대로 둔 FK 대상·ON DELETE·인덱스 고유성/열/부분 조건·숨긴 생성 열 변조도 거부한다. 날짜별 주간표 선택과 원형 연결 삭제처럼 정확히 표현할 수 없는 출력 변경은 명시적으로 실패한다. 요일 대체/임시 일과 취소는 해당 종류만 적용한다.

같은 이름은 자동 병합하지 않고 교사가 지정한 master만 연결한다. 사진명렬표의 동일 앵커 복수 사진은 확정에서 제외하며 좌표가 불명확한 일반 표는 수동 대응한다. native 세션은 최초 revision에 고정하고 경합 뒤 재지정하지 않는다. UI가 picker/decrypt 대기 중 내려가면 늦은 성공의 handle도 즉시 닫아 BUSY 세션 유실을 막는다. 기존 선택 학생은 검색 후보 제한에도 보이게 유지한다.

## 확인한 결과

- Java→Rust: 원작 JDK17 API가 만든 고정 암호화 벡터를 UTF-8 암호 `합성 암호 🔑`로 인증/복호화했다.
- Rust→Java: Rust의 새 salt/IV 출력 파일을 같은 JDK17 API로 인증/복호화하고 합성 평문 일치를 확인했다. ignored oracle은 `target/adversarial-review/timealert-oracle/`에 있다.
- scoped host TimeAlert 13개, core 학교 자료4개, JS5파일37개가 통과했다. host `--lib --tests` Clippy의 경고 오류 처리와 소유 파일 Rustfmt/ESLint를 통과했다. 전체 verify 숫자와 합산하지 않는다.
- 동결 후 원작 PhotoStore의 절대 경로 분기와 restore의 재배치 부재를 재확인해 사진 출력 경로 보정을 추가했다. 출력에 실제 담긴 사진의 과거 절대 경로만 basename으로 바꾸며 누락 사진·행 식별자·thumbnailVersion·source는 보존한다. 마지막 변경도 최종 전체 `pnpm verify`의 Cargo 회귀·Clippy에서 통과했다.

## 남은 실기 검증

Android 실제 기기의 Room 복원·사진 경로 재배치와 실제 새 PC 이동은 미검증이다. DB7이더라도 공통 자료 상한이나 표현 규칙을 벗어난 입력은 거부할 수 있다. 원작 연결을 닫거나 앱을 종료한 뒤 다음 출력에는 비공개 원작 기록이 없다는 안내를 제공한다. 오늘 시간표·출결 기록·알림 기능은 이번 B 범위에 포함하지 않는다.
