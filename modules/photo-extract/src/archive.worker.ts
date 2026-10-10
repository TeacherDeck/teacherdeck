// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { unzipLimited } from "./archive.ts";
import { matchPhotos, collectStudents, type Student, type Anchor, type Cell } from "./roster.ts";
type Request =
  | { kind: "unzip"; bytes: Uint8Array }
  | { kind: "match"; sheets: { students: Student[]; anchors: Anchor[]; cells: Cell[]; name: string }[] };
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    if (event.data.kind === "unzip") {
      const parts = unzipLimited(event.data.bytes);
      self.postMessage({ parts }, { transfer: Object.values(parts).map((bytes) => bytes.buffer) });
    } else {
      const warnings: string[] = [];
      const students = event.data.sheets.flatMap((sheet) => {
        const collected = collectStudents(sheet.cells, sheet.name);
        if (collected.duplicates) warnings.push(`${collected.duplicates}개 중복 학생 셀은 첫 기록을 유지해요.`);
        if (collected.missingHeader)
          warnings.push(`${collected.missingHeader}개 번호·이름 셀의 학년·반을 찾지 못했어요.`);
        return matchPhotos(collected.students, sheet.anchors);
      });
      self.postMessage({ students, warnings });
    }
  } catch {
    self.postMessage({ error: "INVALID_ARCHIVE" });
  }
};
