// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  InfoBar,
  NumberBox,
  SettingsExpander,
  TextBox,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { calendar, counts, type PlanInput, type PlanResult } from "./planner.ts";
import {
  detailedCounts,
  detailedIssues,
  emptyDetailed,
  MAX_JOBS,
  parseTime,
  setDetailedActual,
  setDetailedManual,
  timeLabel,
  type DetailedState,
} from "./detailed.ts";
import type { PlannerState } from "./state.ts";
const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, minWidth: 0 },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
});
const EMPTY_DETAILS = emptyDetailed();
export function DetailedEditor({
  state,
  input,
  busy,
  onBusy,
  onChange,
}: {
  state: PlannerState;
  input: PlanInput;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChange: (detailed: DetailedState) => void;
}) {
  const s = useStyles(),
    d = state.detailed ?? EMPTY_DETAILS;
  const [blockLabel, setBlockLabel] = useState("1교시"),
    [start, setStart] = useState("09:00"),
    [end, setEnd] = useState("09:50");
  const [day, setDay] = useState(1),
    [block, setBlock] = useState(""),
    [task, setTask] = useState("시험감독"),
    [rooms, setRooms] = useState(""),
    [required, setRequired] = useState(1);
  const [selected, setSelected] = useState(""),
    [teacher, setTeacher] = useState(""),
    [message, setMessage] = useState("");
  const [manual, setManual] = useState<string[]>([]),
    [actual, setActual] = useState<string[]>([]);
  const worker = useRef<Worker | null>(null);
  const job = d.jobs.find((j) => j.id === selected),
    locked = busy || !!state.closed;
  const blockId = d.blocks.some((b) => b.id === block) ? block : (d.blocks[0]?.id ?? "");
  const jobLabel = (j: DetailedState["jobs"][number]) =>
    `${j.day}일 · ${d.blocks.find((b) => b.id === j.block)?.label ?? ""} · ${j.task}${j.room ? ` · ${j.room}` : ""}`;
  const options = [
    { value: "", label: "교사를 선택해 주세요" },
    ...input.teachers.map((t) => ({ value: t.id, label: t.name })),
  ];
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );
  useEffect(() => {
    setManual(job ? (d.assignments[job.id] ?? []) : []);
    setActual(job ? (d.actual[job.id] ?? []) : []);
  }, [job, d.assignments, d.actual]);
  function change(next: DetailedState) {
    onChange(next);
    setMessage("");
  }
  function addBlock() {
    const a = parseTime(start),
      b = parseTime(end);
    if (
      !blockLabel.trim() ||
      blockLabel.trim().length > 100 ||
      a === null ||
      b === null ||
      a >= b ||
      d.blocks.length >= 24
    ) {
      setMessage("시간대 이름과 시작·종료 HH:MM을 확인해 주세요. 자정 전 같은 날, 최대 24개예요.");
      return;
    }
    const id = crypto.randomUUID();
    change({ ...d, blocks: [...d.blocks, { id, label: blockLabel.trim(), start: a, end: b }] });
    setBlock(id);
  }
  function addJobs() {
    const places = rooms
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const entries = places.length ? [...new Set(places)] : [""];
    const date = calendar(input).find((x) => x.day === day);
    if (
      !date ||
      date.excluded ||
      !blockId ||
      !task.trim() ||
      task.trim().length > 100 ||
      entries.some((x) => x.length > 100) ||
      d.jobs.length + entries.length > MAX_JOBS
    ) {
      setMessage("지도하는 날짜·시간대·업무를 확인해 주세요. 세부 업무는 월별 최대 120칸이에요.");
      return;
    }
    if (
      entries.some((room) =>
        d.jobs.some((j) => j.day === day && j.block === blockId && j.task === task.trim() && j.room === room),
      )
    ) {
      setMessage("같은 날짜·시간대·업무·장소가 이미 있어요. 기존 칸의 인원을 조정해 주세요.");
      return;
    }
    const chosen = d.blocks.find((b) => b.id === blockId);
    if (
      chosen &&
      d.jobs.some(
        (j) =>
          j.day === day &&
          j.block !== blockId &&
          d.blocks.some((b) => b.id === j.block && b.start < chosen.end && chosen.start < b.end),
      )
    ) {
      setMessage("같은 날짜의 시간대가 겹쳐요. 여러 장소는 같은 시간대를 함께 선택해 주세요.");
      return;
    }
    const jobs = entries.map((room) => ({
      id: crypto.randomUUID(),
      day,
      block: blockId,
      task: task.trim(),
      room,
      required,
      fixed: [],
      excluded: [],
    }));
    change({ ...d, jobs: [...d.jobs, ...jobs] });
    setSelected(jobs[0]?.id ?? "");
  }
  function generate() {
    const next = new Worker(new URL("./detailed.worker.ts", import.meta.url), { type: "module" });
    worker.current = next;
    onBusy(true);
    setMessage("");
    next.onmessage = (event: MessageEvent<PlanResult>) => {
      if (worker.current !== next) return;
      if (!event.data.issues.length) {
        onChange({ ...d, assignments: event.data.assignments });
        setMessage("조건을 지켜 세부 업무를 배정했어요. 실제 수행 기록은 바뀌지 않아요.");
      } else setMessage(event.data.issues.join(" "));
      next.terminate();
      worker.current = null;
      onBusy(false);
    };
    next.onerror = () => {
      if (worker.current !== next) return;
      setMessage("세부 배정을 계산하지 못했어요. 기존 결과를 유지하니 다시 시도해 주세요.");
      next.terminate();
      worker.current = null;
      onBusy(false);
    };
    const basic = counts(input, state.assignments);
    next.postMessage({
      input: { ...input, teachers: input.teachers.map((t) => ({ ...t, past: t.past + (basic[t.id] ?? 0) })) },
      detailed: d,
    });
  }
  const conflicts = detailedIssues(input, d);
  const planned = detailedCounts(d),
    performed = detailedCounts(d, d.actual);
  return (
    <SettingsExpander
      header="세부 편성 · 시험감독·야자·다른 업무"
      description="하루 지도일은 위 달력 그대로 써요. 교시·시간대나 시험실별 배정이 필요할 때만 펼쳐요."
    >
      <div className={s.stack}>
        <Body>
          시간대 → 날짜·업무·시험실 → 세부 배정 순서예요. 같은 시간대의 여러 장소에는 서로 다른 교사를 배정해요. 날짜
          고정은 그 날짜의 세부 업무에 최소 한 번 참여하는 조건이에요.
        </Body>
        <Caption secondary>
          기본 지도일은 시각이 없는 별도 업무예요. 세부 편성과 각각 배정·수행 기록을 관리하며 누적 횟수는 합산해요. 업무
          한 칸 참여를 1회로 세고 근무 시간에 가중치를 주지 않아요.
        </Caption>
        {message && <InfoBar message={message} onClose={() => setMessage("")} />}
        {conflicts.map((issue) => (
          <InfoBar key={issue} severity="error" message={issue} />
        ))}
        <SettingsExpander header="시간대 등록" defaultExpanded={!d.blocks.length}>
          <div className={s.row}>
            <TextBox header="시간대 이름" value={blockLabel} onChange={setBlockLabel} disabled={locked} />
            <TextBox header="시작 HH:MM" value={start} onChange={setStart} disabled={locked} />
            <TextBox header="종료 HH:MM" value={end} onChange={setEnd} disabled={locked} />
            <Button disabled={locked} onClick={addBlock}>
              시간대 추가
            </Button>
          </div>
          {d.blocks.map((b) => (
            <div className={s.row} key={b.id}>
              <Caption>
                {b.label} · {timeLabel(b.start)}~{timeLabel(b.end)}
              </Caption>
              <Button
                disabled={locked || d.jobs.some((j) => j.block === b.id)}
                onClick={() => change({ ...d, blocks: d.blocks.filter((x) => x.id !== b.id) })}
              >
                시간대 삭제 · {b.label}
              </Button>
            </div>
          ))}
        </SettingsExpander>
        <div className={s.row}>
          <NumberBox
            header="세부 업무 날짜"
            min={1}
            max={calendar(input).length}
            value={Math.min(day, calendar(input).length)}
            onChange={setDay}
            disabled={locked}
          />
          <ComboBox
            header="업무 시간대"
            value={blockId}
            onChange={setBlock}
            options={d.blocks.map((b) => ({
              value: b.id,
              label: `${b.label} · ${timeLabel(b.start)}~${timeLabel(b.end)}`,
            }))}
            disabled={locked}
          />
          <TextBox
            header="업무 구분"
            value={task}
            onChange={setTask}
            disabled={locked}
            placeholder="시험감독·야자·등교 지도"
          />
          <NumberBox
            header="장소마다 필요한 인원"
            value={required}
            min={1}
            max={3}
            onChange={setRequired}
            disabled={locked}
          />
        </div>
        <TextBox
          header="시험실·장소"
          multiline
          rows={2}
          value={rooms}
          onChange={setRooms}
          disabled={locked}
          description="여러 장소는 한 줄씩 넣어요. 장소 구분이 없으면 비워도 돼요."
        />
        <div className={s.row}>
          <Button disabled={locked || !blockId} onClick={addJobs}>
            업무 추가
          </Button>
          <Button appearance="primary" disabled={locked || !d.jobs.length || !input.teachers.length} onClick={generate}>
            세부 배정
          </Button>
          {worker.current && busy && (
            <Button
              onClick={() => {
                worker.current?.terminate();
                worker.current = null;
                onBusy(false);
                setMessage("세부 계산을 취소했어요. 기존 배정과 실제 수행 기록은 유지해요.");
              }}
            >
              세부 계산 취소
            </Button>
          )}
        </div>
        {d.jobs.length > 0 && (
          <>
            <ComboBox
              header="편집할 세부 업무"
              value={job?.id ?? ""}
              onChange={setSelected}
              options={[
                { value: "", label: "업무를 선택해 주세요" },
                ...d.jobs.map((j) => ({ value: j.id, label: jobLabel(j) })),
              ]}
              disabled={locked}
            />
            {job && (
              <section className={s.stack} aria-label="세부 업무 편집">
                <BodyStrong>{jobLabel(job)}</BodyStrong>
                <NumberBox
                  header="이 업무의 필요 인원"
                  min={1}
                  max={3}
                  value={job.required}
                  disabled={locked}
                  onChange={(n) => {
                    if (
                      (d.actual[job.id]?.length ?? 0) > n ||
                      job.fixed.length > n ||
                      (d.manual[job.id]?.length ?? 0) > 0
                    ) {
                      setMessage("실제 수행·고정·직접 배정을 먼저 확인해 주세요. 기록을 임의로 지우지 않아요.");
                      return;
                    }
                    change({ ...d, jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, required: n } : j)) });
                  }}
                />
                <ComboBox
                  header="세부 조건을 바꿀 교사"
                  value={teacher}
                  onChange={setTeacher}
                  options={options}
                  disabled={locked}
                />
                {teacher && (
                  <div className={s.row}>
                    <CheckBox
                      content="이 업무에 고정"
                      checked={job.fixed.includes(teacher)}
                      disabled={locked}
                      onChange={(on) =>
                        change({
                          ...d,
                          jobs: d.jobs.map((j) =>
                            j.id === job.id
                              ? { ...j, fixed: on ? [...j.fixed, teacher] : j.fixed.filter((x) => x !== teacher) }
                              : j,
                          ),
                        })
                      }
                    />
                    <CheckBox
                      content="이 업무에서 제외"
                      checked={job.excluded.includes(teacher)}
                      disabled={locked}
                      onChange={(on) =>
                        change({
                          ...d,
                          jobs: d.jobs.map((j) =>
                            j.id === job.id
                              ? {
                                  ...j,
                                  excluded: on ? [...j.excluded, teacher] : j.excluded.filter((x) => x !== teacher),
                                }
                              : j,
                          ),
                        })
                      }
                    />
                  </div>
                )}
                {Array.from({ length: job.required }, (_, slot) => (
                  <ComboBox
                    key={slot}
                    header={`세부 담당 ${slot + 1}`}
                    value={manual[slot] ?? ""}
                    onChange={(id) =>
                      setManual(Array.from({ length: job.required }, (_, i) => (i === slot ? id : (manual[i] ?? ""))))
                    }
                    options={options}
                    disabled={locked}
                  />
                ))}
                <div className={s.row}>
                  <Button
                    disabled={locked}
                    onClick={() => {
                      try {
                        change(setDetailedManual(input, d, job.id, manual));
                      } catch {
                        setMessage("필요 인원·고정·제외·같은 시간 중복을 확인해 주세요. 기존 배정은 유지해요.");
                      }
                    }}
                  >
                    세부 직접 배정 적용
                  </Button>
                  <Button
                    disabled={locked || !d.manual[job.id]}
                    onClick={() =>
                      change({
                        ...d,
                        manual: Object.fromEntries(Object.entries(d.manual).filter(([key]) => key !== job.id)),
                      })
                    }
                  >
                    세부 직접 배정 해제
                  </Button>
                  <Button
                    disabled={locked || !!d.actual[job.id]?.length || !!d.manual[job.id] || !!job.fixed.length}
                    onClick={() => {
                      const omit = (r: Record<string, string[]>) =>
                        Object.fromEntries(Object.entries(r).filter(([key]) => key !== job.id));
                      change({
                        ...d,
                        jobs: d.jobs.filter((j) => j.id !== job.id),
                        assignments: omit(d.assignments),
                        manual: omit(d.manual),
                        actual: omit(d.actual),
                      });
                      setSelected("");
                    }}
                  >
                    업무 삭제
                  </Button>
                </div>
                <SettingsExpander header="세부 실제 수행 기록">
                  {Array.from({ length: job.required }, (_, slot) => (
                    <ComboBox
                      key={slot}
                      header={`세부 실제 수행자 ${slot + 1}`}
                      value={actual[slot] ?? ""}
                      onChange={(id) =>
                        setActual(Array.from({ length: job.required }, (_, i) => (i === slot ? id : (actual[i] ?? ""))))
                      }
                      options={options}
                      disabled={locked}
                    />
                  ))}
                  <div className={s.row}>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        try {
                          change(setDetailedActual(input, d, job.id, actual.filter(Boolean)));
                        } catch {
                          setMessage("미래 날짜·필요 인원·같은 시간 수행 중복을 확인해 주세요. 기존 기록은 유지해요.");
                        }
                      }}
                    >
                      세부 수행 기록 반영
                    </Button>
                    <Button
                      disabled={locked || !d.assignments[job.id]?.length}
                      onClick={() => {
                        try {
                          change(setDetailedActual(input, d, job.id, d.assignments[job.id] ?? []));
                        } catch {
                          setMessage("미래 날짜나 같은 시간 수행 중복은 기록하지 않아요.");
                        }
                      }}
                    >
                      이 업무 배정대로 수행 기록
                    </Button>
                  </div>
                </SettingsExpander>
              </section>
            )}
            <section className={s.stack} aria-label="세부 편성 결과">
              {d.jobs.map((j) => (
                <Caption key={j.id}>
                  {jobLabel(j)} ·{" "}
                  {(d.assignments[j.id] ?? [])
                    .map((id) => input.teachers.find((t) => t.id === id)?.name ?? "미배정")
                    .join(" · ") || "미배정"}
                  {d.manual[j.id] ? " · 직접" : ""} · 실제 {d.actual[j.id]?.length ?? 0}명
                </Caption>
              ))}
            </section>
            <SettingsExpander header="업무별 횟수">
              {[...new Set(d.jobs.map((j) => j.task))].map((name) => (
                <div key={name}>
                  <BodyStrong>{name}</BodyStrong>
                  {input.teachers.map((t) => (
                    <Caption key={t.id}>
                      {t.name} · 배정{" "}
                      {d.jobs.filter((j) => j.task === name && d.assignments[j.id]?.includes(t.id)).length}회 · 실제{" "}
                      {d.jobs.filter((j) => j.task === name && d.actual[j.id]?.includes(t.id)).length}회{" "}
                    </Caption>
                  ))}
                </div>
              ))}
              <Caption>
                세부 합계: 배정 {Object.values(planned).reduce((a, b) => a + b, 0)}회 · 실제{" "}
                {Object.values(performed).reduce((a, b) => a + b, 0)}회. 월 마감은 위 기본 기록과 함께 저장해요.
              </Caption>
            </SettingsExpander>
          </>
        )}
      </div>
    </SettingsExpander>
  );
}
