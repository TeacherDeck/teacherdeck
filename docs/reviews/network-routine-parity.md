# 네트워크 루틴 순수 판단 코어 비교

2026-10-11 기준. Windows 네트워크 캡의 승인·구현 전 준비본이며 기본 번들 통합을 보류한다. 실제 어댑터 조회/변경·UAC·스케줄러 등록·재부팅 시험은 하지 않았다.

## 원천과 검사 방식

- 원천: `D:/codex_work/network_routine`, APP_VERSION1.4.0, HEAD `9bcae0084339fec77b1d4f48da167eaf44f340ee`.
- `tools/porting/network-routine/scripts/source-parity.py`는 명시적 AST allowlist의 순수 함수와 상수만 읽는다. 원본 GUI/COM/import/main/native 함수를 실행하지 않는다.
- 원본 `test_network_routine.py`의 **39개 assertion 시험 모두 통과**. 표준 라이브러리 harness가 pytest.raises/monkeypatch.setattr의 필요한 동작만 제공한다. 실제 pytest 설치나 pytest runner 실행은 아니다.
- 180개 합성 설정/시간/Wi-Fi 입력의 원본 결정·segment identity·구간 시작/끝·선택 SSID·요일 경계 트리거를 `tools/porting/network-routine/source-cases.ts`에 기록한다. 원본 파일 SHA-256와 Unicode 버전도 함께 저장한다.
- TypeScript의 순수 엔진을 원본 기대값과 직접 대조한 180건, 원천 provenance1건, 별도 경계/회귀23건을 합쳐 **Vitest204개 통과**했다.
- Python Unicode16의 전체 casefold 표를 생성해 Sharp-s/그리스어 등의 원본 이름 비교까지 보존한다. 브라우저의 locale/Unicode lowercase 차이에 기대지 않는다.

## 보존한 동작과 추가 회귀

시간표만/혼합/이름만, 연결 SSID 우선·주변 단독 일치·모호 fallback/유지·위치 권한없음, 요일 제외·시작=끝·자정넘김·붙는 구간 병합·exclusive end·outside 구간 ID·주간 트리거 중복 제거를 보존한다.

수동 전환은 같은 판단 구간에서 유지하고 구간이 바뀌면 해제한다. 이미 처리한 구간을 반복 적용하지 않는다. DNS만 입력한 내부 상태 비교와 DNS 순서, 설정의 판단 관련 필드 변경 때 이력 초기화, dirty 설정의 지금검사 차단을 검사한다. OS 적용 계획은 `apply`일 뿐 성공 이력을 먼저 기록하지 않으며 실제 성공 이후 `completeApply`로 기록한다.

원본 자체 업데이트·asset/hash parsing·작업표시 보조 시험은 원본39개 검사에는 포함된다. TeacherDeck에는 자체 업데이트를 복제하지 않고 기존 앱 업데이트를 사용한다. 원천의 실제 정책 엔진과 모듈 산출물을 한 버전으로 유지하는 배포 통합은 아직 하지 않았다.

## 실행과 검사 결과

```powershell
python tools/porting/network-routine/scripts/source-parity.py --source D:\codex_work\network_routine
.\dev.ps1 --config.verifyDepsBeforeRun=false exec prettier --write tools/porting/network-routine
.\dev.ps1 --config.verifyDepsBeforeRun=false exec vitest run tools/porting/network-routine/logic.test.ts
.\dev.ps1 --config.verifyDepsBeforeRun=false exec eslint tools/porting/network-routine
```

원본 harness39개, Vitest204개, 대상 모듈 ESLint는 통과했다. 최초 sandbox Vitest 실행의 spawn EPERM은 프로세스 실행 권한을 받는 동일 명령으로 해소했다. root `tsc`의 이 모듈 index-signature 오류는 수정했다. 같은 검사에서 다른 병렬 작업의 PDF asset import/ProgressBar props 오류가 나왔으며 그 파일은 수정하지 않았다. 전체 `pnpm verify`와 최종 타입/번들 검사·통합 여부는 부모 에이전트가 담당한다.

초기 모듈 스캐폴드는 검수용 target 폴더로 옮겼고, 순수 엔진과 테스트만 tools/porting 아래 보존한다. 사용 불가능한 빈 모듈은 앱 카탈로그에 나타나지 않는다. 레지스트리/SDK/호스트/원본 저장소 변경이 없다. OS 구현 이후에는 이 순수 엔진의 동일 입력·출력 계약을 그대로 사용하고 실제 네트워크 상태 성공 증거와 백그라운드 수명을 별도로 검증해야 한다.
