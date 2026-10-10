# fs 1.2 저장 폴더 권한 구현 검토

2026-10-10. 사용자 승인 범위는 `docs/proposals/quick-capture.md`의 새 파일 추가 전용 영속 저장 폴더 권한이다.

## 구현 경계

- `destination.rs`는 호스트 앱 데이터 아래 모듈별 JSON 기록에만 경로와 폴더 fingerprint를 보관한다. 모듈에는 난수 grant handle과 **선택한 저장 폴더** 표시만 반환한다.
- 사용자가 선택한 일반 폴더만 등록하며 reparse point·junction·연결된 조상을 거부한다. 복원 후 폴더가 없거나 교체되면 `available:false`이고 다시 선택하기 전에는 저장하지 않는다. 사용자 폴더를 자동 생성하지 않는다.
- 매 작업에서 소유자·grant·폴더 fingerprint·DirectoryGuard를 다시 검사한다. Windows stable std의 생성 시간·속성 fingerprint는 암호학적 file ID 보장이 아니며, 유지한 디렉터리 핸들 및 reparse 검사와 함께 보수적으로 검증한다.
- 저장은 128MiB 이하의 인코딩 결과만 받는다. 기존 `OutputBatch`의 쓰기 청크·복구 journal·목적 볼륨 stage·atomic hard-link create-new 게시를 재사용한다. 이미 있는 파일은 바꾸지 않고 번호 붙은 새 이름을 사용한다.
- `destinations` mutex를 게시와 읽기 핸들 발급까지 유지한다. 권한 해제는 이미 진행 중인 저장이 끝난 다음 처리되고 이후 저장을 거부한다. 권한 해제는 호스트 기록만 제거하며 사용자 결과 파일을 삭제하지 않는다.
- 파일 핸들은 `ReadFile` 권한과 현재 모듈 generation으로 발급한다. 일반 디렉터리 읽기·열거·기존 파일 수정 권한은 발급하지 않는다.
- remembered grant 조회와 native trigger 검증은 별개이다. 캡 선언·설치 상태·사용자 시작한 캡처 세션 검증은 캡 핸들러/캡처 세션 담당이 수행한다. 앱 재시작은 캡처를 자동 시작하지 않는다.

## 검증

합성 임시 폴더 테스트는 영속 복원·모듈 격리·같은 이름의 바이트 보존·권한 해제 후 사용자 파일 보존·임시 grant·재선택·폴더 이동과 교체·잘못된 이름·손상 기록의 재선택 복구·Windows junction 거부를 다룬다. Windows Rust 실행에서 destination 6개·기존 file_output/journal 13개·core handles 5개 테스트가 통과했다. 기존 fs 1.1 번호 규칙을 유지하며 append destination의 첫 중복만 원본처럼 `(1)`부터 시작한다. 실제 OS 폴더 선택 확인과 네이티브 캡처 픽셀·트레이·단축키 QA는 별도의 통합 검증이다.
