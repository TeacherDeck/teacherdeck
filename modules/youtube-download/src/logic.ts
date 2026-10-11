// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
/** Early feedback; the host independently revalidates the address. */
export function videoUrl(value: string): string | null {
  const input = value.trim();
  if (input.length > 2048 || /[^\x21-\x7e]/.test(input) || !input.startsWith("https://")) return null;
  const address = input.slice(8),
    slash = address.indexOf("/");
  if (slash < 0) return null;
  const host = address.slice(0, slash).toLowerCase(),
    resource = address.slice(slash + 1).split("#")[0] ?? "";
  const question = resource.indexOf("?"),
    path = question < 0 ? resource : resource.slice(0, question),
    query = question < 0 ? "" : resource.slice(question + 1);
  let id: string;
  if (host === "youtu.be" || host === "www.youtu.be") id = path;
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    if (path === "watch") {
      const ids = query
        .split("&")
        .filter((pair) => pair.startsWith("v="))
        .map((pair) => pair.slice(2));
      if (ids.length !== 1) return null;
      id = ids[0] ?? "";
    } else {
      const parts = path.split("/");
      if (parts.length !== 2 || !["shorts", "embed", "live"].includes(parts[0] ?? "")) return null;
      id = parts[1] ?? "";
    }
  } else return null;
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}
export function terminal(stage: string): boolean {
  return ["complete", "cancelled", "failed"].includes(stage);
}
export function stageLabel(stage: string): string {
  switch (stage) {
    case "preparing-engine":
      return "다운로드 준비 중이에요. 처음에는 실행 환경을 내려받을 수 있어요.";
    case "downloading":
      return "영상·음성을 내려받거나 MP4로 합치고 있어요.";
    case "validating":
      return "완료 파일을 확인하고 새 결과 폴더에 저장하고 있어요.";
    case "complete":
      return "새 MP4 파일을 저장했어요.";
    case "cancelled":
      return "취소했어요. 이미 저장된 파일은 유지해요.";
    case "failed":
      return "완료하지 못했어요. 주소와 저장 폴더를 확인하고 다시 시도해 주세요.";
    default:
      return "다운로드 상태를 확인하고 있어요.";
  }
}
export function byteLabel(value: number): string {
  return `${(Math.max(0, value) / (1024 * 1024)).toFixed(1)} MiB`;
}
export function progress(downloaded: number, total: number | undefined): number | undefined {
  return total && total > 0 ? Math.min(100, Math.max(0, (downloaded / total) * 100)) : undefined;
}
// Match both fields exactly: host messages outside this fixed vocabulary can contain
// provider/process details and must never be displayed verbatim.
const safeHostMessages: Readonly<Record<string, readonly string[]>> = {
  CAPABILITY_UNAVAILABLE: [
    "이 영상은 YouTube가 로그인이나 접근 확인을 요구하고 있어요. 로그인·쿠키 연동은 지원하지 않으니 다른 공개 영상을 선택해 주세요.",
    "인터넷 보안 인증서를 확인하지 못했어요. PC 날짜와 학교망 연결 상태를 확인해 주세요.",
    "YouTube에 연결하지 못했어요. 인터넷 연결이나 학교망 차단 여부를 확인해 주세요.",
    "영상을 받지 못했어요. 공개 영상인지와 인터넷 연결을 확인해 주세요. 지원하는 MP4 형식이 없는 영상은 받을 수 없어요.",
  ],
  INVALID_ARGS: ["영상 크기가 512MiB를 넘어요. 더 작은 영상을 선택해 주세요."],
};
export function errorLabel(code: string | undefined, message?: string): string {
  if (code && message && safeHostMessages[code]?.includes(message)) return message;
  switch (code) {
    case "BUSY":
      return "다른 다운로드가 진행 중이에요. 완료하거나 취소한 뒤 다시 시도해 주세요.";
    case "PERMISSION_DENIED":
    case "NOT_FOUND":
    case "INVALID_HANDLE":
      return "저장 폴더 권한을 확인하거나 폴더를 다시 선택해 주세요.";
    case "TIMEOUT":
      return "준비와 다운로드가 30분을 넘었어요. 연결을 확인하고 다시 시도해 주세요.";
    case "INVALID_ARGS":
      return "공개 YouTube 영상 한 개의 https 주소를 넣어 주세요.";
    default:
      return "완료하지 못했어요. 주소·연결·저장 공간을 확인하고 다시 시도해 주세요.";
  }
}
