# 제안: QuickCapture의 네이티브 영역 캡처와 반복 작업 세션

상태: **승인됨 (2026-10-10 사용자 명시 승인).** 승인 범위 구현과 통합 검증을 진행해요. 실제 확인 범위는 [통합 검토](../reviews/quick-capture-integration.md)에 기록해요.

- 정지 조건: GEN-005의 새 캡, Tauri ACL/로컬 오버레이 창 보안 범위, 브리지 이벤트 계약, GEN-004 런타임 의존성 추가. 기존 폴더의 새 파일 추가와 영속 저장 권한도 명시적으로 승인받아요.
- 배경: 원본 QuickCapture의 고정된 투명 영역을 움직이고 조절한 뒤, 다른 앱을 쓰면서 단축키·더블클릭으로 계속 캡처하는 흐름을 유지해야 해요. 브라우저 캡처 선택창을 매번 띄우거나 이미지 크롭으로 바꾸면 원본의 핵심을 잃어요.
- 제안: 범용 `capture` 1.0.0, `overlay` 1.0.0, `global-shortcut` 1.0.0과 `fs` 1.2.0의 제한된 영속 새 파일 저장 권한을 조합해요. UI는 셸/모듈, OS 조작은 호스트에만 둬요.
- 검토한 대안: 아래 6절.
- 영향: 브리지 envelope의 `deck:1`과 매니페스트/카탈로그 구조는 유지해요. 이벤트 topic 추가와 명시적 네이티브 백그라운드 세션 수명은 DOC-002로 규정해요. Windows만 구현하고 다른 OS는 `CAPABILITY_UNAVAILABLE`로 안내해요.
- 필요한 승인: 이 문서 8절의 범위를 프로젝트 책임자가 승인한 뒤 ADR → spec → Rust 원천 타입 → 생성 → 구현·테스트 순서로 진행해요.

## 1. 원본 UX를 그대로 유지할 범위

읽기 전용으로 `D:/codex_work/programs/QuickCapture/README.md`, `main.py`, `overlay.py`를 대조했어요. Python 파일·설정·저작자 표기는 수정하거나 복사하지 않았어요.

| 원본 기능                    | 구현 계약                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 항상 남아 있는 투명 오버레이 | 프레임 없는 로컬 셸 보조 창. 이동·8방향 크기 조절·항상 위 토글·표시 토글을 유지해요. 설정 창을 닫아도 세션은 유지해요.     |
| 플로팅 툴바                  | 캡처·저장 폴더 열기·설정·항상 위·종료와 실제 물리 픽셀 크기 표시를 유지해요.                                               |
| 전역 기본 Ctrl+Shift+C       | 원하는 조합으로 변경 가능. 등록 충돌은 기존 정상 단축키를 유지하고 알려요. 전체 키 입력을 감시하지 않아요.                 |
| 영역 더블클릭                | 선택된 영역을 즉시 캡처해요. 이동 드래그 종료·단축키와 중복 실행되지 않아요.                                               |
| 자동 폴더 저장               | 한 번 선택한 폴더를 기억하고 다음 시작에도 같은 폴더에 새 파일만 저장해요. 사용자에게 권한 해제와 다시 선택을 제공해요.    |
| PNG/JPG·파일명 3종           | `image_001_HHMMSS`, `capture_YYMMDD_HHMMSS`, `접두어_0001`; JPG 품질 기본 95; 성공 뒤에만 연번 증가·세션 연번 초기화 유지. |
| 중복 이름 비덮어쓰기         | `(1)`, `(2)`를 붙이고 원자적 새 파일 게시로 경합까지 보호해요.                                                             |
| 캡처 피드백                  | 성공 테두리 120ms 점멸, 저장된 표시용 이름·세션 장수, 실패 원인과 다음 행동. 로그에는 이름을 넣지 않아요.                  |
| 테두리 설정                  | 사용자 선택 색과 1~12px 두께. 툴바와 테두리는 캡처 결과에서 제외해요.                                                      |
| 트레이 상주                  | 즉시 캡처·표시 토글·설정·세션 종료, 더블클릭 설정 열기. TeacherDeck 종료는 별도 명확한 메뉴로 구분해요.                    |
| DPI와 위치 저장              | 물리 픽셀 rect를 원천으로 유지. 재시작 시 모니터 변화·화면 밖 영역을 확인해 가용 화면에 복원해요.                          |

원본 `get_capture_bbox`는 전체 좌표를 현재 창의 단일 배율로 곱해요. 이 방식까지 복제하지 않고 혼합 DPI·음수 가상 화면 좌표를 올바르게 처리해요.

## 2. 타입·메서드·권한 경계

아래는 **승인용 계약 초안**이며 생성 타입이 아니에요. 인자·결과는 `deny_unknown_fields` Rust 구조체/enum을 원천으로 정의하고 `pnpm gen`으로 내보내요. HWND·OS 모니터 id·경로·임의 URL·실행 명령은 모듈에 주지 않아요.

```ts
PhysicalRect = { x: i32, y: i32, width: u32, height: u32 } // right/bottom exclusive
DisplayInfo = { displayHandle: string, bounds: PhysicalRect, scale: number, primary: boolean }
OverlayInfo = { overlayHandle: string, rect: PhysicalRect, visible: boolean, alwaysOnTop: boolean }
CaptureSettings = { format: 'png'|'jpeg', quality: number,
  naming: { mode:'numbered'|'datetime'|'custom', prefix?:string }, cursor:false }
CaptureResult = { file: FileHandleInfo, width:u32, height:u32, sequence:u32 }
DestinationGrant = { grantHandle:string, label:string, persistent:boolean, available:boolean }
```

| 캡                  | 메서드                                                                       | 계약                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| capture 1.0         | `displays()`                                                                 | 실제 모니터를 불투명 핸들과 물리 bounds로 제공해요. 원점 0에 제한하지 않아요.                                                                 |
| capture 1.0         | `capture({rect,settings})`                                                   | 명시한 rect 1장을 호스트 temp에 인코딩하고 모듈 소유 FileHandleInfo를 반환해요. 전체 화면은 사용자가 전체 화면 rect를 선택했을 때만 제공해요. |
| capture 1.0         | `arm({overlayHandle,shortcutHandle?,destinationGrant,settings})`             | 사용자 시작으로 반복 캡처 세션을 발급해요. 네이티브 트리거마다 화면 → 인코딩 → 새 파일 게시를 호스트에서 처리해요.                            |
| capture 1.0         | `status({sessionHandle})`, `update`, `resetSequence`, `stop`                 | 세션 상태와 최근 성공 결과·실패 코드만 조회·설정해요. 임의 실행 callback은 받아들이지 않아요.                                                 |
| overlay 1.0         | `create({rect,style,alwaysOnTop})`, `update`, `show`, `hide`, `close`        | 모듈 소유의 영역 선택 창을 다뤄요. 임의 HTML/URL/네이티브 창 핸들을 주입할 수 없어요.                                                         |
| global-shortcut 1.0 | `register({modifiers,key})`, `replace`, `unregister`                         | 허용된 정규화 키 조합을 등록해 triggerHandle을 반환해요. 충돌 변경은 원자적으로 rollback해요. 자동 반복을 억제하고 pressed만 처리해요.        |
| fs 1.2              | `pickDestination({remember:true})`                                           | 호스트 폴더 선택과 명시한 '이 폴더에 새 캡처 파일 저장·기억' 확인 후 append-new-only 영속 grant를 발급해요. 취소는 null.                      |
| fs 1.2              | `destinationStatus({grantHandle})`, `revealDestination`, `revokeDestination` | 복원·탐색기 표시·권한 해제를 제공해요. 권한 해제는 호스트 grant 기록만 해제하며 저장된 사용자 파일을 삭제하지 않아요.                         |

단발 `capture()` 결과는 기존 `fs.openRead/readChunks`의 인증된 `deckmod` 읽기 세션과 256KiB 청크를 사용해요. 기존 `fs` 1.1 새 결과 폴더로 저장할 수도 있어요. PNG/JPG를 base64 브리지나 storage에 넣지 않아요. 반복 캡처는 iframe이 프레임을 받아 다시 전송하는 왕복을 없애고, 동일 소유자로 묶인 overlay·shortcut·destination grant를 호스트가 조합해 저장해요.

`arm`은 도구 이름에 의존하지 않는 영역 캡처 세션이에요. 임의 캡 메서드 연결, 일반 JS 함수 실행, 무제한 녹화·정기 스크린샷은 제공하지 않아요. UI·단축키·더블클릭·트레이의 명시한 캡처 동작 한 번에 한 장만 실행해요.

### 수명·백그라운드

설정 화면만 숨기거나 다른 모듈로 이동해도 사용자 시작한 세션·오버레이·단축키·트레이는 유지해야 해요. 현재 window 캡의 '숨기면 복원' 정책을 기존 캡에 적용한 채 새 overlay/capture 세션 수명만 별도로 정의해요. keepAlive iframe을 무조건 영구 유지하지 않아요. 승인받은 네이티브 세션은 호스트가 소유하고 설정 모듈이 다시 열리면 status로 연결해요.

일반 비활성 모듈 RPC에 권한을 넓히지 않아요. 네이티브 트리거 실행은 세션 소유 모듈의 설치·실행 가능·선언 캡·버전·영속 grant·사용자 시작 상태를 매번 다시 검사해요. 명시한 종료, 권한 해제, 모듈 제거/비호환 업데이트, 앱 종료에는 핫키와 창·임시 읽기 권한을 정리해요. 재시작 시 설정·폴더는 복원하지만 캡처 동작 자체는 자동 시작하지 않아요.

`capture.completed/failed`, `overlay.changed`, `shortcut.triggered` topic을 Rust 원천 이벤트 타입과 BRG-009에 추가하는 승인도 포함해요. 비활성 iframe에 이미지를 방송하지 않아요. metadata push는 살아 있는 소유 iframe에만, 나머지는 status 조회와 호스트 툴바 피드백으로 전달해요.

## 3. Windows 구현·의존성 선택

**권장안: safe API 래퍼와 기존 Tauri 창을 사용하여 레포에 unsafe 코드·lint 억제를 추가하지 않아요.**

- Windows target에 `xcap = '=0.9.8'`, `default-features=false`: 안전한 `Monitor::capture_region`으로 모니터 교차 부분만 캡처. Apache-2.0. Windows backend 소스·DPI 의미·실제 할당량은 고정 crate를 로컬 registry에서 대조했어요. Windows GDI backend는 요청 region 크기 bitmap과 RGBA 버퍼를 할당하며 전체 모니터를 먼저 읽지 않아요. [원천 예제](https://github.com/nashaofu/xcap/blob/master/examples/monitor_region_capture.rs), [고정 버전 메타데이터](https://docs.rs/crate/xcap/0.9.8/source/Cargo.toml).
- Windows target에 `image = '=0.25.10'`, `default-features=false`, `features=['png','jpeg']`: 원본 장면을 PNG/JPG로 제한하여 인코딩하고 JPG 품질을 제어해요. `xcap`이 사용하는 image 0.25와 하나로 해석하도록 lock를 확인해요. [메타데이터](https://docs.rs/crate/image/0.25.10).
- `tauri-plugin-global-shortcut = '=2.4.0'`: Rust API에서만 등록해요. JS 패키지와 frontend plugin 권한을 추가하지 않아요. 기존 Tauri 2.12.1과 요구 버전이 맞아요. [공식 사용법](https://v2.tauri.app/plugin/global-shortcut/), [2.4.0 메타데이터](https://docs.rs/crate/tauri-plugin-global-shortcut/2.4.0).
- 기존 `tauri` 2.12.1의 `tray-icon` 기능만 활성화하고 Rust tray builder를 사용해요. 보조 overlay는 기존 Tauri WebviewWindowBuilder의 transparent/decorations/skip_taskbar/always_on_top/physical_position·size와 안전한 drag/resize API를 사용해요. [공식 트레이](https://v2.tauri.app/learn/system-tray/), [창 설정](https://v2.tauri.app/learn/window-customization/).
- 위 버전은 조사 시점의 공개 registry 자료예요. 승인은 해당 버전·기능·Windows target 범위만 포함해요. 다른 crate 추가·버전 교체·license allowlist 변경은 다시 승인해요. 전이 의존성과 설치 크기·취약점은 `cargo deny`와 고정 lock로 검증해요. 영상/WGC 옵션은 켜지 않아요.

`screenshots` 0.8.10도 safe `capture_area`를 제공하지만 이전 API·image 버전과 혼합 DPI 검증 부담 때문에 기본안으로 선택하지 않아요. [API](https://docs.rs/screenshots/latest/screenshots/struct.Screen.html).

원시 Win32 fallback은 기본안에 포함하지 않아요. 직접 RegisterHotKey/GDI/WIC/SetWindowDisplayAffinity를 호출하면 SEC-010 분리 FFI와 현재 `unsafe_code=deny` 사이에 별도 승인이 필요해요. `tools/checks/suppressions.allow.json`에는 사람 승인형 좁은 예외 장치가 있지만 이를 이번 구현을 통과시키는 우회로 사용하지 않아요. safe 래퍼로 정확도를 입증하지 못하면 기능을 줄여 출시하지 않고 원인·필요한 추가 승인을 보고해요.

## 4. 오버레이 origin·ACL과 화면 제외

오버레이 문서는 모듈 origin이 아니라 **셸의 고정된 로컬 `/overlay` route**로만 로드해요. 모듈 HTML·외부 주소를 로드하지 않아요. `main` ACL의 `host_invoke`, fs·shell·http·global-shortcut frontend plugin 권한을 보조 창으로 복사하지 않아요.

별도 `capabilities/overlay.json`의 정확한 label prefix `capture-overlay-*`, `capture-toolbar-*`에 core drag/resize와 `overlay_ui_action`, `overlay_ui_state`만 허용해요. 이 전용 셸 명령은 호출 webview label→호스트 보유 overlayHandle 매핑으로만 소유자를 판단하고, payload의 moduleId/sessionId를 믿지 않아요. 정해진 캡처·설정열기·폴더표시·항상위·표시·종료 action만 허용해요. `@tauri-apps/api`는 셸 origin 코드에서만 사용하며 모듈은 SDK로만 호출해요. 추가 보안 선언이 필요한 CSP 항목은 기존 로컬 origin·소스만 유지하고 정확한 diff를 승인 구현 PR에서 제시해요. custom protocol 쓰기 라우트나 네트워크 origin은 추가하지 않아요.

원본처럼 캡처 순간 오버레이와 툴바를 숨기고, hide 완료 뒤 제한된 compositor settling을 기다린 다음 읽어요. 원래 숨겨져 있었다면 캡처 뒤 임의로 보여 주지 않아요. 오류·취소에도 기존 표시 상태를 복원해요. Tauri의 safe content-protection 기능을 보조적으로 확인하되 캡처 영역이 검게 변하는 fallback을 성공 처리하지 않아요. [Windows capture exclusion의 적용 범위](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

고정 sleep만으로 모든 드라이버에서 제외를 보장했다고 주장하지 않아요. 최대 대기 제한·성공/실패 복원과 실제 픽셀 검증이 출시 조건이에요. 직접 `DwmFlush`는 프로세스의 대기 surface 범위이며 세션 전체 flush가 아니므로 만능 해법으로 쓰지 않아요. [공식 설명](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmflush).

## 5. 좌표·버퍼·파일 저장 제한

- `PhysicalRect`는 실제 가상 데스크톱 픽셀 좌표예요. x/y 음수를 허용하고 width/height, 덧셈·곱셈·stride·allocation을 checked arithmetic으로 검사해요. 배율을 전역 좌표에 곱하지 않아요.
- 셸 pointer의 CSS/dip 변화는 해당 창의 scale과 **물리 원점**을 기준으로 환산해요. 창 이동·DPI 변경 이벤트에서 실제 physical position/size로 다시 읽어요. 원본 테두리와 툴바 inset은 해당 창 배율로 올림하고 실제 client rect와 일치하도록 검증해요. [DPI 가상화와 WindowRect 경계](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect), [PMv2](https://learn.microsoft.com/en-us/windows/win32/hidpi/dpi-awareness-context).
- 모니터마다 rect와 물리 bounds의 교집합을 구하고 모니터 상대 물리 좌표로 region을 읽어 같은 배율 없이 붙여요. DPI가 다른 모니터를 가로지르는 영역도 유지해요. 모니터 사이 빈 공간은 명시한 단색 배경으로 채우고 disconnected 영역 전체라면 거부해요. 이미지 크기를 몰래 잘라 성공하지 않아요.
- 최소 실제 영역 5×5px, 최대 32메가픽셀·한 축 16,384px. 원본 UI는 드래그 최소 약100dip를 유지해요. raw RGBA 합성 버퍼 128MiB 이하, 인코딩 결과 128MiB 이하, 프레임 1개·작업 1개·대기 트리거 1개. hotkey 반복·더블클릭 중첩은 `BUSY`/debounce 300ms로 막아요.
- capture job은 OS 작업 스레드에서 실행하고 인코딩도 셸/메인 창 이벤트 루프를 막지 않아요. 종료 시 in-flight 게시 단계와 취소 경계를 분리해 미완성 파일을 사용자 결과로 표시하지 않아요.
- fs 1.2 영속 grant의 경로와 directory fingerprint는 호스트의 모듈 소유 메타데이터로만 보관해요. 매 실행 root 정규화·reparse 검사·directory guard·가용성 검사. 폴더가 사라지거나 교체되면 자동 생성/다른 폴더로 저장하지 않고 다시 선택을 요구해요. 핸들을 storage에 저장하여 fs1.1 세션 수명을 우회하지 않아요.
- 목적지는 새 파일 append만 허용해요. 경로구분자·Windows 예약 장치명·후행 점/공백·NUL·제어문자·지나치게 긴 접두어를 정규화/거부하고 표시명과 별개로 안전한 단일 filename을 만들어요. atomic create-new/post 없이 존재 확인 후 일반 write를 하지 않아요. 저장 실패는 연번을 소비하지 않고 이미 저장된 파일을 지우지 않아요.
- 영속 destination grant는 일반 읽기·열거·기존 파일 수정 권한을 주지 않아요. 캡처로 새로 저장한 결과에만 read-only fileHandle을 발급해요. 모듈·앱 세션에 묶인 읽기권한은 기존 fs1.1 제한·만료를 지켜요. 트레이에서 반복 캡처했다고 과거 모든 파일 핸들을 무제한 보관하지 않아요.
- 로그·에러에는 화면 pixels·텍스트·폴더·파일명·단축키 사용자 입력을 넣지 않아요. 표시용 성공 filename은 결과/UI에만 제공해요. 외부 전송·클립보드 읽기·OCR·사용자 파일 삭제/덮어쓰기는 추가하지 않아요.

## 6. 대안 비교

| 대안                      | 판단                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 매번 getDisplayMedia 선택 | 지속 영역·전역 단축키·타 앱 위 오버레이·자동 폴더 저장을 유지하지 못하므로 채택하지 않아요.                      |
| 기존 fs/window만          | 파일 읽기/쓰기와 main 항상위만 있고 화면 픽셀·보조 창·전역 핫키가 없어요.                                        |
| 모듈 JS/WASM만            | 인코딩은 가능하지만 OS 화면·전역 키·네이티브 창 권한은 해결하지 못해요.                                          |
| 원본 Python exe 동봉      | 모듈은 웹 번들이고 native는 host만이라는 구조와 별도 runtime/update 크기에 맞지 않아요.                          |
| raw Win32 GDI/WIC/HotKey  | 기술적으로 가능한 fallback이지만 unsafe 예외·어댑터 검토를 추가로 요구하므로 현재 승인안의 기본 선택이 아니에요. |

## 7. 승인 후 작업과 완료 증거

1. ADR와 capture/overlay/shortcut/fs1.2·브리지 topic·셸 보조 origin·네이티브 세션 수명 spec 확정.
2. Rust 타입·캡 레지스트리·SDK 그룹·생성물, 호스트 safe 래퍼·보조 셸 UI·ACL, 모듈 생성기로 실제 모듈 구현. 완료되지 않은 placeholder 모듈은 기본 번들에 넣지 않아요.
3. 합성 좌표/픽셀/파일명·mock host 테스트: 음수 위치·125/150/200%·교차 DPI·빈 영역·overflow·unknown fields·권한 거부·남의 핸들·중복 파일 경합·저장 실패/정리·단축키 충돌 rollback·중복 트리거·세션 종료·영속 grant 재검증.
4. 실제 Windows 2개 배율 모니터에서 합성 체크보드 캡처: 설정 영역 픽셀 크기·모서리 좌표·툴바/테두리 미포함을 PNG로 검증. 앱 뒤/전환/설정닫힘/트레이에서 Ctrl+Shift+C·변경키·더블클릭·드래그·resize·피드백·폴더열기를 확인.
5. PNG/JPG·품질·모든 이름양식·중복·세션초기화·restart 기억·폴더삭제/드라이브분리·등록충돌·화면잠김/RDP/보호화면 실패를 검증. Windows 예약키를 강제로 빼앗지 않아요. [RegisterHotKey 충돌·반복 제한](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey).
6. 기본 번들·설치본·오프라인 환경에서 실제 결과 확인, `cargo deny`, `pnpm verify`. 화면 픽셀 오차나 overlay 포함이 있으면 기능 축소판 출시 대신 원인을 고쳐요.

## 8. 승인할 정확한 범위

- 새 capture/overlay/global-shortcut 1.0 캡과 fs1.2 영속 append-only destination grant, 위 메서드·한도·소유자·취소/종료 계약.
- 고정한 Windows-only `xcap =0.9.8`, `image =0.25.10` PNG/JPEG, `tauri-plugin-global-shortcut =2.4.0`, 기존 tauri의 tray-icon 기능. 새 JS runtime/plugin 패키지는 없어요.
- 로컬 overlay 셸 route와 별도 최소 ACL·고정 셸 명령, 새 metadata 이벤트 topic, 사용자 시작 네이티브 세션의 백그라운드 유지·tray-close 동작. main 권한을 모듈이나 overlay에 복사하지 않아요.
- 사용자 한 번 선택한 폴더를 호스트가 기억하고 같은 폴더에 새 캡처 파일만 자동 저장하는 권한. 기존 사용자 파일을 삭제/덮어쓰는 권한은 포함하지 않아요.

이 문서 승인만으로 blanket unsafe/lint 억제·추가 dependency·외부 URL·네트워크·자동 녹화·계획되지 않은 캡을 허용하지 않아요. safe 래퍼 제약으로 별도 FFI가 필요하면 구체적인 파일/API/안전성 사유를 새 제안으로 먼저 보고해요.

## 승인 후 확정 사항

사용자가 2026-10-10 제안 범위를 명시 승인했어요. 원천 타입은 capture/overlay/global-shortcut 1.0.0, fs 1.2.0, SDK 0.4.0으로 구현해요. region과 별도 toolbar 창을 함께 숨기며 region rect 자체가 캡처 영역이에요. 128MiB는 각 raw 버퍼 상한이며 프로세스 총 메모리 보장이 아니에요. xcap GDI bitmap과 변환 버퍼, 합성 버퍼, encoder를 함께 고려하여 순차 교집합 처리와 전체 작업 예산을 제한해요. 실제 cargo deny Windows 폐쇄에서 새 캡 의존성의 추가 거부 라이선스는 없고, clipboard-win/error-code의 기존 BSL-1.0 승인 항목만 확인되었어요.

### 구현 감사에 따른 권한 설명 보완 (2026-10-10)

승인 초안에는 일반 비활성 RPC가 거절된다고 적었지만 실제 기존 bridge.authorize는 runnable·캡 선언·버전을 검사해 keepAlive 숨김 iframe의 RPC도 가능했어요. 이번 구현은 기존 일반 RPC 권한·모듈 소유자 검사를 변경하지 않아요. fs 드롭 active-only와 기존 window 숨김 복원은 유지해요. 사용자 승인된 네이티브 세션은 iframe 없는 상태에서도 소유자 설치·캡·grant를 검증해 실행해요. 일반 RPC 활성 강제는 storage 정리 등 기존 동작에 영향이 있으므로 별도 검토 항목으로 기록해요. 이 문단은 최초 초안 설명의 구현 감사 보완이며 새 권한 확대가 아니에요.
