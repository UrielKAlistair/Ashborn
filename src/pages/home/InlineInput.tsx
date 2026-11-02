import { useState } from "react";

type InlineInputProps = {
  placeholder: string;
  onSubmit: (value: string) => unknown;
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
};

// A one-line input that submits on Enter and clears itself for the next entry
export function InlineInput({ placeholder, onSubmit, onEscape, autoFocus = false, className = "" }: InlineInputProps) {
  const [value, setValue] = useState("");

  return (
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && value.trim()) {
          onSubmit(value.trim());
          setValue("");
        }
        if (event.key === "Escape" && onEscape) {
          event.preventDefault();
          onEscape();
        }
      }}
      className={`nodrag nopan rounded-lg border border-ink/10 bg-canvas/60 px-3 py-1.5 text-[13px] text-ink/85 placeholder:text-muted focus:border-ember/50 focus:outline-none ${className}`}
    />
  );
}
