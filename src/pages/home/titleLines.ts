// How many lines a card's title wraps to. Layout sizes the cards before they are drawn, so it reads
// each title from a hidden copy, set in the same classes at the width the title will get: that
// wraps exactly as the browser will. Results are kept per (classes, width, text).

export const titleMaxLines = 3;

export type TitleText = { text: string; className: string; width: number };

const lines = new Map<string, number>();
const widths = new Map<string, number>();
let probe: HTMLDivElement | null = null;

// The fonts the cards' titles and labels are set in. Measures taken before they load are dropped,
// and the graph lays out again.
export const fontsLoaded: Promise<void> = Promise.all(
  ["14px VT323", "400 12.5px 'Martian Mono'", "500 12.5px 'Martian Mono'", "600 10px 'Martian Mono'"].map((font) => document.fonts.load(font)),
).then(
  () => {
    lines.clear();
    widths.clear();
  },
  () => undefined,
);

// Measures every title not yet known in one layout pass
export function measureTitles(titles: TitleText[]) {
  const wanted = new Map<string, TitleText>();
  titles.forEach((title) => {
    const key = keyOf(title);
    if (!lines.has(key)) wanted.set(key, title);
  });
  if (wanted.size === 0) return;

  const container = probeContainer();
  // Per title, a copy of it and one line of the same type, whose height is the line height
  const copies = [...wanted].map(([key, { text, className, width }]) => {
    const copy = element(className, text, width);
    const line = element(className, "x", width);
    container.append(copy, line);
    return { key, copy, line };
  });
  copies.forEach(({ key, copy, line }) => lines.set(key, Math.min(titleMaxLines, Math.max(1, Math.round(copy.offsetHeight / line.offsetHeight)))));
  container.replaceChildren();
}

export function titleLines(title: TitleText): number {
  measureTitles([title]);
  return lines.get(keyOf(title))!;
}

// The height of one line of text in these classes
export function lineHeight(className: string): number {
  const key = `line|${className}`;
  if (!widths.has(key)) {
    const line = probeContainer().appendChild(element(className, "x", 100));
    widths.set(key, line.offsetHeight);
    line.remove();
  }
  return widths.get(key)!;
}

// The width of a short label, such as a pill, drawn in these classes
export function labelWidth(className: string, text: string): number {
  const key = `${className}|${text}`;
  if (!widths.has(key)) {
    const label = probeContainer().appendChild(element(className, text, null));
    widths.set(key, label.getBoundingClientRect().width);
    label.remove();
  }
  return widths.get(key)!;
}

const keyOf = ({ text, className, width }: TitleText) => `${className}|${width}|${text}`;

// A block of the given width, or a label as wide as its text when the width is null
function element(className: string, text: string, width: number | null) {
  const block = document.createElement("div");
  block.className = className;
  block.textContent = text;
  block.style.cssText = width === null ? "display:inline-block;width:max-content" : `display:block;width:${width}px`;
  return block;
}

// Off screen and contained, so measuring lays out only its own copies
function probeContainer() {
  if (!probe) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;contain:strict";
    document.body.append(probe);
  }
  return probe;
}
