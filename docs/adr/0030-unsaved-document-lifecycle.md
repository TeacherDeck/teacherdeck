# ADR-0030: 미저장 문서의 이탈과 종료 보호

- 상태: 승인됨
- 날짜: 2026-10-12
- 결정자: 프로젝트 소유자(고급 이미지 편집 제안 후 구현 시작 지시)

## 맥락

레이어 편집 문서는 storage 한도보다 크고 keepAlive는 최대 3개 LRU다. iframe 제거·앱 종료로 미저장 작업을 잃지 않도록 보호가 필요하다. 기존 window 캡과 main 전용 IPC 권한을 유지하며 문서 내용이나 파일명은 보호 메시지로 보내지 않는다.

## 결정

window 1.2에 `registerDocument()`, `setDocumentState({documentHandle,dirty,saving})`, `completeDocumentSave({documentHandle,requestId,saved})`를 추가한다. 문서 핸들은 모듈당 하나이며 언로드 때 폐기한다. 첫 변경은 dirty 등록 성공 후 적용한다. 저장 완료는 현재 revision이 저장된 경우에만 dirty를 해제한다.

셸은 도구 이탈과 LRU 제거 전에 저장·버리기·취소를 확인한다. 저장 선택은 `window.documentSaveRequested({documentHandle,requestId})` 이벤트를 소유 iframe에 보내고 응답을 기다린다. 실패·취소·60초 응답 만료·새 편집은 이탈을 취소한다. 버리기는 호스트가 만든 해당 문서의 이탈 requestId에 한해 유효하며 iframe을 제거한다. 저장 또는 버리기 승인 전에 iframe을 유지한다. 이탈 중재부터 완료까지 모듈 레이어의 사용자 입력을 잠시 막아, 확인 직후 새 편집과 언로드가 겹치지 않게 한다. keepAlive 한도를 늘리거나 미저장 도구를 무기한 고정하지 않는다.

기존 main 전용 `module_visibility` 명령에 optional typed `documentAction`을 추가한다. 기존 visible 인자는 optional이지만 기존 호출 동작을 유지한다. status·prepare·requestSave·saveResult·cancelSave·discard·resolveExit를 제공하며 모듈은 직접 접근할 수 없다. prepare 토큰은 해당 문서에 한 개만 유지하고 5분 후 만료한다. discard는 동일 문서 핸들·토큰을 다시 검사한다. 새로운 IPC/ACL/CSP 권한은 추가하지 않는다.

기존 main 전용 `module_unloaded`는 optional `moduleIds` 묶음(최대 4개)을 받는다. 기존 단일 moduleId 호출은 유지한다. 묶음의 모든 문서가 clean이고 저장 중이 아님을 같은 registry lock 안에서 확인한 뒤 보호 핸들을 함께 폐기하고 리소스를 정리한다. 한 문서의 늦은 편집으로 이탈이 취소됐는데 다른 살아 있는 iframe의 파일 핸들만 폐기되는 부분 언로드를 방지한다.

네이티브 제목바·Alt+F4 닫기, 트레이 종료, 업데이트 재시작은 호스트의 미저장/저장 중 등록을 먼저 확인한다. 위험한 종료는 정지하고 `deck://document-exit-request`를 main에 보낸다. 응답 requestId는 한 번만 유효하고 5분 만료하며, 호스트가 다시 모든 문서 상태를 확인한 뒤 종료한다. 실패·취소·만료는 종료하지 않는다. 캡처 활성 시 일반 닫기를 숨김으로 처리하는 기존 동작은 유지한다. 명시적 트레이 종료는 숨김 대신 동일 저장 확인을 사용한다.

## 결과

### 2026-10-13: 작업 유지와 실제 제거 경계

제품 점검 뒤 작업 손실을 먼저 고치라는 프로젝트 소유자의 지시에 따라, 저장 확인을 iframe의 실제 제거와 종료 경계에 적용한다. 살아 있는 keepAlive iframe을 숨기는 이동은 작업을 멈추지 않는다. 활성 도구를 포함한 3개 한도 안에서 dirty/saving 문서를 clean 문서보다 먼저 유지하며, 같은 보호 상태에서는 LRU로 선택한다. 보호 문서만으로 한도를 넘으면 가장 오래 사용하지 않은 문서에 기존 저장·버리기·취소 절차를 적용한다. 타이머와 작은 입력 초안은 기존 window 1.2 및 storage 캡을 사용하며 새 권한이나 포맷을 추가하지 않는다.

저장 완료의 기준은 도구의 작업에 맞춘다. 레이어 편집기는 편집 가능한 작업 파일, 메모·배정기는 복원 가능한 입력 상태, 이미지 자르기·PDF 개인정보 지우기는 현재 선택한 처리를 반영한 결과 파일을 저장한다. 여러 사진 중 일부만 저장했거나 입력 중인 항목이 남으면 dirty를 유지한다. 레이어·마스크 등 편집 정보가 사라지는 이미지 내보내기를 고급 편집기의 작업 저장으로 간주하지 않는다.

deck:1 envelope, 기존 window 1.0/1.1 API와 기존 모듈 동작을 유지한다. SDK는 0.8.0으로 올린다. 미저장 보호는 프로세스가 정상 실행 중일 때의 수명 계약이며 강제 종료·크래시 자동복구를 보증하지 않는다. CAP-002·006·008·009, BRG-001·009, PRV-003·006을 따른다.

## 대안

모든 iframe 고정은 자원 제한과 맞지 않는다. localStorage·IndexedDB 저장은 MOD-009와 맞지 않는다. 새 복구 서비스나 별도 캡은 현 범위에 필요하지 않다. 새 shell 명령을 추가하면 ACL 변경이 필요하므로 기존 module_visibility의 수명 책임에 한정된 typed 확장을 사용한다.
