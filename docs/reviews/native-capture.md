# 네이티브 캡처 구현 검토

2026-10-10, 승인된 ADR-0017 범위. 원본 QuickCapture 파일은 수정하지 않았다.

## 구현 경계

- safe xcap 0.9.8로 모니터 교집합만 물리 좌표에서 캡처한다. 서로 다른 DPI의 전역 좌표에 배율을 곱하지 않는다. 빈 모니터 간 공간은 흰색으로 채운다.
- 화면 읽기·인코딩은 작업 스레드에서 실행한다. 전역 프레임 작업은 한 개이고 각 단축키의 대기 트리거도 하나로 제한한다. 자동 반복 pressed와 release는 캡처 메타데이터 잠금과 독립된 atomic 상태로 처리한다.
- 32MP/한 축 16384/인코딩 128MiB, Windows GDI와 변환·합성의 극단적인 순간 메모리는 약512MiB 범위다. 실제 저사양 PC 피크는 native QA 대상이다.
- native region과 별도360×128dip toolbar는 고정된 로컬 /overlay route이다. 모듈의 HTML·URL·경로·OS 핸들을 받지 않는다. Tauri2.12.1의 asset fallback(manager/mod.rs)은 /overlay가 없으면 index.html을 제공한다.
- 캡처 전 두 창을 숨기고80ms 제한 settling 뒤 읽는다. 오류에도 살아 있는 overlay의 표시 상태를 확인해 복원한다. 캡처 중 수정은 BUSY로 거부하고 stop은 게시 전에 세션 소유권을 취소한다. 게시가 이미 시작한 경우에는 원자적 저장이 끝난 뒤 종료한다.
- 모듈마다 허용된 선언·버전·실행 가능 상태와 목적지 grant를 트리거 전/게시 전에 재검사한다. iframe 제거는 native 세션을 종료하지 않는다. 권한 해제·모듈 제거·명시적 종료는 native 창/핫키를 정리한다.
- 결과 read-only 핸들은 최근64개만 유지한다. 단발 host temp는5분 내16개로 제한한다. 종료되거나 만료한 파일 핸들은 재사용하지 않는다. 저장된 사용자 파일은 삭제하지 않는다.
- 폴더 사라짐 등 조기 실패도 toolbar 마지막 오류와 capture.failed에 전달한다. BUSY/debounce는 무음 억제한다. 로그에는 화면·경로·파일명·키 조합을 넣지 않는다.
- tray를 만들 수 없으면 다른 도구의 시작을 막지 않으며 arm은 CAPABILITY_UNAVAILABLE이다. 정상 tray가 있는 사용자 시작 세션에서만 설정 창 닫기를 숨김으로 처리한다. 단일 인스턴스 재실행은 show→unminimize→focus로 복원한다.

## 자동 검사 결과

Rust host clippy --all-targets -D warnings 통과. 호스트4개 테스트(전역 작업 lease, 모듈 소유권, 키 whitelist, 메타데이터 잠금 중 release 보존)와 native 좌표 한도1개 통과. 목적지 grant6개 및 기존 파일 게시13개는 별도 담당 테스트로 통과했다. 실제 dependency closure cargo deny licenses 통과. 전체 verify는 통합 담당이 최종 변경 뒤 실행한다.

## 실제 Windows 출시 확인

자동 검사는 실제 화면 픽셀·오버레이 제외·혼합 DPI 정확성을 증명하지 않는다. 이 환경의 native UI 제어가 비활성화되어 해당 결과를 통과했다고 기록하지 않았다. 설치본에서 단일/125·150·200% 혼합 DPI/음수 모니터 좌표/모니터 교차 합성, overlay+toolbar 미포함, 드래그·resize·hide 복원, 키 반복·빠른 release, 설정 닫기와 트레이 재열기, PNG/JPG 품질·중복명·grant 복원/드라이브 분리·종료 중 저장을 확인해야 한다. Word/한글의 HTML 클립보드 붙여넣기도 실제 응용프로그램 확인 항목이다.