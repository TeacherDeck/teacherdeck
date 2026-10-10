# ADR-0013: 모듈별 독립 origin

- 상태: 승인됨(2026-10-10, 프로젝트 소유자 명시 승인)
- 관련: SEC-002, SEC-005, BRG-001, [후속 제안](../proposals/file-transfer-followup.md)

## 배경

셸과 모듈의 origin은 이미 분리돼 있지만 여러 keepAlive 모듈은 같은 `http://deckmod.localhost`를 사용했다. 같은 sandbox 구조의 합성 브라우저 시험에서 sibling iframe의 DOM 읽기가 재현됐다. 실제 Tauri에서 토큰 탈취를 실행한 결과와는 구분한다. 파일 읽기 권한 토큰을 도입할 때 모듈 간 독립 origin도 필요하다.

## 결정

Windows 모듈 origin은 `http://deckmod.<id>.modules.localhost`, 논리 URI는 `deckmod://<id>.modules.localhost/<id>/<version>/<path>`다. Wry 0.57.0의 `deckmod.` prefix 변환과 기존 scheme 등록 하나를 유지한다. 호스트는 authority를 정확한 `<valid-id>.modules.localhost`로 검증하고 경로의 id와 대조한다. 설치된 실행 가능 모듈과 서빙 버전은 기존 ModuleStore에서 확인한다. 임의 suffix, userinfo, port, 추가 label, 후행 점은 거부한다.

셸 CSP frame-src/img-src는 `http://*.modules.localhost`를 허용한다. `tauri.localhost`와 `ipc.localhost`는 이 범위에 없다. 모듈 CSP는 connect-src 등 `'self'` 제한을 유지한다. 새 모듈 추가마다 CSP 변경이 필요하지 않다. CSP wildcard는 인증 수단이 아니므로 호스트 검증과 셸의 프레임별 정확한 source/origin 검사를 함께 적용한다.

ModuleBridge는 검증된 entryUrl에서 정확한 origin을 저장한다. 메시지의 module id를 신뢰하지 않고 `event.source`와 등록 origin을 모두 확인한다. 응답과 이벤트는 해당 origin만 targetOrigin으로 사용한다. 언로드된 프레임의 늦은 응답은 버린다. manifest·catalog·브리지 envelope/deck 버전은 바뀌지 않는다. SDK의 부모/셸 origin 검사는 유지한다.

`http://deckmod.localhost`와 ShellInfo.moduleOrigin은 디버그 SEC-004 프로브용으로만 남긴다. 이 origin은 일반 모듈 번들이나 사용자 파일을 제공하지 않는다. 프로브는 디버그 빌드에서 명시 활성화할 때만 제공한다.

## 결과와 검증

새 의존성·ACL 권한·외부 통신을 추가하지 않는다. host/path 불일치·authority 우회·다른 모듈 origin의 메시지·언로드 후 늦은 응답을 자동 검사한다. Windows에서는 서로 다른 모듈 origin 로딩/자산/fetch/worker와 sibling DOM 접근 거부, SEC-004 IPC 차단을 다시 검증한다. 이전 단일 origin 검증 결과를 새 구조의 통과 증거로 사용하지 않는다.
