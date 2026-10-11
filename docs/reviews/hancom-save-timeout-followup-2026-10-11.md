# 한글 합성 문서 저장 응답 대기 후속 진단

2026-10-11. 초기 진단은 이전 두 실행의 기록, 현재 소스, 설치된 타입 라이브러리와 한컴 공식 자료를 읽어 진행했다. 이후 사용자 승인 범위에서 화면 관찰을 동반한 합성 검수를 한 번 추가했고, 아래 후속 관측에 구분했다. 실제 HWP→HWPX 변환 성공을 확인한 보고서는 아니다.

## 현재 확정된 사실

| 근거                                                                                                                                                           | 확인 결과                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target/adversarial-review/hancom-visible-native.log`, `target/next-tools/office-qa/95ed0ded004a079f2200795479538f76/fixture-stages.log`·`report.json`         | 소유권 검증, 창 표시, 새 문서 추가, 텍스트 입력을 지난 뒤 `save-begin`에서 마지막 기록이 남았다. 결과는 fixture 단계의 TIMEOUT이다.                                                                                                                               |
| `target/adversarial-review/hancom-single-document-native.log`, `target/next-tools/office-qa/18e581881c5ccf1fe031eb27968360b6/fixture-stages.log`·`report.json` | 불필요한 `Add(false)`를 제거한 뒤에도 창 표시, 단일 문서 확인, 텍스트 입력을 통과했고 `save-begin`에서 멈췄다. `fixtureStage=save-begin`, TIMEOUT, HRESULT 없음이다. 디렉터리에는 단계 기록과 결과 보고서만 있고 합성 HWP 파일은 없다.                            |
| `apps/desktop/src-tauri/examples/office_synthetic.rs`의 `fixture_worker`·`generate`                                                                            | 마지막 기록 직후 호출은 `SaveAs(path, "HWP", "")`이다. 반환 이후에만 `saved`를 기록한다. 120초는 작업자 시작 이후 전체 fixture 제한이며 SaveAs만의 정확한 소요 시간이 아니다.                                                                                     |
| 같은 example의 `run`                                                                                                                                           | fixture 생성이 성공한 뒤에만 생산 변환 작업자를 호출한다. 이번 실패에서는 HWPX 저장·재열기·내용 검증을 시작하지 않았다.                                                                                                                                           |
| 설치 파일 `Hwp.exe`·`HwpAutomation.dll` 버전 정보                                                                                                              | 현재 설치된 한글 2024의 파일 버전은 `13.0.0.3189`이다. 과거 다른 환경의 버그 보고를 이 빌드의 확정 결함으로 취급하지 않는다.                                                                                                                                      |
| 설치된 `HwpAutomation.tlb`·`HwpObject.tlb`의 읽기 전용 타입 정보                                                                                               | `IHwpAutomation`·`IHwpObject`의 SaveAs는 `Path(BSTR), Format(VARIANT), arg(VARIANT)`, 반환 BOOL, DISPATCH_METHOD이다. 현재 인자 순서·문자열 VARIANT·메서드 호출과 일치한다. 타입 정보는 `LoadTypeLibEx(REGKIND_NONE)`로 읽었고 한글 COM 인스턴스는 만들지 않았다. |

초기 두 실행에서는 승인 대화상자의 존재·표시 위치·응답 여부를 직접 관찰한 기록이 없었다. HRESULT가 없는 것은 호출 성공을 뜻하지 않는다. 제한에 도달하기 전에 COM 호출이 반환하지 않았으므로 호출 결과를 받지 못한 상태다.

## 공식 자료와 가설 구분

1. **파일 쓰기 접근 승인 대기: 가장 강한 가설이지만 아직 관찰로 확정하지 않았다.** [공식 오토메이션 안내](https://developer.hancom.com/hwpautomation)는 로컬 파일 접근과 저장에서 보안 승인 메시지가 나타난다고 설명한다. [동일한 C++ SaveAs 멈춤 사례](https://forum.developer.hancom.com/t/c/1889)는 현재와 같은 `SaveAs(path, "HWP", "")`에서 멈춤과 파일 쓰기 접근 허용 대화상자를 함께 보고하며 한컴 답변도 승인창으로 설명한다. 현재 구현은 보안 DLL을 등록하지 않고 사용자 승인을 유지하므로 이 설명과 부합한다. 창을 표시했다고 승인까지 이루어진 것은 아니다.
2. **SaveAs 호출 인자 결함: 현재 증거로 지지되지 않는다.** [2026년 한컴 답변](https://forum.developer.hancom.com/t/saveas/2963)은 null 대신 빈 문자열을 쓰도록 안내한다. 현재 구현은 이미 인자 세 개와 빈 문자열을 사용하고 설치 타입 정보도 일치한다. 인자 생략·null 변경·임의 Action 대체를 수정 후보로 채택하지 않는다.
3. **다른 편집창을 만든 결함: 이전 fixture에는 있었으나 현재 대기의 충분한 원인은 아니다.** 두 번째 실행은 `Add(false)` 없이 같은 소유 창의 단일 문서로 수행했지만 결과가 동일하다. 제거한 호출을 되돌리지 않는다.
4. **저장 옵션에 따른 추가 모달 또는 설치 프로그램 내부 대기: 남은 낮은 확신의 가설이다.** [공식 저장 도움말](https://help.hancom.com/hoffice/multi/ko_kr/hwp/file/save_as/save_as.htm)은 새 문서 저장의 암호·개인정보 검사 등 선택 사항을 설명한다. 해당 옵션이 이번 PC에서 활성화됐거나 특정 창이 떴다는 증거는 없다. 사용자 설정을 읽거나 바꿔 원인으로 단정하지 않는다.

[한컴의 메시지박스 관련 답변](https://forum.developer.hancom.com/t/topic/1560)에 따르면 파일 접근 승인창은 `SetMessageBoxMode`로 제어되지 않는다. 해당 API 추가는 이 문제의 입증된 해결책이 아니다.

## 승인 범위 안의 좁은 수정

TIMEOUT 시 fixture와 생산 작업자는 자기 child를 종료하고, `KILL_ON_JOB_CLOSE`가 설정된 소유 Job Object를 닫는다. 따라서 오류를 받은 뒤 이미 정리된 승인 창을 찾으라는 기존 안내는 실제 종료 흐름과 맞지 않았다.

- 실행 전·실행 중의 안내는 사용자가 한글·Office 창의 문서 접근 승인을 직접 확인하도록 유지한다.
- TIMEOUT 안내는 작업을 중지했다는 사실과 **다음 시도 중** 승인을 확인할 동작을 구분한다. 모듈은 앞서 저장한 결과 유지도 설명한다.
- 모듈 기존 오류 분기 테스트에서 중지·재시도 시점·결과 유지·임의 예외 비노출을 확인한다. 모듈 버전은 0.1.2이다.

이 문구 수정은 SaveAs 대기를 해결하는 수정이 아니다. Hancom 생산 경로의 HWPX 저장·재열기 검증은 여전히 미검증이다.

## 남은 확인과 실행 금지 범위

초기 기록만으로는 승인 대기와 다른 모달·내부 대기를 확정 구분할 수 없었다. 아래 후속 관찰로 이번 합성 저장의 파일 접근 승인 대기를 확인했다. 다음 실제 확인은 사용자가 승인창을 직접 확인할 수 있을 때 진행한다. 새 단계를 통과했는지와 반환값을 확인하고 기존 120초 제한·소유 프로세스 경계를 유지한다. 사용자 승인을 확인하지 못하는 같은 무인 실행 반복은 새로운 근거를 만들지 않는다.

초기 진단에서는 한글 재실행, 실제 문서나 사용자 프로세스 조작·종료, 승인창 자동 클릭, 보안 설정·레지스트리 변경, 보안 DLL 설치·등록, Cargo·빌드·전체 검사·커밋을 실행하지 않았다. 개인정보가 담길 수 있는 COM 예외·창 제목·문서 내용은 수집하지 않았다. Cargo 검증과 최종 통합 검사는 루트 담당자가 수행한다.

## 후속 실제 화면 관측과 0.1.3 안내

같은 날 사용자가 잔여 작업 개선을 승인했고 주 작업자가 네이티브 화면 관찰을 준비한 뒤 기존 합성 example을 실행했다. 샌드박스 실행은 `activation-begin`에서 HRESULT `0x80070005`로 거부되어 한글 SaveAs에 도달하지 않았다(`target/adversarial-review/hancom-observed-native.log`). 동일한 승인 명령을 샌드박스 밖에서 실행한 결과 소유권 확인·창 표시·단일 문서 확인·TEXT 입력을 통과했다.

주 작업자는 `save-begin` 대기 중 해당 소유 한글 창의 **파일 접근 승인창**을 실제 화면과 UI 정보에서 확인했다. 표시된 파일은 검수기가 생성하려던 합성 `synthetic.hwp`였다. 따라서 이번 관측의 SaveAs 대기 원인은 파일 접근 승인 대기로 확인됐다. 사용자에게 직접 **접근 허용** 선택을 요청했으며 승인창을 자동 클릭하지 않았다. 직접 승인 전에 기존 120초 제한으로 작업이 종료됐다.

근거는 `target/adversarial-review/hancom-observed-native-approved.log`와 `target/next-tools/office-qa/f1723b7baa9ef899d3647b0aaa5c059e/fixture-stages.log`·`report.json`이다. 결과는 `TIMEOUT`, `fixtureStage=save-begin`, `success=false`이며 합성 HWP 파일은 생성되지 않았다. 실행 뒤 해당 example 프로세스는 남지 않았다. 실제 사용자 파일과 기존 Office 프로세스는 조작하지 않았다.

모듈 0.1.3은 한글 변환 실행 중 조건부 승인 안내를 표시한다. 실제 modal 감지 API는 추가하지 않았으므로 승인창을 감지했다고 표시하지 않는다. 원본 열기·출력 저장·재열기에서 각각 승인할 수 있음을 설명하고, 한글 TIMEOUT은 다음 시도 중 **접근 허용**을 직접 선택하도록 안내한다. 실패한 문서가 있으면 성공 완료 문구를 사용하지 않는다. 제한 시간·소유 프로세스 경계·원본 보존은 유지하며 자동 승인, 모두 허용 선택, 보안 DLL·레지스트리 신뢰 등록은 추가하지 않는다.

직접 승인 후 생산 HWP→HWPX 변환·재열기·본문/서식·원본 보존 검수는 아직 남아 있다. 승인창을 관찰했다는 결과를 실제 변환 성공으로 확대하지 않는다.

## 제한된 공식 경로 확인 구현과 0.2.0 검증

사용자는 반복 수동 승인 대신 자동화를 명시 요청했고 computer-use를 중단하도록 지시했다. [ADR-0027](../adr/0027-scoped-hancom-path-check.md)의 독립 Rust x86 DLL은 공식 ABI만 참조한다. 공식 무조건 TRUE 예제는 사용·동봉하지 않는다. 난수 등록값은 작업마다 생성하고 기존 값·`Uses`·전역 보안 설정은 바꾸지 않는다. DLL은 정확한 worker PID의 pipe만 연결하고 서버는 소유 Job에 속한 정확한 Hwp PID만 받아 작업용 입력 사본·신규 결과 두 개만 허용한다. 준비 단계에는 pipe가 없어 접근을 허용하지 않는다.

| 현재 증거                                                                                                                                    | 결과                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target/adversarial-review/hancom-scoped-machine-diagnostic.log`, `target/next-tools/office-qa/1e3671eb86ef01e48e73d472b4fea899/report.json` | COM 시작 후 고유 등록은 3.516초에 `RegisterModule(FALSE)`로 실패했다. `fixtureStage=gate-begin`, `success=false`, 직후 해당 DLL은 module snapshot에 없었다.                |
| `target/adversarial-review/hancom-preactivation-native.log`, `target/next-tools/office-qa/266a93f53684bedbabbf88ecf3d6d6a0/report.json`      | COM 시작 전 등록으로 분리한 뒤에도 5.954초에 같은 실패였다. 시작 시 목록 캐시는 현재 원인으로 입증되지 않았다.                                                             |
| 두 결과의 `IsWow64Process2`                                                                                                                  | 실제 소유 Hwp `processMachine=332(0x014c)`, OS `nativeMachine=34404(0x8664)`로 x86 DLL과 맞았다. 설치 경로만으로 추정하지 않았다.                                          |
| `target/adversarial-review/hancom-preactivation-x86-tests.log`                                                                               | 4/4 통과. 단독 x86 DLL 로드와 정확한 `IsAccessiblePath` export, ANSI/Unicode·잘못된 포인터·프로토콜 검사다. 공식 `.def`의 export 요구도 해당 함수 하나뿐이었다.            |
| `target/adversarial-review/hancom-preactivation-host-tests.log`                                                                              | 7/7, 3.19초. 다른 PID·경로·잘못된 frame·만료 거부, 반복 응답 ACK, 원본 잠금·hardlink·결과 교체 거부, 시작 전 접근 거부, 등록 충돌 미덮어쓰기·정리·바뀐 값 보존을 확인했다. |
| `target/adversarial-review/hancom-preactivation-cleanup.json`                                                                                | 검증 뒤 실행기/Hwp는 0개였고 32/64 레지스트리 view에 TeacherDeck 고유 값이 남지 않았다. 기존 `FilePathCheckerModule`은 유지됐고 `Uses` 키는 없었다.                        |

**등록 실패 직후 미로드 상태는 확인됐지만 내부 일시 로드·해제 여부와 정확한 거부 단계는 미확정이다.** `RegisterModule`의 BOOL FALSE에는 COM HRESULT 오류가 없었다. 이 결과를 DLL 로드 시도 자체가 없었다거나 보안 제품이 막았다는 확정으로 확대하지 않는다. 최근 합성 실행의 CodeIntegrity 이벤트 제한 조회에는 관련 이벤트가 없었고 Defender 이벤트 조회는 사용할 수 없었다.

[한컴 2026-08 답변](https://forum.developer.hancom.com/t/topic/3206)은 arbitrary REG_SZ 이름·절대 DLL 경로·한글과 동일한 x86·코드 서명 불필요를 설명한다. [후속 답변](https://forum.developer.hancom.com/t/topic/3209)은 `Uses`가 없으면 활성이고 빈 이름의 TRUE는 등록 해제임을 설명한다. [2026-09 동일 증상 답변](https://forum.developer.hancom.com/t/ai/3242)은 단독 LoadLibrary/export 성공과 한글 내부 등록 FALSE에 추가 공식 등록 절차·로그·알려진 수정 버전이 없다고 답했다. 조직 정책 완화나 임의 allow-all DLL로 원인을 우회하지 않는다.

모듈 0.2.0은 등록 실패를 설치 오류와 구분해 **한글에서 직접 변환**을 안내하고 저장을 시작하지 않는다. 정상 경로는 숨긴 소유 COM 작업이며 승인창 클릭에 의존하지 않는다. 120초 제한도 자기 작업 창을 정리한 후 직접 변환 안내를 표시한다. 사용자 원본·기존 Office·보안창은 조작하지 않았다.

이번 개선으로 기존 승인창에서 120초 기다리는 경로는 등록 실패에서 조기에 안전하게 종료된다. **HWP→HWPX 자동 변환의 실제 성공과 본문·서식 보존은 해결 완료가 아니며 남은 한컴 호환성 제한이다.** 같은 실패 실행을 반복하거나 미검증 산출물을 성공으로 보고하지 않는다.
