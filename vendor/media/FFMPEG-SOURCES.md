# 영상·음성 합치기용 FFmpeg 고정 출처

선정한 실행 환경은 **Gyan FFmpeg 9.0.2 essentials Windows x64 정적 빌드**다. [FFmpeg 공식 다운로드 페이지](https://ffmpeg.org/download.html)는 Windows 실행 파일 공급자로 [Gyan](https://www.gyan.dev/ffmpeg/builds/)을 연결한다. FFmpeg 프로젝트 자체가 Windows 실행 파일을 배포하는 것으로 안내하지 않는다.

TeacherDeck 설치본에 실행 파일이나 ZIP을 동봉하지 않는다. 첫 영상 받기 작업에서 아래 고정 공급자 URL을 사용해 PC 전용 캐시에 준비한다. Python 표준 `zipfile`로 읽을 수 있는 ZIP이므로 7-Zip·별도 해제 의존성이 필요하지 않다.

| 항목              | 고정값                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 공급자 릴리스     | [Gyan 9.0.2](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)                                                                    |
| ZIP URL           | `https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip`                                         |
| ZIP 크기          | 114,768,076바이트                                                                                                                        |
| ZIP SHA-256       | `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`                                                                       |
| 사용할 단일 entry | `ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe`                                                                                           |
| 실행 파일 크기    | 105,423,872바이트                                                                                                                        |
| 실행 파일 SHA-256 | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`                                                                       |
| FFmpeg 원천       | [커밋 946fcce07b6dcd0331c8cc609192aeff5e1924f8](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b6dcd0331c8cc609192aeff5e1924f8), 9.0.2 |

ZIP 해시는 [공급자가 공개한 고정 SHA-256](https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip.sha256) 및 GitHub 릴리스 API의 asset digest와 실제 다운로드를 대조했다. 실행 파일 해시는 검증된 ZIP의 정확한 entry에서 계산했다. ZIP 전체를 작업 폴더에 풀지 않으며, `ffplay.exe`, `ffprobe.exe`, presets·doc은 실행 환경으로 추출하지 않는다. 네이티브 구현 담당자와 `ffprobe` 없이 고정 영상·음성 두 파일을 합치는 계약으로 확인했다.

## 라이선스·원문 고지

공급자는 모든 일반 빌드를 GPLv3 정적 빌드로 안내한다. 검증한 `ffmpeg.exe -version`은 `--enable-gpl --enable-version3 --enable-static`을 포함하고 `--enable-nonfree`는 포함하지 않는다. 실제 실행 파일의 출력은 `FFMPEG-BUILD-CONFIG.txt`에 보존했다. GPLv3 프로젝트와 사용할 수 있는 독립 실행 환경으로 선정했으며 외부 라이브러리 전체에 대한 별도 법률 검토 완료를 주장하지 않는다.

ZIP에서 다음 원문을 바이트 그대로 보존했다.

- `FFMPEG-LICENSE.txt`: ZIP 루트 `LICENSE`, GPLv3 원문, 35,147바이트, SHA-256 `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`.
- `FFMPEG-UPSTREAM-README.txt`: ZIP 루트 `README.txt`, 41,577바이트, SHA-256 `0342de6bb39dd421cbec2c00d89ad274b640d75ad3f2cab09ffd647ce2d8f949`. 저작자·공급자·원천 코드 링크·구성·외부 라이브러리별 버전 목록을 포함한다.
- `FFMPEG-9.0.2.sha256`: 공개 ZIP 해시와 검증한 실행 파일 해시.

이 문서는 제공된 GPL 원문과 빌드 원문·원천 링크를 보존한다. 공급자가 포함한 모든 정적 외부 라이브러리의 대응 소스·고지를 재구성한 자료는 아니다. 해당 실행 파일을 향후 TeacherDeck 설치본에 직접 재배포한다면 그 범위의 라이선스·대응 소스 의무를 별도로 확인해야 한다.

공급자는 Windows 10 이상을 지원 대상으로 안내한다. Python stdlib ZIP 인식, 크기·해시, 실행 파일의 버전 조회는 확인했으며 네이티브 취소·고정 입력·네트워크 금지·합치기 결과 검증은 호스트 구현 담당자가 별도로 확인한다. 이 출처 확인을 실제 영상 합치기 성공으로 세지 않는다.
