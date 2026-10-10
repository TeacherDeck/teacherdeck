# ADR-0017: 사용자 시작 영역 캡처 세션

- 상태: 승인됨 (2026-10-10 사용자 명시 승인)
- 관련: [승인 제안서](../proposals/quick-capture.md), GEN-004/005, CAP-002/008, BRG-009

capture 1.0.0, overlay 1.0.0, global-shortcut 1.0.0와 fs 1.2.0을 추가한다. 모듈은 SDK로만 호출하며 native 코드는 호스트에 둔다. 기존 deck:1 envelope 및 파일 청크 인증은 유지한다. SDK는 0.4.0으로 올린다.

화면 영역은 signed 물리 가상 화면 좌표로 정의한다. 혼합 DPI에서 전역 좌표에 배율을 곱하지 않고 모니터별 물리 교집합을 같은 크기로 합성한다. xcap 0.9.8 region safe API, image 0.25.10 PNG/JPEG, tauri-plugin-global-shortcut 2.4.0와 기존 Tauri tray 기능만 사용한다. 레포에 raw unsafe FFI 또는 lint 예외를 추가하지 않는다.

캡처 세션은 동일 모듈이 소유한 overlay·shortcut·명시 선택한 destination grant를 결합한다. UI가 숨겨져도 사용자 시작한 네이티브 세션은 유지한다. 기존 일반 RPC 권한·모듈 소유자 검사를 변경하지 않는다. 네이티브 트리거는 매번 설치·선언 캡·버전·grant와 사용자 시작 상태를 재검사한다. 재시작에는 자동 arm하지 않는다. 종료·모듈 제거·권한 해제에 리소스를 정리한다.

오버레이는 고정 로컬 셸 `/overlay` route의 단일 투명 도구 창으로 구성한다. 상단36DIP 띠에30DIP 미니 툴바를 오른쪽 정렬하고 아래 영역은 Windows hit-test용 alpha1 수준으로 채운다. `overlay.rect`는 테두리와 툴바를 제외한 실제 물리 캡처 좌표이며, 내부에서 외부 창 좌표로 변환한다. CSS 테두리와 inset은 같은 물리 borderWidth를 사용한다. 창 label을 호스트 소유자 매핑으로 확인하며 기존 최소 ACL 안에서 동작한다. 셸 이벤트는 현재 Window target으로만 구독한다. 캡처 전에 이 창을 숨기고 성공·실패 후 살아 있는 표시 상태를 복원한다. 기존 미사용 capture-toolbar-* ACL은 이번 변경에서 추가·확대하지 않는다.

fs 영속 grant는 명시한 폴더에 새 파일만 게시할 권한이다. 경로는 호스트에만 저장하고 일반 읽기/열거/덮어쓰기 권한을 주지 않는다. 저장은 원자적 새 파일 생성, 충돌 suffix, 성공 뒤 연번 증가를 지킨다. grant 해제는 메타데이터만 해제한다.

화면은 32Mi 픽셀/축 16,384, 각 RGBA 버퍼 128MiB 이하로 제한한다. 이 값은 총 프로세스 메모리 제한이 아니다. bitmap/변환/합성/encoder 별도 비용을 계산하고 모니터 교집합을 순차 처리한다. 작업 하나, 대기 트리거 하나, 300ms debounce를 적용한다. 로그에는 pixels·경로·파일명·사용자 키 입력을 남기지 않는다.

승인된 global-shortcut 캡 이름을 선언하기 위해 캡 이름 문법은 최대32 ASCII 바이트, 소문자 시작, 소문자/숫자 segment를 내부 단일 하이픈으로 연결하는 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`로 확정한다. 선두·후미·연속 하이픈을 금지하며 기존 이름은 모두 유효하다. 이는 명시 승인된 이름과 매니페스트 캡 선언 계약에 포함된다.

구현 감사(2026-10-10): 기존 bridge.authorize는 runnable/캡 선언/버전을 검사하며 keepAlive 숨김 iframe의 RPC도 가능하다. 이번 작업에서 활성 강제를 도입하지 않는다. fs 드롭 active-only 및 window 숨김 복원은 유지한다. 일반 RPC 활성 상태 강제는 기존 storage 정리 등에 영향을 줄 수 있어 별도 검토한다.
