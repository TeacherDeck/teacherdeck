// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError, type OfficeConvertArgs, type FileHandleInfo } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
afterEach(cleanup);
const file = (handle: string, name: string): FileHandleInfo => ({
  handle,
  name,
  ext: name.split(".").at(-1) ?? "",
  size: 64,
  modifiedAt: 0,
});
async function setup(convert: (args: OfficeConvertArgs) => unknown, cancel = () => ({ requested: false })) {
  const host = createMockHost({
    module: { id: "office-convert", version: "0.1.0" },
    granted: ["fs", "office"],
    handlers: {
      "office.availability": () => ({
        providers: ["hancom", "excel", "powerpoint", "word"].map((provider) => ({
          provider,
          ready: true,
          registered: true,
        })),
      }),
      "office.convert": (args) => convert(args as OfficeConvertArgs),
      "office.cancel": cancel,
      "fs.pickFolder": () => ({ handle: "parent", name: "합성 폴더" }),
      "fs.createOutputFolder": () => ({ batchId: "batch", folder: { handle: "output", name: "변환한 문서" } }),
      "fs.closeOutputFolder": () => null,
      "fs.reveal": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() => expect(screen.getByText(/한글 변환 확인됨/)).toBeTruthy());
  return { host, deck };
}
const result = (args: OfficeConvertArgs) => ({
  file: file(`result-${args.sourceHandle}`, args.suggestedName),
  provider: "excel",
  targetFormat: args.targetFormat,
  validation: { packageValid: true, reopened: true, originalUnchanged: true },
  warnings: ["review_layout"],
});
describe("installed Office SDK workflow", () => {
  it("explains bounded Hancom access and the cleaned job after timeout", async () => {
    let rejectPending: ((reason: DeckCallError) => void) | undefined;
    const { host, deck } = await setup(
      () =>
        new Promise((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    host.emit("fs.dropped", { files: [file("hancom", "합성.hwp")] });
    await waitFor(() => expect(screen.getByText("1개 문서")).toBeTruthy());
    expect(screen.queryByText(/파일 접근은 작업용 사본과 새 결과로 제한/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "출력 폴더 선택하고 변환" }));
    const approval = await screen.findByText(/파일 접근은 작업용 사본과 새 결과로 제한/);
    expect(approval.textContent).toContain("안전하게 연결하지 못하면 변환을 중지");
    expect(screen.getByText("변환 중")).toBeTruthy();
    rejectPending?.(
      new DeckCallError(
        "TIMEOUT",
        "응답 시간이 지나 한글 변환을 중지하고 작업 창을 정리했어요. 한글에서 직접 변환해 주세요.",
      ),
    );
    await screen.findByText(/한글 변환을 중지하고 작업 창을 정리/);
    await screen.findByText("변환하지 못한 문서가 있어요. 항목별 안내를 확인하고 실패한 문서만 다시 변환해 주세요.");
    expect(screen.queryByText(/파일 접근은 작업용 사본과 새 결과로 제한/)).toBeNull();
    expect(screen.queryByText("변환했어요")).toBeNull();
    expect((screen.getByRole("button", { name: "실패한 문서 다시 변환" }) as HTMLButtonElement).disabled).toBe(false);
    deck.dispose();
  });
  it("retains successful results and retries only failed files in a macro-preserving format", async () => {
    const { host, deck } = await setup((args) => {
      if (args.sourceHandle === "macro" && args.targetFormat === "xlsx")
        throw new DeckCallError("INVALID_ARGS", "synthetic macro");
      return result(args);
    });
    host.emit("fs.dropped", { files: [file("plain", "샘플.xls"), file("macro", "샘플.xlsx")] });
    await waitFor(() => expect(screen.getByText("2개 문서")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "출력 폴더 선택하고 변환" }));
    await waitFor(() => expect(screen.getByText("다시 확인")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "매크로 보존 형식으로 변환" }));
    expect(screen.getByText("변환했어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실패한 문서 다시 변환" }));
    await waitFor(() => expect(screen.getAllByText("변환했어요")).toHaveLength(2));
    const calls = host.requests.filter((r) => r.method === "convert").map((r) => r.args as OfficeConvertArgs);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual({
      sourceHandle: "macro",
      batchId: "batch",
      targetFormat: "xlsm",
      suggestedName: "샘플 (2).xlsm",
    });
    expect(host.requests.filter((r) => r.method === "closeOutputFolder")).toHaveLength(2);
    deck.dispose();
  });
  it("cancels the host worker, retains earlier files and does not start queued documents", async () => {
    let rejectPending: ((reason: DeckCallError) => void) | undefined;
    const { host, deck } = await setup(
      (args) =>
        args.sourceHandle === "second"
          ? new Promise((_resolve, reject) => {
              rejectPending = reject;
            })
          : result(args),
      () => {
        rejectPending?.(new DeckCallError("CANCELLED", "synthetic cancellation"));
        return { requested: true };
      },
    );
    host.emit("fs.dropped", {
      files: [file("first", "첫 문서.xls"), file("second", "둘째 문서.xls"), file("third", "셋째 문서.xls")],
    });
    await waitFor(() => expect(screen.getByText("3개 문서")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "출력 폴더 선택하고 변환" }));
    await waitFor(() => expect(rejectPending).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "중지" }));
    await waitFor(() => expect(screen.getByText("변환을 중지했어요. 저장한 결과는 유지해요.")).toBeTruthy());
    expect(screen.getByText("변환했어요")).toBeTruthy();
    expect(host.requests.filter((r) => r.method === "convert")).toHaveLength(2);
    expect(host.requests.some((r) => r.method === "cancel" && r.cap === "office")).toBe(true);
    expect(host.requests.some((r) => r.method === "closeOutputFolder")).toBe(true);
    deck.dispose();
  });
});
