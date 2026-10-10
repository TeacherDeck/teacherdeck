// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Dev-only UI gallery (design-system.md §6): every @deck/ui component in light/dark and at 150% text.
// SAMPLES is typed by @deck/ui COMPONENTS, so a new component that is not registered here fails
// typecheck (packages/ui/AGENTS.md).
import { ClockRegular, DocumentRegular, FolderRegular, InfoRegular, TextBoldRegular } from "@fluentui/react-icons";
import {
  Body,
  BodyStrong,
  Button,
  COMPONENTS,
  Caption,
  CapabilityGate,
  CheckBox,
  ComboBox,
  ContentDialog,
  DeckProvider,
  Display,
  DropZone,
  EmptyState,
  HyperlinkButton,
  InfoBar,
  ListView,
  NumberBox,
  PageHeader,
  ProgressBar,
  ProgressRing,
  RadioButtons,
  SettingsCard,
  SettingsExpander,
  SettingsGroup,
  Subtitle,
  TextBox,
  Title,
  TitleLarge,
  ToggleButton,
  ToggleSwitch,
  ToolLayout,
  Tooltip,
  createDeckTheme,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { type ReactNode, useState } from "react";

type ComponentName = (typeof COMPONENTS)[number];

const CASES = [
  { value: "keep", label: "그대로" },
  { value: "upper", label: "대문자" },
  { value: "lower", label: "소문자" },
] as const;
type Case = (typeof CASES)[number]["value"];

function DialogSample() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState("없음");
  return (
    <>
      <Button onClick={() => setOpen(true)}>대화상자 열기</Button>
      <Caption secondary>마지막 결과: {last}</Caption>
      <ContentDialog
        open={open}
        title="원본을 덮어쓸까요?"
        primaryButtonText="덮어쓰기"
        secondaryButtonText="새 파일로 저장"
        closeButtonText="취소"
        defaultButton="secondary"
        onClose={(r) => {
          setLast(r);
          setOpen(false);
        }}
      >
        덮어쓰면 되돌릴 수 없어요.
      </ContentDialog>
    </>
  );
}

function InputsSample({ kind }: { kind: "text" | "number" | "combo" | "radio" | "toggle" | "check" }) {
  const [text, setText] = useState("");
  const [num, setNum] = useState(5);
  const [choice, setChoice] = useState<Case>("keep");
  const [on, setOn] = useState(true);
  switch (kind) {
    case "text":
      return (
        <TextBox
          header="이름 규칙"
          placeholder="예: {번호}_{이름}"
          value={text}
          onChange={setText}
          description="{번호}는 1부터 매겨요."
        />
      );
    case "number":
      return <NumberBox header="분" value={num} min={1} max={180} onChange={setNum} />;
    case "combo":
      return <ComboBox header="대소문자" options={CASES} value={choice} onChange={setChoice} />;
    case "radio":
      return <RadioButtons header="대소문자" options={CASES} value={choice} onChange={setChoice} />;
    case "toggle":
      return <ToggleSwitch header="알림 소리" checked={on} onChange={setOn} />;
    case "check":
      return <CheckBox content="하위 폴더 포함" checked={on} onChange={setOn} />;
  }
}

function ListSample() {
  const files = ["가정통신문.hwp", "시간표.xlsx", "사진_001.jpg"];
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <ListView
        header="선택한 파일"
        items={files}
        getKey={(f) => f}
        renderItem={(f) => <Body>{f}</Body>}
        selectionMode="multiple"
        selectedKeys={selected}
        onSelectionChange={setSelected}
      />
      <ListView header="빈 목록" items={[]} getKey={String} renderItem={String} emptyText="파일을 추가해 주세요." />
    </>
  );
}

const SAMPLES: Record<ComponentName, () => ReactNode> = {
  DeckProvider: () => <Body>DeckProvider: 이 미리보기 전체를 감싸고 있어요.</Body>,
  PageHeader: () => <PageHeader title="파일명 일괄 변환" description="여러 파일의 이름을 한 번에 바꿔요." />,
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
  SettingsGroup: () => (
    <SettingsGroup header="동작">
      <SettingsCard
        icon={<ClockRegular />}
        header="알림 소리"
        description="끝나면 소리로 알려요."
        action={<ToggleSwitch header="알림 소리" showHeader={false} checked onChange={() => undefined} />}
      />
      <SettingsCard
        icon={<InfoRegular />}
        header="정보"
        description="버전과 라이선스를 봐요."
        onClick={() => undefined}
      />
    </SettingsGroup>
  ),
  SettingsCard: () => (
    <SettingsCard
      icon={<ClockRegular />}
      header="알림 소리"
      description="끝나면 소리로 알려요."
      action={<ToggleSwitch header="알림 소리" showHeader={false} checked={false} onChange={() => undefined} />}
    />
  ),
  SettingsExpander: () => (
    <SettingsExpander
      icon={<DocumentRegular />}
      header="고급 설정"
      description="자주 쓰지 않는 옵션이에요."
      defaultExpanded
    >
      <SettingsCard
        header="하위 폴더 포함"
        action={<ToggleSwitch header="하위 폴더 포함" showHeader={false} checked onChange={() => undefined} />}
      />
      <SettingsCard
        header="숨김 파일 건너뛰기"
        action={
          <ToggleSwitch header="숨김 파일 건너뛰기" showHeader={false} checked={false} onChange={() => undefined} />
        }
      />
    </SettingsExpander>
  ),
  CapabilityGate: () => (
    <CapabilityGate deck={{ has: () => false }} cap="ocr" feature="글자 인식">
      <span>보이지 않아야 해요</span>
    </CapabilityGate>
  ),
  EmptyState: () => (
    <EmptyState
      icon={<DocumentRegular />}
      title="파일이 없어요"
      description="파일을 끌어 놓거나 '파일 선택'을 눌러 주세요."
    />
  ),
  DropZone: () => <DropZone active description="한 번에 여러 개를 놓을 수 있어요." />,
  Caption: () => <Caption>Caption 12/16</Caption>,
  Body: () => <Body>Body 14/20 본문이에요.</Body>,
  BodyStrong: () => <BodyStrong>BodyStrong 14/20</BodyStrong>,
  Subtitle: () => <Subtitle>Subtitle 20/26</Subtitle>,
  Title: () => <Title>Title 28/36</Title>,
  TitleLarge: () => <TitleLarge>TitleLarge 40/52</TitleLarge>,
  Display: () => <Display>05:00</Display>,
  Button: () => (
    <div>
      <Button appearance="primary">변환</Button> <Button>취소</Button>{" "}
      <Button appearance="subtle" icon={<FolderRegular />} aria-label="폴더 열기" />
    </div>
  ),
  ToggleButton: () => <ToggleButton icon={<TextBoldRegular />}>굵게</ToggleButton>,
  HyperlinkButton: () => <HyperlinkButton onClick={() => undefined}>자세히 보기</HyperlinkButton>,
  Tooltip: () => (
    <Tooltip content="폴더를 열어요" relationship="label">
      <Button icon={<FolderRegular />} />
    </Tooltip>
  ),
  InfoBar: () => (
    <>
      <InfoBar severity="success" message="3개 파일을 변환했어요." onClose={() => undefined} />
      <InfoBar
        severity="error"
        title="변환하지 못했어요"
        message="파일이 다른 프로그램에서 열려 있어요. 닫고 다시 시도해 주세요."
        action={<Button>다시 시도</Button>}
      />
    </>
  ),
  ProgressBar: () => (
    <>
      <ProgressBar header="변환 중 (2/5)" value={40} />
      <ProgressBar header="파일 목록을 읽는 중" />
    </>
  ),
  ProgressRing: () => <ProgressRing label="불러오는 중" />,
  ContentDialog: () => <DialogSample />,
  TextBox: () => <InputsSample kind="text" />,
  NumberBox: () => <InputsSample kind="number" />,
  ComboBox: () => <InputsSample kind="combo" />,
  RadioButtons: () => <InputsSample kind="radio" />,
  ToggleSwitch: () => <InputsSample kind="toggle" />,
  CheckBox: () => <InputsSample kind="check" />,
  ListView: () => <ListSample />,
};

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: deckTokens.itemGap },
  item: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM },
  large: { fontSize: tokens.fontSizeBase500 },
});

export function Gallery() {
  const s = useStyles();
  const [large, setLarge] = useState(false);
  return (
    <div className={s.page}>
      <Title as="h1">UI 갤러리</Title>
      <ToggleSwitch header="텍스트 150%" checked={large} onChange={setLarge} />
      {COMPONENTS.map((name) => (
        <section key={name} aria-label={name}>
          <Subtitle as="h2">{name}</Subtitle>
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
