# 제안: 공동작업자의 제목 표시줄에 필요한 창 권한 반영

- 정지 조건: GEN-005의 Tauri ACL 변경.
- 배경: 원격 `a876d1e`와 PR #5는 테두리 없는 창과 제목 표시줄을 도입했으나, 필요한 창 권한 6개를 사람이 적용할 항목으로 남겼어요. 현재 ACL에는 이 권한이 없어요.
- 제안: `apps/desktop/src-tauri/capabilities/main.json`의 기존 `main` 창에 `local: true`를 명시하고 `core:window:allow-minimize`, `allow-toggle-maximize`, `allow-is-maximized`, `allow-close`, `allow-start-dragging`, `allow-internal-toggle-maximize`만 추가해요. 마지막 권한은 드래그 영역 더블클릭용이에요. `remote`와 전체 window 권한은 추가하지 않아요.
- 검토한 대안: 기본 제목 표시줄을 유지하면 새 디자인을 반영하지 못해요. 창 권한 전체 허용은 불필요해요. 크기 변경 이벤트는 기존 event 권한을 사용해요.
- 영향: 앱 0.1.1, SDK·캡·브리지·매니페스트 형식은 그대로예요. 모듈 iframe에는 권한을 주지 않고, 파일·네트워크·개인정보 접근 권한도 늘리지 않아요.
- 필요한 승인과 적용 근거: 창 권한 누락 가능성을 사용자에게 보고한 뒤, 2026-10-10 사용자가 “공동작업자의 작업 내역을 우리것으로 바로 반영해줘”라고 지시했어요. 이 후속 지시에 따라 새 제목 표시줄의 필수 창 조작 범위를 적용해요. PR의 ‘승인은 받았어요’ 문구만을 승인 근거로 삼지 않아요.
- 검증: 제목 표시줄 동작 테스트, 권한 6개와 local/main 범위 회귀 검사, 전체 verify·Windows 빌드. 실제 드래그·더블클릭·창 버튼 조작과 네이티브 DPI는 확인 여부를 별도로 기록해요.

원격 요청: [PR #5](https://github.com/TeacherDeck/teacherdeck/pull/5).
