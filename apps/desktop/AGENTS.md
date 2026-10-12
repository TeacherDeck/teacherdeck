# apps/desktop — 셸 지침

셸은 호스트 메인 창의 React 프론트엔드다. 모듈 iframe을 띄우고, 브리지 메시지를 검증해 Rust `host_invoke`로 넘긴다. 루트 [AGENTS.md](../../AGENTS.md) 규칙을 모두 따르며, 여기서는 추가 규칙만 적는다.

호스트(Rust) 작업은 [src-tauri/AGENTS.md](src-tauri/AGENTS.md)를 본다.

## 규칙

| ID         | 요약                                                                                                           | 정의                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 추가       | `@tauri-apps/api`는 셸(`apps/desktop/src`)에서만 쓴다. 모듈·패키지에서는 금지한다(MOD-005).                    | [modules.md](../../docs/spec/modules.md#4-규칙)                 |
| BRG-001    | 알려진 모듈 iframe의 contentWindow와 모듈 origin에서 온 메시지만 처리하고, 모듈 id는 iframe 매핑으로 판정한다. | [bridge-protocol.md](../../docs/spec/bridge-protocol.md#5-규칙) |
| BRG-003    | `hello` 10초 타임아웃 시 로드 오류 화면을 띄운다.                                                              | 같은 문서                                                       |
| BRG-006    | 알 수 없거나 잘못된 메시지는 무시하고 내용 없이 debug 로그만 남긴다.                                           | 같은 문서                                                       |
| BRG-007    | 1MB 초과 메시지는 `INVALID_ARGS`로 거절한다.                                                                   | 같은 문서                                                       |
| BRG-009    | `fs.dropped`는 fs 캡이 있는 활성 모듈에만 보낸다.                                                              | 같은 문서                                                       |
| CAP-008    | 셸의 권한 검사는 보조일 뿐이다. 최종 검사는 Rust가 한다.                                                       | [capabilities.md](../../docs/spec/capabilities.md#6-규칙)       |
| SEC-002    | 셸 문서에 모듈 스크립트를 주입하지 않는다. 모듈은 모듈 origin iframe으로만 띄운다.                             | [security.md](../../docs/spec/security.md#3-규칙)               |
| UI-001~009 | 셸 UI도 디자인 규칙을 모두 따른다. 셸 모션은 UI-009를 따른다.                                                  | [design-system.md](../../docs/spec/design-system.md#8-규칙)     |
| GEN-007    | About/크레딧 화면의 저자 표기를 지우거나 약화하지 않는다.                                                      | [process.md](../../docs/spec/process.md#5-규칙)                 |

## 파일 지도

| 위치                         | 내용                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/host.ts`                | Rust 명령 호출(`@tauri-apps/api`는 여기서만)                                                                                                    |
| `src/bridge/ModuleBridge.ts` | 브리지 셸 측 규칙(BRG-001·003·006·007). React와 분리돼 단위 테스트한다                                                                          |
| `src/bridge/keepAlive.ts`    | keepAlive LRU                                                                                                                                   |
| `src/App.tsx`                | 상단바, 내비 레일, 페이지 전환, 테마 push, `fs.dropped` 전달                                                                                    |
| `src/CaptureOverlay.tsx`     | 승인된 고정 `/overlay` 셸 화면. 영역·툴바 전용 명령만 사용하며 모듈을 로드하지 않음([ADR-0017](../../docs/adr/0017-native-capture-sessions.md)) |
| `src/LaunchScreen.tsx`       | 셸 안에서 그리는 시작 화면. 로딩 동안만 보이고 프레임이 없어도 타이머로 넘어간다([ADR-0024](../../docs/adr/0024-shell-motion-and-home.md))      |
| `src/motion.ts`              | 애니메이션 효과 설정, OS reduced-motion, 다시 마운트할 수 없는 레이어용 `playMotion`(UI-009)                                                    |
| `src/deckState.ts`           | 덱 홈의 즐겨찾기·본 도구 목록. 셸 localStorage에 모듈 id만 저장한다(PRV-003)                                                                    |
| `src/categories.tsx`         | 카테고리 순서·아이콘(레일과 덱 홈 공용)                                                                                                         |
| `src/TitleBar.tsx`           | 테두리 없는 창의 상단바(뒤로 버튼, 드래그 영역, 캡션 버튼). 창 조작은 `host.ts`의 `windowControls`로만 한다                                     |
| `src/pages/`                 | 덱(Home), 모듈 화면(ModuleHost), 설정, 정보(About, GEN-007 테스트), UI 갤러리(dev)                                                              |
| `src/generated/`             | Rust에서 생성한 타입과 서드파티 목록(GEN-006)                                                                                                   |

## keepAlive 관리

승인된 학생 화면은 고정 `/presentation` 경로의 `src/Presentation.tsx`다. `host.ts`의 전용 state/close만 사용한다([ADR-0025](../../docs/adr/0025-public-presentation.md), [계약](../../docs/spec/presentation.md)).

- `ui.keepAlive: true` 모듈은 화면을 전환해도 iframe을 숨긴 채 유지한다. 활성 keepAlive 도구를 포함해 최대 3개이며 LRU로 내린다.
- 숨기거나 보일 때 `module.visibility` 이벤트를 보낸다.
- iframe은 고정 순서로 렌더한다. LRU 순서대로 렌더하면 React가 iframe을 옮기고, 옮겨진 iframe은 브리지가 모르는 새 창으로 다시 로드돼 `init`을 받지 못한다(`App.test.tsx`).
- 모듈이 숨겨지거나 내려가면 호스트가 창 상태(항상 위, 전체화면)를 되돌린다.
- 상세: [modules.md 생명주기](../../docs/spec/modules.md#3-생명주기)

BRG-009: 초기화의 권한 조회는 활성 도구를 바꾸지 않으며, 파일 드롭은 현재 표시된 도구에만 전달한다([브리지 명세](../../docs/spec/bridge-protocol.md#4-이벤트-v1)).

## 작업 체크리스트

홈의 빠른 실행과 도구 정보 행은 [ADR-0029](../../docs/adr/0029-compact-tool-workspaces.md)와 [디자인 시스템 1절](../../docs/spec/design-system.md#1-화면-구조)을 따른다(UI-005·007).

- [ ] 브리지 처리 코드를 바꿨다면 BRG-001·006·007 셸 단위 테스트를 갱신했다
- [ ] 새 화면 문구가 UI-007을 따른다
- [ ] 테마 전환이 열린 모듈 iframe에 즉시 반영된다
- [ ] dev 전용 화면(UI 갤러리)이 릴리스 빌드에 포함되지 않는다
- [ ] `pnpm verify` 통과

학교 자료 화면의 JSON 복구 파일·시간표 PNG 출력은 [ADR-0020](../../docs/adr/0020-school-data.md)과 [학교 자료 명세](../../docs/spec/school-data.md)의 승인된 main 셸 전용 명령을 따른다. JSON은 저장 자료만 담고 사진 파일·미저장 초안을 제외한다. PNG는 현재 화면의 미저장 시간표를 포함하지만 학교 자료 저장을 대신하지 않는다. 모듈 브리지·브라우저 다운로드로 출력 권한을 우회하지 않는다.

사진 포함 이동은 [ADR-0026](../../docs/adr/0026-timealert-portability.md)과 [TimeAlert 계약](../../docs/spec/timealert-portability.md)의 다섯 main 명령만 사용한다. 암호·원본 DB·사진 원본은 모듈에 공개하지 않는다. 학생 연결은 명시적 선택만 사용하며 동명이름으로 병합하지 않는다. 공통 JSON에는 사진 파일이 없고 TimeAlert 출력은 저장 자료만 사용한다. Android 실기 증거가 없으면 호환 완료로 표시하지 않는다.
