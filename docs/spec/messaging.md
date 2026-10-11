# 예약 메시징

`messaging` 1.0.0은 승인된 [ADR-0023](../adr/0023-managed-messaging.md)에 따른 외부 앱 예약 등록 프리미티브다. 첫 provider는 gentoo만 허용한다. 원작 코어의 보관·반복·일반/중식 업무 처리는 같은 원천 모듈이 맡고 캡은 여섯 실행 메서드에 한정한다.

## 공개 메서드와 핸들

| 메서드            | Rust 인자               | 결과                  |
| ----------------- | ----------------------- | --------------------- |
| connect (long)    | MessagingConnectArgs    | MessagingConnection   |
| recipients (long) | MessagingRecipientsArgs | MessagingRecipient[]  |
| plan (long)       | MessagingPlanArgs       | MessagingPlan         |
| start (long)      | MessagingStartArgs      | MessagingRun          |
| status            | MessagingStatusArgs     | MessagingStatus       |
| cancel            | MessagingCancelArgs     | MessagingCancelResult |

모든 타입은 `crates/deck-core/src/caps/messaging.rs`의 strict camelCase 모델을 원천으로 생성한다. 불투명 connection/recipient/plan/run 핸들은 매번 설치·선언 캡·버전·모듈 소유·세션을 검사한다. 새 연결과 재시작 뒤 이전 핸들은 재사용하지 않는다. 표시 증거가 유일하고 정확히 일치할 때만 모듈은 현재 연결의 새 recipientHandle에 초안을 재연결한다. 동명이인·계정/부서 변경·중복 증거는 미확인 상태로 남긴다. 영속 제출 시도 기록은 핸들 만료와 무관하게 유지한다.

ScheduledMessage는 id/recipients/title?/body/scheduledAt/attachmentHandles/contentRevision이다. scheduledAt은 KST `YYYY-MM-DDTHH:mm`이며 지금부터 최소 10분 뒤~달력상 3개월 범위를 원작 parse_time/add_months/validate_job로 다시 검사한다. 제목 공란은 유효하다. 제목은 200자, 본문은 30,000자, 수신자는 중복 없이 1~100명, 첨부는 메시지당 10개까지다. NUL·탭·잘못된 유니코드는 거절한다. 계획은 1~500건·직렬화 512KiB 이하·제목/본문 UTF-8 합계 256KiB 이하다. prepare/inspect는 원작처럼 한 번에 한 건이다. 초과 입력을 자르지 않는다.

plan은 immutable 내용·연결·수신자 account evidence·첨부 path/size/mtime/SHA256에 묶인 5분 검토를 반환한다. preview에는 공개 원본 메시지와 표시 수신자·첨부명, retryLocked만 담는다. issues는 고정 code와 messageId만 담으며 경로·화면·사용자 내용이 들어가는 provider 오류문은 반환하지 않는다. resultConfirmation은 기본 manual이다. automatic은 현재 연결의 selected-result-verification feature가 있을 때만 사용한다. 기존 자동 프로필이 이 feature를 제공하지 않으면 미지원 상태를 그대로 표시한다.

원작 automatic_profile의 첨부 reader는 gentoo_empty_attachments로 무첨부만 확인한다. 실제 첨부 목록·파일 선택 역할이 없는 연결에는 attachments feature를 표시하지 않는다. 초안의 첨부 정보는 보존하고 계획 전에 “연결된 쿨메신저에서 첨부 등록을 확인할 수 없어요”를 안내한다. 첨부를 빼거나 지원하지 않는 임의 화면 선택자로 바꾸지 않는다. 원작 수동 역할 연결의 TeacherDeck 통합은 후속 범위로 남는다.

register start의 confirmation는 trusted shell이 현재 계획에 한 번 발급하는 호스트 승인이다. 모듈 텍스트만으로 승인하지 않는다. 확인 화면은 수신자·제목·본문·시각·첨부 및 외부 앱 전달 설명을 보여준다. 확인 취소·계획 변경·만료·계정 변경은 실행하지 않는다. simulate/inspect/prepare는 보내기를 누르지 않는다. 등록 정상 상태 registration-requested는 보내기와 작성창 종료를 확인했다는 뜻이며 수신함 도착·서버 접수 확인이 아니다. confirmed도 지원된 선택 예약목록 대조 결과이며 배송 증명이 아니다.

최종 확인은 호스트가 만든 immutable preview를 셸의 스크롤 대화상자로 표시한다. 긴 본문과 첨부명은 자르지 않으며 500건도 10건씩 넘기거나 수신자·본문·시각·첨부로 찾을 수 있다. 첫 초점은 검토 내용의 시작에 두고, 전체 건수와 계획의 5분 만료까지 남은 시간을 표시한다. 전체 검토 동의 뒤에만 예약 등록 버튼을 제공한다. 닫기·Escape·취소·만료는 허용하지 않음으로 처리하며 초안을 보존한다. 비공개 confirmationId는 모듈 소유·세션·계획에 묶인 단회 식별자이고 셸 resolve에서 현재 권한과 같은 계획을 다시 검사한다. 모듈 iframe의 confirmation 문자열은 승인 근거로 인정하지 않는다.

cancel은 현재 호출 이후 남은 처리를 멈추는 요청이다. 이미 접수된 예약을 취소하지 않는다. F8와 화면 중지는 원작의 같은 stop flag로 연결한다. 제출 후 실패/충돌/강제 종료는 uncertain 또는 registration-requested 잠금을 보존하며 자동 재시도하지 않는다. SQLite attempts 지문은 초안·보관함의 삭제/복원/새 ID 가져오기 이후에도 같은 내용의 재등록을 막는다.

## 호스트 비공개 JSON line 계약

고정 worker는 모듈별 호스트 소유 ledger 폴더를 argv `--data-dir`로 받는다. 실행파일·진입점·isolated module 경로는 승인된 배포 해시로 고정한다. 사용자 PYTHONPATH·site·임의 설치 Python·pip·프론트 script 경로를 받지 않는다. stdin/stdout만 사용하는 private protocol이며 HTTP 서버나 Google 직접 연결을 시작하지 않는다.

요청은 `{id:string,method,args}`, 성공은 `{id,ok:true,result}`, 실패는 `{id,ok:false,error:{code}}`다. UTF-8 한 줄은 LF를 포함해 최대 512KiB이다. 허용하지 않은 필드·method·중복 키·잘못된 프레임을 거절한다. 과대/미종결 프레임은 오류 한 줄 뒤 worker 입력 처리를 끝낸다. stdout/stderr는 일반 로그로 복사하지 않는다. 성공 결과도 같은 한도를 검사한다.

| private method | args                                               | result                                                            |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| connect        | `{}`                                               | `{connectionId,capabilities,ready,versionSupport,accountBinding}` |
| recipients     | `{connectionId}`                                   | `[{recipientId,displayName,department,accountLabel}]`             |
| plan           | `{connectionId,messages,mode,resultConfirmation?}` | `{planId,expiresAt,issues,items}`                                 |
| start          | `{planId,confirmed:boolean,accountBinding}`        | `{runId}`                                                         |
| status         | `{runId}`                                          | `{active,mode,stage,progress,total,items,issue?}`                 |
| cancel         | `{runId}`                                          | `{requested:true}`                                                |

private messages는 공개 message의 recipients를 recipientIds로, attachmentHandles를 attachmentPaths로 바꾼다. id/title?/body/scheduledAt/contentRevision은 유지한다. 호스트만 파일 읽기 세션을 잠그고 검증한 절대 첨부 경로를 전달한다. helper는 임의 모듈 핸들을 경로로 해석하지 않는다. recipientId는 원작 contacts identity이며 공개 recipientHandle로 그대로 내보내지 않는다. 원작 selector·exe·login marker와 SQLite 위치는 호스트 내부에 남는다. accountLabel은 사용자가 계정을 구별하는 표시 문자열이며 실행 식별자로 사용하지 않는다.

private issues와 items는 공개 code/state와 같다. 원작 needs_review는 registration-requested, submitting/confirmed/uncertain은 retryLocked=true다. 연결 시 읽은 login marker를 계획/실행 및 준비·대조·보내기 직전에 다시 검사한다. 실제 UI 대조·F8·화면 잠금·배율·다른 작성창 검사와 준비 복구는 원작 WindowsDriver/Runner를 그대로 사용한다. helper의 원작 state.log/report/error 문자열은 공개 status에 복사하지 않는다.

accountBinding은 원작의 본인 계정 증거와 login marker의 SHA256이다. 최초 연결 또는 저장한 본인 증거 불일치 때는 사용자가 본인 항목을 선택하고 나에게 보내기를 켠 본인 작성창을 준비해야 한다. helper는 원작 build_profile/bind_gentoo_self로 이미 열린 창만 읽으며 창을 만들거나 클릭하지 않는다. 유효한 저장 self_binding은 재사용하므로 매 연결마다 작성창을 요구하지 않는다. 로그인 nickname의 숫자를 계정 ID로 추론하지 않는다. 계획은 accountBinding에 묶이고 start 직전에 live 증거를 다시 검사한 뒤 호스트 전달 binding과 비교한다.

고정 오류 code는 INVALID_ARGS/INVALID_METHOD/INVALID_HANDLE/INVALID_MESSAGE/BUSY/CONNECTION_CHANGED/SELF_VERIFICATION_REQUIRED/RECIPIENT_MISMATCH/PLAN_EXPIRED/PLAN_BLOCKED/CONFIRMATION_REQUIRED/RESULT_TOO_LARGE/PROVIDER_FAILED다. 다른 예외는 PROVIDER_FAILED로만 답한다. SELF_VERIFICATION_REQUIRED는 최초 본인 작성창 확인 안내로 구분하며 일반 provider 오류로 감추지 않는다. EOF/host 취소 시 소유 worker 종료는 호스트가 책임지며 멈춘 Windows 호출에 성공을 추측하지 않는다. 재시작하면 원작 Store가 submitting을 uncertain으로 바꾼다.

## 범위 검사

원작 offline tests와 mock provider/driver를 사용해 optional title, immutable 검토, 첨부/계정 변경, 확인 전 제출 금지, 등록 요청 완료, 준비 복구, 보내기 뒤 불명 잠금, 재시작/새 ID 재등록 금지, F8/취소, 과대·중복 JSON 및 private 오류 비노출을 검사한다. 실제 Gentoo 조회·조작·메시지 발송은 별도 승인 없이 수행하지 않는다. 원작 라이선스와 고정 런타임의 모든 필수 고지는 보존한다.
