# 휠 스크롤 회귀 검증

2026-10-10. 공통 DeckProvider의 `body`에 가로 `overflow: hidden`을 적용하면 세로 방향도 암묵적으로 `auto`가 된다. 높이가 콘텐츠만큼 늘어난 body는 자체 세로 스크롤 범위가 없는데 `overscroll-behavior: none`이 바깥 문서로의 휠 전달을 막았다.

## 수정

- html/body/provider의 가로 넘침은 새 스크롤 컨테이너를 만들지 않는 `clip`으로 처리한다.
- overscroll 경계는 최상위 html에만 둔다.
- 셸 메뉴는 짧은 창에서 별도 스크롤할 수 있다. 모듈 헤더 높이를 유지하고 프레임 영역은 가용 높이 안으로 줄어든다.

## 확인

- 수정 전: 실제 배정기 컴포넌트를 렌더한 브라우저에서 문서 높이 1117px, 뷰포트 720px. 휠 아래 두 번 이후에도 scrollTop 0.
- 수정 후: 같은 화면과 같은 휠 조작에서 scrollTop 약 397px. 아래 명단 및 설명 도달.
- iframe 검증: 셸과 같은 고정 제목/메뉴 및 유동 프레임 레이아웃의 합성 harness에서 실제 배정기 컴포넌트를 렌더. 프레임 내부 scrollTop 약 821px, 외부 문서 scrollTop 0 및 제목 상단 0 유지.
- `DeckProvider.test.tsx`는 불투명/Mica 두 모드의 CSS 스크롤 소유 조건을 검증한다. Griffel이 test 모드에서 전역 CSS를 생략하므로 해당 테스트는 실제 개발 모드 CSS를 렌더하고 환경 설정을 복원한다.

브라우저 검증은 실제 모듈 컴포넌트와 SDK mock을 사용했다. Windows 네이티브 창의 물리 마우스 휠 조작을 직접 제어한 증거는 아니다. 재빌드한 Windows 앱에서 사용자가 같은 동작을 확인할 수 있다. 로컬 harness는 `target/parallel-qa/`에 있으며 배포물에 포함하지 않는다.
