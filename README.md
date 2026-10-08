# TeacherDeck

선생님들이 자주 쓰는 작은 Windows 도구를 하나의 앱("덱")에 모아 두는 무료 오픈소스 프로젝트예요. 한 번 설치하면 업데이트로 새 도구가 계속 추가돼요.

> **개발 초기 단계예요.** 앱 골격과 첫 도구(타이머)가 있어요. 아직 정식 릴리스는 없어요.

## 무엇을 하나요

- 이미지 크롭, 파일명 일괄 변환, 개인정보 마스킹, 문서 변환, PDF 도구 같은 사무 도구
- 타이머, 자리 배치, 모둠 편성 같은 수업 도구
- 도구는 모듈로 만들어져서, 앱을 다시 설치하지 않아도 새 도구를 받을 수 있어요.

## 약속

**모든 처리는 PC 안에서 하고, 파일과 개인정보는 외부로 나가지 않아요.**

- 사용 통계나 오류 보고를 자동으로 보내지 않아요.
- 원본 파일을 마음대로 덮어쓰거나 지우지 않아요.
- 관리자 권한 없이 설치할 수 있어요.

자세한 내용: [개인정보 원칙](docs/spec/privacy.md)

## 개발 환경

Windows 10/11에서 개발해요.

| 도구 | 버전 |
|---|---|
| Node.js | LTS |
| pnpm | corepack으로 활성화(`corepack enable`) |
| Rust | stable, `x86_64-pc-windows-msvc` |
| Visual Studio C++ Build Tools | 2022 |
| WebView2 Runtime | Windows 11 기본 포함 |
| git | 최신 |

처음 한 번 준비해요.

```powershell
corepack enable              # pnpm 활성화 (버전은 package.json의 packageManager를 따라요)
cargo install cargo-deny --locked
pnpm install                 # 의존성 설치 + git 훅(lefthook) 설치
```

자주 쓰는 명령이에요.

```powershell
pnpm verify          # 전체 검증 (CI와 같음). 커밋 전에 꼭 실행해요
pnpm verify:fast     # lint + typecheck + 모듈 검사 (커밋할 때 자동 실행)
pnpm gen             # 생성물 갱신
```

앱을 실행하고 설치본을 만들어요.

```powershell
pnpm tauri dev       # 개발 실행 (기본 모듈을 번들한 뒤 실행해요)
pnpm tauri build     # NSIS 설치본: target/release/bundle/nsis/
```

새 도구를 만들 때는 `pnpm new:module <id>`로 시작해요. 자세한 절차는 [modules/AGENTS.md](modules/AGENTS.md)에 있어요.

비밀값 검사를 위해 [gitleaks](https://github.com/gitleaks/gitleaks) 설치를 권장해요(`winget install Gitleaks.Gitleaks`).

## 기여하기

[CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요. AI 에이전트로 작업한다면 [AGENTS.md](AGENTS.md)부터 시작해요. 규격 문서는 [docs/spec](docs/spec/README.md), 설계 결정은 [docs/adr](docs/adr/)에 있어요.

보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 방법으로 알려 주세요.

## 라이선스

Copyright (C) 2026 신민성, 정영주

- 소스 코드는 [GPL-3.0-only](LICENSE)로 배포돼요. 수정해서 배포할 때도 소스를 같은 라이선스로 공개해야 해요.
- [추가조항(제7조(b))](LICENSE-ADDITIONAL-TERMS): 정보/크레딧 화면의 원저작자 표기와 모듈 저자 표기를 유지해야 해요.
- 이름 "TeacherDeck"과 로고는 GPL 대상이 아니에요. 포크는 이름을 바꿔야 해요. [상표 정책](TRADEMARK.md)을 보세요.
- 저자 목록: [AUTHORS](AUTHORS)

이 프로그램은 어떠한 보증도 없이 제공돼요. 자세한 내용은 GPL-3.0 전문을 보세요.
