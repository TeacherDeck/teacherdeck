# 변경 기록

## 0.8.0

- window 1.2의 편집 문서 등록·미저장/저장 중 상태·셸 저장 요청과 결과 API를 추가했어요. 이전 호스트에서는 변경 전에 필요한 버전을 안내해요.

## 0.7.0

- media-download 1.0의 공개 YouTube 영상 다운로드 시작·진행 조회·취소 API를 추가했어요. 결과는 선택한 폴더의 새 MP4 파일 핸들로 받아요.

## 0.6.0

- window 1.1의 모니터 선택·학생 화면 열기·갱신·닫기와 소유 모듈 전용 종료·연결 변경 이벤트를 추가했어요.
- 이전 호스트에서는 기존 화면 기능을 유지하며 학생 화면 호출에 필요한 버전을 안내해요.

## 0.5.0

- fs 1.3의 폴더 목록과 file-ops 1.0의 확인된 이름 변경·보호된 되돌리기 API를 추가했어요.
- school-data 1.0의 선택한 학급·허용한 항목 읽기와 사진 리소스 API를 추가했어요.
- office·network 1.0의 설치 Office 변환과 네트워크 루틴 API를 추가했어요. 기존 deck=1 브리지와 API를 유지해요.

## 0.4.1

- 캡처 전용 셸의 내부 배치 상태 타입을 보완했어요. 모듈 캡처 좌표와 캡·브리지 계약은 유지해요.

## 0.4.0

- capture·overlay·global-shortcut의 typed API와 소유자 이벤트, fs 1.2의 기억한 저장 폴더 권한 API를 추가했어요. 기존 API와 deck=1 브리지는 유지해요.

## 0.3.0

- 출력 전용 clipboard 1.0의 typed writeText/writeRichText와 구조화 문서 타입을 추가했어요. 기존 API와 브리지 deck=1은 유지해요.

## 0.2.0

- fs 1.1의 핸들 기반 파일 읽기와 새 결과 폴더의 순차 쓰기 API를 추가했어요.
- readChunks는 자체 모듈 origin에서 제한된 청크를 읽고 종료·취소 시 리소스를 정리해요.
- writeBlob은 64KiB 이하 청크를 순서대로 전송하고 명시적으로 취소·게시해요.
- 기존 fs 1.0 API와 브리지 deck=1 계약을 유지해요.
- 고정 MODULE_ORIGIN은 이전 probe 호환용으로 유지하며 파일 읽기는 실제 모듈의 origin을 사용해요.

## 0.1.0

- 셸 핸드셰이크, 캡 권한 검사, typed fs/storage/system/window API와 mock host를 제공해요.
