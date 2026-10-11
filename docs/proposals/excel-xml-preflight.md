# 제안: Excel 사전 검사의 XML 구조 해석

상태: 2026-10-11 사용자의 “승인한다. 계속 작업해”로 승인받아 구현했다. GEN-004의 직접 런타임 의존성 추가에 해당하며 통합 검증은 진행 중이다.

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

승인 범위: 위 버전의 quick-xml을 직접 의존성으로 사용하는 범위. 다른 런타임·Office 보안 설정·실제 매크로 실행은 포함하지 않는다.

## 구현과 확인 범위

`office_excel_xml.rs`가 UTF-8 XML을 스트리밍으로 읽는다. 패키지 루트의 officeDocument 관계가 선택한 실제 workbook을 검사하며, 같은 경로의 content type과 관계 파일도 확인한다. 추가로 선언된 다른 workbook과 모든 `.rels`도 검사해 기본 경로의 미끼 문서를 신뢰하지 않는다. namespace·속성 참조는 라이브러리로 정규화하고, 자동 실행 이름과 XLM 함수 표식은 SpreadsheetML의 definedName 문맥에서 판단한다. 정상 `AUTO_OPEN` 시트 이름·일반 수식 본문·주석은 자동 실행 이름으로 취급하지 않는다.

DTD·정의되지 않은 엔티티·중복 속성·손상된 XML·중복 main 관계·외부 main target·패키지 밖 경로는 거부한다. XML 깊이는 64, 검사 메타데이터는 파일별 1MiB·합계 8MiB, ZIP은 20,000개 항목, 입력은 512MiB 한도를 유지한다. 기존 CFB/BIFF 검사도 유지한다. worksheet 본문 전체의 XML 스키마 검증이나 Office의 모든 매크로·취약점 차단을 보증하지 않으며, 실제 실행 가능한 매크로를 생성하거나 실행하지 않았다.

합성 회귀는 실제 main part 변경과 정상 미끼 workbook, namespace/엔티티 표기, 자동 실행 정의·함수 표식, 정상 이름, 손상·DTD·외부 target·크기 상한을 포함한다. 전체 Cargo·라이선스·앱 검증과 실제 Excel 합성 재검수 결과는 통합 담당자의 최종 기록에 반영한다.
