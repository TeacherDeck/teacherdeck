// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { FileHandleInfo, OfficeFormat, OfficeProvider } from "@deck/sdk";
export interface ConversionRow {
  file: FileHandleInfo;
  format: OfficeFormat;
  outputName: string;
  state: "pending" | "converting" | "converted" | "failed" | "cancelled";
  result?: FileHandleInfo;
  message?: string;
}
const kinds: Record<string, { format: OfficeFormat; provider: OfficeProvider }> = {
  hwp: { format: "hwpx", provider: "hancom" },
  hwpx: { format: "hwpx", provider: "hancom" },
  xls: { format: "xlsx", provider: "excel" },
  xlsx: { format: "xlsx", provider: "excel" },
  xlsm: { format: "xlsm", provider: "excel" },
  ppt: { format: "pptx", provider: "powerpoint" },
  pptx: { format: "pptx", provider: "powerpoint" },
  pptm: { format: "pptm", provider: "powerpoint" },
  doc: { format: "docx", provider: "word" },
  docx: { format: "docx", provider: "word" },
  docm: { format: "docm", provider: "word" },
};
export function providerFor(file: FileHandleInfo): OfficeProvider | null {
  return kinds[file.ext.toLowerCase()]?.provider ?? null;
}
export function outputFormat(file: FileHandleInfo, preserveMacros: boolean): OfficeFormat | null {
  const basic = kinds[file.ext.toLowerCase()]?.format;
  if (basic === undefined) return null;
  if (!preserveMacros) return basic;
  return basic === "xlsx" ? "xlsm" : basic === "pptx" ? "pptm" : basic === "docx" ? "docm" : basic;
}
export function planConversions(files: FileHandleInfo[], preserveMacros: boolean): ConversionRow[] {
  const seen = new Set<string>(),
    names = new Set<string>();
  return files
    .filter((file) => !seen.has(file.handle) && (seen.add(file.handle), true))
    .flatMap((file) => {
      const format = outputFormat(file, preserveMacros);
      if (format === null) return [];
      const base = file.name.replace(/\.[^.]+$/, "") || "변환 문서";
      let name = `${base}.${format}`,
        index = 2;
      while (names.has(name.toLocaleLowerCase("en-US"))) name = `${base} (${index++}).${format}`;
      names.add(name.toLocaleLowerCase("en-US"));
      return [{ file, format, outputName: name, state: "pending" as const }];
    });
}
export function conversionError(code: string | undefined, safeMessage?: string): string {
  if (code === "CANCELLED") return "변환을 중지했어요. 앞서 저장한 결과는 유지해요.";
  if (
    code === "TIMEOUT" &&
    safeMessage === "응답 시간이 지나 한글 변환을 중지하고 작업 창을 정리했어요. 한글에서 직접 변환해 주세요."
  )
    return `${safeMessage} 앞서 저장한 결과는 유지해요.`;
  if (code === "TIMEOUT")
    return "응답 시간이 지나 변환을 중지했어요. 다시 시도할 때 한글·Office 창의 문서 접근 승인을 확인해 주세요. 앞서 저장한 결과는 유지해요.";
  if (code === "PERMISSION_DENIED") return "문서 접근 승인을 확인하거나 파일을 다시 선택해 주세요.";
  if (code === "INVALID_ARGS") return "매크로 보존 형식과 문서 종류를 확인해 주세요.";
  if (code === "CAPABILITY_UNAVAILABLE") {
    if (safeMessage === "한글의 작업용 파일 접근을 안전하게 연결하지 못했어요. 한글에서 직접 변환해 주세요.")
      return `${safeMessage} 원본과 앞서 저장한 결과는 유지해요.`;
    return "이 문서를 여는 한글·Office가 설치되어 있는지 확인해 주세요.";
  }
  if (code === "BUSY") {
    // Only fixed host advice is reflected. Arbitrary exception text stays private.
    if (
      safeMessage === "열려 있는 PowerPoint를 닫은 뒤 다시 변환해 주세요." ||
      safeMessage === "사용 중인 PowerPoint를 바꾸지 않았어요. 직접 변환하거나 프로그램을 닫은 뒤 다시 시도해 주세요."
    )
      return safeMessage;
    return "다른 문서 변환이 끝난 뒤 다시 변환해 주세요.";
  }
  return "변환하지 못했어요. 암호·손상 여부를 확인하고 다시 시도해 주세요.";
}
/** Update failed/pending choices without discarding successfully published results. */
export function replanRows(rows: ConversionRow[], plans: ConversionRow[]): ConversionRow[] {
  return rows.map((row) => {
    if (row.state === "converted") return row;
    const plan = plans.find((item) => item.file.handle === row.file.handle);
    return plan ? { ...plan, state: row.state, ...(row.message ? { message: row.message } : {}) } : row;
  });
}
