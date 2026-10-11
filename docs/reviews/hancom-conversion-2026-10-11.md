# HWP→HWPX 실제 변환 검수 — 2026-10-11

## 결과

현재 PC의 한글 2024 13.0.0.3189(x86)에서 HWP 생성, 생산 변환 작업자의 HWPX 저장, 한글에서 결과 재열기, 원본 해시·본문·기본 서식 검사와 정상 종료 정리를 통과했다. 컴퓨터 유즈와 확인창 자동 클릭은 사용하지 않았다. 실존 문서는 사용하지 않고 개발 전용 합성 문서만 사용했다.

| 검사 | 증거 | 결과 |
|---|---|---|
| 첫 전체 실행 | `132478e49398b78efb24acb72d844b7c/report.json` | `success: true` |
| 두 번째 독립 전체 실행 | `40cde93ad25fce2a4360ab151234b85e/report.json` | `success: true` |
| 생산 변환 단계 | 각 `synthetic.stages.log` | `hancom-open-begin` → `hancom-save-begin` → `hancom-reopen-begin` → `complete` |
| 원본 보존 | 실행 전후 SHA-256 비교 | 일치 |
| 패키지·본문·서식 | Rust namespace/manifest/style 검사와 독립 Python 검사 | ZIP 11개 항목, XML/HPF 8개, 한글·영문 3문단 순서와 모든 텍스트 run의 18pt 굵은 서식 일치 |
| 정상 종료 | 각 fixture·변환 직후 살아 있는 Hwp 확인 | 잔류 없음 |
| 시간 초과 | 소유 자식 시작 후 합성 지연 | `timeoutCleanup: true` |
| 취소 | COM 보조 프로세스를 Job에 편입한 뒤 합성 지연 | `cancellationCleanup: true` |
| 중단 검사 후 원본 | `--hancom-stop-proof` | `sourcePreserved: true`, 전체 8,442ms |
| 최종 정리 확인 | 실제 프로세스·HKCU 등록값 읽기 | 살아 있는 Hwp 0개, `TeacherDeck-Hwp-*` 등록값 0개 |

식별자는 레포 내부 `target/next-tools/office-qa/`의 하위 폴더다. 이 임시 산출물은 Git에 포함하지 않는다. 첫 입력 SHA-256은 `77934d65328490bc4795efeca8d8e0d2bfa81d710848b0a72fc818b4861e697d`, 출력은 `23794e77f99d11aaf4815e20ed3b7f25b79bbe95a5681dd98a20abd37767e2c4`다.

### 릴리스 실행 파일 검증

최신 원격 변경을 병합하고 다시 만든 0.5.1 NSIS 설치본과 동일한 `target/review-040/release/teacherdeck.exe`의 실제 `--deck-native-worker office` 진입점도 합성 문서로 별도 실행했다. 부모가 만든 전용 Job에 작업자를 넣고 고정 요청을 전달했다. `target/hwp-focus/release-proof/9b70419892a048af93d598ef408f986c/report.json`의 `releaseWorkerSucceeded`, `sourcePreserved`, `processCleanup`, `registrationCleanup`이 모두 true다. 독립 Python 검사도 ZIP/XML, 문단, 18pt 굵은 서식을 통과했다. 원본 SHA는 위 첫 입력과 같고 출력은 `32d63e56711debcdbcdfd48e6ed7523f450bbe27cfcbc11ac3bbe0270b6af023`다. 병합 전 릴리스 검증 `ba1285e5f0094399828062e10082756d`의 성공 기록도 별도로 보존했다.

- 실행 파일 SHA-256: `d81dd7fc21e53e09d92f5d3d684300fc1a6a54878ba5d61753ef282de2ee5c06`
- 설치본: `target/review-040/release/bundle/nsis/TeacherDeck_0.5.1_x64-setup.exe`
- 설치본 SHA-256: `0672cd13386334ef56dab6cc870136cdb5d8be9a2c68eaa4c229b70a587ee271` (39,159,391바이트·37.35MiB)
- 동봉 모듈: 19개. 영상 다운로드의 기본 배포 보류를 유지했다.
- 동봉 문서 변환 모듈: 0.2.1, 카탈로그 SHA와 `.deckmod` 실물 SHA `7c15aa58bdd0820a54c8fa54e5e6471b1448377fb4e22a6a5a9d28c8f1227546` 일치
- 빌드 로그: `target/hwp-focus/build-051-merged.log`, 묶음 대조: `bundle-051-merged.json`

설치·제거 UI를 실행한 검수는 아니다. 실제 실행 파일의 변환 작업자와 결과를 확인했다.

### 저장소 검사

최신 원격 변경을 통합한 최종 `pnpm verify` 16단계가 모두 통과했다. JavaScript 147파일·1,332개, Rust core 104개·host 169개·제한 DLL 3개 테스트다. 별도로 `office_synthetic`의 29개 회귀 테스트와 전체 target의 Clippy도 통과했다. 최종 검사 로그는 `target/hwp-focus/verify-051-merged-final.log`, 별도 회귀 시험은 `example-tests-051.log`에 남겼다. 저장소가 지정한 pnpm 12.10.1을 사용했으며, 이전 pnpm 11의 라이선스 목록 차이를 생성물 수동 편집으로 처리하지 않았다.

병합 전 검사에서는 기존 메모 시험이 확인창 종료 직후 남은 `aria-hidden` 때문에 버튼을 찾지 못한 간헐 실패가 한 번 있었다. 자료 보존 검사는 통과했고 같은 시험 파일 5개와 전체 1,330개를 재실행해 통과했다. 이후 원격의 확인창 시험 안정화 수정을 그대로 통합했다. 병합 후 첫 전체 실행에서는 시간표 가져오기 시험도 저장 완료 뒤 같은 접근성 복원 지연으로 한 번 실패했다. 해당 시험은 변경하지 않았고, 독립 15개와 최종 전체 1,332개 재실행이 모두 통과했다. 실패·독립 재실행 로그도 각각 `verify-051-merged.log`, `school-data-recheck.log`에 보존했다.

## 수정한 원인

1. 설치된 한글의 `RegisterModule`은 `VT_BOOL` 성공값에 `+1`을 썼다. 일반 `VariantToBoolean` 경유 해석에서는 이것이 거짓으로 바뀌었다. 실제 variant 종류가 `VT_BOOL`인지 확인한 뒤 원래 값의 0/비0을 해석한다. 0, +1, -1 회귀 검사를 추가했다.
2. `SaveAs`의 선택 문자열 인자에 빈 Rust 문자열을 전달하면 NULL BSTR가 됐다. 설치된 한글 내부에서 이 문자열을 읽다가 서버 오류가 발생했다. 생략 가능한 인자는 `DISP_E_PARAMNOTFOUND`로 전달한다. `Open`의 형식 선택 인자도 같은 생략값을 사용한다.
3. COM 단독 시작 경로에서는 한글이 고유 HKCU 등록값을 읽지 못했다. 등록된 실행 파일을 작업자의 소유 자식으로 직접 시작하면 같은 등록값이 보였다. 운영체제 내부 격리 원인을 확정하지는 않았다.
4. COM 활성화가 만든 별도 SCM 보조 프로세스는 자식 Job에 자동 포함되지 않았다. 실제 CoCreate 구간에 새로 생긴 유일한 후보의 이미지·정확한 인수·사용자·세션·비표시 창 상태를 확인하고 동일 핸들로 소유 Job에 편입한다. 사용자가 열어 둔 한글은 시작 전에 거부한다.
5. Job 종료 요청과 Windows의 프로세스 목록 갱신 사이에 시차가 있었다. 소유 Job의 종료를 기다리고, 목록에 남아 있어도 종료 코드가 확인된 프로세스는 실행 중으로 오인하지 않는다. 읽지 못하거나 살아 있는 프로세스는 계속 사용 중으로 판단한다.

세부 승인 범위와 프로세스 소유 검사는 [ADR-0027](../adr/0027-scoped-hancom-path-check.md)에 있다. 과거 실패 과정은 [초기 진단](hancom-save-timeout-followup-2026-10-11.md)에 보존했다.

## 검증의 한계

- 실제 시험은 위 한글 버전과 합성 문서의 본문·기본 글자 서식 범위다. 표·그림·수식·다단·페이지 배치의 시각적 동일성을 확인했다고 주장하지 않는다.
- 취소 검사는 보조 프로세스 편입 이후, 시간 초과 검사는 편입 전 자식만 존재하는 단계다. CoCreate나 보조 프로세스 신원 검사 중 작업자가 강제 중단되면 아직 소유 Job에 편입되지 않은 SCM 프로세스가 남을 수 있다. 부모가 정확한 활성화 정보를 받는 보완은 후속 항목이다. 관련 없는 프로세스를 넓게 찾아 종료하지 않는다.
- 동일 순간에 외부 프로그램이 같은 한글 자동화 인수로 시작한 프로세스까지 인과적으로 구별하는 기능은 없다. 후보가 여러 개거나 검증이 불확실하면 파일 작업 전에 실패한다.
- 조직에서 서명되지 않은 제한 DLL 로드를 차단하거나 다른 한글 비트수·버전을 사용하는 환경은 별도 검증이 필요하다.

## 재현

Windows에서 `cargo run -p teacherdeck --example office_synthetic -- --provider hancom`을 실행한다. fixture 생성과 변환 모두 실제 생산 네이티브 경계를 재사용한다. 검사 실패는 0이 아닌 종료 코드로 반환한다. 각 실행은 새 식별자를 만들며 기존 산출물을 덮어쓰지 않는다.

성공 식별자로 `--hancom-stop-proof <식별자>`를 별도 실행하면 시간 초과·취소와 원본 보존을 검사한다. 이전 단계 로그나 결과가 있으면 이를 새 검사 증거로 재사용하지 않고 거부한다.
