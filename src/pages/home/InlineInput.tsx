import { useState } from "react";

type InlineInputProps = {
  placeholder: string;
  onSubmit: (value: string) => unknown;
  onEscape?: () => void;
  onPasteList?: (text: string) => void; // a paste of several lines, instead of filling the field
  autoFocus?: boolean;
  className?: string;
};

// A one-line input that submits on Enter and clears itself for the next entry
export function InlineInput({ placeholder, onSubmit, onEscape, onPasteList, autoFocus = false, className = "" }: InlineInputProps) {
  const [value, setValue] = useState("");

  return (
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text");
        if (!onPasteList || !/\n/.test(text.trim())) return;
        event.preventDefault();
        // The list goes where the caret is, over any selected text, as a paste would
        const { selectionStart, selectionEnd } = event.currentTarget;
        onPasteList(value.slice(0, selectionStart ?? value.length) + text + value.slice(selectionEnd ?? value.length));
        setValue("");
      }}
      onKeyDown={(event) => {
        // Not while an input method is composing: its Enter picks a word, it doesn't send
        if (event.key === "Enter" && !event.nativeEvent.isComposing && value.trim()) {
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
