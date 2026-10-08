# ADR-0006: NSIS 사용자별 설치, Tauri updater, GitHub Releases

- 상태: 승인됨
- 날짜: 2026-10-08
- 결정자: 신민성, 정영주

## 맥락

학교 PC에서 교사는 관리자 권한이 없는 경우가 많다. 망분리·웹 필터 때문에 외부 다운로드가 막힐 수 있고, 백신이 서명되지 않은 실행 파일을 차단할 수 있다. 한 번 설치하면 업데이트로 계속 새 도구를 받아야 한다.

## 결정

- 설치 프로그램은 NSIS **사용자별 설치**(`installMode: currentUser`)다. 관리자 권한이 필요 없다.
- WebView2 부트스트래퍼를 설치 프로그램에 내장한다(`embedBootstrapper`).
- 앱 업데이트는 Tauri updater로 하며 서명을 검증한다. 자동 재시작하지 않는다(SEC-008).
- 배포처는 GitHub Releases다.
- **업데이터 서명키(신뢰 루트)와 모듈 서명키를 분리한다.** 모듈 서명 공개키는 앱에 내장되어 updater로 배포된다.
- 앱 식별자(`identifier`)는 **`io.github.teacherdeck.deck`**이다. 출시 후 바꾸지 않는다.

## 결과

- 키 보관·회전 정책: [keys.md](../security/keys.md).
- updater 공개키와 endpoint는 Phase 4에서 `TODO(human)`으로 둔다.
- Authenticode 코드 서명은 범위 밖이며 `TODO(human): SignPath`로 남긴다. 서명 전에는 SmartScreen 경고가 뜰 수 있다.
- 릴리스 워크플로와 시크릿 규칙: [ci.md](../spec/ci.md) (CI-004).

## 대안

- **MSI(머신 단위)**: 관리자 권한이 필요하다.
- **MSIX**: 정책·사이드로딩 제약이 학교마다 달라 설치 실패 위험이 있다.
- **포터블 zip**: 설치는 쉽지만 업데이트와 WebView2 보장이 어렵다.
