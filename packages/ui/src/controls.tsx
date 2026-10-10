// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// WinUI controls on Fluent v9 (design-system.md §6). Names and props follow WinUI so a module reads
// like a Windows app: `header` is the WinUI Header label above a control. Every input control needs a
// `header` for its accessible name; pass `showHeader={false}` when a SettingsCard already shows it.
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Link,
  List,
  ListItem,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Option,
  ProgressBar as FluentProgressBar,
  Radio,
  RadioGroup,
  SpinButton,
  Spinner,
  Switch,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useCallback, type CompositionEventHandler, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { deckTokens } from "./tokens/index.ts";
import { Body, Caption } from "./typography.tsx";

/** Drops undefined values so optional props pass through under exactOptionalPropertyTypes. */
function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  list: {
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    padding: tokens.spacingVerticalXS,
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    gap: deckTokens.inlineGap,
    minHeight: deckTokens.listItemHeight,
    paddingInline: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  listEmpty: { padding: tokens.spacingVerticalL, textAlign: "center" },
});

/** Shared props of controls with a WinUI Header. */
export interface HeaderedProps {
  /** Label above the control. Also its accessible name. */
  header: string;
  /** Hide the visible header (e.g. inside a SettingsCard that already shows it). Default true. */
  showHeader?: boolean;
  /** Help text under the control. */
  description?: string;
  disabled?: boolean;
}

function fieldProps({ header, showHeader = true, description }: HeaderedProps, validationMessage?: string) {
  return defined({
    label: showHeader ? header : undefined,
    hint: description,
    validationMessage,
    validationState: validationMessage === undefined ? undefined : ("error" as const),
  });
}

/* ---------- Buttons ---------- */

export interface HyperlinkButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/** Text-styled button for secondary actions (WinUI HyperlinkButton). Modules do not open URLs. */
export function HyperlinkButton({ children, onClick, disabled }: HyperlinkButtonProps) {
  return (
    <Link as="button" onClick={onClick} {...defined({ disabled })}>
      {children}
    </Link>
  );
}

/* ---------- InfoBar ---------- */

export type InfoBarSeverity = "informational" | "success" | "warning" | "error";

export interface InfoBarProps {
  severity?: InfoBarSeverity;
  title?: string;
  /** One sentence: cause and fix for errors, result for success (UI-007). */
  message: string;
  /** A Button for the follow-up action, e.g. "다시 시도". */
  action?: ReactNode;
  /** Shows the close button when set. */
  onClose?: () => void;
}

const INTENT = { informational: "info", success: "success", warning: "warning", error: "error" } as const;

/** Inline status message at the top of a page or section (WinUI InfoBar). Use instead of toasts. */
export function InfoBar({ severity = "informational", title, message, action, onClose }: InfoBarProps) {
  const close =
    onClose === undefined ? undefined : (
      <Button appearance="transparent" icon={<DismissRegular />} aria-label="닫기" onClick={onClose} />
    );
  return (
    <MessageBar intent={INTENT[severity]} layout="multiline">
      <MessageBarBody>
        {title !== undefined && <MessageBarTitle>{title}</MessageBarTitle>}
        {message}
      </MessageBarBody>
      {(action !== undefined || close !== undefined) && (
        <MessageBarActions {...defined({ containerAction: close })}>{action}</MessageBarActions>
      )}
    </MessageBar>
  );
}

/* ---------- Progress ---------- */

export interface ProgressBarProps extends Omit<HeaderedProps, "disabled"> {
  /** 0–100. Leave undefined while the total is unknown (indeterminate). */
  value?: number;
  /** Turns the bar red with this message. */
  errorMessage?: string;
}

/** Determinate or indeterminate progress for batch work (WinUI ProgressBar). */
export function ProgressBar({ value, errorMessage, ...header }: ProgressBarProps) {
  const ratio = value === undefined ? undefined : Math.min(100, Math.max(0, value)) / 100;
  return (
    <Field {...fieldProps(header, errorMessage)}>
      <FluentProgressBar
        thickness="medium"
        aria-label={header.header}
        {...defined({ value: ratio, color: errorMessage === undefined ? undefined : ("error" as const) })}
      />
    </Field>
  );
}

export interface ProgressRingProps {
  /** What is happening, e.g. "불러오는 중". Also the accessible name. */
  label: string;
  showLabel?: boolean;
  size?: "small" | "medium" | "large";
}

/** Indeterminate busy indicator (WinUI ProgressRing). */
export function ProgressRing({ label, showLabel = true, size = "medium" }: ProgressRingProps) {
  return showLabel ? <Spinner size={size} label={label} /> : <Spinner size={size} aria-label={label} />;
}

/* ---------- ContentDialog ---------- */

export type ContentDialogResult = "primary" | "secondary" | "none";

export interface ContentDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Main action, e.g. "덮어쓰기". */
  primaryButtonText?: string;
  secondaryButtonText?: string;
  /** Cancel button, e.g. "취소". Escape does the same. */
  closeButtonText: string;
  /** Accent-styled button. Default "primary"; use "close" for destructive primaries (PRV-006). */
  defaultButton?: "primary" | "secondary" | "close";
  /** Called once with the pressed button; "none" for close/Escape. Set `open` to false here. */
  onClose: (result: ContentDialogResult) => void;
}

/** Modal confirmation (WinUI ContentDialog). Buttons are Primary, Secondary, Close from left to right. */
export function ContentDialog({
  open,
  title,
  children,
  primaryButtonText,
  secondaryButtonText,
  closeButtonText,
  defaultButton = "primary",
  onClose,
}: ContentDialogProps) {
  const look = (b: "primary" | "secondary" | "close") => (b === defaultButton ? "primary" : "secondary");
  return (
    <Dialog open={open} modalType="modal" onOpenChange={(_, d) => !d.open && onClose("none")}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions fluid>
            {primaryButtonText !== undefined && (
              <Button appearance={look("primary")} onClick={() => onClose("primary")}>
                {primaryButtonText}
              </Button>
            )}
            {secondaryButtonText !== undefined && (
              <Button appearance={look("secondary")} onClick={() => onClose("secondary")}>
                {secondaryButtonText}
              </Button>
            )}
            <Button appearance={look("close")} onClick={() => onClose("none")}>
              {closeButtonText}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/* ---------- Inputs ---------- */

export interface NumberBoxProps extends HeaderedProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  validationMessage?: string;
}

/** Number input with spin buttons; out-of-range values are clamped (WinUI NumberBox). */
export function NumberBox({ value, onChange, min, max, step = 1, validationMessage, ...header }: NumberBoxProps) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <Field {...fieldProps(header, validationMessage)}>
      <SpinButton
        value={value}
        step={step}
        aria-label={header.header}
        {...defined({ min, max, disabled: header.disabled })}
        onChange={(_, d) => {
          const n = d.value ?? Number(d.displayValue);
          if (d.value !== null && Number.isFinite(n)) onChange(clamp(n));
        }}
      />
    </Field>
  );
}

export interface TextBoxProps extends HeaderedProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Multi-line input (Textarea). */
  multiline?: boolean;
  validationMessage?: string;
  /** Selectable output without allowing edits. */
  readOnly?: boolean;
  /** Focus and selection target is the actual text input, including multi-line inputs. */
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onCompositionStart?: CompositionEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onCompositionEnd?: CompositionEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}

/** Single- or multi-line text input (WinUI TextBox). */
export function TextBox({
  value,
  onChange,
  placeholder,
  multiline = false,
  validationMessage,
  readOnly,
  inputRef,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...header
}: TextBoxProps) {
  const setInputRef = useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (typeof inputRef === "function") return inputRef(element);
      if (inputRef !== undefined && inputRef !== null) inputRef.current = element;
      return undefined;
    },
    [inputRef],
  );
  const common = {
    value,
    "aria-label": header.header,
    ...defined({ placeholder, disabled: header.disabled, readOnly, onKeyDown, onCompositionStart, onCompositionEnd }),
  };
  return (
    <Field {...fieldProps(header, validationMessage)}>
      {multiline ? (
        <Textarea {...common} ref={setInputRef} resize="vertical" onChange={(_, d) => onChange(d.value)} />
      ) : (
        <Input {...common} ref={setInputRef} onChange={(_, d) => onChange(d.value)} />
      )}
    </Field>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface ComboBoxProps<T extends string> extends HeaderedProps {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Pick one of several options from a dropdown (WinUI ComboBox, non-editable). */
export function ComboBox<T extends string>({ options, value, onChange, ...header }: ComboBoxProps<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <Field {...fieldProps(header)}>
      <Dropdown
        aria-label={header.header}
        value={current?.label ?? ""}
        selectedOptions={[value]}
        {...defined({ disabled: header.disabled })}
        onOptionSelect={(_, d) => {
          const next = options.find((o) => o.value === d.optionValue);
          if (next !== undefined) onChange(next.value);
        }}
      >
        {options.map((o) => (
          <Option key={o.value} value={o.value}>
            {o.label}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}

export interface RadioButtonsProps<T extends string> extends HeaderedProps {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Pick one of 2–5 visible options (WinUI RadioButtons). Use ComboBox for more. */
export function RadioButtons<T extends string>({ options, value, onChange, ...header }: RadioButtonsProps<T>) {
  return (
    <Field {...fieldProps(header)}>
      <RadioGroup
        value={value}
        aria-label={header.header}
        {...defined({ disabled: header.disabled })}
        onChange={(_, d) => {
          const next = options.find((o) => o.value === d.value);
          if (next !== undefined) onChange(next.value);
        }}
      >
        {options.map((o) => (
          <Radio key={o.value} value={o.value} label={o.label} />
        ))}
      </RadioGroup>
    </Field>
  );
}

export interface ToggleSwitchProps extends HeaderedProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** State text. Defaults "켬"/"끔" like Windows Settings. */
  onContent?: string;
  offContent?: string;
}

/** On/off setting that applies immediately (WinUI ToggleSwitch). */
export function ToggleSwitch({ checked, onChange, onContent = "켬", offContent = "끔", ...header }: ToggleSwitchProps) {
  const s = useStyles();
  const { header: name, showHeader = true, description, disabled } = header;
  return (
    <div className={s.stack}>
      {showHeader && <Body>{name}</Body>}
      <Switch
        checked={checked}
        aria-label={name}
        label={checked ? onContent : offContent}
        labelPosition={showHeader ? "after" : "before"}
        {...defined({ disabled })}
        onChange={(_, d) => onChange(d.checked)}
      />
      {description !== undefined && <Caption secondary>{description}</Caption>}
    </div>
  );
}

export interface CheckBoxProps {
  /** Text next to the box. Also the accessible name. */
  content: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Opt-in choice, often one of several (WinUI CheckBox). */
export function CheckBox({ content, checked, onChange, disabled }: CheckBoxProps) {
  return (
    <Checkbox
      label={content}
      checked={checked}
      {...defined({ disabled })}
      onChange={(_, d) => onChange(d.checked === true)}
    />
  );
}

/* ---------- ListView ---------- */

export interface ListViewProps<T> {
  /** Accessible name of the list, e.g. "선택한 파일". */
  header: string;
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Default "none". */
  selectionMode?: "none" | "single" | "multiple";
  selectedKeys?: readonly string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Shown when `items` is empty; tell the user what to do (UI-007). */
  emptyText?: string;
}

/** Vertical list of rows, e.g. input files and their results (WinUI ListView). */
export function ListView<T>({
  header,
  items,
  getKey,
  renderItem,
  selectionMode = "none",
  selectedKeys,
  onSelectionChange,
  emptyText,
}: ListViewProps<T>) {
  const s = useStyles();
  if (items.length === 0 && emptyText !== undefined) {
    return (
      <div className={mergeClasses(s.list, s.listEmpty)} role="list" aria-label={header}>
        <Body secondary>{emptyText}</Body>
      </div>
    );
  }
  const selection =
    selectionMode === "none"
      ? {}
      : {
          selectionMode: selectionMode === "single" ? ("single" as const) : ("multiselect" as const),
          selectedItems: [...(selectedKeys ?? [])],
          onSelectionChange: (_: unknown, d: { selectedItems: (string | number)[] }) =>
            onSelectionChange?.(d.selectedItems.map(String)),
        };
  return (
    <List className={s.list} aria-label={header} navigationMode="items" {...selection}>
      {items.map((item) => {
        const key = getKey(item);
        return (
          <ListItem key={key} value={key} className={s.listItem}>
            {renderItem(item)}
          </ListItem>
        );
      })}
    </List>
  );
}
