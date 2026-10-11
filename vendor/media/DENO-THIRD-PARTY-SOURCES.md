# Deno 2.9.7 공식 고지 출처

TeacherDeck 설치본은 Deno 실행 파일·ZIP을 동봉하지 않는다. 첫 영상 받기 요청에서 고정된 [공식 Windows x64 릴리스 ZIP](https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip)을 사용자의 PC 전용 캐시에 내려받고, ZIP·실행 파일의 크기와 SHA-256을 확인한다. 이 문서는 그 실행 파일과 관련하여 확보한 공식 원문 고지의 출처를 기록한다.

- Deno: [v2.9.7](https://github.com/denoland/deno/releases/tag/v2.9.7), 커밋 `0c071246a412575e07423263404a5d13e7ed6aa2`. 자체 MIT 고지는 `DENO-LICENSE.txt`에 보존한다.
- 제3자 원문: 해당 커밋의 `cli/tsc/dts/node/LICENSE`, `cli/tsc/dts/node/undici/LICENSE`, `ext/webgpu/LICENSE.md`.
- V8 버전: [Deno의 고정 Cargo.lock](https://github.com/denoland/deno/blob/0c071246a412575e07423263404a5d13e7ed6aa2/Cargo.lock)의 `v8 150.4.0`.
- rusty_v8: [v150.4.0](https://github.com/denoland/rusty_v8/tree/v150.4.0), 커밋 `5c15a6995c9bb4bacd3e341b59fff32c909c80bf`. 자체 MIT 고지를 포함한다.
- V8: 위 rusty_v8 태그의 [v8 서브모듈](https://github.com/denoland/rusty_v8/tree/5c15a6995c9bb4bacd3e341b59fff32c909c80bf/v8)이 지정한 [커밋](https://github.com/denoland/v8/tree/ac1e23989121713ca642f6650b34deff7b686896) `ac1e23989121713ca642f6650b34deff7b686896`. 루트 `LICENSE`, `LICENSE.v8`, `LICENSE.fdlibm`, `LICENSE.strongtalk`과 소스 트리 안의 `third_party/**/LICENSE` 원문을 포함한다. 테스트 전용 하위 트리는 제외한다.

`DENO-THIRD-PARTY-NOTICES.txt`는 위 출처에서 확보한 원문 23개를 포함한다. 각 원문 앞에 정확한 공식 URL과 원문 바이트의 SHA-256을 기록했다. 원문 내용과 저자 표기는 변경하지 않았다. V8 소스에 존재한다는 사실만으로 모든 구성 요소가 이 Windows 실행 파일에 포함된다고 판단하지 않는다.

## 확인한 범위와 한계

공식 Windows ZIP에는 `deno.exe` 하나만 있다. v2.9.7의 공식 릴리스 자산 목록과 Deno 소스 트리·공식 `deno_src.tar.gz`에는 통합 제3자 고지 파일이 없다. SHA-256을 확인한 Windows 실행 파일에서 `--license`를 호출하면 지원하지 않는 인수 오류로 종료한다. 이 옵션을 고지 출력 방법으로 안내하지 않는다.

이 모음은 **Windows 실행 파일의 모든 Rust/V8 전이 의존성에 대한 완전한 고지 목록이 아니다**. 별도 서브모듈의 ICU·Abseil 등과 Cargo 전이 의존성 전체를 재구성하지 않았다. 공식 출처에서 확인한 고지 원문만 보존했으며, 고지 완결이나 모든 라이선스 검토 완료를 주장하지 않는다. 새 외부 바이너리를 TeacherDeck 설치본에 재배포하는 것으로 범위를 확대하지 않는다.

공식 ZIP은 42,630,221바이트이며 SHA-256은 `a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238`이다. 내부 실행 파일은 97,462,048바이트이며 SHA-256은 `e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33`이다. 고지는 출처에 접근하지 못하는 PC에서도 읽을 수 있도록 텍스트로 보존한다.
