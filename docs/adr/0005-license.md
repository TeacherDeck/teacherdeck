# ADR-0005: GPL-3.0-only + 제7조(b) 저자 표기 유지, 외부 기여는 DCO

- 상태: 승인됨
- 날짜: 2026-10-08
- 결정자: 신민성, 정영주

## 맥락

무료 오픈소스로 공개하되, 누군가 포크해서 소스를 닫거나 원저작자 이름을 지운 채 배포하는 것을 막고 싶다. 기여자 관리는 가벼워야 한다.

## 결정

- 라이선스는 **GPL-3.0-only**다. 전문은 gnu.org 원문을 그대로 `LICENSE`에 둔다.
- GPLv3 제7조(b)에 따른 추가조항으로 저자 표기 유지를 요구한다(`LICENSE-ADDITIONAL-TERMS`).
- 모든 소스 파일에 SPDX 헤더를 둔다(GEN-008).
- 외부 기여는 CLA 대신 DCO(`Signed-off-by`)로 받는다(GEN-009).
- 프로젝트 이름·로고는 GPL 대상이 아니며 상표 정책을 따로 둔다(`TRADEMARK.md`).

## 의존성 라이선스 allowlist

2026-10-09 확정: 아래 목록에서 LGPL을 뺀 나머지를 허용한다. 목록에 없는 라이선스는 사람 승인이 필요하다(GEN-004).

| 라이선스 | 비고 |
|---|---|
| MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception | |
| BSD-2-Clause, BSD-3-Clause, ISC, Zlib, 0BSD | |
| Unicode-3.0, CC0-1.0 | |
| MPL-2.0 | 파일 단위 copyleft. GPL-3.0과 호환된다. |
| OFL-1.1 | 폰트 전용. 2026-10-10부터 번들 폰트 없음([ADR-0011](0011-winui-aligned-deck-ui.md)) |
| ~~LGPL-2.1, LGPL-3.0~~ | **제외(2026-10-09 확정).** Rust는 정적 링크가 기본이라 동적 링크 조건을 지키기 어렵다. 필요하면 패키지 단위 예외로 따로 승인한다. |

허용 목록은 `tools/checks/licenses.allow.json`(npm)과 `deny.toml`(Rust)에 같은 내용으로 둔다. 목록 밖 라이선스는 패키지 단위 예외로만 허용하며, 승인 사유를 `licenses.allow.json`의 `packages`에 기록한다. 예: `minimatch`(BlueOak-1.0.0, ESLint 개발 도구 전용, 2026-10-08 승인), `@csstools/color-helpers`·`@csstools/css-syntax-patches-for-csstree`(MIT-0)·`lru-cache`(BlueOak-1.0.0)(jsdom 테스트 환경 전용, 2026-10-09 승인).

## 결과

- 강제: `check-licenses`, cargo-deny(SEC-011, Phase 2에서 구현), `check-spdx`(GEN-008).
- About 화면에 7(b) 표기와 모듈 저자를 보여 준다(GEN-007, [design-system.md](../spec/design-system.md#5-about크레딧-화면)).
- 라이선스·저작자 표기 파일 변경은 정지 조건이다(GEN-005).

## 대안

- **MIT/Apache-2.0**: 채택은 쉽지만 소스를 닫은 재배포를 막지 못한다.
- **GPL-3.0-or-later**: 미래 버전 GPL의 조건을 미리 수락하게 된다. 7(b) 추가조항과의 관계를 단순하게 유지하려고 `-only`를 고른다.
- **CLA**: 재라이선스 여지가 생기지만 기여 장벽이 높다.
