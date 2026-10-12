# 미저장 문서 보호

[ADR-0030](../adr/0030-unsaved-document-lifecycle.md)의 window 1.2 계약이다.

`registerDocument({})`는 소유 모듈의 `{documentHandle}`을 반환한다. 같은 살아 있는 모듈에서 재호출하면 기존 핸들을 반환하며 dirty를 초기화하지 않는다. `setDocumentState({documentHandle,dirty,saving})`는 해당 모듈의 핸들만 받는다. 등록 성공과 최초 dirty 설정 성공 전에 첫 편집을 적용하지 않는다. 숨김은 핸들을 유지하며 언로드는 폐기한다.

작업 파일 저장을 완료한 revision이 현재 revision과 같은 경우에만 dirty=false로 등록한다. PNG/JPEG 또는 손실 있는 PSD 출력은 완전한 편집 문서 저장을 대신하지 않는다. 저장 실패·취소는 dirty를 유지하며 saving은 실제 작업 중에만 true다.

셸은 이탈·LRU 제거 전에 dirty 또는 saving 문서를 확인한다. 저장·버리기·취소를 선택하며 취소가 기본이다. 중재부터 완료까지 모듈 레이어의 사용자 입력을 잠시 막고, 취소 또는 실패 시 즉시 복원한다. 저장 선택은 소유 iframe에 `window.documentSaveRequested` 이벤트를 보낸다. payload는 `{documentHandle,requestId}`만 담는다. 모듈은 작업 파일 저장 후 `completeDocumentSave({documentHandle,requestId,saved})`로 답한다. 호스트는 준비된 요청·모듈 소유권·문서 핸들을 검사한다. saved=true와 dirty=false·saving=false를 모두 확인해야 성공이며 응답 뒤 새 편집이 생겨도 성공으로 간주하지 않는다. 요청은 60초 내 응답해야 한다. 시간 초과·실패·취소는 iframe과 미저장 상태를 유지한다.

main 전용 module_visibility의 optional `documentAction`은 Rust 원천 typed union으로 정의한다. status는 보호 상태를, prepare는 5분 수명의 한 번 사용 이탈 requestId를 반환한다. requestSave·saveResult·cancelSave는 그 요청에 한정된다. discard는 동일 문서 핸들과 prepare requestId를 확인하고 보호 등록을 폐기하며 셸은 해당 iframe을 제거한다. 미저장 내용을 유지한 iframe을 clean으로 표시하고 숨기지 않는다. 기존 visible 호출은 창 상태 복원만 수행한다.

main 전용 module_unloaded는 optional `moduleIds`로 최대 4개의 이탈 대상을 한 번에 확인·언로드한다. 기존 단일 moduleId 호출도 유지한다. 한 문서라도 dirty/saving이면 모든 대상의 보호 등록과 파일 핸들을 유지한다. 모든 대상의 보호 상태를 한 registry lock 안에서 확인하고 등록을 함께 폐기한 뒤 리소스를 정리한다. 셸은 성공 응답 뒤에만 iframe 묶음을 제거한다.

호스트는 모든 문서가 clean이고 저장 중이 아닌지 네이티브 종료 경계에서도 확인한다. 위험한 닫기·트레이 종료·업데이트 재시작은 main 전용 `deck://document-exit-request`를 보내며 `{requestId,action}`만 담는다. action은 close/exit/restart다. resolveExit는 같은 5분 수명 requestId와 proceed를 받고 한 번만 사용한다. proceed=false 또는 만료이면 종료하지 않는다. proceed=true도 다시 dirty/saving을 검사한다. 캡처 활성 일반 닫기는 기존대로 숨겨 문서를 유지한다.

파일명·경로·문서 내용·선택 영역은 보호 메시지와 로그에 넣지 않는다. 수명 보호는 크래시·OS 강제 종료 복구를 포함하지 않는다.
