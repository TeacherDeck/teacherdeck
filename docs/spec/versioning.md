# 버전 (versioning)

버전 축과 각 축의 원천, 모듈 호환성 해석 알고리즘을 정의한다.

## 1. 버전 축

| 축 | 형식 | 원천 | 올리는 때 |
|---|---|---|---|
| 앱 | semver | 루트 `package.json`(VER-001) | 릴리스마다 |
| 캡 | semver, 캡별 | Rust 레지스트리 상수(VER-002) | CAP-004 |
| 모듈 | semver, 모듈별 | `modules/<id>/module.json` | VER-004 |
| 브리지 프로토콜 | 정수 `deck` | 셸·SDK 상수 | 깨지는 변경(BRG-008) |
| 매니페스트 포맷 | 정수 `manifestVersion` | deck-core | 매니페스트 포맷 변경(GEN-005) |
| 카탈로그 인덱스 | 정수 `format` + 단조 증가 `seq` | 인덱스 생성기 | [catalog.md](catalog.md) |
| SDK | semver | `packages/sdk/package.json` | 공개 API 변경(VER-006) |

- 앱 버전과 캡 버전은 독립이다(VER-003). 앱이 1.4.0이어도 `storage` 캡은 1.0.0일 수 있다.
- `tauri.conf.json`의 버전은 루트 `package.json`을 참조하고, Cargo 버전은 `pnpm sync-versions`로 맞춘다(Phase 2에서 구현).

## 2. 모듈 semver

| 변경 | bump |
|---|---|
| 버그 수정, 문구 수정 등 사용자에게 보이는 작은 변경 | patch |
| 기능 추가, `requires` 범위 상향 | minor 이상 |
| 저장 데이터 형식 비호환 변경 등 | major |

`requires`를 올리면 CHANGELOG에 "필요 앱 버전"을 적는다(VER-004).

## 3. 호환성 해석 알고리즘

deck-core의 순수 함수로 구현한다(VER-005, Phase 3에서 구현).

```
입력: 호스트 캡 버전 맵 H, 모듈 id별 후보 버전 목록 C(id) (출처: bundled | installed | catalog)
for each id:
  cands = C(id) 중 manifest 유효 && !revoked, 버전 내림차순
  if cands 비어 있음:
      state = (C(id)가 전부 revoked) ? Revoked : Invalid
      continue                                  # Phase 1 명확화: 아래 단계를 건너뛴다
  pick = cands 중 requires의 모든 (cap, range)가 H[cap]으로 만족되는 첫 번째
  if pick 없음:                       state = NeedsAppUpdate       (최소 필요 캡 버전 보고)
  else if pick != cands[0]:           state = NewerNeedsAppUpdate  (pick 사용, 배지 표시)
  else:                               state = Ready
  optional 미충족 캡 목록은 결과에 포함 (UI에서 기능별 안내)
semver 매칭은 semver 크레이트 VersionReq 사용. prerelease는 명시적으로 요청된 경우에만 매칭.
```

해석 세부:

- H에 없는 캡(미등록 캡)은 어떤 범위도 만족하지 않는다. `requires`에 있으면 그 후보는 탈락하고, `optional`에 있으면 미충족 목록에 들어간다.
- `requires`가 비어 있으면 모든 H에서 만족한다.
- 결정 대기 항목(Phase 3 전에 확정 필요):
  - `TODO(human)`: NeedsAppUpdate일 때 "최소 필요 캡 버전"을 어느 후보 기준으로 보고할지. 제안은 `cands[0]`(최신 유효 후보)의 미충족 requires다.
  - `TODO(human)`: 같은 버전이 여러 출처에 있을 때의 우선순위. 제안은 installed > bundled > catalog다(로컬 우선, 다운로드 회피). 같은 버전인데 sha256이 다르면 그 버전을 Invalid로 본다.

### UI 배지

| 상태 | 배지 문구 |
|---|---|
| Ready | (없음) |
| NewerNeedsAppUpdate | 새 버전은 앱 업데이트 필요 |
| NeedsAppUpdate | 앱 업데이트 후 사용 가능 |
| Revoked | (Phase 5에서 문구 확정) |
| Invalid | 개발 모드에서만 표시 |

배지를 누르면 updater 확인을 시작한다.

## 4. 규칙

- **VER-001** [MUST] 앱 버전의 원천은 루트 `package.json`이다. `tauri.conf.json`은 이를 참조하고, Cargo 버전은 `pnpm sync-versions`로 맞춘다. — 강제: `check-versions`(Phase 2에서 구현)
- **VER-002** [MUST] 캡 버전은 Rust 레지스트리 상수가 원천이다. — 강제: `check-gen`(Phase 2에서 구현)
- **VER-003** [MUST] 앱 버전과 캡 버전은 독립이다. 앱 패치 릴리스는 캡 버전을 바꾸지 않는다. — 강제: [manual]
- **VER-004** [MUST] 모듈 semver: 사용자에게 보이는 변경은 bump한다. `requires`를 올리면 최소 minor bump를 하고 CHANGELOG에 "필요 앱 버전"을 명시한다. — 강제: `check-modules`(Phase 2에서 구현), CI diff(Phase 7에서 구현)
- **VER-005** [MUST] 호환성 판정은 [3절](#3-호환성-해석-알고리즘) 알고리즘(deck-core의 순수 함수)으로만 한다. — 강제: 단위 테스트(Phase 3에서 구현)
- **VER-006** [MUST] SDK는 지원하는 브리지 프로토콜 버전과 자체 semver를 노출한다. — 강제: SDK 테스트(Phase 5에서 구현)
