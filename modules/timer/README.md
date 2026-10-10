# 타이머

Space로 시작·일시정지, R로 리셋, F로 발표 모드를 바꿔요. 입력 중이거나 버튼에 초점이 있으면 그 컨트롤의 기본 키 동작을 유지해요. 길게 누른 단축키는 한 번만 실행해요. 발표 숫자는 화면 폭과 높이에 맞춰 크기를 정하고 숫자의 줄 높이와 버튼 영역을 따로 확보해요.

경과 시간은 `performance.now()`의 단조 증가 시간을 사용해요. 사용자가 PC 시각을 바꾸거나 자동 시각 보정이 일어나도 남은 시간이 변하지 않아요. 모듈이 숨겨졌거나 갱신이 지연된 시간도 경과 시간에 포함해요. Windows WebView2에서 절전·최대 절전 중 지난 시간도 복귀 뒤 첫 갱신에 반영하는 정책이에요. 절전 중 알림은 실행되지 않으며 남은 시간이 지났으면 복귀 뒤 종료를 표시해요. 절전 전에 일시정지하면 지난 시간을 세지 않아요. 앱을 종료하면 타이머를 다시 시작해야 해요.

단조 증가 시계의 기준은 [W3C High Resolution Time](https://www.w3.org/TR/hr-time-3/)이며 Windows의 절전 포함 경과 시간은 [Microsoft QPC 설명](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)을 참고해요. 실제 학교 PC의 WebView2와 절전·복귀 조합은 Windows 실기 검수 대상이에요.
