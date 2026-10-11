# 파일명 계획·폴더 목록·보호된 되돌리기

사용자 승인: 2026-10-11, [통합안](../proposals/file-tools-next.md) 전체와 fs 1.3/file-ops 1.0. 설계 결정은 [ADR-0019](../adr/0019-protected-file-operations.md)다. 경로는 호스트 내부에서만 사용한다.

## fs 1.3 폴더 목록

`listFiles({folderHandle,recursive,cursor?,limit?})`는 `{files,nextCursor?}`를 반환한다. pickFolder 또는 호스트가 만든 폴더 핸들의 소유자·세션을 확인한다. 기본 limit128, 최대128, 목록 최대2,000개, 탐색 디렉터리 최대4,096개, 깊이32다. 한도를 넘거나 reparse 파일/폴더를 만나면 부분 성공 대신 명확한 오류를 반환한다. 첫 호출에서 순서를 고정하며 다음 cursor는 같은 소유자·폴더·recursive 설정에만 사용한다. 표시 이름 외 상대/절대 경로를 반환하지 않는다. 목록은 5분 후 만료한다.

## file-ops 1.0

| 메서드        | 인자                           | 결과                                                                     |
| ------------- | ------------------------------ | ------------------------------------------------------------------------ |
| planRename    | items: sourceHandle,targetName | planHandle, items(sourceHandle,finalName,status),expiresAt               |
| executeRename | planHandle                     | historyHandle?,success,failed,notStarted,items(sourceHandle,status),done |
| listHistory   | cursor?,limit?                 | entries(historyHandle,createdAt,total,success,blocked,state),nextCursor? |
| undoRename    | historyHandle                  | success,failed,blocked,done                                              |

인자는 unknown 필드를 거부한다. 계획은 1~2,000개, 한 파일512MiB·전체2GiB 이하이고 단일 부모 내 변경만 허용한다. 계획이름은 Windows UTF-16 240단위 이하, 금지문자/제어문자/장치명/끝 공백·점/경로 구분자를 거부한다. 대소문자 목적지 충돌과 다른 기존 파일의 점유를 검사한다. 서로 교환하거나 대소문자만 바꾸는 이름은 허용하되 계획에 포함된 파일만 vacate 대상으로 인정한다. 변경 없는 행은 unchanged이며 실행하지 않는다. 계획 표시 이후 파일·목적지가 바뀌면 그 군을 차단한다.

행 status는 ready/unchanged/invalid/conflict/changed/success/failed/notStarted다. 계획에 invalid/conflict가 있으면 실행을 거부한다. 성공 수는 지금까지 완료된 변경 수, 실패 수는 처리했으나 실패한 수, notStarted는 아직 시작하지 않은 수다. 첫 executeRename 호출은 호스트 확인을 요구한다. 확인을 취소하면 파일·이력은 바뀌지 않는다. 각 호출은 다음 연결군 하나를 처리하고 done을 반환한다. 군 내부 작업은 직렬화하며 UI 취소는 이후 호출을 중단한다. 계획은 만료 전 반복 호출할 수 있다.

이력은 원본 변경만 대상이며 복사는 대상이 아니다. 최대20건, 개별 journal16MiB·전체64MiB로 제한한다. 새 이력을 기록할 공간이 없으면 원본 변경 전에 거부한다. 진행·미복구 임시 이름·차단 이력은 자동 삭제하지 않는다. 완료·되돌림 이력만 오래된 순서로 정리한다. 모듈 소유별 조회이며 limit 기본20/최대20, cursor는 호스트가 검증한다.

undoRename은 첫 호출에서 호스트 확인 후 다음 연결군 하나를 처리한다. 아직 처리할 군이 있으면 done=false다. 내용·수정 시각·파일 ID가 달라지거나 원래 이름을 다른 파일이 점유하면 연결군 전체를 blocked로 남긴다. 파일을 원래 폴더 밖에서 탐색하거나 이동시키지 않는다. 손상된 journal은 오류로 잠그며 원본을 임의로 복구하지 않는다. 재시작은 journal의 의도와 실제 ID·검증값을 대조하여 미완성 군을 안전한 원래 이름으로 돌릴 수 있는지 확인하며 자동 삭제/덮어쓰기를 하지 않는다.

## 개인정보와 검증

호스트 전용 journal은 기능에 필요한 경로·이름·식별자·검증값만 저장하며 내용 본문은 저장하지 않는다. 모듈에는 이력 이름/경로/검증값을 보내지 않는다. 일반 에러는 오류 코드와 고정 한국어 메시지만 사용한다. 합성 파일로 교환·대소문자·재시작 중단·변조·교체·충돌·다른 모듈 핸들·reparse·2,000개 한도·확인 취소를 검사한다. 실존 학생/학교 파일은 사용하지 않는다.
