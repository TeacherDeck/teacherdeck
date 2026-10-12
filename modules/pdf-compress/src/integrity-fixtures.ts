// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

/** Synthetic PDF with an independently written xref table and stream length. */
export function contentFixture(
  text: string,
  lengthEntry: "direct" | "indirect" | "missing" | "unresolved" | "wrong-type" = "direct",
  payloadEnding = "",
  lengthAdjustment = 0,
  streamSeparator = "\n",
): { bytes: Uint8Array; content: Uint8Array } {
  const encode = (value: string) => new TextEncoder().encode(value);
  const content = encode(
    `BT /F1 20 Tf 40 760 Td (${text}) Tj ET\nBT /F1 20 Tf 40 720 Td (TAIL TEXT MUST SURVIVE) Tj ET${payloadEnding}`,
  );
  const declared = content.length + lengthAdjustment;
  const length = {
    direct: `/Length ${declared}`,
    indirect: "/Length 6 0 R",
    missing: "",
    unresolved: "/Length 99 0 R",
    "wrong-type": "/Length (invalid)",
  }[lengthEntry];
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< ${length} >>\nstream\n${new TextDecoder().decode(content)}${streamSeparator}endstream`,
    String(declared),
  ];
  let pdf = `%PDF-1.4\n${"% synthetic padding\n".repeat(300)}`;
  const offsets = [0];
  for (const [index, body] of bodies.entries()) {
    offsets.push(encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = encode(pdf).length;
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: encode(pdf), content };
}

// Generated solid-color 2x2 baseline JPEG, with no EXIF, ICC or Adobe metadata.
export function jpegFixture(): { original: Uint8Array; replacement: Uint8Array } {
  const encoded =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbgCRab//Z";
  const replacement = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  // A legal JPEG comment gives the reencoder removable bytes without fake data.
  const comment = new TextEncoder().encode("SYNTHETIC COMMENT ".repeat(30));
  const original = new Uint8Array(replacement.length + comment.length + 4);
  original.set(replacement.subarray(0, 2));
  original.set([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff], 2);
  original.set(comment, 6);
  original.set(replacement.subarray(2), 6 + comment.length);
  return { original, replacement };
}
