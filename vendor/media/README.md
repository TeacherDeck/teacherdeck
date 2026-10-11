# 영상 다운로드 고정 실행 엔진

yt-dlp 2026.8.19와 yt-dlp-ejs 0.8.0의 공식 PyPI wheel을 원문 그대로 동봉합니다. wheel의 RECORD 및 `dist-info/licenses/LICENSE`와 JavaScript 내부 저작자·라이선스 고지를 보존합니다. 설치나 사용자 Python package 검색 없이 격리된 관리 Python 3.14.8에서 zipimport합니다. yt-dlp는 Unlicense, ejs는 Unlicense·MIT·ISC입니다.

Deno 2.9.7 Windows x64는 첫 다운로드 때 고정 공식 GitHub ZIP을 받고 SHA256·정확한 단일 `deno.exe` 항목·실행 파일 SHA256을 확인한 뒤 앱 전용 캐시에 새 파일로 게시합니다. 이미 있는 파일을 덮어쓰거나 사용자 PATH에서 실행 엔진을 찾지 않습니다. 라이선스 원문은 [DENO-LICENSE.txt](DENO-LICENSE.txt), 확인한 제3자 고지와 범위는 [DENO-THIRD-PARTY-SOURCES.md](DENO-THIRD-PARTY-SOURCES.md)입니다. Deno 업데이트 확인을 끄며, 로컬에 동봉한 ejs만 사용하고 원격 JS·외부 플러그인·쿠키·로그인을 허용하지 않습니다.

고정 해시는 호스트와 `tools/media/media_worker.py`에 있으며 ZIP 해시 원문은 [deno-2.9.7.sha256sum](deno-2.9.7.sha256sum)입니다. 분리 MP4·M4A는 고정 FFmpeg 9.0.2 실행기로 네트워크 입력 없이 무손실로 합칩니다. 실행 파일 출처·라이선스·고지 원문은 [FFMPEG-SOURCES.md](FFMPEG-SOURCES.md), [FFMPEG-LICENSE.txt](FFMPEG-LICENSE.txt), [FFMPEG-UPSTREAM-README.txt](FFMPEG-UPSTREAM-README.txt)에 보존합니다. Deno와 FFmpeg 고지·출처 문서를 첫 사용 캐시에 새 파일로 함께 준비합니다.
