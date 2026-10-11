# 네이티브 문서 변환과 네트워크 루틴

[ADR-0021](../adr/0021-native-workers.md)의 승인된 새 캡 세부 계약이다. 기존 핸들·브리지 envelope·카탈로그 형식을 유지한다. Rust `caps/office.rs`, `caps/network.rs`가 인자와 결과 타입의 원천이다.

## Office 1.0

`availability({})`는 hancom/excel/powerpoint/word 등록 여부를 반환한다. 조회만으로 프로그램을 실행하지 않는다. `convert({sourceHandle,batchId,targetFormat,suggestedName})`는 한 파일을 실제 설치된 제공자의 SaveAs로 변환한다. 형식은 hwpx/xlsx/xlsm/pptx/pptm/docx/docm만 가능하다. 입력은 같은 종류의 hwp/hwpx, xls/xlsx/xlsm, ppt/pptx/pptm, doc/docx/docm이다. 매크로가 존재하면 macro-enabled 형식을 요구하고 Excel XLM 문서는 자동 변환하지 않는다.

변환은 앱 전체에서 한 번에 하나다. 기존 fs의 512MiB 입력 한도와 출력 batch 한도를 따른다. 읽기 전용 원본을 잠금·복사하고 120초 제한 작업자에서 처리한다. 원본 해시·실제 ZIP 필수 구성·제공자 재열기가 성공해야 공개한다. 결과는 새 파일 핸들과 검증 항목, `review_layout` 안내다. 암호·손상·권한 대화상자·취소·시간 초과는 개인정보 없는 일반 오류로 표시한다. HWP 보안 승인 창을 자동으로 누르지 않고 DLL을 설치하지 않는다.

`cancel({})`은 호출한 모듈의 현재 변환만 취소한다. 남의 변환과 사용자가 이미 연 Office 프로세스를 종료하지 않는다. 사용자의 원본·기존 결과를 덮어쓰거나 삭제하지 않는다. 취소 시 이미 공개한 이전 파일은 남긴다.

## Network 1.0

| 메서드 | 계약 |
|---|---|
| adapters | 소유자별 불투명 어댑터 핸들과 표시 정보 |
| inspect | 선택 어댑터 IPv4/DNS/DHCP 상태, 명시적 scanWifi일 때만 Wi-Fi 관측 |
| saveProfile | 어댑터·내부 IPv4 패치·고정 외부 DHCP를 저장, profileHandle/revision 반환 |
| configureRoutine | 일치하는 revision과 7일 규칙을 저장하고 고정 레시피 등록/중단 |
| status | 소유자의 저장 설정·실제 상태·수동 구간·여섯 트리거 상태 복원; 저장 없음이면 null |
| evaluate | 저장한 revision만 판단·적용; 미저장 편집값은 받지 않음 |
| apply | 저장 프로필의 내부/외부 모드를 수동 적용한 뒤 OS 재조회 |
| stopRoutine | 소유 작업만 해제·자동화를 비활성화, 현재 IP 유지 |

`Ipv4Patch`의 address/mask는 함께 지정한다. gateway는 주소를 설정할 때만 쓸 수 있다. DNS는 0~2개이며 내부 모드의 빈 DNS는 변경하지 않는다. 외부 모드는 address와 dns가 모두 dhcp인 고정 레시피다. 정상 IPv4와 연속 마스크만 허용한다.

`NetworkRules`는 decisionMode(schedule/hybrid/wifi-only), 월→일 순서의 정확히 7개 days(enabled/start/end), internalNames/externalNames이다. 각 목록은 최대64개, 각 SSID는 UTF-8 32바이트다. 내외부에 중복 이름을 허용하지 않는다. Python Unicode16 casefold·공백 정규화·연결 SSID 우선·주변 단독 일치·혼합 모드 시간 fallback·Wi-Fi 전용 모호 시 유지·야간/합친 구간·경계 end-exclusive를 원본과 유지한다.

revision이 다르거나 소유 모듈이 제거/권한 해제/호환성 실패이면 실행을 거부한다. 매 실행 저장 상태를 다시 읽는다. 자동화 등록이 실패하면 켜졌다고 표시하지 않는다. 수동 적용 성공 후 현재 판단 segment만 우선하며 다음 segment에서 해제한다. OS 적용 실패를 처리 완료나 수동 우선으로 기록하지 않는다. 프로필·SSID·실제 IP·계정 경로·오류 원문은 로그에 남기지 않는다.

## 검증

원본 network_routine 1.4.0 SHA는 [원본 대조 기록](../reviews/network-routine-parity.md)에 보존한다. TS 모듈과 Rust runner는 같은 합성 180개 판단/경계 사례를 검사한다. 정상·잘못된 인자·다른 소유자의 핸들·revision 불일치·수동 구간·저장 실패·UAC 취소·실행파일/설정 변경·취소/시간 제한을 범위 검사한다. 현재 PC의 실제 네트워크 전환과 실제 외부 메시지 발송은 검증에서 제외한다.
