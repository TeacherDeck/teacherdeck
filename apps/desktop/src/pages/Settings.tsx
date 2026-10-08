// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Settings (PowerToys SettingsCard pattern). Updates are only applied after the user agrees (SEC-008).
import { Button, Dropdown, Option, Title3, makeStyles } from "@fluentui/react-components";
import { ArrowSyncRegular, DarkThemeRegular } from "@fluentui/react-icons";
import { SettingsCard, deckTokens } from "@deck/ui";
import { useState } from "react";
import type { UpdateStatus } from "../generated/UpdateStatus.ts";
import type { ThemePreference } from "../theme.ts";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, padding: deckTokens.pagePadding },
});

const THEME_LABELS: Record<ThemePreference, string> = { system: "시스템 설정", light: "라이트", dark: "다크" };

function describe(status: UpdateStatus | null): string {
  if (status === null) return "새 도구와 기능이 있는지 확인해요.";
  switch (status.status) {
    case "notConfigured":
      return "업데이트가 아직 설정되지 않았어요.";
    case "upToDate":
      return "최신 버전이에요.";
    case "available":
      return `새 버전 ${status.version}을 설치할 수 있어요.`;
    case "failed":
      return `${status.reason} 학교 네트워크에서 막혔다면 나중에 다시 확인해 주세요.`;
  }
}

export interface SettingsProps {
  theme: ThemePreference;
  onTheme(p: ThemePreference): void;
  checkUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  restart(): Promise<void>;
}

export function Settings({ theme, onTheme, checkUpdate, installUpdate, restart }: SettingsProps) {
  const s = useStyles();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "installing" | "installed">("idle");
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setPhase("checking");
    setStatus(await checkUpdate());
    setPhase("idle");
  };
  const install = async () => {
    setPhase("installing");
    try {
      await installUpdate();
      setPhase("installed");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  };

  return (
    <div className={s.page}>
      <Title3 as="h1">설정</Title3>
      <SettingsCard
        icon={<DarkThemeRegular />}
        header="테마"
        description="앱과 도구의 색 모드를 골라요."
        action={
          <Dropdown
            aria-label="테마"
            value={THEME_LABELS[theme]}
            selectedOptions={[theme]}
            onOptionSelect={(_, d) => onTheme(d.optionValue as ThemePreference)}
          >
            {(Object.keys(THEME_LABELS) as ThemePreference[]).map((k) => (
              <Option key={k} value={k}>
                {THEME_LABELS[k]}
              </Option>
            ))}
          </Dropdown>
        }
      />
      <SettingsCard
        icon={<ArrowSyncRegular />}
        header="업데이트"
        description={error ?? (phase === "installed" ? "설치했어요. 다시 시작하면 적용돼요." : describe(status))}
        action={
          phase === "installed" ? (
            <Button appearance="primary" onClick={() => void restart()}>
              다시 시작
            </Button>
          ) : status?.status === "available" ? (
            <Button appearance="primary" disabled={phase !== "idle"} onClick={() => void install()}>
              설치
            </Button>
          ) : (
            <Button disabled={phase !== "idle"} onClick={() => void check()}>
              업데이트 확인
            </Button>
          )
        }
      />
    </div>
  );
}
