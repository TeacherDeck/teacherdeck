# ADR-0028: 공개 YouTube 단일 영상의 제한된 다운로드

상태: 보류 (2026-10-11, [#15](https://github.com/TeacherDeck/teacherdeck/issues/15)). 승인·구현했으나 제품 약속의 네트워크 예외, YouTube 약관, 망분리 환경 안내를 결정할 때까지 `youtube-download` 모듈을 기본 번들에서 뺀다(`tools/scripts/lib/modules.ts`의 `HELD_MODULES`). 호스트 `media-download` 구현은 남지만 이 캡을 선언한 기본 모듈이 없다.

사용자의 구체적인 기능 지시와 add-capability 반복 승인 생략 지시를 [제안서](../proposals/local-tools-next.md)에 기록했다. 기존 fs 캡은 네트워크 실행을 제공하지 않고 iframe HTTP나 실행 파일 권한 확대는 불필요하므로, 신뢰 호스트의 `media-download` 1.0으로 분리한다. 기존 캡 major·브리지 메시지 형식·CSP·Tauri ACL은 바꾸지 않는다.

`start({url,folderHandle})`는 `{jobHandle}`을 반환한다. `status({jobHandle})`는 고정 단계, 다운로드 바이트/선택적 전체 바이트, 완료한 `FileHandleInfo` 또는 고정 `DeckError`를 반환한다. `cancel({jobHandle})`은 `{requested}`를 반환한다. 단일 영상 ID 11자를 검증하고 `https://www.youtube.com/watch?v=<ID>`로 정규화하며 재생목록은 처리하지 않는다. 사용자 쿠키·로그인·외부 plugin·임의 extractor·명령·경로·HTTP 옵션은 받지 않는다.

저장은 동일 모듈·현재 generation의 fs.pickFolder 핸들만 사용한다. 새 결과 하위 폴더에 `video.mp4`를 기존 fs append-new 경계로 게시하며 기존 파일을 덮어쓰거나 삭제하지 않는다. 결과는 영상과 음성이 합쳐진 MP4다. 공개 영상의 720p 이하 30fps H.264 MP4와 AAC M4A HTTPS 스트림을 고정 실행기로 받고, FFmpeg 9.0.2 Gyan essentials 고정 빌드로 두 로컬 입력만 무손실 합친다. 입력별 `-protocol_whitelist file,pipe`, 고정 stream map과 `-c copy`, 기존 파일 거부 `-n`을 사용한다. 네트워크 입력·임의 인자·FFmpeg 사용자 플러그인·전역 설치를 허용하지 않는다. 분리 스트림이 없으면 같은 조건의 합본 MP4 다운로드로 돌아간다. 고화질 보장은 이번 범위가 아니다.

호스트는 승인된 관리 Python 3.14.8을 재사용하고, 공식 yt-dlp 2026.8.19 및 yt-dlp-ejs 0.8.0 wheel을 고정 SHA-256으로 검증하여 동봉한다. wheel 원형 및 저작권/라이선스 내용을 보존한다. Deno 2.9.7 및 FFmpeg 9.0.2 Windows x64는 첫 사용 시 고정 공식 HTTPS 배포 ZIP만 전용 캐시에 준비하며 다운로드 크기·SHA-256·정확한 allowlist 실행 파일 entry와 실행 파일 SHA256을 확인한다. Deno ZIP은 정확한 단일 deno.exe만 허용하고 FFmpeg ZIP은 검증한 고정 bin/ffmpeg.exe만 추출한다. 관리 런타임 고지 원문·출처 문서는 캐시에 새 파일로 함께 설치하고 동일 내용의 읽기 잠금을 유지한다. 기존 캐시도 사용 전 같은 해시와 파일/부모 경계를 검증한다. JS challenge 코드는 동봉 ejs만 사용하고 Deno의 네트워크·환경·사용자 파일 권한은 주지 않는다.

허용 네트워크는 사용자가 지정한 공개 영상 조회/다운로드와 고정 Deno·FFmpeg 첫 준비다. 기존 로컬 변환·분석은 계속 PC 안에서 처리한다. 모듈은 HTTP나 subprocess 권한을 얻지 않는다. 도움 실행 환경은 고정 호스트 코드·검증된 패키지만 실행하고 stdout/stderr 원문을 로그·프론트엔드에 전달하지 않는다.

앱 전체 한 작업, 다운로드 입력 합계와 최종 결과 각각 512MiB, 준비 포함 30분 제한을 둔다. 최근 32개 terminal snapshot만 보존하며 오래된 상태를 폐기해도 fs 파일·핸들은 보존한다. 모듈 unload로 취소한 active worker가 실제 종료할 때까지 새 작업을 BUSY로 거부한다. 취소·권한 해제·모듈 generation 변경 시 자체 작업 프로세스와 미완성 staging만 정리한다. 게시와 취소를 직렬화하며 이미 게시한 파일은 취소로 삭제하지 않는다. 크기·실제 MP4 signature·완료 파일 확인과 마지막 권한 재검사 후에만 성공을 반환한다. 정상·다른 소유자·잘못된 URL·위조 결과/진행·취소/시간/크기·캐시 해시·압축 경계의 합성 회귀 및 허가된 공개 영상 한 건의 실제 검증을 완료 근거로 구별한다.
