# 네트워크 루틴 이식 검증

원작의 순수 판단 엔진과 동등성을 확인하는 준비 코드예요. Windows 네트워크 캡은 승인 대기이며, 이 폴더는 앱 카탈로그나 배포 모듈에 포함하지 않아요. 실제 네트워크 설정은 바꾸지 않아요.

- `logic.ts`: 시간표·Wi-Fi·수동 전환 정책
- `logic.test.ts`: 원작 대조와 경계 회귀 검증
- `source-cases.ts`, `unicode-casefold.ts`: 원작의 합성 기대값과 문자 비교 표
- `scripts/source-parity.py`: 원작 파일을 수정하거나 네이티브 함수를 실행하지 않는 재생성 도구

원천·검증 결과는 [대조 보고서](../../../docs/reviews/network-routine-parity.md), 호스트 구현 범위는 [기능 제안서](../../../docs/proposals/native-tools-next.md)를 참고해요. 새 모듈을 구현할 때 이 순수 계약을 옮기고 UI·호스트·권한을 별도로 검증해야 해요.
