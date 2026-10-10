# 제안: 클립보드 출력 캡 1.0

상태: 2026-10-10 사용자가 제안서대로 구현을 승인했다. ADR-0016과 구조화 출력 구현을 진행한다. 새 native FFI, CSP·ACL 변경은 승인 범위에 포함하지 않는다.

- 정지 조건: 새 캡 추가(GEN-005, CAP-005), 호스트 런타임 의존성 추가(GEN-004).
- 배경: 원본 `D:/codex_work/meeting_note/index.html`의 `copyRich()`는 제목·안건 제목·발언자 굵은 글씨·발언 표·결정/조치 표·줄바꿈을 HTML과 일반 텍스트 두 형식으로 복사한다(1482~1601행). 읽기 기능은 사용하지 않는다. 현재 모듈 iframe에서는 웹 클립보드 권한과 활성화 조건에 의존하므로 학교 PC의 한글·Word 붙여넣기를 안정적으로 복원하려면 네이티브 출력 기능이 필요하다.
- 제안: 범용 `clipboard` 1.0.0에 `writeText`와 `writeRichText`만 제공한다. 클립보드 읽기·지우기·감시·이미지/파일 목록 출력·전역 단축키는 포함하지 않는다. 새 호스트 의존성은 Windows 전용 `arboard = { version = "=3.6.1", default-features = false }` 하나를 우선안으로 승인받는다.
- 검토한 대안: 웹 Clipboard API/execCommand는 iframe 권한과 WebView 동작에 의존한다. SDK fs로 HTML 파일을 저장하는 경로는 유지할 수 있지만 복사 후 즉시 붙여넣기와 다르다. 모듈 JS/WASM은 OS 클립보드 자체 권한을 얻지 못한다. 아무 변경도 하지 않으면 서식 복사는 지원하지 않는다.
- 영향: 새 캡이며 기존 캡·브리지 envelope·매니페스트·카탈로그 포맷은 그대로다. 아래의 엄격한 입력·출력 제한과 사용자 클릭에 한정한 쓰기를 적용한다. Windows 시스템 클립보드에 대한 명시적인 복사 동작이므로 원본 파일은 변경하지 않는다.
- 필요한 승인: 사용자가 새 `clipboard` 캡, 아래 구조화 서식 API, Windows 전용 arboard 3.6.1 호스트 의존성 추가를 승인한다. 추가 native 의존성이나 보안 설정 변경이 필요해지면 다시 제안한다.

## API와 타입 초안

타입은 승인 후 `crates/deck-core/src/caps/clipboard.rs`에서 serde/ts-rs로 정의한다. 아래는 검토용 설명이며 생성 TS 파일을 수동으로 만들지 않는다.

```ts
type ClipboardWriteTextArgs = { text: string };
type ClipboardRun = { text: string; bold?: boolean };
type ClipboardBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: ClipboardRun[] }
  | { kind: 'paragraph'; runs: ClipboardRun[] }
  | { kind: 'table'; rows: ClipboardCell[][] };
type ClipboardCell = { runs: ClipboardRun[]; header?: boolean };
type ClipboardWriteRichTextArgs = {
  plainText: string;
  blocks: ClipboardBlock[];
};
// deck.clipboard.writeText(args): Promise<void>
// deck.clipboard.writeRichText(args): Promise<void>
```

`writeRichText`는 원시 HTML, 스타일, URL, 이미지, 파일 경로를 받지 않는다. 호스트가 모든 text를 HTML escape한 뒤 고정 태그 `h1/h2/h3`, `p`, `strong`, `table/tr/th/td`, `br`로 직렬화한다. 입력의 CRLF/CR은 LF로 정규화하고 LF를 `br`로 만든다. 문서에는 정적인 맑은 고딕/Segoe UI 폰트, 제목 크기, 표 테두리와 셀 여백만 넣는다. 모듈이 CSS·속성·글꼴·색을 주입하는 통로는 만들지 않는다. 외부 리소스, 링크, scripts, event handler가 생성될 수 없다. 임의 HTML sanitizer 의존성이 필요하지 않다.

회의록은 제목→일시/장소/참석 표→안건 제목→시각/발언자/본문 표→결정/조치 표로 매핑한다. 발언자 및 결정/조치 접두사는 bold run을 사용한다. 공개 내보내기 대상 필터는 회의록 모듈에서 수행하며, 비공개 발언이 섞이지 않는 별도 테스트를 둔다. 일반 텍스트 대체 본문은 원본의 `buildTxt()`와 같은 의미를 유지한다.

## 입력과 자원 한계

- `writeText.text` UTF-8 최대 256KiB.
- `writeRichText`의 plainText와 모든 run.text의 UTF-8 합산 최대 256KiB. 생성 HTML과 plainText UTF-8 합산도 최대 256KiB이며 초과 시 쓰기 전에 `INVALID_ARGS`를 반환한다. HTML escape와 표 태그 확장 후에도 제한을 다시 확인한다.
- 전체 JSON 직렬화 최대 512KiB. 기존 브리지 1MiB 검사도 그대로 유지한다.
- 최상위 block 최대 4096, 전체 표 행 최대 4096, 행당 cell 최대 32, 전체 cell 최대 16384, run 총합 최대 32768, 셀/문단당 run 최대 64.
- table은 비어 있지 않으며 행마다 열 수가 같아야 한다. heading level은 1~3만 받는다. 중첩 table과 임의 재귀 구조는 없다. unknown field, 잘못된 enum/숫자/배열은 거부한다.
- NUL 문자 및 불필요한 제어 문자는 거부한다. 탭·LF는 허용한다. 문자열을 잘라서 복사하지 않고 사용자가 파일 저장이나 더 작은 범위를 선택하도록 고정 오류 메시지를 반환한다.
- 브리지 권한 검사를 먼저 하고 유효성 검증·HTML 생성 후 OS를 호출한다. 새 cap의 모든 요청을 한 OS 작업 스레드에서 직렬화한다. 경쟁/점유 실패는 일반 `BUSY` 오류로 반환하고 자동 반복 복사를 하지 않는다.

3000개 회의 기록은 block 수로 먼저 거부하지 않는다. 발언을 표의 행으로 모으되 실제 256KiB 출력 상한이 최종 제한이며, 큰 회의는 HTML 파일 저장을 안내한다.

## 최소 의존성과 공식 근거

확인일: 2026-10-10.

우선안 arboard 3.6.1은 MIT OR Apache-2.0이며 Rust MSRV 1.71이다. `default-features = false`로 기본 image-data를 제거한다. Windows에서 clipboard-win, windows-sys, log 등의 전이 의존성이 생기므로 승인 후 Cargo.lock 실제 해석 결과에 `cargo deny`를 적용한다. 새 직접 의존성은 호스트의 Windows target에 한정하고 deck-core와 SDK에는 추가하지 않는다. [공식 Cargo.toml](https://raw.githubusercontent.com/1Password/arboard/v3.6.1/Cargo.toml), [기능 플래그](https://docs.rs/crate/arboard/3.6.1/features).

arboard의 `set_text`와 `set_html(html, Some(plainText))`는 필요한 두 출력을 제공한다. Windows에서는 병렬 클립보드 접근을 피하도록 안내하므로 한 스레드에서 처리한다. [공식 API](https://docs.rs/arboard/3.6.1/arboard/struct.Clipboard.html).

대안 `tauri-plugin-clipboard-manager`의 현재 안정 버전은 2.4.1이고 라이선스는 MIT 또는 해당 파일의 MIT/Apache-2.0이다. readText, writeText, writeHtml, clear 등의 plugin command와 게스트 바인딩까지 포함하며 arboard도 의존한다. 이 제안의 출력 전용 범위에는 직접 arboard보다 넓어 채택하지 않는다. JS plugin 바인딩과 plugin ACL을 모듈에 노출하지 않는다. [공식 패키지](https://docs.rs/crate/tauri-plugin-clipboard-manager/latest).

## 보안과 개인정보

기존 host_invoke→cap router를 사용하므로 브리지 envelope, 커스텀 프로토콜, CSP, Tauri ACL 변경은 필요하지 않다는 설계다. 모듈은 `@deck/sdk`의 헬퍼만 사용한다. 모듈의 선언/활성/버전 권한을 매 호출 확인하고 clipboard 미선언 모듈은 거부한다. 회의록은 `optional: { clipboard: '^1.0' }`로 선언하고 `deck.has()` + CapabilityGate로 구형 호스트에서 파일 저장 경로를 유지한다.

클립보드에 기록하는 문자열은 사용자 데이터일 수 있으므로 로그·에러·panic 문맥·디스크에 남기지 않는다. OS error의 원문을 그대로 반환하지 않는다. 복사 버튼을 눌렀을 때만 쓰며 백그라운드·자동 저장·화면 진입에는 호출하지 않는다.

Windows 클립보드 동기화와 기록에 데이터가 남지 않도록 arboard `SetExtWindows`의 cloud/history 제외를 고정 적용한다. 모듈이 이를 끄는 인자는 받지 않는다. 이는 해당 항목의 Windows 동작에 대한 요청이며 PC에 설치된 별도 클립보드 감시 앱까지 차단하는 보장은 하지 않는다. [공식 Windows 구현](https://raw.githubusercontent.com/1Password/arboard/v3.6.1/src/platform/windows.rs).

Windows는 SetClipboardData 성공 시 메모리 소유권을 시스템에 넘기고 CloseClipboard 이후 다른 앱이 접근한다. 따라서 완료한 데이터를 유지하기 위해 Worker/모듈을 계속 살려두는 설계는 필요하지 않다. 실제 호스트 종료 뒤 Word/한글 붙여넣기는 수용 테스트로 확인한다. [Microsoft SetClipboardData](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata), [Microsoft CloseClipboard](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-closeclipboard).

주의할 구현 지점: arboard 3.6.1 Windows `html()`은 HTML Format 등록 실패 시 일반 텍스트만 썼어도 Ok가 될 수 있다. 실제 구현 승인 후 이 경계는 HTML format 존재를 콘텐츠 읽기 없이 검증할 수 있는지 검토한다. 검증을 위해 별도 직접 native dependency 또는 프로젝트 FFI 추가가 필요하면 추가 제안하며, 서식 유지 확인이 불가능한 상태에서 완료 문구를 확정하지 않는다. HTML 등록 실패·점유·출력 크기 초과는 각각 일반화된 안내를 반환한다. raw clipboard 콘텐츠를 되읽어 검증하는 캡 메서드는 만들지 않는다.

## 승인 후 변경 파일과 버전

1. `docs/adr/<next>-clipboard-output.md` 결정 기록 및 `docs/spec/capabilities.md` 규격 갱신. 예정 캡 목록에는 현재 clipboard가 없으므로 새 범용 출력 캡으로 등록한다.
2. 루트 `Cargo.toml` workspace 의존성과 `apps/desktop/src-tauri/Cargo.toml` Windows dependency, `Cargo.lock`에 arboard 3.6.1 추가.
3. `crates/deck-core/src/caps/clipboard.rs` 타입·검증·HTML 생성 순수 로직, `caps/mod.rs` registry 등록.
4. `apps/desktop/src-tauri/src/caps/clipboard.rs` Windows OS 호출 및 `caps/mod.rs` route 연결. 호스트 초기화에는 직렬 작업 서비스만 연결한다.
5. `crates/deck-codegen/src/main.rs` 타입 그룹 추가 후 `pnpm gen`. schema·SDK generated·spec 생성 표는 생성 결과만 사용한다.
6. `packages/sdk/src/client.ts`, `index.ts` 타입 헬퍼와 mock host 테스트 추가. SDK 공개 API 추가에 맞춰 minor bump.
7. `modules/meeting-note/module.json` optional 선언, App/내보내기 로직에 typed mapping, 모듈 minor bump 및 CHANGELOG/README.
8. 앱 minor 릴리스 버전과 루트 CHANGELOG, 관련 AGENTS 요약을 갱신하고 `pnpm sync-versions`, `pnpm verify`를 실행한다. 캡 1.0.0, 브리지 deck=1, manifestVersion=1과 catalog 포맷은 유지한다.

## 검증 계획

- 순수 로직: 한국어/이모지 UTF-8, `<>&"'` escape, 줄바꿈, heading level, 굵은 글씨, 표 직렬화, 빈/잘못된 행, unknown field, NUL, 각 제한 경계 및 escape 이후 초과를 검증한다.
- 호스트: 권한 없음·버전 미충족·비활성 모듈·잘못된 args에서 OS가 호출되지 않으며 레지스트리 모든 메서드에 route가 존재하는지 검사한다.
- SDK mock host: 두 메서드 직렬화/응답/일반 오류·타임아웃 및 optional cap 유무를 검사한다.
- 회의록: 원본 합성 사례의 제목·시간·장소·참석·안건·발언·결정·조치가 표/굵은 글씨/줄바꿈으로 매핑되고 비공개 발언이 없는지 검증한다.
- Windows 실제 QA: 복사 직후와 모듈/호스트 종료 후 Word 및 한글에 붙여넣어 한글, 표, 제목, 굵은 발언자와 줄바꿈을 확인한다. 메모장 일반 텍스트 대체본, Windows 클립보드 기록/동기화 제외, OS 점유 오류와 재시도를 확인한다. 한글/Word 설치가 없어 확인하지 못한 항목은 완료라고 보고하지 않는다.
- 전체 `pnpm verify`, `cargo deny`, 번들 크기 비교 및 native 패키지 실행 검증.

## 사용자 승인 요청 문구

“회의록을 한글·Word에 표와 굵은 글씨를 유지해 붙여넣으려면 새 클립보드 출력 기능이 필요해요. [제안서](clipboard-output.md)의 출력 전용 clipboard 1.0과 arboard 3.6.1 추가를 승인해 주시면 구현하겠습니다.”

승인을 요청하는 근거는 [add-capability 스킬](../../.claude/skills/add-capability/SKILL.md)의 “사람이 승인하기 전에는 코드를 쓰지 않는다.”와 GEN-004/GEN-005다. 현재는 제안서만 작성했다.
## 구현 중 추가 승인 필요: 전이 의존성 라이선스

정확한 두 crate·버전에만 적용할 cargo-deny 예외와 검증 계획은 [후속 제안서](clipboard-license-followup.md)에 정리했다. 전역 라이선스 목록과 정책 파일은 승인 전 변경하지 않았다.
