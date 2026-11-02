// A list typed or pasted as steps: one step per line, with the marks lists come with (bullets,
// numbers, checkboxes, Markdown headings) taken off and blank lines dropped.
export function parseStepList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(?:[-*+•–]|\d+[.)])\s+/, "")
        .replace(/^\[[ xX]?\]\s*/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}
