# ADR-0018: PDF 렌더링 자산과 한정 글꼴 예외

- 상태: 승인됨 (2026-10-11 사용자 명시 승인)
- 관련: [제안서](../proposals/pdf-resource-license.md), GEN-004/005, SEC-011

PDF.js 6.4.299에 포함된 Liberation Sans 1.07.4 네 TTF에 한해 원문의 GPL v2 및 Liberation 글꼴 예외를 인정한다. `tools/checks/pdf-assets.allow.json`은 파일명·버전·SHA-256와 라이선스 원문 해시를 고정한다. 패키지 전체나 다른 GPL 자산을 일반 라이선스 allowlist에 추가하지 않는다.

각 PDF 모듈은 자기 번들에 PDF.js·pdf-lib 및 그 런타임 의존성의 원문 고지, 자산별 고지, 버전·소스·SHA-256 목록을 포함한다. `pnpm gen`이 모듈별 목록을 생성하며 검사기와 빌드 플러그인이 자산 변조·누락을 거부한다. PDF.js의 cmaps/standard_fonts/wasm/iccs 원문 라이선스를 유지한다. 사용하지 않는 quickjs-eval 두 파일은 제외한다.

UI의 시스템 글꼴 정책은 유지한다. 네 글꼴은 PDF 문서 렌더링 전용이다. upstream은 글리프 순서가 PDF.js의 폭·배율 데이터에 연결되므로 임의 글꼴 교체를 피하도록 설명한다. [PDF.js 원천 설명](https://github.com/mozilla/pdf.js/blob/master/external/standard_fonts/README.md)과 설치된 6.4.299 자산을 대조했다. 원천은 [PDF.js v6.4.299](https://github.com/mozilla/pdf.js/tree/v6.4.299/external/standard_fonts) 및 [Liberation Fonts 1.07.4](https://github.com/liberationfonts/liberation-fonts/tree/1.07.4)이다.
