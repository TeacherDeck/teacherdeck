# 고급 이미지 편집 코드 반입 기록

Klecks의 고정 소스 `7b1d4744b648de6133b0d45073af4efd2f998148`에서 필요한 세 부분을 선별 계승했다. 전체 Klecks 엔진을 이식한 것은 아니다. 원문은 `klecks/*.original.txt`, 원래 MIT 고지는 `klecks/LICENSE.original`에 보관한다. 실행 코드에도 원래 저자와 MIT 원문을 유지한다.

| 원천 파일                                                     | 실행 코드                       | 적용과 변경                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/script/klecks/image-operations/flood-fill.ts`        | `src/core/klecks-flood-fill.ts` | 연결 영역 및 전체 유사색 선택을 계승. BB bounds 타입을 내부 타입으로 변경하고 입력 크기/좌표 검사, 부분 ArrayBuffer offset, 타입이 확인되는 인덱스 접근을 보완했다.                         |
| `src/app/script/klecks/history/push-helpers/changed-tiles.ts` | `src/core/klecks-tiles.ts`      | 변경 영역에서 256px 이력 타일을 계산하는 방식과 반복문을 계승. BB의 배열 생성·범위 클리핑 의존을 같은 의미의 내부 계산으로 좁혔다.                                                          |
| `src/app/script/klecks/image-operations/render-text.ts`       | `src/core/render.ts`            | 글꼴·굵기·기울임·정렬, 탭 변환, 여러 줄의 폰트 크기×줄 간격 계산과 그리기를 계승. Canvas factory와 편집 가능한 글자 속성으로 연결하고 BB 유틸, stroke text, selection path 의존을 제거했다. |

글자/도형 속성, 독립 마스크, 픽셀/속성 통합 이력, 메모리 사전 검사, 보정 LUT, CPU 원근 변환, 단순 원형 브러시 및 Worker 어댑터는 TeacherDeck의 새 연결 코드다. Klecks PenBrush 전체는 BB·Bezier·복잡 브러시 자산·기존 상태 이력·선택 경로를 묶어 가져와야 하므로 반입하지 않았다. 이 최소 구성에서는 polygon-clipping과 transformation-matrix도 사용하지 않는다. 검증되지 않은 Paint.NET 유래 곡선 보간 코드는 반입하지 않았다.

반입한 MIT 코드의 사용 권한과 고지는 계속 보존하며, TeacherDeck에서 수정·연결한 배포 소스는 프로젝트의 GPL-3.0-only 및 추가 조건에 따른다. 원문 파일의 원래 MIT 사용 권한을 제거하지 않는다. 소스 SHA-256은 `adoption-manifest.json`에 기록한다. 원문 고지는 패키지 산출물에도 포함해야 한다.

일반 이미지·PSD·ZIP의 라이브러리 고지는 파일 어댑터의 별도 기록에 포함된다. ag-psd 저장소의 이미지·브러시 샘플 자산은 사용하지 않는다. 모든 시험 이미지는 자체 합성 데이터다.
