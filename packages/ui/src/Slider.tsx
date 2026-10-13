// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Field, Slider as FluentSlider } from "@fluentui/react-components";
import type { HeaderedProps } from "./controls.tsx";

export interface SliderProps extends HeaderedProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  onCommit?: () => void;
}
/** WinUI Slider; Fluent supplies focus, Home/End and arrow-key behavior. */
export function Slider({
  header,
  showHeader = true,
  description,
  disabled = false,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: SliderProps) {
  return (
    <Field {...(showHeader ? { label: `${header} (${value})` } : {})} {...(description ? { hint: description } : {})}>
      <FluentSlider
        aria-label={header}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(_, data) => onChange(data.value)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </Field>
  );
}
