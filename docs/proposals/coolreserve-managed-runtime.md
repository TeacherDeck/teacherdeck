# 제안: CoolReserve 관리 실행 환경 고정

상태: 2026-10-11 사용자 명시 승인. `native-tools-next.md`에서 명시적으로 제외했던 Python 배포 패키지의 후속안이다. 공식 배포 파일의 해시와 필수 모듈 import를 확인했고 승인된 패키징·원작 코어 통합을 진행한다. 실제 메시지 발송 검증은 포함하지 않는다.

## 배경과 범위

CoolReserve의 예약·수신자 검증·중복 방지 코어를 그대로 재사용한다. 원천은 [CoolReserve 공개 저장소](https://github.com/rochelobeJYJ/CoolReserve)의 `2c11d10008c88b8373d2277e54b468c5cd3b1191`(1.4.1, MIT)이다. TeacherDeck 안에 별도 구현을 발전시키지 않고, 원천 저장소에서 함께 빌드한 모듈과 helper를 정확한 SHA256으로 소비한다. 이번 제안은 기능 계약과 외부 메시지 전달 예외를 확대하지 않는다.

GEN-004·GEN-005에 따라 아래 고정 Windows x64 런타임·의존성 및 한정 라이선스 예외를 승인 요청한다. 전역 Python 설치·PATH·레지스트리·서비스는 변경하지 않는다. 최종 사용자에게 Python 설치를 요구하지 않는다.

## 정확한 입력

| 구성 | 버전 | 공식 산출물 SHA256 |
|---|---|---|
| CPython Windows x64 embeddable | 3.14.8 | `a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310` |
| pywinauto | 0.6.9 | `5924b3072864a1d730c5546bbeb17cf4063ba518b618dbc5e43c18276c7c9356` |
| comtypes | 1.4.17 | `4e0a221dde2c589b82977bed802efd71cd5eb67a380347b732e02735e597f586` |
| pywin32, cp314-win_amd64 | 312 | `a4dd3a848290ef724347b19f301045831d8e802fa4464f491b98b1e0a081432e` |
| six | 1.17.0 | `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274` |

파일별 경로·크기·해시와 공식 URL은 [후보 잠금 목록](coolreserve-runtime-candidate.json)에 있다. [Python 공식 릴리스](https://www.python.org/downloads/release/python-3148/)와 [PyPI pywin32](https://pypi.org/project/pywin32/312/)·[pywinauto](https://pypi.org/project/pywinauto/0.6.9/)의 배포물로 다운로드와 해시 일치를 확인했다. 원본의 Python 3.14.3보다 새로운 같은 3.14 계열 유지보수 버전이다.

pywin32는 `win32`, `win32com`, 시스템 DLL, 필수 `win32ui/win32uiole/scintilla`만 포함한다. 사용하지 않는 `adodbapi` LGPL 실행 코드·MAPI·Pythonwin IDE·설치 스크립트는 제외한다. 배포물의 원래 라이선스·고지와 wheel metadata는 그대로 보존한다. 제외된 구성의 라이선스 문서만 metadata에 남는 것은 실행 코드를 포함한다는 뜻이 아니다.

## 라이선스와 실행 경계

후보 목록에는 isolated 경로를 지정한 `python314._pth`와 comtypes가 만든 56바이트 `comtypes/gen/__init__.py`도 해시로 고정했다. wrapper 코드는 import 시험에서 메모리로 생성했으며 시험용 스크립트는 배포 목록에 포함하지 않는다. 승인 후 패키징에서도 이 두 파일을 동일하게 재현하고 런타임 디렉터리에 추가 파일을 쓰지 않는지 검사한다.

일반 npm/Cargo 라이선스 allowlist를 넓히지 않고 이 잠금 목록의 CPython 배포물에만 PSF-2.0 및 원래 `LICENSE.txt`의 역사적 Python 고지를 허용한다. comtypes의 MIT, pywinauto·pywin32 핵심의 BSD 계열, six의 MIT와 Scintilla 고지도 정확한 원문과 파일 해시로 검증한다. Python 자체의 동봉 구성 고지 전체를 유지한다. 검사기는 새 파일·바뀐 버전·바뀐 해시·라이선스 누락을 거부한다. CoolReserve의 MIT 저작자 표기를 보존한다.

호스트가 고정 배포 경로의 실행파일과 고정 진입점만 실행한다. `_pth`의 앱 내부 경로와 isolated/no-site 모드를 사용하며 사용자 `PYTHONPATH`, 임의 Python, pip 설치, 모듈 지정 스크립트는 받지 않는다. COM 생성 wrapper는 메모리 또는 호스트가 정한 전용 캐시에 둔다. 모듈은 승인된 `messaging`의 구조화 요청과 불투명 핸들만 전달한다. 표준 입출력은 제한된 private protocol이며 사용자 내용·helper stdout을 일반 로그에 복사하지 않는다. 오류·시간 초과·취소 시 소유 worker만 종료하고 실제 등록 결과가 불명확하면 재시도 잠금을 유지한다.

## 검토 결과와 남은 검증

- 검토용 후보에서 Python 3.14.8 isolated 모드 및 pywinauto 0.6.9/comtypes 1.4.17/six 1.17.0, pywin32 DLL import가 성공했다. 쿨메신저 창 검색·조작·메시지 발송은 수행하지 않았다.
- 후보 풀린 크기는 약 34MB다. 최종 helper/모듈·설치 압축 크기는 실제 빌드로 다시 측정한다.
- 원본의 pywinauto에 Python escape SyntaxWarning이 있다. import는 성공했지만 원본 합성 테스트와 고정 adapter 시험을 통과하기 전 기능 호환 완료로 보지 않는다.
- 승인 후 원천 저장소의 공유 코어·모듈·private worker adapter를 구현하고 원본 offline 테스트, 중복 등록/취소/불명 결과/재시작 검증, 배포 hash·license 검사, 오프라인 설치를 수행한다. 실제 메시지 발송은 별도 명시 시험 승인 전까지 하지 않는다.

검토한 대안은 전체 Rust 재작성과 PC에 설치된 임의 Python 호출이다. 전자는 원작 검증을 잃고, 후자는 재현성과 배포 일관성을 잃는다. 이 제안은 기존 코어를 쓰면서 실행 환경을 앱이 관리하는 방식을 택한다.
