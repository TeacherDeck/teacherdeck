# TeacherDeck

선생님들이 자주 쓰는 작은 Windows 도구를 하나의 앱("덱")에 모아 두는 무료 오픈소스 프로젝트예요. 한 번 설치하면 업데이트로 새 도구가 계속 추가돼요.

> **개발 초기 단계예요.** 파일·이미지·PDF·수업·Windows 연동 도구를 개발하고 있어요. 아직 정식 릴리스는 없어요. 확인된 동작과 남은 검수는 [개발 현황](docs/DEVELOPMENT_STATUS.md)을 보세요.

## 무엇을 하나요

- 이미지 크롭, 파일명 일괄 변환, 개인정보 마스킹, 문서 변환, PDF 도구 같은 사무 도구
- 타이머, 자리 배치, 모둠 편성 같은 수업 도구
- 로컬 메모·D-day 같은 작은 업무 도구
- 도구는 모듈로 만들어져서, 앱을 다시 설치하지 않아도 새 도구를 받을 수 있어요.

## 약속

**변환·분석은 PC 안에서 처리해요. 쿨메신저 예약 등록은 사용자가 확인한 수신자·내용·첨부를 로그인한 쿨메신저로 전달해요.** 문서·명단은 외부로 보내지 않으며 사용 통계를 수집하지 않아요.

- 사용 통계나 오류 보고를 자동으로 보내지 않아요.
- 원본 파일을 마음대로 덮어쓰거나 지우지 않아요.
- 관리자 권한 없이 설치할 수 있어요.

자세한 내용: [개인정보 원칙](docs/spec/privacy.md)

공통 화면과 아이콘의 기준은 [기본 앱·모듈 디자인 계획](docs/proposals/app-module-design-2026-10-11.md)에 있어요. 도구마다 핵심 작업 흐름을 유지하면서 홈의 빠른 실행, 기능별 아이콘, 입력·실행·결과의 위치를 일관되게 다듬고 있어요.

## 개발 환경

Windows 10/11에서 개발해요.

| 도구                          | 버전                                   |
| ----------------------------- | -------------------------------------- |
| Node.js                       | LTS                                    |
| pnpm                          | corepack으로 활성화(`corepack enable`) |
| Rust                          | stable, `x86_64-pc-windows-msvc`       |
| Visual Studio C++ Build Tools | 2022                                   |
| WebView2 Runtime              | Windows 11 기본 포함                   |
| git                           | 최신                                   |

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

새 설치본 빌드가 성공하면 이전 설치 파일과 오래된 모듈 패키지를 자동 정리해요. 실패한 빌드는 기존 설치본을 보존해요. 정리 범위와 수동 확인 방법은 [빌드 산출물 정리](docs/development-build-cleanup.md)에 있어요.

Windows 전체 검증·개발 실행·빌드는 쿨 예약실의 승인된 Python 실행 환경을 앱 내부에 준비해요. 처음에는 공식 배포 파일을 내려받아 해시를 검사하고, 이후에는 캐시와 준비된 파일을 확인해 재사용해요. `pnpm verify`도 Rust 빌드 전에 이 단계를 실행하므로 새 체크아웃에 앱 실행 이력이 없어도 검증할 수 있어요. 전역 Python 설치는 필요 없어요. 완성된 설치본은 실행 환경을 함께 포함해요. 원작 코어·모듈 갱신 절차는 [쿨 예약실 안내](modules/coolreserve/README.md)에 있어요.

한글 변환용 제한 보안 모듈도 저장소 소스로 빌드해 동봉해요. 이때 고정 Rust 도구체인의 `i686-pc-windows-msvc` 대상이 필요하며 준비 스크립트가 설치 여부를 확인해요. 한글에 작업용 보안 모듈을 등록하지 못하면 변환을 중단하고 직접 변환을 안내해요. 0.5.1에서 이 PC의 한글 2024로 실제 HWP→HWPX 저장·재열기·원본 보존을 확인했어요. 확인한 문서 범위와 남은 제한은 [변환 검수](docs/reviews/hancom-conversion-2026-10-11.md)에 있어요.

새 도구를 만들 때는 `pnpm new:module <id>`로 시작해요. 자세한 절차는 [modules/AGENTS.md](modules/AGENTS.md)에 있어요.

로컬 명령 실행과 준비물은 [로컬 개발 준비](docs/LOCAL_SETUP.md), 기존 프로그램을 모듈로 옮기는 절차는 [모듈 이식 안내](docs/MODULE_MIGRATION.md)를 보세요.

기존 도구를 재구성하는 사용자 요구와 개발 순서 권고는 [제품 개발 계획 초안](docs/PRODUCT_PLAN.md)에 정리했어요.

개발 현황과 실제 검증 범위는 [개발 현황](docs/DEVELOPMENT_STATUS.md)에 정리했어요.

현재 화면의 동선·정보 배치 개선 제안은 [디자인 개선 계획](docs/proposals/design-improvements-2026-10-11.md)에 있어요.

도구별 사용법과 지원 범위예요.

- 파일·문서: [파일명 작업기](modules/file-rename/README.md), [문서 변환](modules/office-convert/README.md), [PDF 압축](modules/pdf-compress/README.md), [PDF 개인정보 지우기](modules/pdf-mask/README.md)
- 이미지: [이미지 압축](modules/image-compress/README.md), [명렬표 사진 추출](modules/photo-extract/README.md), [이미지 자르기](modules/image-crop/README.md), [퀵캡처](modules/quick-capture/README.md)
- 수업·업무: [회의록](modules/meeting-note/README.md), [지도일 배정](modules/duty-planner/README.md), [발표자 뽑기](modules/presenter-picker/README.md), [모둠 편성](modules/group-planner/README.md), [자리 배치](modules/seat-planner/README.md), [역할·당번 배정](modules/role-planner/README.md)
- 작은 도구: [빠른 메모](modules/quick-note/README.md), [D-day](modules/dday/README.md), [QR 코드 만들기](modules/qr-maker/README.md)
- 보류: [영상 다운로드](modules/youtube-download/README.md)는 기본 모듈에서 빠져 덱에 나타나지 않아요([#15](https://github.com/TeacherDeck/teacherdeck/issues/15)).
- Windows 연동: [네트워크 루틴](modules/network-routine/README.md), [쿨 예약실](modules/coolreserve/README.md)

설정의 공통 학급 자료에서 명부·시간표를 관리하고 수업 도구에서 선택해 불러올 수 있어요. 공통 자료에 등록하지 않고 각 도구에 직접 명단을 넣어 작업해도 돼요. TimeAlert DB7 암호화 백업을 열어 공통 자료를 가져오고, 연결된 원작의 비공개 기록·사진을 보존한 백업을 새로 저장할 수 있어요. 원작 백업 연결을 닫거나 앱을 종료하면 원형 보존 세션도 끝나므로 다시 보존하려면 원작 백업을 열어 주세요. 연결 없는 출력에는 현재 공통 자료·사진만 포함돼요. 자세한 호환 범위와 한도는 [TimeAlert 백업 안내](apps/desktop/src-tauri/src/timealert/README.md)에 있어요.

자리·발표·모둠·역할 결과는 선택한 모니터의 별도 학생 화면에 표시할 수 있어요. 교사용 조건과 비공개 기록은 보내지 않아요. 모니터 구성 변경 시 공개 결과를 비우고 다시 화면을 선택하도록 안내하며, 메인 앱을 종료하면 학생 화면도 닫아요.

주간 시간표는 수업을 고른 뒤 요일·교시 칸을 눌러 여러 칸에 연속으로 배치해요. 칸 비우기와 XLSX·텍스트 붙여넣기도 지원하며, **시간표 저장**을 눌러야 변경을 보관해요.

**명부·시간표 복구 JSON 저장**은 이 PC에 저장된 모든 학기의 명부·수업 연결·일과 시각·시간표·날짜 변경을 복구용 파일로 만들어요. 사진 파일과 화면의 미저장 수정은 포함하지 않아요. 사진을 포함한 이동용 전체 백업이 아니며, 같은 PC에서 명부·시간표를 복구할 때 사용해요.

**현재 화면 시간표 PNG 저장**은 지금 보이는 교시와 수업 배치를 이미지로 만들어요. 미저장 수정도 포함하지만 학교 자료를 저장하지는 않아요. 일과 시각·날짜 변경·사진은 담지 않아요. JSON·PNG 모두 선택한 폴더에 새 파일로 저장하며 같은 이름의 파일이 있으면 번호를 붙여 기존 파일을 보존해요.

TimeAlert의 남은 기능은 [사용자 후속 작업](docs/TIMEALERT_BACKLOG.md)으로 기록했어요. 여러 도구·학생·교사 자료를 설정에서 한 번에 백업하고 복구하는 [자료 관리 설계](docs/proposals/local-data-management.md)를 작성했으며, 통합 화면 구현은 후속 단계예요. 현재 메모·D-day는 도구 안에서 개별 JSON 백업·불러오기를 제공해요.

최근 구현과 검증 결과, 남은 작업은 [개발 현황](docs/DEVELOPMENT_STATUS.md)에 정리했어요.

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
