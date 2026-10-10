# ADR-0015: 셸 제목 표시줄의 최소 창 조작 권한

- 상태: 승인됨
- 날짜: 2026-10-10
- 결정자: 프로젝트 소유자, 권한 누락 보고 후 최신 공동작업 변경의 즉시 반영 지시

## 맥락

공동작업자의 `a876d1e`는 Windows 기본 제목 표시줄 대신 셸 제목 표시줄을 사용한다. PR #5는 해당 UI의 창 조작 권한을 사람이 반영하도록 남겼다. 기존 메인 ACL에는 이 권한이 없어 제목 표시줄을 함께 통합하려면 보완이 필요하다. 승인 경위와 범위는 [제안서](../proposals/titlebar-window-controls.md)에 기록한다.

## 결정

기존 main 창의 로컬 셸에만 `core:window`의 minimize, toggle-maximize, is-maximized, close, start-dragging, internal-toggle-maximize 허용 권한을 준다. 각 식별자는 `allow-` 접두어를 사용한다. 마지막 권한은 Tauri의 Windows 드래그 영역 더블클릭 처리에 필요하다.

`local: true`, `windows: ["main"]` 범위를 명시하고 remote origin을 허용하지 않는다. 기존 크기 변경 이벤트 listen/unlisten을 재사용하며, `core:window:default` 또는 전체 창 권한을 추가하지 않는다. 모듈의 창 기능은 기존 SDK·호스트 캡 경로를 유지한다.

## 결과

앱 0.1.1에서 새 제목 표시줄과 기존 모듈 origin 격리·파일 전송을 함께 유지한다. SDK·캡 버전과 브리지 형식은 바뀌지 않는다. 권한 목록과 범위를 회귀 테스트로 고정하며, 컴포넌트 테스트 결과를 실제 네이티브 버튼 검증으로 간주하지 않는다.
