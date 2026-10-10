# @deck/sdk

모듈이 TeacherDeck 호스트를 호출하는 유일한 통로예요. React 등 UI 프레임워크에 의존하지 않아요. 먼저 `connect()`로 셸에 연결하고, 매니페스트에 선언한 캡만 호출해 주세요. 기존 fs 1.0의 선택·정보·탐색기 기능은 그대로 사용할 수 있어요.

## fs 1.1 파일 전송

파일 전송을 사용하는 모듈은 `requires.fs: "^1.1.0"`을 선언해 주세요. 선택한 파일은 경로 대신 핸들로 읽고, 출력은 사용자가 선택한 부모 폴더 아래 새 결과 폴더에만 만들어요. 원본과 기존 출력 파일을 덮어쓰거나 삭제하지 않아요.

```ts
const deck = await connect();
const files = await deck.fs.pickFiles();
if (files[0]) {
  for await (const chunk of deck.fs.readChunks({ handle: files[0].handle })) {
    // 청크를 순서대로 처리해요. 전체 파일을 모아 메모리에 올릴 필요는 없어요.
  }
}
const parent = await deck.fs.pickFolder();
if (parent) {
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "변환 결과" });
  try {
    const output = new Blob([new Uint8Array([1, 2, 3])]);
    await deck.fs.writeBlob({ batchId: batch.batchId, suggestedName: "synthetic.bin", blob: output });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
}
```

`readChunks`는 모듈 자신의 origin 아래 인증된 리소스 URL만 읽어요. GET에는 offset과 length를 넣고 한 번에 최대 256KiB를 요청해요. 외부 URL·다른 모듈 URL·리다이렉트는 허용하지 않아요. 응답 길이가 요청과 다르면 중단해요. 정상 종료, 반복문 break, 읽기 오류, 취소 시 closeRead를 호출해요. AbortSignal은 소비자가 yield된 청크를 처리하는 동안에도 읽기 리소스를 닫아요.

`writeBlob`은 Blob.slice로 최대 64KiB씩 읽고 바이트 배열을 인증 브리지의 writeChunk로 보내요. 한 청크의 응답을 받은 뒤 다음 청크를 보내므로 파일 전체 배열과 대기 청크를 만들지 않아요. TIMEOUT 때만 같은 offset·바이트로 직전 청크를 한 번 재시도해요. 빈 파일은 beginWrite와 commitWrite만 호출해요.

두 편의 함수는 두 번째 인자로 `{ signal: AbortSignal }`을 받아요. 호출 전에 취소된 경우 호스트에 요청하지 않아요. openRead나 beginWrite 응답을 기다리는 동안 취소되면 응답으로 받은 id를 명시적으로 정리해요. 브리지 cancel이 실제 파일 작업을 중단했다고 가정하지 않아요. 쓰기 실패·취소는 abortWrite로 정리하고, commitWrite가 시작된 뒤 게시에 성공한 결과는 취소 신호가 오더라도 보존하고 성공으로 반환해요. 정리 실패가 최초 오류를 가리지 않아요.

## 직접 상태 관리

편의 함수 대신 openRead/closeRead, beginWrite/writeChunk/commitWrite/abortWrite를 직접 사용할 수도 있어요. 인자·결과 타입은 Rust에서 생성한 공개 타입이에요. 직접 호출할 때는 반드시 finally에서 리소스를 정리하고, 청크 크기와 순서를 지켜 주세요. 파일당 상한은 512MiB예요. 호스트가 더 제한된 활성 작업·출력 개수·총량·만료 한도를 적용해요.

SDK는 정상 사용의 전송 청크를 제한하지만 악성 모듈이 보내는 모든 IPC/HTTP 요청에 대한 전역 메모리 절대 상한을 보장하지 않아요. 저장·처리 중인 파일 내용과 URL·토큰은 로그에 남기지 마세요.

## 테스트

`@deck/sdk/testing`의 createMockHost로 브리지 계약을 검증해요. 파일 읽기 테스트는 자신의 모듈 origin과 대체 fetch를 제공해 합성 바이트를 반환해요. SDK 테스트 통과는 실제 Windows WebView2의 파일·자산·Worker·커스텀 프로토콜 동작 검증을 대신하지 않아요.
