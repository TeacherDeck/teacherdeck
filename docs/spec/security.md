# 보안 (security)

보안 원칙, 위협 모델 요약, SEC 규칙을 정의한다. 키 관리는 [keys.md](../security/keys.md), 취약점 신고는 [SECURITY.md](../../SECURITY.md)를 본다.

## 1. 원칙

1. **네이티브 권한은 호스트에만.** 모듈은 웹 번들이며 Tauri IPC에 닿지 못한다. OS 접근은 Rust 캡을 거친다([ADR-0003](../adr/0003-module-isolation.md)).
2. **origin 분리.** 셸과 각 모듈, 서로 다른 모듈은 모두 독립 origin이다. iframe `allow-same-origin`의 안전성은 이 분리에 기댄다([ADR-0013](../adr/0013-module-origin-isolation.md)).
3. **최소 권한.** Tauri ACL은 셸 메인 창에만, 필요한 커맨드만 준다.
4. **서명된 업데이트.** 앱은 Tauri updater 서명 검증을 거쳐서만 업데이트된다. 업데이터 서명키가 신뢰 루트다.
5. **보안 설정 변경은 정지 조건.** CSP, ACL, updater, 커스텀 프로토콜 변경은 GEN-005에 따라 사람 승인을 받는다.

## 2. 위협 모델 요약

| 위협                       | 예                                            | 완화                                                                                                                   |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 악성·버그 모듈의 권한 상승 | 모듈이 IPC를 직접 호출, 다른 모듈 데이터 접근 | 다른 origin의 iframe(SEC-002, SEC-004), 셸의 출처 판정(BRG-001), Rust 매 호출 권한 검사(CAP-008), 데이터 격리(PRV-007) |
| 경로 탈출                  | `deckmod://…/../../` 또는 `%2e%2e`            | 정규화 후 모듈 루트 검사, 심볼릭 링크 거부(SEC-005)                                                                    |
| 악성 패키지                | zip-slip, 압축 폭탄, 변조 파일                | 패키지 검증(SEC-006)                                                                                                   |
| 업데이트 하이재킹          | 가짜 업데이트 서버                            | updater 서명 검증(SEC-008), 키 분리([keys.md](../security/keys.md))                                                    |
| 카탈로그 롤백              | 예전 취약 버전 재배포                         | `seq` 단조 증가 검사([catalog.md](catalog.md)), revoke                                                                 |
| 데이터 유출                | 모듈의 외부 전송, 로그에 개인정보             | 모듈 CSP `connect-src 'self'`(MOD-008), PRV-001, PRV-003                                                               |
| 공급망                     | 악성 의존성, workflow 변조                    | cargo-deny·라이선스 검사(SEC-011), action SHA 고정(CI-002), PR·`verify` 필수(CI-006)                                   |
| 비밀 유출                  | 서명키 커밋                                   | SEC-009, gitleaks, push protection                                                                                     |

학교 PC에는 백신·보안 에이전트가 많다. 서명되지 않은 실행 파일은 차단될 수 있으므로 Authenticode 서명은 별도로 다룬다(`TODO(human)`, 범위 밖).

## 3. 규칙

- **SEC-001** [MUST] 셸 webview는 로컬 번들만 로드하며 CSP를 설정한다. 원격 URL을 로드하지 않는다. — 강제: tauri.conf 검사 `check-security`
- **SEC-002** [MUST] 모듈은 셸 및 다른 모듈과 독립 origin에서만 서빙한다. Windows origin은 `http://deckmod.<id>.modules.localhost`다. 셸 origin에서 모듈 코드를 서빙하거나 셸 문서에 모듈 스크립트를 주입하지 않는다. iframe `allow-same-origin`이 안전하다는 전제가 이 규칙이다. — 강제: origin 생성·authority 검증(`origins.rs`, `protocol.rs`), 셸 브리지·CSP 테스트
- **SEC-003** [MUST] Tauri ACL은 셸 메인 창에만, 최소 권한으로 준다. 프론트엔드에 fs/shell/http 플러그인 권한을 주지 않는다. OS 접근은 Rust 캡을 경유한다. — 강제: `check-security`
- **SEC-004** [MUST] 모듈 origin에서 Tauri IPC에 접근할 수 없어야 하며, 이를 검증하는 테스트나 절차를 유지한다. — 강제: 검증 절차 [sec-004.md](../security/sec-004.md)
- **SEC-005** [MUST] `deckmod` 프로토콜은 정확한 `<id>.modules.localhost` authority와 경로 id를 대조하고 정규화 후 해당 모듈 루트 하위만 서빙한다. userinfo·port·추가 label·후행 점, `..`, 퍼센트 인코딩 우회, 심볼릭 링크를 거부하고, 지정 CSP와 `nosniff` 헤더를 붙인다. 예약 파일 리소스도 해당 모듈 authority 아래에서 권한을 검사한다. bare `deckmod.localhost`는 명시 활성화한 디버그 프로브만 제공한다. — 강제: 프로토콜 테스트(`src-tauri/src/protocol.rs`)
- **SEC-006** [MUST] 패키지 설치 시 zip-slip·크기·SHA256SUMS를 검증하고, 원격 카탈로그 도입 시 서명 검증을 추가한다. — 강제: deck-core `package.rs` 테스트
- **SEC-007** [MUST] 릴리스 빌드에서 devtools를 비활성화한다. — 강제: `check-security`
- **SEC-008** [MUST] updater는 서명을 검증하고, 자동 재시작하지 않는다(사용자 동의 후 적용). — 강제: 코드 리뷰
- **SEC-009** [MUST NOT] 비밀값(키, 토큰)을 레포에 두지 않는다. — 강제: gitleaks lefthook, GitHub push protection(사람 설정), `.claude/settings.json` deny
- **SEC-010** [MUST] deck-core는 `#![forbid(unsafe_code)]`를 둔다. 호스트의 Win32 FFI는 별도 모듈로 분리하고 안전성 주석과 리뷰를 거친다. — 강제: 컴파일러, [manual]
- **SEC-011** [MUST] 의존성 라이선스·보안 권고 검사를 통과한다. — 강제: cargo-deny, npm license check
