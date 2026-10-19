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
      className={`nodrag nopan rounded-lg border border-white/10 bg-night/70 px-3 py-1.5 text-xs tracking-[0.06em] text-white/85 placeholder:text-white/40 focus:border-white/30 focus:outline-none ${className}`}
    />
  );
}
