// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Dev-only UI gallery (design-system.md §6): every @deck/ui component in light/dark and at 150% text.
// SAMPLES is typed by @deck/ui COMPONENTS, so a new component that is not registered here fails
// typecheck (packages/ui/AGENTS.md).
import { Button, Switch, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { ClockRegular, DocumentRegular } from "@fluentui/react-icons";
import {
  COMPONENTS,
  CapabilityGate,
  DeckProvider,
  DropZone,
  EmptyState,
  SettingsCard,
  SettingsExpander,
  ToolLayout,
  createDeckTheme,
  deckTokens,
} from "@deck/ui";
import { type ReactNode, useState } from "react";

type ComponentName = (typeof COMPONENTS)[number];

const SAMPLES: Record<ComponentName, () => ReactNode> = {
  DeckProvider: () => <span>DeckProvider: 이 미리보기 전체를 감싸고 있어요.</span>,
  ToolLayout: () => (
    <ToolLayout title="파일명 일괄 변환" description="여러 파일의 이름을 한 번에 바꿔요.">
      <ToolLayout.Section step="input" title="입력">
        <DropZone onPick={() => undefined} />
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="실행">
        <Button appearance="primary">변환</Button>
      </ToolLayout.Section>
    </ToolLayout>
  ),
  SettingsCard: () => <SettingsCard icon={<ClockRegular />} header="알림 소리" description="끝나면 소리로 알려요." action={<Switch />} />,
  SettingsExpander: () => (
    <SettingsExpander icon={<DocumentRegular />} header="고급 설정" description="자주 쓰지 않는 옵션이에요." defaultExpanded>
      <SettingsCard header="하위 항목" />
    </SettingsExpander>
  ),
  CapabilityGate: () => (
    <CapabilityGate deck={{ has: () => false }} cap="ocr" feature="글자 인식">
      <span>보이지 않아야 해요</span>
    </CapabilityGate>
  ),
  EmptyState: () => <EmptyState icon={<DocumentRegular />} title="파일이 없어요" description="파일을 끌어 놓거나 '파일 선택'을 눌러 주세요." />,
  DropZone: () => <DropZone active description="한 번에 여러 개를 놓을 수 있어요." />,
};

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: deckTokens.itemGap },
  item: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM },
  large: { fontSize: tokens.fontSizeBase500 },
});

export function Gallery() {
  const s = useStyles();
  const [large, setLarge] = useState(false);
  return (
    <div className={s.page}>
      <Title3 as="h1">UI 갤러리</Title3>
      <Switch label="텍스트 150%" checked={large} onChange={(_, d) => setLarge(d.checked)} />
      {COMPONENTS.map((name) => (
        <section key={name} aria-label={name}>
          <Title3 as="h2">{name}</Title3>
          <div className={s.grid}>
            {(["light", "dark"] as const).map((mode) => (
              <DeckProvider key={mode} theme={createDeckTheme(mode)} mica={false}>
                <div className={large ? `${s.item} ${s.large}` : s.item}>{SAMPLES[name]()}</div>
              </DeckProvider>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
