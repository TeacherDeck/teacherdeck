// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Keep pure logic in plain functions so it can be unit-tested without the host (MOD-015).

export interface Student {
  id: string;
  number: number;
  name: string;
  baseCount: number;
}
export interface Job {
  id: string;
  title: string;
  capacity: number;
}
export interface Assignment {
  studentId: string;
  jobId: string;
}
export interface Performance {
  id: string;
  draftId: string;
  cycle: number;
  studentId: string;
  number: number;
  name: string;
  jobId: string;
  jobTitle: string;
  completedAt: string;
}
export interface RoleState {
  version: 1;
  label: string;
  students: Student[];
  retiredStudents?: Student[];
  jobs: Job[];
  excluded: string[];
  fixed: Record<string, string>;
  draft: Assignment[];
  draftId: string;
  cycle: number;
  events: Performance[];
}
export const MAX_EVENTS = 10000;
function controls(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32);
}
export function emptyState(): RoleState {
  return {
    version: 1,
    label: "이번 배정",
    students: [],
    jobs: [
      { id: "j1", title: "진행", capacity: 1 },
      { id: "j2", title: "기록", capacity: 1 },
      { id: "j3", title: "자료", capacity: 1 },
    ],
    excluded: [],
    fixed: {},
    draft: [],
    draftId: "",
    cycle: 1,
    events: [],
  };
}
export function totalCount(state: RoleState, id: string): number {
  return totalCounts(state).get(id) ?? 0;
}
export function totalCounts(state: RoleState): Map<string, number> {
  const counts = new Map(state.students.map((s) => [s.id, s.baseCount]));
  for (const event of state.events) counts.set(event.studentId, (counts.get(event.studentId) ?? 0) + 1);
  return counts;
}
/** Reconnect only after the teacher explicitly confirms that these are the same people. */
export function parseTaskRoster(state: RoleState, text: string, reconnect = false): Student[] {
  if (!reconnect) return parseRoster(text, state.students);
  const entered = parseRoster(text, state.students);
  const history = new Map<string, Student>();
  for (const event of state.events)
    history.set(event.studentId, { id: event.studentId, number: event.number, name: event.name, baseCount: 0 });
  for (const student of state.retiredStudents ?? []) history.set(student.id, student);
  const currentIds = new Set(state.students.map((student) => student.id));
  const previous = [...state.students];
  for (const student of entered) {
    if (currentIds.has(student.id)) continue;
    const matches = [...history.values()].filter(
      (old) => !currentIds.has(old.id) && old.number === student.number && old.name === student.name,
    );
    if (matches.length > 1)
      throw new Error(
        "같은 번호·이름의 이전 학생이 여러 명이에요. 자동 연결하지 않았어요. 이전 기록 파일을 확인하거나 새 학생으로 적용해 주세요.",
      );
    if (matches[0]) previous.push(matches[0]);
  }
  return parseRoster(text, previous);
}
function retainRemoved(state: RoleState, students: Student[]): Pick<RoleState, "retiredStudents"> {
  const ids = new Set(students.map((student) => student.id));
  const removed = new Map(
    [...(state.retiredStudents ?? []), ...state.students]
      .filter((student) => !ids.has(student.id))
      .map((student) => [student.id, student]),
  );
  if (removed.size > 10000)
    throw new Error("보관 학생이 10,000명이에요. 기록 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  return removed.size || state.retiredStudents ? { retiredStudents: [...removed.values()] } : {};
}
export function parseRoster(
  text: string,
  previous: Student[] = [],
  newId: () => string = () => crypto.randomUUID(),
): Student[] {
  if (text.length > 100000) throw new Error("명단은 100,000자 이내로 입력해 주세요.");
  const out: Student[] = [];
  const numbers = new Set<number>();
  for (const line of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^(번호|학번|출석번호)[\t, ]+(이름|성명)([\t, ]+(기존횟수|횟수))?$/.test(line)) continue;
    const columns = line.split(/[\t,]+/).map((s) => s.trim()),
      first = columns[0] ?? "",
      m = first.match(/^(\d+)[. ]+(.+)$/);
    let number: number;
    let name: string;
    let count: string | undefined;
    if (columns.length > 1) {
      number = Number(first);
      name = columns[1] ?? "";
      count = columns[2];
      if (columns.length > 3) throw new Error("명단은 번호·이름·기존횟수 순서로 입력해 주세요.");
    } else if (m) {
      number = Number(m[1]);
      name = m[2] ?? "";
    } else {
      number = 1;
      while (numbers.has(number)) number++;
      name = first;
    }
    if (!Number.isInteger(number) || number < 1 || number > 999999 || numbers.has(number))
      throw new Error("번호가 중복되거나 범위를 벗어났어요. 서로 다른 번호를 입력해 주세요.");
    if (!name || name.length > 40 || controls(name)) throw new Error("이름은 1~40자로 입력해 주세요.");
    const old = previous.find((s) => s.number === number && s.name === name),
      baseCount = count === undefined || count === "" ? (old?.baseCount ?? 0) : Number(count);
    if (!Number.isInteger(baseCount) || baseCount < 0 || baseCount > 100000)
      throw new Error("기존횟수는 0~100,000의 정수로 입력해 주세요.");
    out.push({ id: old?.id ?? newId(), number, name, baseCount });
    numbers.add(number);
  }
  if (!out.length || out.length > 1000) throw new Error("학생을 1~1,000명 입력해 주세요.");
  return out.sort((a, b) => a.number - b.number);
}
export function parseJobs(text: string, previous: Job[] = []): Job[] {
  if (text.length > 5000) throw new Error("역할 입력은 5,000자 이내로 적어 주세요.");
  const jobs: Job[] = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^역할[\t, ]+(필요인원|인원)$/.test(line)) continue;
    const m = line.match(/^(.+?)[\t, ]+(\d+)$/);
    if (!m) throw new Error("한 줄에 역할 이름과 필요인원을 적어 주세요.");
    const title = (m[1] ?? "").trim(),
      capacity = Number(m[2]);
    if (
      !title ||
      title.length > 30 ||
      controls(title) ||
      capacity < 1 ||
      capacity > 1000 ||
      jobs.some((j) => j.title === title)
    )
      throw new Error("역할 이름은 서로 다르게, 인원은 1~1,000명으로 입력해 주세요.");
    jobs.push({
      id: previous.find((j) => j.title === title)?.id ?? `job-${jobs.length + 1}-${crypto.randomUUID()}`,
      title,
      capacity,
    });
  }
  if (!jobs.length || jobs.length > 100 || jobs.reduce((sum, j) => sum + j.capacity, 0) > 1000)
    throw new Error("역할은 1~100개, 필요인원 합계는 1,000명 이하로 입력해 주세요.");
  return jobs;
}
export function applySetup(state: RoleState, students: Student[], jobs: Job[], label: string): RoleState {
  if (!label.trim() || label.length > 80) throw new Error("배정 이름은 1~80자로 입력해 주세요.");
  const ids = new Set(students.map((s) => s.id)),
    jobIds = new Set(jobs.map((j) => j.id));
  const fixed = Object.fromEntries(Object.entries(state.fixed).filter(([sid, jid]) => ids.has(sid) && jobIds.has(jid)));
  return {
    ...state,
    label: label.trim(),
    students,
    jobs,
    ...retainRemoved(state, students),
    excluded: state.excluded.filter((sid) => ids.has(sid)),
    fixed,
    draft: [],
    draftId: "",
    cycle: state.students.length || state.events.length ? state.cycle + 1 : state.cycle,
  };
}
export function conditions(state: RoleState): string[] {
  const errors: string[] = [];
  const eligible = new Set(state.students.filter((s) => !state.excluded.includes(s.id)).map((s) => s.id));
  if (state.jobs.reduce((sum, j) => sum + j.capacity, 0) > eligible.size)
    errors.push("필요인원이 참여 학생보다 많아요. 정원을 줄이거나 제외 설정을 바꿔 주세요.");
  for (const [sid, jid] of Object.entries(state.fixed)) {
    if (!eligible.has(sid)) errors.push("고정 학생이 제외됐거나 명단에 없어요. 고정 또는 제외 설정을 바꿔 주세요.");
    if (!state.jobs.some((j) => j.id === jid)) errors.push("고정한 역할이 없어졌어요. 고정 설정을 바꿔 주세요.");
  }
  for (const j of state.jobs)
    if (Object.values(state.fixed).filter((id) => id === j.id).length > j.capacity)
      errors.push("역할의 고정 인원이 정원을 초과했어요. 정원 또는 고정 설정을 바꿔 주세요.");
  return [...new Set(errors)];
}
export function draftErrors(state: RoleState, draft: Assignment[] = state.draft): string[] {
  const errors = conditions(state),
    seen = new Set<string>();
  for (const a of draft) {
    if (seen.has(a.studentId)) errors.push("한 학생에게 두 역할이 배정됐어요.");
    seen.add(a.studentId);
    if (!state.students.some((s) => s.id === a.studentId) || state.excluded.includes(a.studentId))
      errors.push("명단에 없거나 제외된 학생이 배정됐어요.");
    if (!state.jobs.some((j) => j.id === a.jobId)) errors.push("삭제된 역할에 학생이 배정됐어요.");
  }
  for (const j of state.jobs)
    if (draft.filter((a) => a.jobId === j.id).length !== j.capacity) errors.push("역할별 필요인원을 채워 주세요.");
  for (const [sid, jid] of Object.entries(state.fixed))
    if (!draft.some((a) => a.studentId === sid && a.jobId === jid)) errors.push("교사가 고정한 역할이 바뀌었어요.");
  return [...new Set(errors)];
}
function currentPerformed(state: RoleState): boolean {
  return state.events.some((e) => e.cycle === state.cycle);
}
/** Fixed assignments first; fill only needed seats from smallest overall actual counts. */
export function generate(state: RoleState, newDraftId: string, random: () => number = Math.random): RoleState {
  if (currentPerformed(state)) throw new Error("이번 배정에 수행 기록이 있어요. 새 배정으로 넘어간 뒤 편성해 주세요.");
  const issues = conditions(state);
  if (issues.length) throw new Error(issues.join(" "));
  if (!state.students.length) throw new Error("먼저 명단을 적용해 주세요.");
  const draft = Object.entries(state.fixed).map(([studentId, jobId]) => ({ studentId, jobId }));
  const assigned = new Set(draft.map((a) => a.studentId));
  const counts = totalCounts(state);
  const candidates = state.students
    .filter((s) => !state.excluded.includes(s.id) && !assigned.has(s.id))
    .map((student) => {
      const tie = random();
      if (!Number.isFinite(tie) || tie < 0 || tie >= 1) throw new Error("편성을 다시 시도해 주세요.");
      return { student, count: counts.get(student.id) ?? 0, tie };
    })
    .sort((a, b) => a.count - b.count || a.tie - b.tie);
  let cursor = 0;
  for (const job of state.jobs) {
    const need = job.capacity - draft.filter((a) => a.jobId === job.id).length;
    for (let i = 0; i < need; i++) {
      const selected = candidates[cursor++]?.student;
      if (!selected) throw new Error("남은 참여 학생이 부족해요. 조건을 확인해 주세요.");
      draft.push({ studentId: selected.id, jobId: job.id });
    }
  }
  const errors = draftErrors(state, draft);
  if (errors.length) throw new Error(errors.join(" "));
  return { ...state, draft, draftId: newDraftId };
}
export function setCondition(state: RoleState, id: string, excluded: boolean, fixedJob: string): RoleState {
  if (!state.students.some((s) => s.id === id) || (fixedJob && !state.jobs.some((j) => j.id === fixedJob)))
    throw new Error("학생·역할을 확인해 주세요.");
  if (currentPerformed(state)) throw new Error("이번 수행 기록을 보존하려면 새 배정으로 넘어가 주세요.");
  const fixed = Object.fromEntries(Object.entries(state.fixed).filter(([sid]) => sid !== id));
  if (fixedJob) fixed[id] = fixedJob;
  return {
    ...state,
    excluded: excluded ? [...new Set([...state.excluded, id])] : state.excluded.filter((sid) => sid !== id),
    fixed,
    draft: [],
    draftId: "",
  };
}
/** Replace a performer or swap assigned students, then revalidate every hard condition. */
export function changePerformer(state: RoleState, studentId: string, replacementId: string): RoleState {
  if (currentPerformed(state))
    throw new Error("수행 기록이 있는 배정은 바꿀 수 없어요. 완료를 되돌리거나 새 배정으로 넘어가 주세요.");
  const original = state.draft.find((a) => a.studentId === studentId);
  if (!original) throw new Error("바꿀 배정이 없어요.");
  const other = state.draft.find((a) => a.studentId === replacementId);
  const draft = state.draft.map((a) =>
    a.studentId === studentId
      ? { ...a, studentId: replacementId }
      : other && a.studentId === replacementId
        ? { ...a, studentId }
        : a,
  );
  const errors = draftErrors(state, draft);
  if (errors.length) throw new Error(errors.join(" "));
  return { ...state, draft };
}
export function complete(state: RoleState, studentId: string, eventId: string, completedAt: string): RoleState {
  if (state.events.some((e) => e.id === eventId)) return state;
  const errors = draftErrors(state);
  if (errors.length) throw new Error(errors.join(" "));
  const a = state.draft.find((item) => item.studentId === studentId),
    student = state.students.find((s) => s.id === studentId),
    job = state.jobs.find((j) => j.id === a?.jobId);
  if (!a || !student || !job || !state.draftId) throw new Error("완료할 배정이 없어요. 먼저 역할을 배정해 주세요.");
  if (state.events.some((e) => e.cycle === state.cycle && e.studentId === studentId))
    throw new Error("이번 수행은 이미 완료로 기록됐어요.");
  if (state.events.length >= MAX_EVENTS)
    throw new Error("완료 기록이 10,000건이에요. 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  if (!eventId || Number.isNaN(Date.parse(completedAt))) throw new Error("완료 시각을 확인해 주세요.");
  return {
    ...state,
    events: [
      ...state.events,
      {
        id: eventId,
        draftId: state.draftId,
        cycle: state.cycle,
        studentId,
        number: student.number,
        name: student.name,
        jobId: job.id,
        jobTitle: job.title,
        completedAt,
      },
    ],
  };
}
export function nextCycle(state: RoleState): RoleState {
  return { ...state, draft: [], draftId: "", cycle: state.cycle + 1 };
}
/** Explicit actual-performance batch; validation completes before the caller saves anything. */
export function completeSelected(
  state: RoleState,
  studentIds: readonly string[],
  completedAt: string,
  newId: () => string = () => crypto.randomUUID(),
): RoleState {
  const selected = new Set(studentIds);
  if (selected.size !== studentIds.length) throw new Error("수행 학생이 중복됐어요.");
  const issues = draftErrors(state);
  if (issues.length) throw new Error(issues.join(" "));
  if (studentIds.some((id) => !state.draft.some((a) => a.studentId === id)))
    throw new Error("완료할 배정을 확인해 주세요.");
  const done = new Set(state.events.filter((e) => e.cycle === state.cycle).map((e) => e.studentId));
  const pending = studentIds.filter((id) => !done.has(id));
  if (state.events.length + pending.length > MAX_EVENTS)
    throw new Error("완료 기록이 10,000건을 넘어요. 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  if (Number.isNaN(Date.parse(completedAt))) throw new Error("완료 시각을 확인해 주세요.");
  const students = new Map(state.students.map((s) => [s.id, s]));
  const jobs = new Map(state.jobs.map((j) => [j.id, j]));
  const assignments = new Map(state.draft.map((a) => [a.studentId, a.jobId]));
  const ids = new Set(state.events.map((e) => e.id));
  const events = pending.map((studentId) => {
    const student = students.get(studentId),
      job = jobs.get(assignments.get(studentId) ?? ""),
      id = newId();
    if (!student || !job || !state.draftId) throw new Error("완료할 배정이 없어요.");
    if (!id || ids.has(id)) throw new Error("완료 기록 식별자가 중복됐어요. 다시 시도해 주세요.");
    ids.add(id);
    return {
      id,
      draftId: state.draftId,
      cycle: state.cycle,
      studentId,
      number: student.number,
      name: student.name,
      jobId: job.id,
      jobTitle: job.title,
      completedAt,
    };
  });
  return events.length ? { ...state, events: [...state.events, ...events] } : state;
}
export function undoCompletion(state: RoleState): RoleState {
  if (!state.events.length) throw new Error("되돌릴 완료 기록이 없어요.");
  return { ...state, events: state.events.slice(0, -1) };
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("자료 형식을 확인해 주세요.");
  return v as Record<string, unknown>;
}
function str(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || v.length > max || (!empty && !v.trim()) || controls(v))
    throw new Error("자료의 글자 형식을 확인해 주세요.");
  return v;
}
function num(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error("자료의 숫자 범위를 확인해 주세요.");
  return v;
}
function list(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Error("자료의 개수를 확인해 주세요.");
  return v;
}
export function decodeState(v: unknown): RoleState {
  const raw = obj(v);
  if (raw["version"] !== 1) throw new Error("기록 파일 버전을 확인해 주세요.");
  const decodeStudent = (v: unknown): Student => {
    const s = obj(v);
    return {
      id: str(s["id"], 80),
      number: num(s["number"], 1, 999999),
      name: str(s["name"], 40),
      baseCount: num(s["baseCount"], 0, 100000),
    };
  };
  const students = list(raw["students"], 1000).map(decodeStudent);
  const retiredStudents =
    raw["retiredStudents"] === undefined ? undefined : list(raw["retiredStudents"], 10000).map(decodeStudent);
  if (
    retiredStudents &&
    (new Set(retiredStudents.map((s) => s.id)).size !== retiredStudents.length ||
      retiredStudents.some((old) => students.some((current) => current.id === old.id)))
  )
    throw new Error("보관 학생의 식별자가 중복됐어요.");
  const jobs = list(raw["jobs"], 100).map((v) => {
    const j = obj(v);
    return { id: str(j["id"], 80), title: str(j["title"], 30), capacity: num(j["capacity"], 1, 1000) };
  });
  if (
    !jobs.length ||
    new Set(jobs.map((j) => j.id)).size !== jobs.length ||
    new Set(jobs.map((j) => j.title)).size !== jobs.length ||
    new Set(students.map((s) => s.id)).size !== students.length ||
    new Set(students.map((s) => s.number)).size !== students.length ||
    jobs.reduce((sum, j) => sum + j.capacity, 0) > 1000
  )
    throw new Error("명단·역할의 중복과 인원을 확인해 주세요.");
  const studentIds = new Set(students.map((s) => s.id)),
    jobIds = new Set(jobs.map((j) => j.id));
  if ([...studentIds, ...jobIds].some((id) => ["__proto__", "constructor", "prototype"].includes(id)))
    throw new Error("명단·역할의 식별자 형식을 확인해 주세요.");
  const excluded = list(raw["excluded"], 1000).map((v) => str(v, 80));
  if (excluded.some((id) => !studentIds.has(id)) || new Set(excluded).size !== excluded.length)
    throw new Error("제외 학생을 확인해 주세요.");
  const fixed = Object.fromEntries(Object.entries(obj(raw["fixed"])).map(([sid, v]) => [str(sid, 80), str(v, 80)]));
  if (
    Object.keys(fixed).length > 1000 ||
    Object.entries(fixed).some(([sid, jid]) => !studentIds.has(sid) || !jobIds.has(jid))
  )
    throw new Error("고정 정보를 확인해 주세요.");
  const cycle = num(raw["cycle"], 1, Number.MAX_SAFE_INTEGER - 1);
  const draft = list(raw["draft"], 1000).map((v) => {
    const a = obj(v);
    return { studentId: str(a["studentId"], 80), jobId: str(a["jobId"], 80) };
  });
  const events = list(raw["events"], MAX_EVENTS).map((v) => {
    const e = obj(v),
      completedAt = str(e["completedAt"], 40);
    if (Number.isNaN(Date.parse(completedAt))) throw new Error("완료 시각을 확인해 주세요.");
    return {
      id: str(e["id"], 80),
      draftId: str(e["draftId"], 80),
      cycle: num(e["cycle"], 1, cycle),
      studentId: str(e["studentId"], 80),
      number: num(e["number"], 1, 999999),
      name: str(e["name"], 40),
      jobId: str(e["jobId"], 80),
      jobTitle: str(e["jobTitle"], 30),
      completedAt,
    };
  });
  if (
    new Set(events.map((e) => e.id)).size !== events.length ||
    new Set(events.map((e) => `${e.cycle}:${e.studentId}`)).size !== events.length
  )
    throw new Error("수행 기록이 중복됐어요.");
  const state: RoleState = {
    version: 1,
    label: str(raw["label"], 80),
    students,
    ...(retiredStudents === undefined ? {} : { retiredStudents }),
    jobs,
    excluded,
    fixed,
    cycle,
    draft,
    draftId: str(raw["draftId"], 80, true),
    events,
  };
  if (draft.length && (!state.draftId || draftErrors(state).length))
    throw new Error("저장 배정의 조건을 확인해 주세요.");
  if (
    events.some(
      (e) =>
        e.cycle === cycle &&
        (!draft.some((a) => a.studentId === e.studentId && a.jobId === e.jobId) || e.draftId !== state.draftId),
    )
  )
    throw new Error("수행 기록과 배정표가 달라요.");
  return state;
}
