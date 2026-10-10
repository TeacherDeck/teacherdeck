// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Title, BodyStrong, Body } from "./typography.tsx";
afterEach(cleanup);
it("leaves heading and paragraph spacing to the surrounding desktop layout", () => {
  render(
    <>
      <Title as="h1">도구 제목</Title>
      <BodyStrong as="h2">설정</BodyStrong>
      <Body as="p">설명</Body>
    </>,
  );
  for (const name of ["도구 제목", "설정", "설명"]) expect(getComputedStyle(screen.getByText(name)).margin).toBe("0px");
});
