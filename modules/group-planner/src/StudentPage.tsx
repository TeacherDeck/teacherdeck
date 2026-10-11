// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Button, Caption, TextBox, deckTokens, makeStyles } from "@deck/ui";
import { useMemo, useState, type ReactNode } from "react";
const useStyles = makeStyles({
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
});
export function StudentPage<T extends { number: number; name: string }>({
  students,
  children,
}: {
  students: T[];
  children: (visible: T[]) => ReactNode;
}) {
  const styles = useStyles(),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const filtered = useMemo(
    () => students.filter((student) => `${student.number} ${student.name}`.includes(query.trim())),
    [students, query],
  );
  const size = students.length > 100 ? 50 : 100;
  const pages = Math.max(1, Math.ceil(filtered.length / size)),
    current = Math.min(page, pages - 1);
  return (
    <>
      {students.length > 100 && (
        <TextBox
          header="학생 찾기"
          description="번호·이름으로 찾거나 50명씩 확인해요."
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
      )}
      {children(filtered.slice(current * size, (current + 1) * size))}
      {students.length > 100 && (
        <div className={styles.row}>
          <Button disabled={current === 0} onClick={() => setPage(current - 1)}>
            이전 학생
          </Button>
          <Caption>
            {current + 1} / {pages}쪽 · 검색 결과 {filtered.length}명
          </Caption>
          <Button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            다음 학생
          </Button>
        </div>
      )}
    </>
  );
}
