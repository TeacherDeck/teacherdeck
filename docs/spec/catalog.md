# 카탈로그·패키지·서빙 (catalog)

모듈을 배포하고 설치하고 서빙하는 형식을 정의한다. 이 문서는 자체 규칙 ID를 갖지 않으며 SEC·VER 규칙을 참조한다. 형식 변경은 GEN-005 정지 조건이다.

## 1. 인덱스 (`index.json`)

카탈로그와 기본 모듈(설치본에 동봉된 모듈)은 같은 인덱스 형식을 쓴다.

```json
{
  "format": 1,
  "seq": 1,
  "generatedAt": "2026-01-01T00:00:00Z",
  "modules": {
    "timer": [
      {
        "version": "0.1.0",
        "requires": { "storage": "^1.0", "window": "^1.0" },
        "optional": {},
        "sha256": "…",
        "size": 0,
        "url": "timer/0.1.0/",
        "revoked": false
      }
    ]
  }
}
```

- `format`은 인덱스 형식 버전이다. 현재 `1`이다.
- `seq`는 단조 증가한다. 이미 본 것보다 작은 `seq`의 카탈로그는 거부한다(롤백 공격 방지).
- `requires`·`optional`은 해당 버전 매니페스트의 값과 같아야 한다. 해석기는 패키지를 받기 전에 이 값으로 호환성을 판단한다([versioning.md](versioning.md#3-호환성-해석-알고리즘)).
- `revoked: true`인 버전은 해석 후보에서 제외한다.
- 기본 모듈 인덱스는 `pnpm bundle:modules`가 `apps/desktop/src-tauri/resources/modules/index.json`에 생성한다. 패키지 파일은 `<url><id>-<version>.deckmod`이다.

### 원격 카탈로그 서명 (예정)

원격 카탈로그는 `index.json.sig`(모듈 서명키로 서명)를 함께 배포한다. 모듈 서명키의 공개키는 앱에 내장되어 updater로 배포된다([keys.md](../security/keys.md)). 이번 부트스트랩에서는 형식만 정의하고 구현하지 않는다(SEC-006).

## 2. 패키지 (`.deckmod`)

- zip 형식이다.
- 루트에 `module.json`, entry, 에셋, `SHA256SUMS`를 둔다.
- `SHA256SUMS`는 자기 자신을 제외한 모든 파일의 SHA-256을 담는다. 형식은 `sha256sum` 출력(`<hex>  <상대경로>`)이다.
- 패키지는 최대 20MB, 압축을 푼 합계는 최대 50MB다. 1MB를 넘는 파일의 압축률이 100배를 넘으면 압축 폭탄으로 보고 거부한다([ADR-0009](../adr/0009-core-resolution-and-package-rules.md)).
- 암호화된 엔트리와, 대소문자만 다른 같은 경로(Windows에서 충돌)를 거부한다.
- 절대 경로, `..`, 심볼릭 링크를 담은 엔트리를 거부한다.
- 설치 시 zip-slip·크기·`SHA256SUMS`를 검증한다(SEC-006). 검증기는 deck-core `package.rs`다. 패키지는 `pnpm pack:module`이 deck-core `build_package`로 생성하므로 항상 검증을 통과한다.

## 3. 서빙

- 커스텀 스킴 `deckmod`를 쓴다. Windows에서는 `http://deckmod.localhost/<id>/<version>/<path>` 형태다. origin은 `apps/desktop/src-tauri/src/origins.rs`에 상수로 고정했다([sec-004.md](../security/sec-004.md)에서 실측 확인).
- `_`로 시작하는 최상위 경로는 호스트 리소스용으로 예약한다. 모듈 id는 `_`로 시작할 수 없다(MOD-002 정규식이 보장).
- 경로는 정규화한 뒤 해당 모듈 루트 하위만 서빙한다. `..`, 퍼센트 인코딩 우회, 심볼릭 링크를 거부한다(SEC-005).
- 응답 헤더:

  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
    style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
    connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none';
    form-action 'none'; frame-ancestors <셸 origin>
  X-Content-Type-Options: nosniff
  ```

  `style-src 'unsafe-inline'`은 Fluent UI v9의 Griffel 런타임 스타일 주입 때문에 필요하다. `connect-src 'self'`는 외부 네트워크 요청을 막는다(MOD-008).
- iframe은 다음과 같이 만든다.

  ```html
  <iframe sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe>
  ```

  `allow-same-origin`은 모듈 origin이 셸 origin과 다를 때만 안전하다(SEC-002).
