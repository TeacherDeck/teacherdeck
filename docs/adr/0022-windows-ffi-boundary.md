# ADR-0022: 네 파일에 한정한 Windows FFI 경계

- 상태: 승인됨 (2026-10-11 사용자 명시 승인)
- 관련: [후속 제안서](../proposals/windows-ffi-boundary.md), ADR-0019, ADR-0021, GEN-003, SEC-010

승인된 파일명 변경·Office·네트워크 기능에 필요한 FFI를 `file_ops/native.rs`, `native_automation.rs`, `network_native.rs`, `native_workers.rs` 네 호스트 파일에 격리한다. 각 파일의 `#![allow(unsafe_code)]` 한 줄만 사유 있는 억제 allowlist에 등록한다. 워크스페이스 `unsafe_code=deny`, deck-core의 `forbid(unsafe_code)`, 다른 검사와 테스트는 유지한다.

각 unsafe 블록의 SAFETY 주석과 독립 리뷰에서 포인터/길이/정렬, 핸들·COM 객체 소유권, 스레드 apartment, 실패 경로 해제와 자기 소유 프로세스만 종료하는 조건을 확인한다. 외부 인터페이스는 안전한 함수이며 모듈이 임의 실행 경로·COM 이름·키보드/마우스 동작을 전달할 수 없다. 구체 네 파일의 범위는 후속 제안서 표로 고정한다. 범위 확장은 새 승인 대상이다.
