# 후속 제안: 승인된 Windows 기능의 네이티브 경계

- 상태: 승인됨 (2026-10-11 사용자 명시 승인). 승인된 파일명 변경·Office·네트워크 기능의 구현 중 확인한 추가 범위다. 결정은 [ADR-0022](../adr/0022-windows-ffi-boundary.md)에 기록한다.
- 문제: SEC-010은 별도 모듈의 Win32 FFI와 안전성 리뷰를 예정하지만, 현재 Cargo는 모든 `unsafe`를 거부하며 억제 allowlist도 비어 있다. Windows 0.62.2의 COM·WLAN·TaskScheduler와 열린 파일 핸들 기반 이름 변경은 해당 API 경계에서 `unsafe` 호출이 필요하다. Rust 1.98의 표준 파일 ID 조회는 아직 비안정 API다.
- 제안: 아래 네 파일의 `unsafe_code` 속성만 사유와 함께 `tools/checks/suppressions.allow.json`에 등록한다. `deck-core`의 금지와 워크스페이스 기본값, 나머지 린트·테스트·검사기는 유지한다.

| 파일 | 허용 목적 |
|---|---|
| `apps/desktop/src-tauri/src/file_ops/native.rs` | 열린 파일 핸들의 Windows 파일 ID 조회와 같은 폴더 안의 덮어쓰기 없는 이름 변경 |
| `apps/desktop/src-tauri/src/native_automation.rs` | 새 Office 인스턴스의 COM apartment·IDispatch·VARIANT·SAFEARRAY 수명 관리 |
| `apps/desktop/src-tauri/src/network_native.rs` | 고정 WLAN·WMI·TaskScheduler 호출 |
| `apps/desktop/src-tauri/src/native_workers.rs` | 고정 자기 실행파일의 UAC 시작 및 자기 작업 프로세스 소유권·시간 제한 |

- 안전성 조건: 공개 인터페이스는 안전한 Rust 함수로만 제공한다. 포인터·길이·구조체 정렬·핸들 소유권·스레드 apartment·해제 순서를 각 블록의 SAFETY 주석과 독립 리뷰로 확인한다. 모듈이 명령어·실행 경로·포인터·임의 COM 이름을 전달할 수 없다. 오류는 개인정보 없는 고정 코드로 바꾼다.
- 대안: 파일 ID 대신 경로와 수정 시각만 비교하면 파일 교체 경쟁을 막았다고 주장할 수 없다. 외부 PowerShell/Python 스크립트 실행은 승인한 고정 Rust 작업자보다 권한·배포 범위가 커진다. 기능을 생략하면 이미 승인된 보호된 되돌리기·설치 Office 변환·네트워크 루틴을 완성할 수 없다.
- 영향: 새 실행 권한이나 의존성 버전 추가가 아니다. 승인된 `windows = "=0.62.2"`의 FileSystem 기능을 포함한다. 실제 메시지 발송·현재 PC 네트워크 변경 시험은 하지 않는다.
- 필요한 승인: GEN-003 억제 allowlist의 네 파일 한정 예외. 승인 전 이 경계 구현은 보류하고 순수 로직·화면·SDK·PDF·공통 자료 작업은 계속한다.
