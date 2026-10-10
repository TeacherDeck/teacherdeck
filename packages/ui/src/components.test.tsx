// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ui from "./index.ts";

afterEach(cleanup);

const wrap = (node: ReactNode) => render(<ui.DeckProvider mica={false}>{node}</ui.DeckProvider>);

/** Function components and forwardRef/memo objects (Fluent re-exports) both count. */
const isComponent = (v: unknown) => typeof v === "function" || (typeof v === "object" && v !== null && "$$typeof" in v);

describe("@deck/ui", () => {
  it("lists every exported component in COMPONENTS (gallery registration)", () => {
    const exported = Object.entries(ui)
      .filter(([name, v]) => /^[A-Z]/.test(name) && isComponent(v))
      .map(([name]) => name)
      .sort();
    expect([...ui.COMPONENTS].sort()).toEqual(exported);
  });

  it("CapabilityGate shows the update notice when the cap is missing (MOD-007)", () => {
    wrap(
      <ui.CapabilityGate deck={{ has: () => false }} cap="ocr" feature="글자 인식">
        <span>기능</span>
      </ui.CapabilityGate>,
    );
    expect(screen.getByText(/앱 업데이트 후 사용 가능/)).toBeTruthy();
    expect(screen.queryByText("기능")).toBeNull();
  });

  it("ToolLayout renders sections in the given order (UI-008)", () => {
    const { container } = wrap(
      <ui.ToolLayout title="도구">
        <ui.ToolLayout.Section step="input" title="입력">
          a
        </ui.ToolLayout.Section>
        <ui.ToolLayout.Section step="result" title="결과">
          b
        </ui.ToolLayout.Section>
      </ui.ToolLayout>,
    );
    const steps = [...container.querySelectorAll("section")].map((el) => el.getAttribute("data-step"));
    expect(steps).toEqual(["input", "result"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("도구");
  });

  it("SettingsExpander toggles from the header and the chevron, and flattens its rows", () => {
    wrap(
      <ui.SettingsExpander header="고급">
        <ui.SettingsCard header="하위" />
      </ui.SettingsExpander>,
    );
    const chevron = screen.getByRole("button", { name: "고급" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByText("고급"));
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "고급" }).textContent).toContain("하위");
    fireEvent.click(chevron);
    expect(screen.queryByRole("group", { name: "고급" })).toBeNull();
  });

  it("clickable SettingsCard is one button", () => {
    const onClick = vi.fn();
    wrap(<ui.SettingsCard header="정보" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /정보/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ContentDialog reports which button closed it", () => {
    const onClose = vi.fn();
    wrap(
      <ui.ContentDialog open title="덮어쓸까요?" primaryButtonText="덮어쓰기" closeButtonText="취소" onClose={onClose}>
        원본이 바뀌어요.
      </ui.ContentDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "덮어쓰기" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose.mock.calls).toEqual([["primary"], ["none"]]);
  });

  it("controls take their accessible name from header even when it is hidden", () => {
    wrap(
      <>
        <ui.NumberBox header="분" showHeader={false} value={5} onChange={() => undefined} />
        <ui.TextBox header="이름 규칙" value="" onChange={() => undefined} />
        <ui.ToggleSwitch header="항상 위" showHeader={false} checked onChange={() => undefined} />
      </>,
    );
    expect(screen.getByRole("spinbutton", { name: "분" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "이름 규칙" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "항상 위" })).toBeTruthy();
    expect(screen.getByText("켬")).toBeTruthy();
  });

  it("InfoBar shows its message and close button", () => {
    const onClose = vi.fn();
    wrap(<ui.InfoBar severity="error" message="파일을 열지 못했어요." onClose={onClose} />);
    expect(screen.getByText("파일을 열지 못했어요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "TextBox keeps focus, selection and IME events on the actual input (multiline=%s)",
    (multiline) => {
      const inputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
      const events: string[] = [];
      const onChange = vi.fn();
      wrap(
        <ui.TextBox
          header="회의 입력"
          value="합성 문장"
          multiline={multiline}
          inputRef={inputRef}
          onChange={onChange}
          onCompositionStart={() => events.push("start")}
          onCompositionEnd={(event) => events.push(`end:${event.data}`)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) events.push("composing");
            else if (event.key === "Enter") {
              event.preventDefault();
              events.push("submit");
            }
          }}
        />,
      );
      const input = screen.getByRole("textbox", { name: "회의 입력" });
      expect(inputRef.current).toBe(input);
      inputRef.current?.focus();
      inputRef.current?.select();
      expect(document.activeElement).toBe(input);
      expect(inputRef.current?.selectionStart).toBe(0);
      expect(inputRef.current?.selectionEnd).toBe(5);
      fireEvent.compositionStart(input);
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
      fireEvent.compositionEnd(input, { data: "장" });
      expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
      fireEvent.change(input, { target: { value: "합성 문장 추가" } });
      expect(events).toEqual(["start", "composing", "end:장", "submit"]);
      expect(onChange).toHaveBeenLastCalledWith("합성 문장 추가");
    },
  );

  it("TextBox read-only output stays selectable and focusable", () => {
    const inputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
    wrap(
      <ui.TextBox
        header="공개용 결과"
        multiline
        readOnly
        inputRef={inputRef}
        value="선택할 결과"
        onChange={() => undefined}
      />,
    );
    expect(inputRef.current?.readOnly).toBe(true);
    expect(inputRef.current?.disabled).toBe(false);
    inputRef.current?.focus();
    expect(document.activeElement).toBe(inputRef.current);
  });

  it("ListView shows the empty text when there are no items", () => {
    wrap(
      <ui.ListView header="파일" items={[]} getKey={String} renderItem={String} emptyText="파일을 추가해 주세요." />,
    );
    expect(screen.getByRole("list", { name: "파일" }).textContent).toBe("파일을 추가해 주세요.");
  });

  it("round-trips the theme payload including WinUI extras", () => {
    const payload = ui.themeToPayload("dark", true);
    const theme = ui.payloadToTheme(payload);
    expect(theme.colorNeutralBackground1).toBe(ui.createDeckTheme("dark").colorNeutralBackground1);
    expect(theme.fontFamilyBase).toBe(ui.FONT_STACK);
    expect(theme.deckCardFill).toBe(ui.createDeckTheme("dark").deckCardFill);
    expect(ui.FONT_STACK).not.toMatch(/Pretendard/);
  });
});
