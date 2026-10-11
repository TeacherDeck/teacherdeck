# 로컬 학생 화면 (window 1.1)

결정과 승인은 [ADR-0025](../adr/0025-public-presentation.md)에 있다. 기존 window1.0 메서드는 유지한다.

## 계약

| 메서드 | 인자 | 결과 |
| --- | --- | --- |
| listDisplays | 없음 | displayHandle, label, primary, width, height, scaleFactor 목록 |
| openPresentation | displayHandle, payload | presentationHandle, revision |
| updatePresentation | presentationHandle, revision, payload | presentationHandle, revision |
| closePresentation | presentationHandle | void |

displayHandle과 presentationHandle은 난수이며 모듈 소유다. 다른 모듈의 핸들은 거부한다. 모니터 위치/이름은 호스트 내부에서만 사용하고 공개 목록에는 화면 번호와 크기만 제공한다. listDisplays 재호출은 이전 목록 핸들을 교체한다. 모듈당 공개 창 하나, 앱 전체 네 개다.

payload는 kind(seats/picker/groups/roles), title, columns(자리 배치일 때), items 배열이다. item은 label, group(모둠/역할 표시), row/column(자리 위치)만 가진다. unknown field는 거부한다. 문자열120자, items1,000개, 직렬화512KiB 이하이며 자리의 행/열은0부터 시작한다. columns는1~100, 행/열 좌표가 겹치거나 종류에 맞지 않는 필드는 거부한다. 빈 자리 label은 빈 문자열을 허용한다.

열기 revision은0이며 갱신은 이전보다 큰 revision만 허용한다. 결과는 명시적 갱신 때만 바뀐다. 창 자체에는 공개 자료만 보관하며 ESC와 닫기로 종료한다. 모듈 언로드·창 종료 때 자료와 핸들을 해제한다. 메인 창이 실제 종료되면 생성 중인 세션까지 모두 해제하고 학생 창을 닫는다. 캡처를 계속하기 위해 메인 창만 숨기는 경우는 종료로 처리하지 않는다. 모니터 연결·위치·배율 구성이 바뀌면 자료를 비우고 교사가 모니터를 다시 선택하게 한다.

## 보조 창 권한

교사 모듈에는 `window.presentationClosed`, `window.presentationDisconnected` 이벤트를 소유 iframe으로만 보낸다. payload는 `{presentationHandle}`뿐이며 공개한 이름이나 교사 자료를 넣지 않는다. 기존 evt 외피와 브리지 버전1을 유지하는 추가 이벤트다.

고정 로컬 /presentation route, label presentation-*, local=true의 presentation ACL을 쓴다. 권한은 core:event:allow-listen/unlisten, allow-presentation-ui-state, allow-presentation-ui-close뿐이다. 두 커맨드는 호출 webview의 label·local origin과 살아 있는 소유 세션을 검사한다. 이벤트 deck://presentation-changed는 해당 창에 revision만 통지한다. 파일·클립보드·모듈 브리지·외부 네트워크 권한은 없다.

검증은 잘못된 인자·소유자 위조·만료/닫힌 핸들·replay·용량·창 수 제한·모니터 변경과 공개 화면의 교사 메모 배제를 포함한다.
