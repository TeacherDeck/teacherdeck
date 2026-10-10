# 클립보드 전이 의존성 라이선스 예외 승인 제안

상태: 사용자 승인 완료 (2026-10-10). 정확한 버전 예외와 chrono 직접 의존성을 승인 범위대로 적용한다.

승인한 arboard 3.6.1의 Windows 의존성 두 개가 기존 전역 라이선스 목록에 없는 BSL-1.0을 사용해 `cargo deny check licenses`가 실패했다. 기능·버전 추가 승인과 별도로 GEN-005의 라이선스 정책 변경 승인을 요청한다.

| 정확한 패키지 | SPDX | 원천 |
| --- | --- | --- |
| clipboard-win 5.4.1 | BSL-1.0 | [게시된 버전 Cargo.toml](https://docs.rs/crate/clipboard-win/5.4.1/source/Cargo.toml), [저장소](https://github.com/DoumanAsh/clipboard-win) |
| error-code 3.4.0 | BSL-1.0 | [게시된 버전 Cargo.toml](https://docs.rs/crate/error-code/3.4.0/source/Cargo.toml), [저장소](https://github.com/DoumanAsh/error-code) |

게시된 두 crate의 로컬 registry Cargo.toml과 LICENSE 원문을 대조했다. BSL-1.0은 Boost Software License 1.0이다. [SPDX 원문](https://spdx.org/licenses/BSL-1.0.html). 기존 저작자·라이선스 고지는 유지하고 생성된 About 목록에 포함한다.

## 승인할 정확한 변경

`deny.toml`의 기존 `exceptions = []`만 아래로 교체한다. 전역 `allow`에 BSL-1.0을 넣지 않는다.

```toml
exceptions = [
  { name = "clipboard-win", version = "=5.4.1", allow = ["BSL-1.0"] },
  { name = "error-code", version = "=3.4.0", allow = ["BSL-1.0"] },
]
```

[cargo-deny 공식 설정](https://embarkstudios.github.io/cargo-deny/checks/licenses/cfg.html#exceptions)은 패키지별 예외와 version 조건을 지원한다. 사용 중인 cargo-deny 0.20.2의 Exception→PackageSpec 구현도 확인했다. 정확한 버전의 두 crate에만 적용하며 향후 버전 변경은 새 승인을 받는다.

`tools/checks/licenses.allow.json`은 변경할 필요가 없다. 현재 검사기는 그 파일의 전역 licenses와 deny.toml 전역 allow를 비교하고, JSON packages 예외는 npm 패키지 이름·라이선스·사유만 지원한다. 버전 필드는 지원하지 않는다. Rust 패키지에 무효한 JSON 예외를 추가하거나 검사기 로직을 변경하지 않고 cargo-deny의 기존 정확한 버전 예외로 제한한다. ADR-0016에 승인 날짜·범위를 기록한다.

## 검증과 대안

승인 후 cargo deny check licenses, pnpm check:licenses, pnpm gen, pnpm verify를 실행한다. 다른 버전이나 다른 BSL crate는 계속 거부되는지 고정 lock와 예외 조건을 확인한다. QuickCapture 승인 의존성도 전이 라이선스를 먼저 조사하여 추가 예외가 있다면 한 번에 구체적으로 승인받는다.

전역 BSL 허용은 향후 모든 crate를 승인 없이 허용하므로 채택하지 않는다. 직접 Win32 FFI 대체는 새 unsafe/API 승인이 필요하고 검증 부담을 늘린다. 클립보드 라이브러리를 버전만 낮추는 대안은 기능·보안·license 재조사와 새 dependency 승인이 필요하다.

사용자 승인 문구: “승인한 클립보드 라이브러리가 사용하는 clipboard-win 5.4.1과 error-code 3.4.0에만 Boost 라이선스 예외를 추가해도 될까요? 전체 허용 목록은 유지하고, 다른 패키지나 버전은 계속 검사합니다.”
## QuickCapture 로컬 시각 의존성 승인

원본 파일명의 HHMMSS/YYMMDD는 PC의 로컬 시각이다. Rust std는 로컬 날짜·시각 변환을 제공하지 않으며 직접 Win32 FFI와 외부 명령 실행은 이번 승인 범위에 없다. 기존 Cargo.lock에 이미 포함된 chrono 0.4.44를 Windows host의 직접 의존성으로 추가한다.

```toml
chrono = { version = "=0.4.44", default-features = false, features = ["clock"] }
```

원천: [chrono 0.4.44 메타데이터](https://docs.rs/crate/chrono/0.4.44), [공식 기능 설정](https://docs.rs/chrono/0.4.44/chrono/#features), [저장소 라이선스](https://github.com/chronotope/chrono/blob/v0.4.44/LICENSE.txt). MIT OR Apache-2.0으로 기존 허용 정책에 맞는다. clock은 Local::now의 안전한 OS 시간 래퍼를 사용하기 위해 필요하다. 네트워크·시간대 다운로드·FFI 코드를 레포에 추가하지 않는다. 이미 존재한 transitive crate를 직접 이름으로 사용하도록 선언하므로 기존 선택된 Windows 시간 의존성과 lock의 실제 feature 결합을 확인하고 추가 라이선스가 없는지 다시 검증한다.

승인 범위는 두 BSL crate의 정확한 버전 예외 및 chrono 0.4.44 Windows-only 직접 의존성(clock)이다. 전역 license 목록과 unsafe 정책은 유지한다. 승인 전 chrono 의존성 선언도 하지 않았다.