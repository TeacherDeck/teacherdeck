// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { AdapterInfo, Deck, NetworkSnapshot, RoutineStatus } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  InfoBar,
  ListView,
  PageHeader,
  SettingsExpander,
  TextBox,
  ToggleSwitch,
  deckTokens,
  tokens,
  makeStyles,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DAY_KEYS,
  defaultSettings,
  validateSettings,
  parseNameList,
  currentDecisionInfo,
  type Settings,
  type DayKey,
  type DecisionMode,
} from "./logic.ts";
import { rulesFor, patchFor, restoreSettings, wifiFor, localTimestamp, reasonLabel, triggerLabels } from "./profile.ts";
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.sectionGap,
    padding: deckTokens.pagePadding,
    minWidth: 0,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.cardGap,
    padding: deckTokens.cardPadding,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    minWidth: 0,
  },
  actions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: deckTokens.inlineGap },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,18ch),1fr))",
    gap: deckTokens.cardGap,
    minWidth: 0,
  },
  week: {
    display: "grid",
    gridTemplateColumns: "minmax(7ch,1fr) minmax(9ch,2fr) minmax(9ch,2fr)",
    gap: deckTokens.inlineGap,
    alignItems: "end",
    minWidth: 0,
  },
  wide: { overflowWrap: "anywhere" },
});
const dayLabels: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};
const modeOptions: { value: DecisionMode; label: string }[] = [
  { value: "schedule", label: "시간표만 사용" },
  { value: "hybrid", label: "Wi-Fi 이름 우선, 없으면 시간표" },
  { value: "wifi_only", label: "Wi-Fi 이름만 사용" },
];
function advice(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "CANCELLED"
    ? "관리자 승인을 취소했어요. 저장 상태와 현재 네트워크를 다시 확인해 주세요."
    : code === "VERSION_MISMATCH"
      ? "저장된 설정이 달라졌어요. 상태를 다시 불러와 주세요."
      : code === "PERMISSION_DENIED"
        ? "네트워크 변경 권한을 확인해 주세요. 어댑터 조회와 설정 편집은 계속할 수 있어요."
        : code === "BUSY"
          ? "다른 네트워크 작업이 끝난 뒤 다시 시도해 주세요."
          : "네트워크 작업을 확인하지 못했어요. 상태를 다시 불러와 주세요.";
}
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [settings, setSettings] = useState<Settings>(defaultSettings),
    [adapters, setAdapters] = useState<AdapterInfo[]>([]),
    [selected, setSelected] = useState(""),
    [saved, setSaved] = useState<RoutineStatus | null>(null),
    [savedSignature, setSavedSignature] = useState(""),
    [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(""),
    [failedLoad, setFailedLoad] = useState(false),
    [wifiOpen, setWifiOpen] = useState(false),
    [scheduleOpen, setScheduleOpen] = useState(true),
    [internalText, setInternalText] = useState(""),
    [externalText, setExternalText] = useState(""),
    [baseStart, setBaseStart] = useState("08:20"),
    [baseEnd, setBaseEnd] = useState("16:20");
  const [now, setNow] = useState(localTimestamp);
  const locked = useRef(false),
    mounted = useRef(true),
    signature = JSON.stringify([settings, selected]);
  const dirty = savedSignature !== signature;
  const errors = useMemo(() => validateSettings(settings), [settings]);
  function restore(status: RoutineStatus) {
    const next = restoreSettings(status);
    setSaved(status);
    setSettings(next);
    setInternalText(next.wifi_rules.internal_names.join("\n"));
    setExternalText(next.wifi_rules.external_names.join("\n"));
    setSelected(status.adapter.adapterHandle);
    setSavedSignature(JSON.stringify([next, status.adapter.adapterHandle]));
    setSnapshot(status.snapshot);
    setWifiOpen(next.decision_mode !== "schedule");
    const base = DAY_KEYS.map((k) => next.schedule.days[k]).find((day) => day.enabled);
    setBaseStart(base?.start ?? "08:20");
    setBaseEnd(base?.end ?? "16:20");
    setAdapters((previous) =>
      previous.some((a) => a.adapterHandle === status.adapter.adapterHandle) ? previous : [...previous, status.adapter],
    );
  }
  async function reload() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setFailedLoad(false);
    try {
      const [adapterResult, statusResult] = await Promise.allSettled([deck.network.adapters(), deck.network.status()]);
      if (adapterResult.status === "fulfilled") {
        setAdapters(adapterResult.value);
      } else {
        setMessage(advice(adapterResult.reason));
      }
      if (statusResult.status === "fulfilled" && statusResult.value !== null) {
        restore(statusResult.value);
      } else if (statusResult.status === "rejected") {
        setFailedLoad(true);
        setMessage("저장한 설정을 불러오지 못했어요. 저장 상태를 먼저 확인해 주세요.");
      } else if (adapterResult.status === "fulfilled") {
        const adapter =
          adapterResult.value.find((a) => a.displayName === defaultSettings().adapter_name) ?? adapterResult.value[0];
        if (adapter) {
          setSelected(adapter.adapterHandle);
          setSettings((previous) => ({ ...previous, adapter_name: adapter.displayName }));
          const current = await deck.network.inspect({ adapterHandle: adapter.adapterHandle, scanWifi: false });
          setSnapshot(current);
        }
      }
    } catch (error) {
      setMessage(advice(error));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [deck]);
  useEffect(() => {
    const refresh = () => setNow(localTimestamp());
    const interval = setInterval(refresh, 1_000);
    const off = deck.on("module.visibility", ({ visible }) => {
      if (visible) refresh();
    });
    return () => {
      clearInterval(interval);
      off();
    };
  }, [deck]);
  function edit(change: (previous: Settings) => Settings) {
    if (locked.current) return;
    setSettings(change);
    setMessage("");
  }
  function dayChange(key: DayKey, field: "enabled" | "start" | "end", value: string | boolean) {
    edit((previous) => ({
      ...previous,
      schedule: {
        ...previous.schedule,
        days: { ...previous.schedule.days, [key]: { ...previous.schedule.days[key], [field]: value } },
      },
    }));
  }
  const decision = useMemo(() => {
    try {
      return currentDecisionInfo(settings, now, wifiFor(snapshot));
    } catch {
      return null;
    }
  }, [settings, snapshot, now]);
  async function inspect(scanWifi: boolean) {
    if (locked.current || !selected) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await deck.network.inspect({ adapterHandle: selected, scanWifi });
      setSnapshot(result);
      setMessage(scanWifi ? "연결된 Wi-Fi와 주변 이름을 확인했어요." : "현재 어댑터 상태를 확인했어요.");
    } catch (error) {
      setMessage(advice(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (locked.current || !selected || errors.length || failedLoad) return;
    if (settings.automation_enabled && saved?.originalAutomationDetected) {
      setMessage("기존 네트워크 루틴의 자동화를 먼저 끈 뒤 이 루틴을 켜 주세요.");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      const profile = await deck.network.saveProfile({
        adapterHandle: selected,
        internal: patchFor(settings),
        external: { address: "dhcp", dns: "dhcp" },
      });
      const result = await deck.network.configureRoutine({
        profileHandle: profile.profileHandle,
        revision: profile.revision,
        enabled: settings.automation_enabled,
        rules: rulesFor(settings),
      });
      restore(result.status);
      setMessage(
        settings.automation_enabled
          ? "설정을 저장하고 자동 루틴을 켰어요."
          : "설정을 저장했어요. 현재 네트워크는 바꾸지 않았어요.",
      );
    } catch (error) {
      setMessage(advice(error));
      try {
        const status = await deck.network.status();
        if (status) {
          setSaved(status);
          setSavedSignature("");
        }
      } catch {
        setFailedLoad(true);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function refreshAfterFailure(error: unknown) {
    const [status, current] = await Promise.allSettled([
      deck.network.status(saved ? { routineHandle: saved.routineHandle } : undefined),
      deck.network.inspect({ adapterHandle: selected, scanWifi: false }),
    ]);
    if (!mounted.current) return;
    if (status.status === "fulfilled" && status.value) setSaved(status.value);
    // A stored pre-apply snapshot must never stand in for a failed live readback.
    setSnapshot(current.status === "fulfilled" ? current.value : null);
    setMessage(
      `${advice(error)} 일부 설정이 바뀌었을 수 있어요. ${
        current.status === "fulfilled"
          ? "실제 IP와 DNS를 다시 읽었어요. 확인한 뒤 원하는 망으로 다시 전환해 주세요."
          : "현재 상태도 읽지 못했어요. 연결 상태를 확인한 뒤 현재 상태 확인을 눌러 주세요."
      }`,
    );
  }
  async function evaluate() {
    if (locked.current || dirty || !saved || saved.error === "RECONFIGURE_REQUIRED") return;
    locked.current = true;
    setBusy(true);
    try {
      const status = await deck.network.evaluate({ routineHandle: saved.routineHandle });
      restore(status);
      setMessage(
        status.state.manualOverrideSegmentId
          ? "수동으로 선택한 망을 현재 판단 구간에서 유지해요."
          : status.decision?.mode === null
            ? "조건이 분명하지 않아 현재 네트워크를 유지해요."
            : "저장한 조건으로 지금 상태를 검사했어요.",
      );
    } catch (error) {
      await refreshAfterFailure(error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function apply(mode: "internal" | "external") {
    if (locked.current || dirty || !saved || saved.error === "RECONFIGURE_REQUIRED") return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await deck.network.apply({
        profileHandle: saved.profile.profileHandle,
        revision: saved.profile.revision,
        mode,
      });
      setSnapshot(result.snapshot);
      const status = await deck.network.status({ routineHandle: saved.routineHandle });
      if (status) restore(status);
      setMessage(
        `${mode === "internal" ? "내부망으로" : "외부망 DHCP로"} 전환했어요. 현재 판단 구간에서는 수동 선택을 유지해요.`,
      );
    } catch (error) {
      await refreshAfterFailure(error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function stop() {
    if (locked.current || !saved) return;
    locked.current = true;
    setBusy(true);
    try {
      await deck.network.stopRoutine({ routineHandle: saved.routineHandle });
      const status = await deck.network.status();
      if (status) restore(status);
      setMessage("자동 루틴을 중지했어요. 현재 IP와 DNS는 유지해요.");
    } catch (error) {
      setMessage(advice(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function addName(kind: "internal_names" | "external_names", name: string) {
    if (!name) return;
    const names = parseNameList([...settings.wifi_rules[kind], name]);
    if (kind === "internal_names") setInternalText(names.join("\n"));
    else setExternalText(names.join("\n"));
    edit((previous) => ({ ...previous, wifi_rules: { ...previous.wifi_rules, [kind]: names } }));
  }
  return (
    <main className={s.page}>
      <PageHeader
        title="네트워크 루틴"
        description="내부망·외부망 설정과 시간표·Wi-Fi 자동 루틴을 한곳에서 관리해요."
      />
      {message && <InfoBar severity={failedLoad ? "error" : "informational"} message={message} />}
      <div className={s.card}>
        <ComboBox
          header="사용할 네트워크 어댑터"
          options={adapters.map((adapter) => ({ value: adapter.adapterHandle, label: adapter.displayName }))}
          value={selected}
          disabled={busy}
          onChange={(handle) => {
            setSelected(handle);
            const adapter = adapters.find((a) => a.adapterHandle === handle);
            if (adapter) edit((previous) => ({ ...previous, adapter_name: adapter.displayName }));
            setSnapshot(null);
          }}
        />
        <div className={s.actions}>
          <Button disabled={busy || !selected} onClick={() => void inspect(false)}>
            현재 상태 확인
          </Button>
          <Button disabled={busy} onClick={() => void reload()}>
            저장 상태 다시 불러오기
          </Button>
        </div>
        <Body className={s.wide}>
          IP {snapshot?.ips.join(", ") || "없음"} · DNS {snapshot?.dns.join(", ") || "없음"} ·{" "}
          {snapshot?.dhcp ? "DHCP 사용" : "고정 주소 또는 확인 전"}
        </Body>
        <Caption className={s.wide}>연결 Wi-Fi {snapshot?.connectedWifi || "확인 전 또는 연결 없음"}</Caption>
      </div>
      <div className={s.card}>
        <BodyStrong>{dirty ? "편집 중인 조건 미리보기" : "저장한 조건"}</BodyStrong>
        {decision && (
          <Body>
            {decision.mode === "internal" ? "내부망" : decision.mode === "external" ? "외부망 DHCP" : "현재 상태 유지"}{" "}
            · {reasonLabel(decision.source)}
          </Body>
        )}
        {saved?.state.manualOverrideSegmentId && (
          <InfoBar
            severity="informational"
            message={`수동 우선: ${saved.state.manualOverrideMode === "internal" ? "내부망" : "외부망"} 선택을 현재 판단 구간에서 유지해요. 구간이 바뀌면 자동 판단을 다시 사용해요.`}
          />
        )}
        <Caption>
          {dirty
            ? "수정한 내용은 아직 자동 실행에 쓰지 않아요. 먼저 저장해 주세요."
            : "저장한 설정을 사용해요. 수동 전환은 현재 판단 구간 동안 우선해요."}
        </Caption>
        {errors.length > 0 && <InfoBar severity="warning" message={errors.join(" ")} />}
        <div className={s.actions}>
          <Button
            appearance="primary"
            disabled={busy || !selected || errors.length > 0 || failedLoad}
            onClick={() => void save()}
          >
            설정 저장
          </Button>
          <Button
            disabled={busy || dirty || !saved || saved.error === "RECONFIGURE_REQUIRED"}
            onClick={() => void evaluate()}
          >
            저장한 조건으로 지금 검사
          </Button>
          <Button
            disabled={busy || dirty || !saved || saved.error === "RECONFIGURE_REQUIRED"}
            onClick={() => void apply("internal")}
          >
            내부망으로 수동 전환
          </Button>
          <Button
            disabled={busy || dirty || !saved || saved.error === "RECONFIGURE_REQUIRED"}
            onClick={() => void apply("external")}
          >
            외부망 DHCP로 수동 전환
          </Button>
          <Button disabled={busy || !saved} onClick={() => void stop()}>
            자동 루틴 중지
          </Button>
        </div>
        <Caption>
          실제 전환과 자동 작업 등록 때만 Windows 관리자 승인이 필요해요. 취소하면 성공으로 기록하지 않아요.
        </Caption>
      </div>
      <div className={s.card}>
        <BodyStrong>내부망 설정</BodyStrong>
        <Caption>
          주소와 마스크는 함께 입력해 주세요. DNS만 입력하면 IP는 바꾸지 않아요. 외부망은 IP와 DNS를 모두 DHCP로
          복원해요.
        </Caption>
        <div className={s.fields}>
          {(
            [
              { key: "ip", label: "IPv4 주소" },
              { key: "mask", label: "서브넷 마스크" },
              { key: "gateway", label: "게이트웨이 (선택)" },
              { key: "dns1", label: "기본 DNS" },
              { key: "dns2", label: "보조 DNS (선택)" },
            ] as const
          ).map(({ key, label }) => (
            <TextBox
              key={key}
              header={label}
              value={settings.internal[key]}
              disabled={busy}
              onChange={(value) =>
                edit((previous) => ({ ...previous, internal: { ...previous.internal, [key]: value } }))
              }
            />
          ))}
        </div>
      </div>
      <div className={s.card}>
        <BodyStrong>자동 판단 조건</BodyStrong>
        <ComboBox
          header="판단 방법"
          options={modeOptions}
          value={settings.decision_mode}
          disabled={busy}
          onChange={(value) => {
            edit((previous) => ({ ...previous, decision_mode: value }));
            setWifiOpen(value !== "schedule");
            setScheduleOpen(value !== "wifi_only");
          }}
        />
        <ToggleSwitch
          header="자동 루틴 켜기"
          checked={settings.automation_enabled}
          disabled={busy}
          onChange={(value) => edit((previous) => ({ ...previous, automation_enabled: value }))}
          description="저장하면 관리자 승인으로 자동 작업을 등록해요. 창을 닫거나 PC를 다시 켜도 저장한 조건만 사용해요."
        />
        <SettingsExpander
          header="요일별 내부망 시간표"
          description="종료 시각 전까지 내부망이에요. 시작보다 이른 종료 시각은 다음 날로 이어져요."
          expanded={scheduleOpen}
          onExpandedChange={setScheduleOpen}
        >
          <div className={s.fields}>
            <TextBox
              header="기본 시작 시각"
              value={baseStart}
              disabled={busy || settings.decision_mode === "wifi_only"}
              onChange={setBaseStart}
            />
            <TextBox
              header="기본 종료 시각"
              value={baseEnd}
              disabled={busy || settings.decision_mode === "wifi_only"}
              onChange={setBaseEnd}
            />
          </div>
          <Button
            disabled={busy || settings.decision_mode === "wifi_only"}
            onClick={() =>
              edit((previous) => ({
                ...previous,
                schedule: {
                  base_start: baseStart,
                  base_end: baseEnd,
                  days: Object.fromEntries(
                    DAY_KEYS.map((key) => [key, { ...previous.schedule.days[key], start: baseStart, end: baseEnd }]),
                  ) as Settings["schedule"]["days"],
                },
              }))
            }
          >
            기본 시간을 모든 요일에 적용
          </Button>
          {DAY_KEYS.map((key) => (
            <div key={key} className={s.week}>
              <CheckBox
                content={dayLabels[key]}
                checked={settings.schedule.days[key].enabled}
                disabled={busy || settings.decision_mode === "wifi_only"}
                onChange={(value) => dayChange(key, "enabled", value)}
              />
              <TextBox
                header={`${dayLabels[key]} 시작`}
                value={settings.schedule.days[key].start}
                disabled={busy || settings.decision_mode === "wifi_only" || !settings.schedule.days[key].enabled}
                onChange={(value) => dayChange(key, "start", value)}
              />
              <TextBox
                header={`${dayLabels[key]} 종료`}
                value={settings.schedule.days[key].end}
                disabled={busy || settings.decision_mode === "wifi_only" || !settings.schedule.days[key].enabled}
                onChange={(value) => dayChange(key, "end", value)}
              />
            </div>
          ))}
        </SettingsExpander>
        <SettingsExpander
          header="Wi-Fi 이름 조건"
          description="연결된 이름을 먼저 판단하고, 주변에는 한쪽 이름만 감지될 때 전환해요."
          expanded={wifiOpen}
          onExpandedChange={setWifiOpen}
        >
          <div className={s.fields}>
            <TextBox
              header="내부망 Wi-Fi 이름"
              multiline
              rows={3}
              value={internalText}
              disabled={busy || settings.decision_mode === "schedule"}
              onChange={(value) => {
                setInternalText(value);
                edit((previous) => ({
                  ...previous,
                  wifi_rules: { ...previous.wifi_rules, internal_names: parseNameList(value) },
                }));
              }}
            />
            <TextBox
              header="외부망 Wi-Fi 이름"
              multiline
              rows={3}
              value={externalText}
              disabled={busy || settings.decision_mode === "schedule"}
              onChange={(value) => {
                setExternalText(value);
                edit((previous) => ({
                  ...previous,
                  wifi_rules: { ...previous.wifi_rules, external_names: parseNameList(value) },
                }));
              }}
            />
          </div>
          <Caption>쉼표 또는 줄바꿈으로 여러 이름을 입력해 주세요. 내외부에 같은 이름을 넣지 않아요.</Caption>
          <div className={s.actions}>
            <Button
              disabled={busy || settings.decision_mode === "schedule" || !selected}
              onClick={() => void inspect(true)}
            >
              연결·주변 Wi-Fi 확인
            </Button>
            <Button
              disabled={busy || settings.decision_mode === "schedule" || !snapshot?.connectedWifi}
              onClick={() => addName("internal_names", snapshot?.connectedWifi ?? "")}
            >
              연결 이름을 내부망에 추가
            </Button>
            <Button
              disabled={busy || settings.decision_mode === "schedule" || !snapshot?.connectedWifi}
              onClick={() => addName("external_names", snapshot?.connectedWifi ?? "")}
            >
              연결 이름을 외부망에 추가
            </Button>
          </div>
          <Caption className={s.wide}>감지된 이름: {snapshot?.visibleWifi.join(", ") || "없음 또는 확인 전"}</Caption>
          {snapshot?.locationPermissionRequired && (
            <InfoBar
              severity="warning"
              message="Windows 위치 권한이 필요해요. Wi-Fi 이름만 모드에서 판단할 수 없으면 현재 상태를 유지해요."
            />
          )}
          <ListView
            header="감지한 이름 추가"
            items={snapshot?.visibleWifi ?? []}
            getKey={(name) => name}
            emptyText="주변 Wi-Fi를 확인하면 이름을 추가할 수 있어요."
            renderItem={(name) => (
              <div className={s.actions}>
                <Body>{name}</Body>
                <Button
                  disabled={busy || settings.decision_mode === "schedule"}
                  onClick={() => addName("internal_names", name)}
                >
                  내부망에 추가
                </Button>
                <Button
                  disabled={busy || settings.decision_mode === "schedule"}
                  onClick={() => addName("external_names", name)}
                >
                  외부망에 추가
                </Button>
              </div>
            )}
          />
        </SettingsExpander>
      </div>
      <div className={s.card}>
        <BodyStrong>자동 루틴 상태</BodyStrong>
        <Body>{saved?.enabled ? "자동 루틴 켜짐" : "자동 루틴 꺼짐 또는 등록 전"}</Body>
        {saved?.originalAutomationDetected && (
          <InfoBar
            severity="warning"
            message="기존 네트워크 루틴 자동 작업이 있어요. 원본 프로그램에서 자동화를 끈 뒤 새 루틴을 켜 주세요. 원본 작업은 지우지 않아요."
          />
        )}
        <ListView
          header="여섯 자동 실행 트리거"
          items={
            saved?.triggers ?? Object.keys(triggerLabels).map((kind) => ({ kind, required: false, registered: false }))
          }
          getKey={(trigger) => trigger.kind}
          renderItem={(trigger) => (
            <div className={s.actions}>
              <Body>{triggerLabels[trigger.kind] ?? trigger.kind}</Body>
              <Caption>
                {trigger.registered ? "등록됨" : trigger.required ? "등록 확인 필요" : "현재 조건에서 사용하지 않음"}
              </Caption>
            </div>
          )}
        />
        {saved?.error && (
          <InfoBar
            severity="warning"
            message={
              saved.error === "RECONFIGURE_REQUIRED"
                ? "앱이 업데이트되거나 설치 위치가 바뀌었어요. 자동 루틴을 다시 켜고 설정을 저장해 주세요. 다시 저장하기 전에는 전환하지 않아요."
                : "이전 자동 작업을 완료하지 못했어요. 현재 상태와 등록 권한을 확인해 주세요."
            }
          />
        )}
      </div>
    </main>
  );
}
