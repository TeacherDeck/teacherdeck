# ADR-0001: 앱 셸은 Tauri 2 + WebView2

- 상태: 승인됨
- 날짜: 2026-10-08
- 결정자: 신민성, 정영주

## 맥락

학교 교무실·교실 PC는 Windows 10/11이고 사양이 낮을 수 있으며 관리자 권한이 없을 수 있다. 설치 크기와 메모리 사용량이 작아야 하고, Windows 11다운 외관이 필요하다. 네이티브 기능(파일 대화상자, 창 제어, 이후 Office 변환·OCR)도 써야 한다.

## 결정

- 앱 셸은 Tauri 2(Rust)와 시스템 WebView2로 만든다.
- Windows 11에서는 창 배경에 Mica를 적용하고, Windows 10에서는 불투명 배경으로 폴백한다.

## 결과

- 설치본이 작고, Chromium을 동봉하지 않는다. WebView2 런타임은 설치 프로그램이 부트스트래퍼로 보장한다([ADR-0006](0006-distribution-and-updates.md)).
- 네이티브 코드는 Rust로 쓰며 호스트에만 둔다([ADR-0002](0002-module-architecture.md)).
- Tauri 2와 플러그인 API는 버전 간 차이가 크다. 구현 시 설치된 버전의 타입 정의와 공식 문서로 확인한다.
- Mica 구현은 기존 `banatic/Hypercool` 구현을 참고한다([design-system.md](../spec/design-system.md#3-mica와-배경)).

## 대안

- **Electron**: 개발은 쉽지만 설치본과 메모리가 커서 저사양 학교 PC에 부담이다.
- **WinUI 3 / .NET**: 네이티브 외관은 가장 좋지만 모듈을 웹 번들로 독립 배포하는 구조와 맞지 않고, 기여자 진입 장벽이 높다.
