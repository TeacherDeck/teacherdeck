# 로컬 개발 준비

공동 저장소의 기본 구조를 그대로 사용하며, 개발 명령과 이후 모듈 이식의 출발점을 안내한다. 규범 원천은 [spec](spec/README.md), 작업 지침은 [루트 AGENTS.md](../AGENTS.md)다.

## 이 폴더에서 명령 실행하기

루트의 `dev.ps1`은 [package.json](../package.json)에 지정된 pnpm을 Corepack으로 실행한다. pnpm 캐시와 실행 연결 파일, 자식 프로세스가 함께 쓰는 임시 폴더는 Git에서 제외되는 `.pnpm-store/`에 둔다. 다운로드한 도구 파일은 `.pnpm-store/node_modules/`에 보관한다. 앱이나 검사 명령은 저장소의 기존 스크립트를 그대로 실행하며, 명령이 끝나면 현재 셸의 환경 변수와 작업 위치를 복원한다.

```powershell
.\dev.ps1 --version
.\dev.ps1 install --frozen-lockfile
.\dev.ps1 verify
.\dev.ps1 tauri dev
```

PowerShell의 실행 정책 때문에 스크립트를 직접 실행할 수 없다면 해당 실행에만 다음 형식을 사용한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 --version
```

이후 문서의 `pnpm <명령>`은 이 폴더에서 `.\dev.ps1 <명령>`으로도 실행할 수 있다. 예를 들어 `pnpm new:module`은 `.\dev.ps1 new:module`이다. 최초 설치와 의존성 다운로드에는 인터넷이 필요하다.

## Windows 앱 개발 준비물

| 도구          | 저장소가 지정한 조건                                                  | 확인 기준                                     |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Node.js       | 24 이상                                                               | [package.json](../package.json)               |
| pnpm          | 12.10.1                                                               | 같은 파일의 `packageManager`                  |
| Rust          | 1.98.0, rustfmt, clippy, Windows MSVC 대상                            | [rust-toolchain.toml](../rust-toolchain.toml) |
| C++ 빌드 도구 | Visual Studio Build Tools 2022의 C++ 데스크톱 개발 도구와 Windows SDK | [README](../README.md#개발-환경)              |
| WebView2      | Windows 앱 실행에 필요                                                | 같은 문서                                     |
| cargo-deny    | 전체 검증의 라이선스·의존성 검사에 필요                               | [검증 절차](spec/ci.md#1-pnpm-verify)         |
| gitleaks      | 선택 사항, 비밀값 검사 권장                                           | [README](../README.md#개발-환경)              |

Rust와 C++ 빌드 도구는 JavaScript 의존성 설치로 준비되지 않는다. C++ 빌드 도구 설치는 시스템 변경과 관리자 권한이 필요하므로 Windows 개발 환경을 갖출 때 별도로 진행한다. Rustup을 설치한 뒤 저장소 루트에서 다음 명령으로 고정된 도구 모음을 준비한다.

설치 안내는 [Tauri의 Windows 준비물](https://v2.tauri.app/start/prerequisites/#windows)과 [Rust 공식 설치 안내](https://rust-lang.org/tools/install/)에서 확인할 수 있다.

```powershell
.\dev.ps1 exec rustup toolchain install 1.98.0 --profile minimal --component rustfmt --component clippy --target x86_64-pc-windows-msvc
.\dev.ps1 exec cargo install cargo-deny --locked
.\dev.ps1 verify
.\dev.ps1 tauri build
.\dev.ps1 tauri dev
```

`verify:fast`도 Rust 없이 완전히 통과하지 않는다. 모듈 검사에서 실제 Rust 매니페스트 검증을 실행한다. 전체 `verify`는 타입·스키마 생성 비교부터 Rust 컴파일을 요구한다. 검사 단계를 빼거나 생성물을 손으로 수정하지 않는다.

## 개발 작업 시작점

- 기존 프로그램을 가져오는 절차: [모듈 이식 안내](MODULE_MIGRATION.md)
- 기본 모듈 예제: [타이머 진입점](../modules/timer/src/main.tsx), [순수 로직](../modules/timer/src/timer.ts), [설정 저장](../modules/timer/src/presets.ts)
- 새 모듈 생성과 완료 조건: [modules/AGENTS.md](../modules/AGENTS.md)
- 현재 호스트 기능과 예정 기능: [capabilities.md](spec/capabilities.md)
- 확정된 제품 요구와 개발 순서 권고: [제품 개발 계획 초안](PRODUCT_PLAN.md)

받은 기존 소스와 사용자 요구를 바탕으로 도구별 사용 기능을 현재 호스트 기능과 대조하고, 순수 로직·UI·파일 입출력을 나누어 이식한다.

## 초기 준비 기록 — 2026-10-10

최초 준비의 출발점은 `origin/main`의 `a7f2f6fec44b0768256da9f89d476b26331b2a37`이었다. 아래 표는 이 최초 준비 시점의 기록이며, 현재 기준은 뒤의 최신 변경 반영 기록을 따른다.

| 항목                           | 확인 결과                                                                 |
| ------------------------------ | ------------------------------------------------------------------------- |
| Node.js / pnpm                 | 24.14.1 / 12.10.1                                                         |
| Rust / cargo-deny              | 1.98.0 / 0.20.2                                                           |
| Visual Studio Build Tools 2022 | 17.14.41, C++ 도구와 Windows SDK 설치 완료                                |
| WebView2                       | 기존 Runtime 확인                                                         |
| 의존성 설치                    | `dev.ps1 install --frozen-lockfile` 통과                                  |
| 전체 검증                      | `dev.ps1 verify` 15단계 통과                                              |
| 테스트                         | JavaScript 126개, Rust 55개 통과                                          |
| 실행기                         | PowerShell 5/7 실행, 실패 종료 코드 전달, 환경 변수와 작업 위치 복원 확인 |
| Windows 설치본                 | `dev.ps1 tauri build` 통과, NSIS 설치본 생성(8.04 MiB)                    |
| 앱 시작                        | 빌드된 실행 파일의 메인 창 생성·응답 확인 후 정상 종료                    |
| 기본 타이머                    | `timer` 0.1.0 패키지 생성, 실제 호스트 시작 로그에서 `Ready` 확인         |

Rustup은 전역 PATH를 바꾸지 않고 설치했다. `dev.ps1`이 현재 사용자의 `.cargo/bin`을 자식 프로세스의 PATH에 추가하므로 Cargo/Rustup 명령도 `dev.ps1 exec cargo ...`, `dev.ps1 exec rustup ...`으로 실행할 수 있다.

전체 검증 중 `cargo-deny`는 기존 의존성의 중복 버전 경고를 출력했으며, advisories·bans·licenses·sources 검사는 모두 통과했다. 실제 파일 내용 읽기·결과 저장 API와 원격 모듈 설치는 [이식 안내서의 현재 구현 범위](MODULE_MIGRATION.md#2-현재-구현된-기능과-아직-없는-기능)를 따른다.

빌드 결과는 `target/release/teacherdeck.exe`와 `target/release/bundle/nsis/TeacherDeck_0.0.0_x64-setup.exe`에 있다. 이 기록의 앱 시작 검사는 빌드된 실행 파일과 동봉 리소스로 수행했다. NSIS 설치·제거 흐름이나 타이머의 모든 화면 조작을 검증한 기록은 아니다. Vite는 기존 셸 번들의 500KB 초과 경고를 출력했고 빌드는 정상 완료됐다.

## 최신 변경 반영 — 2026-10-10

`origin/main`의 `8a71d02163b8cba349dd23831167c97be2382ea4`까지 네 커밋을 fast-forward로 반영했다. 로컬 준비 파일은 유지했으며 반영 전 사본은 `target/local-prep-backups/`에 보관했다. 의존성은 frozen lockfile로 동기화했다.

- `33f164e`: 단독 병합 정책과 저장소 운영 문서 정합성 정리.
- `68353b4`: WinUI 공통 컨트롤·타입 램프·시스템 폰트, 공통 카드와 UI 갤러리 확장.
- `766210b`: 타이머를 새 공통 컨트롤로 전환, 모듈 0.2.0.
- `8a71d02`: 모듈의 Fluent 직접 import를 MOD-010 린트로 차단.

모듈 UI는 스타일 도구를 포함해 `@deck/ui`에서 가져오고 아이콘만 `@fluentui/react-icons`에서 가져온다. [이식 안내](MODULE_MIGRATION.md#44-화면을-공통-ui에-맞춰요)를 같은 기준으로 갱신했다. 파일 입출력·공통 명부·OS 연동 캡이 이번 변경으로 늘어난 것은 아니다.

최신 기준의 `dev.ps1 verify`는 15단계 모두 통과했다. JavaScript 133개와 Rust 55개, 총 188개 테스트가 통과했다. `dev.ps1 tauri build`도 성공했으며 타이머 0.2.0이 기본 모듈 인덱스에 포함됐다. NSIS 설치본 크기는 5,453,124바이트(5.20 MiB)다.

빌드된 실행 파일에서 TeacherDeck 메인 창의 생성·응답을 확인하고 시험 프로세스를 정상 종료했다. 이 검사는 설치·제거, 모든 컨트롤 조작, 실제 Windows 텍스트/DPI 배율 검증까지 수행했다는 뜻은 아니다. 기존 cargo-deny 중복 의존성 경고와 Vite의 큰 JS 청크 경고는 남아 있으며 검사·빌드는 성공했다. 최종 원격 main 조회에서도 같은 `8a71d02`를 확인했다.
