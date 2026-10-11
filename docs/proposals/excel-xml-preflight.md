# 제안: Excel 사전 검사의 XML 구조 해석

상태: 승인 대기. GEN-004의 직접 런타임 의존성 추가에 해당한다.

## 배경

Excel 4.0 매크로는 Office의 일반 VBA 비활성화만으로 열기 전 동작을 보장할 수 없다. CFB/BIFF 검사를 COM 문서 열기 앞에 추가했고, OOXML에서도 실제 workbook 관계와 매크로 정의를 먼저 확인해야 한다. 단순 문자열 탐지는 비표준 workbook 경로를 놓칠 수 있고 `AUTO_OPEN`이라는 정상 시트 이름도 잘못 거부한다.

## 제안

`quick-xml = "=0.42.0"`을 workspace와 `crates/deck-core`의 직접 의존성으로 선언한다. Cargo.lock에 이미 있는 MIT 라이브러리이며 기존 Rust 1.98.0으로 빌드 가능한 버전이다(패키지 최소 Rust 1.86). 새 버전이나 추가 feature는 받지 않는다.

순수 Excel 사전 검사에서 스트리밍 XML 파서로 `[Content_Types].xml`, `_rels/.rels`, workbook 관계와 실제 workbook의 definedName을 해석한다. namespace와 속성 문맥을 구별하고 DTD/외부 엔티티는 허용하지 않는다. 기존 ZIP 항목 수·XML 해제 크기·입력 길이 상한을 유지한다. 실제 Office 실행은 구조 검사가 통과한 뒤에만 진행한다. 모듈 브리지·캡 버전·ACL·네트워크 권한은 바꾸지 않는다.

## 대안과 검증

- OOXML 입력을 전부 거부하면 이미 제공한 입력 범위를 잃는다.
- 문자열 검사나 새 수제 XML 파서를 더하는 방식은 우회/거짓 거부와 유지 부담이 크다.
- 기존 잠금·복사된 입력과 승인된 zip 라이브러리를 계속 사용한다. 라이브러리 자신은 네트워크나 파일 쓰기를 하지 않는다.
- 정상 Excel 합성 문서, 실제 main part 변경, namespace/엔티티 표기, DTD 거부, 정상 시트 이름 `AUTO_OPEN`, 매크로 definedName·macrosheet, 손상·크기 초과를 회귀 검사한다. 실행 가능한 매크로는 만들거나 실행하지 않는다.
- 라이선스 고지는 기존 생성기로 갱신하고 `cargo deny`와 `pnpm verify`를 실행한다.

필요한 승인: 위 버전의 quick-xml을 직접 의존성으로 사용하는 범위. 다른 런타임·Office 보안 설정·실제 매크로 실행은 포함하지 않는다.
