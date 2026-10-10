# ADR-0016: 구조화 클립보드 출력

- 상태: 승인됨 (2026-10-10 사용자 승인)
- 관련: GEN-004, GEN-005, CAP-001~010, PRV-003

회의록 원본의 한글·Word 서식 붙여넣기를 복원하기 위해 범용 clipboard 1.0.0 출력 캡을 추가한다. writeText와 writeRichText만 제공하고 읽기·감시·이미지·파일 출력은 제공하지 않는다.

모듈은 heading/paragraph/table 및 bold run으로 구성한 구조화 문서와 일반 텍스트 대체본을 전달한다. 호스트가 escape된 HTML을 생성한다. 원시 HTML·CSS·URL·파일 경로는 입력으로 받지 않는다. 입력 텍스트와 생성 출력은 각각 합계 256KiB, JSON은 512KiB로 제한하며 배열 개수에도 상한을 둔다.

Windows 전용 arboard 3.6.1을 default-features=false로 사용한다. 호출은 한 OS 스레드에서 직렬화하고 cloud/history 제외를 고정 적용한다. 기존 host_invoke 권한 검사와 브리지를 사용하므로 CSP·ACL·프로토콜 변경은 하지 않는다.

웹 Clipboard API는 iframe과 WebView 권한 제약에 의존하고, HTML 파일 저장은 즉시 복사와 다르므로 별도 대안으로 남긴다. Tauri clipboard plugin은 읽기와 게스트 API까지 포함하므로 추가하지 않는다.

arboard Windows HTML Format 등록 실패 시 일반 텍스트만 기록하고도 성공을 반환할 수 있다. 추가 FFI 없이 기본 완료 문구는 '클립보드에 복사했어요'로 유지하며 대상 Office 앱의 서식 유지 성공은 실제 붙여넣기 QA로만 확인한다. 클립보드 내용은 로그나 디스크에 남기지 않는다. cloud/history 제외는 별도 제삼자 감시 프로그램까지 차단하는 보장은 아니다.
2026-10-10 후속 승인: clipboard-win =5.4.1과 error-code =3.4.0의 BSL-1.0 cargo-deny 예외만 허용했다. 전역 라이선스 목록은 유지한다. [정확한 후속 범위](../proposals/clipboard-license-followup.md).
