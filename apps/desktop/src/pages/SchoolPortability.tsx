// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useRef, useState } from "react";
import { Field, Input } from "@fluentui/react-components";
import {
  Body,
  Button,
  Caption,
  ComboBox,
  ContentDialog,
  InfoBar,
  SettingsExpander,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import type { SchoolDataDocument } from "@deck/sdk";
import type { TimeAlertPreview } from "../generated/TimeAlertPreview.ts";
import type { TimeAlertRosterPhotosPreview } from "../generated/TimeAlertRosterPhotosPreview.ts";
import type { SchoolDataHost } from "./school-data-model.ts";
import { rosterPhotoRows, rosterPhotoDocument, type RosterPhotoRow } from "./school-roster-photos.ts";
const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
  },
  photo: { maxWidth: "100%", objectFit: "contain", borderRadius: deckTokens.cardRadius },
});
/** Five main-only commands keep backup databases and full-size photos inside the host. */
export function SchoolPortability({
  host,
  document,
  semesterId,
  busy,
  onBusy,
  onSaved,
}: {
  host: Pick<
    SchoolDataHost,
    "openTimeAlert" | "applyTimeAlert" | "exportTimeAlert" | "closeTimeAlert" | "importRosterPhotos"
  >;
  document: SchoolDataDocument;
  semesterId: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onSaved: (document: SchoolDataDocument) => void;
}) {
  const s = useStyles();
  const [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [passwordMode, setPasswordMode] = useState<"open" | "export" | null>(null),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const lastPasswordMode = useRef<"open" | "export">("open");
  if (passwordMode) lastPasswordMode.current = passwordMode;
  const shownPasswordMode = passwordMode ?? lastPasswordMode.current;
  const [preview, setPreview] = useState<TimeAlertPreview | null>(null),
    [previewOpen, setPreviewOpen] = useState(false),
    [applied, setApplied] = useState(false),
    [links, setLinks] = useState<Record<string, string>>({});
  const [rosterPreview, setRosterPreview] = useState<TimeAlertRosterPhotosPreview | null>(null),
    [rosterOpen, setRosterOpen] = useState(false),
    [rosterRows, setRosterRows] = useState<RosterPhotoRow[]>([]),
    [warnings, setWarnings] = useState<string[]>([]);
  const [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const session = useRef<string | null>(null),
    rosterSession = useRef<string | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
      for (const handle of [session.current, rosterSession.current])
        if (handle) void hostRef.current.closeTimeAlert({ sessionHandle: handle }).catch(() => {});
    };
  }, []);
  const run = async (action: (active: () => boolean) => Promise<void>) => {
    const started = generation.current;
    const active = () => generation.current === started;
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await action(active);
    } catch {
      if (active()) setError("백업 형식·암호·최신 자료를 확인해 주세요. 원본과 저장 자료는 유지돼요.");
    } finally {
      if (active()) onBusy(false);
    }
  };
  const closeBackup = () =>
    run(async (active) => {
      if (!preview) return;
      await host.closeTimeAlert({ sessionHandle: preview.sessionHandle });
      if (!active()) return;
      session.current = null;
      setPreview(null);
      setPreviewOpen(false);
      setApplied(false);
      setLinks({});
    });
  const closeRoster = () =>
    run(async (active) => {
      if (!rosterPreview) return;
      await host.closeTimeAlert({ sessionHandle: rosterPreview.sessionHandle });
      if (!active()) return;
      rosterSession.current = null;
      setRosterOpen(false);
      setRosterPreview(null);
    });
  const passwordValid =
    new TextEncoder().encode(password).length > 0 &&
    new TextEncoder().encode(password).length <= 1024 &&
    (passwordMode !== "export" || password === confirmPassword);
  const existingOptions = (name: string, selected: string) => [
    { value: "", label: "새 학생으로 등록" },
    ...document.students
      .filter(
        (student) =>
          student.id === selected ||
          (search
            ? student.name.includes(search) ||
              document.enrollments.some(
                (e) => e.studentId === student.id && `${e.grade}-${e.classNumber}-${e.studentNumber}`.includes(search),
              )
            : student.name === name),
      )
      .sort((a, b) => Number(b.id === selected) - Number(a.id === selected))
      .slice(0, 50)
      .map((student) => ({
        value: student.id,
        label: `${student.name} · ${
          document.enrollments
            .filter((e) => e.studentId === student.id)
            .map((e) => `${e.grade}-${e.classNumber}-${e.studentNumber}`)
            .join(" / ") || "학적 없음"
        }`,
      })),
  ];
  const visibleRows = rosterRows.slice(page * 20, (page + 1) * 20),
    visibleStudents = preview?.document.students.slice(page * 20, (page + 1) * 20) ?? [];
  const selectedPhoto = (key: string) => rosterPreview?.photoKeys.find((photo) => photo.photoKey === key);
  return (
    <SettingsExpander
      header="사진 포함 이동·TimeAlert 백업"
      description="사진과 원작 기록까지 새 PC로 옮겨요. JSON 복구와 별도 기능이에요."
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      <div className={s.stack}>
        <Body>
          저장한 학교 자료와 사진을 암호가 있는 새 백업 파일로 만들어요. TimeAlert DB7 백업의 비공개 기록은 원형으로
          보존하고 공통 화면에는 명부·시간표만 가져와요. 미저장 수정은 백업에 포함하지 않아요.
        </Body>
        {error && <InfoBar severity="error" message={error} />}
        {message && <InfoBar severity="success" message={message} />}
        <div className={s.row}>
          <Button
            disabled={busy || !!preview}
            onClick={() => {
              setPassword("");
              setConfirmPassword("");
              setPasswordMode("open");
            }}
          >
            TimeAlert 백업 가져오기
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setPassword("");
              setConfirmPassword("");
              setPasswordMode("export");
            }}
          >
            사진 포함 백업 저장
          </Button>
          <Button
            disabled={
              busy ||
              !semesterId ||
              !!rosterPreview ||
              !!document.semesters.find(
                (semester) => semester.id === semesterId && (semester.readOnly || semester.archived),
              )
            }
            onClick={() =>
              void run(async (active) => {
                const result = await host.importRosterPhotos({
                  sessionHandle: null,
                  semesterId,
                  expectedRevision: document.revision,
                  matches: [],
                  document: null,
                });
                if (!result) return;
                if (!active()) {
                  await host.closeTimeAlert({ sessionHandle: result.sessionHandle });
                  return;
                }
                rosterSession.current = result.sessionHandle;
                setRosterPreview(result);
                try {
                  const parsed = await rosterPhotoRows(result);
                  if (!active()) return;
                  setRosterRows(parsed.rows);
                  setWarnings(parsed.warnings);
                  setPage(0);
                  setSearch("");
                  setRosterOpen(true);
                } catch (error) {
                  await host.closeTimeAlert({ sessionHandle: result.sessionHandle });
                  if (!active()) return;
                  rosterSession.current = null;
                  setRosterPreview(null);
                  throw error;
                }
              })
            }
          >
            사진명렬표 명부·사진 가져오기
          </Button>
          {preview && (
            <Button disabled={busy} onClick={() => void closeBackup()}>
              원작 백업 연결 닫기
            </Button>
          )}
          {preview && !applied && (
            <Button
              disabled={busy}
              onClick={() => {
                setPage(0);
                setPreviewOpen(true);
              }}
            >
              원작 자료 검토 다시 열기
            </Button>
          )}
          {rosterPreview && (
            <Button
              disabled={busy}
              onClick={() => {
                setPage(0);
                setRosterOpen(true);
              }}
            >
              사진 대응 검토 다시 열기
            </Button>
          )}
        </div>
        {preview && (
          <Caption>
            원작 백업 연결 유지 중 · {preview.photoCount}장 ·{" "}
            {applied ? "공통 자료 적용 완료" : "아직 적용하지 않았어요"}. 사진 포함 백업 저장에 원작의 미편집 기록도
            유지돼요.
          </Caption>
        )}
        <Caption>
          현재 지원 형식은 TIMEALERT v1 / DB7이에요. 날짜별 주간표 지정과 원작 연결 자료 삭제는 백업 저장을 지원하지
          않아요. Android 실기 복원은 아직 검증하지 않았어요. 원작 연결을 닫거나 앱을 종료한 뒤에는 다음 백업에 원작의
          비공개 기록이 포함되지 않아요. 독립 사진 추출 도구도 계속 사용할 수 있어요.
        </Caption>
      </div>
      <ContentDialog
        open={passwordMode !== null}
        title={shownPasswordMode === "export" ? "사진 포함 백업에 암호 설정" : "TimeAlert 백업 암호"}
        {...(!busy && passwordValid
          ? { primaryButtonText: passwordMode === "export" ? "새 백업 저장" : "파일 선택·확인" }
          : {})}
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          const mode = passwordMode,
            value = password;
          setPasswordMode(null);
          setPassword("");
          setConfirmPassword("");
          if (result !== "primary") return;
          void run(async (active) => {
            if (mode === "open") {
              const result = await host.openTimeAlert({ password: value });
              if (result) {
                if (!active()) {
                  await host.closeTimeAlert({ sessionHandle: result.sessionHandle });
                  return;
                }
                session.current = result.sessionHandle;
                setPreview(result);
                setPreviewOpen(true);
                setApplied(false);
                setLinks({});
                setPage(0);
                setSearch("");
              }
            } else if (mode === "export") {
              const saved = await host.exportTimeAlert({
                sessionHandle: preview?.sessionHandle ?? null,
                expectedRevision: document.revision,
                password: value,
              });
              if (saved && active()) setMessage("사진을 포함한 새 백업을 저장했어요. 원본 파일은 유지돼요.");
            }
          });
        }}
      >
        <div className={s.stack}>
          <Body>
            {shownPasswordMode === "export"
              ? "암호를 잊으면 복원할 수 없어요. 저장한 자료·사진만 포함하며 미저장 수정은 제외해요."
              : "암호를 확인한 뒤 파일을 검증해요. 미리보기에서 적용을 확인하기 전에는 학교 자료를 바꾸지 않아요."}
          </Body>
          <Field label="백업 암호">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(_, data) => setPassword(data.value)}
            />
          </Field>
          {shownPasswordMode === "export" && (
            <Field label="백업 암호 다시 입력">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(_, data) => setConfirmPassword(data.value)}
              />
            </Field>
          )}
          <Caption>암호는 이 PC에서만 처리하고 백업 세션에 보관하지 않아요.</Caption>
        </div>
      </ContentDialog>
      <ContentDialog
        open={previewOpen}
        title="TimeAlert 명부·시간표 확인"
        {...(!busy && !applied && preview ? { primaryButtonText: "확인한 자료 추가" } : {})}
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          if (result !== "primary") {
            void closeBackup();
            return;
          }
          setPreviewOpen(false);
          void run(async (active) => {
            if (!preview) return;
            const saved = await host.applyTimeAlert({
              sessionHandle: preview.sessionHandle,
              expectedRevision: document.revision,
              studentLinks: Object.entries(links)
                .filter(([, value]) => value)
                .map(([importedStudentId, existingStudentId]) => ({ importedStudentId, existingStudentId })),
            });
            if (!active()) return;
            onSaved(saved);
            setApplied(true);
            setMessage("원작 명부·시간표와 사진을 추가했어요. 기존 학생 연결은 선택한 대상만 적용했어요.");
          });
        }}
      >
        <div className={s.stack}>
          <Body>
            {preview?.document.semesters.length ?? 0}개 학기 · {preview?.document.students.length ?? 0}명 ·{" "}
            {preview?.photoCount ?? 0}장. 기존 자료에 추가하며 같은 이름은 자동 합치지 않아요.
          </Body>
          {preview?.warnings.map((warning) => (
            <InfoBar key={warning} message={warning} />
          ))}
          <TextBox header="기존 학생 찾기 · 이름 또는 학적" value={search} onChange={setSearch} />
          {visibleStudents.map((student) => (
            <div key={student.id} className={s.item}>
              <Caption>
                {student.name} ·{" "}
                {preview?.document.enrollments
                  .filter((e) => e.studentId === student.id)
                  .map((e) => `${e.grade}-${e.classNumber}-${e.studentNumber}`)
                  .join(" / ")}
              </Caption>
              <ComboBox
                header={`${student.name} 기존 학생 연결`}
                value={links[student.id] ?? ""}
                options={existingOptions(student.name, links[student.id] ?? "")}
                onChange={(value) => setLinks((links) => ({ ...links, [student.id]: value }))}
              />
            </div>
          ))}
          <div className={s.row}>
            <Button disabled={page === 0} onClick={() => setPage((page) => page - 1)}>
              이전 학생
            </Button>
            <Caption>
              {page + 1} / {Math.max(1, Math.ceil((preview?.document.students.length ?? 0) / 20))}
            </Caption>
            <Button
              disabled={(page + 1) * 20 >= (preview?.document.students.length ?? 0)}
              onClick={() => setPage((page) => page + 1)}
            >
              다음 학생
            </Button>
          </div>
        </div>
      </ContentDialog>
      <ContentDialog
        open={rosterOpen}
        title="사진명렬표 대응 확인"
        {...(!busy && rosterRows.length ? { primaryButtonText: "명부·선택한 사진 함께 등록" } : {})}
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          if (result !== "primary") {
            void closeRoster();
            return;
          }
          setRosterOpen(false);
          void run(async (active) => {
            if (!rosterPreview) return;
            const prepared = rosterPhotoDocument(document, semesterId, rosterRows);
            const saved = await host.importRosterPhotos({
              sessionHandle: rosterPreview.sessionHandle,
              semesterId,
              expectedRevision: rosterPreview.expectedRevision,
              matches: prepared.matches,
              document: prepared.document,
            });
            if (!active()) return;
            if (saved?.document) {
              onSaved(saved.document);
              rosterSession.current = null;
              setRosterPreview(null);
              setMessage("확인한 명부와 사진을 함께 등록했어요.");
            }
          });
        }}
      >
        <div className={s.stack}>
          <Body>
            {rosterRows.length}명 · 사진 {rosterPreview?.photoKeys.length ?? 0}장. 위치가 명확한 사진만 자동 선택해요.
            제안·동명이인·겹친 사진은 직접 확인해 주세요.
          </Body>
          {warnings.map((warning) => (
            <InfoBar key={warning} message={warning} />
          ))}
          <TextBox header="기존 학생 찾기 · 이름 또는 학적" value={search} onChange={setSearch} />
          {visibleRows.map((row) => (
            <div className={s.item} key={row.rowKey}>
              <Caption>
                {row.grade}-{row.classNumber}-{row.number} {row.name}
                {row.warning ? ` · ${row.warning}` : ""}
              </Caption>
              <ComboBox
                header={`${row.name} 기존 학생 연결`}
                value={row.existingStudentId}
                options={existingOptions(row.name, row.existingStudentId)}
                onChange={(value) =>
                  setRosterRows((rows) =>
                    rows.map((item) => (item.rowKey === row.rowKey ? { ...item, existingStudentId: value } : item)),
                  )
                }
              />
              <ComboBox
                header={`${row.name} 사진 대응`}
                value={row.photoKey}
                options={[
                  { value: "", label: "사진 연결 안 함" },
                  ...(rosterPreview?.photoKeys.map((photo, index) => ({
                    value: photo.photoKey,
                    label: `사진 ${index + 1}${photo.photoKey === row.suggestionKey ? " · 위치 제안" : ""}`,
                  })) ?? []),
                ]}
                onChange={(value) =>
                  setRosterRows((rows) =>
                    rows.map((item) => (item.rowKey === row.rowKey ? { ...item, photoKey: value } : item)),
                  )
                }
              />
              {selectedPhoto(row.photoKey)?.thumbnailBase64 ? (
                <img
                  className={s.photo}
                  src={`data:image/png;base64,${selectedPhoto(row.photoKey)?.thumbnailBase64}`}
                  alt={`${row.name} 연결 사진 미리보기`}
                />
              ) : row.photoKey ? (
                <Caption>이 사진의 미리보기를 만들지 못했어요. 독립 사진 추출 도구에서 원본을 확인해 주세요.</Caption>
              ) : null}
            </div>
          ))}
          <div className={s.row}>
            <Button disabled={page === 0} onClick={() => setPage((page) => page - 1)}>
              이전 학생
            </Button>
            <Caption>
              {page + 1} / {Math.max(1, Math.ceil(rosterRows.length / 20))}
            </Caption>
            <Button disabled={(page + 1) * 20 >= rosterRows.length} onClick={() => setPage((page) => page + 1)}>
              다음 학생
            </Button>
          </div>
        </div>
      </ContentDialog>
    </SettingsExpander>
  );
}
