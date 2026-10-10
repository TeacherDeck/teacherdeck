# 변경 기록

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
