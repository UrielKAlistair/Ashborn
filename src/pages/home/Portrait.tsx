import { useEffect, useRef } from "react";

// The character's portrait for a sprite tier. A tier with an idle sheet plays it; the others show
// their still. Sprites are found by file name: base_sprites/<tier>.png and Idle_sheets/lvl_<tier>.png.
// An idle sheet is a grid of SHEET_CELL-pixel cells read left to right, top to bottom; empty cells
// are skipped. A still is a sheet of one cell. Only pixels above HAZE_ALPHA count as the figure.
//
// Every tier is drawn at one scale, so a taller figure stands taller, and centred on its body:
// the median column of its opaque pixels, which a thin staff barely moves.

const SHEET_CELL = 256;
const FRAMES_PER_SECOND = 8;
const SHEET_SCALE = 0.9; // CSS pixels per sheet pixel
// The stills are drawn larger: tier 1's figure is 1057 pixels tall in its still, 142 in its sheet
const STILL_SCALE = (SHEET_SCALE * 142) / 1057;
// Pixels at most this opaque (of 255) are the faint haze around the stills, not the figure
const HAZE_ALPHA = 40;

const stills = byTier(import.meta.glob<string>("../../assets/base_sprites/*.png", { eager: true, import: "default" }), /(\d+)\.png$/);
const idleSheets = byTier(import.meta.glob<string>("../../assets/Idle_sheets/*.png", { eager: true, import: "default" }), /lvl_(\d+)\.png$/);

export const portraitTiers = Math.max(...Object.keys(stills).map(Number));

// The portrait advances one sprite tier every PORTRAIT_TIER_LEVELS overall levels
const PORTRAIT_TIER_LEVELS = 5;
export const portraitTier = (level: number) => Math.min(portraitTiers, Math.floor((level - 1) / PORTRAIT_TIER_LEVELS) + 1);

// `zoom` enlarges the figure beyond its usual size (the phone's character screen)
export function Portrait({ tier, zoom = 1 }: { tier: number; zoom?: number }) {
  const { src, cell, scale } = figureOf(tier);
  return <Figure key={src} src={src} cell={cell} scale={scale * zoom} />;
}

// Loads and reads a tier's sheet ahead of its first showing (a sheet is a megapixel image, slow
// to read on a phone)
export function preparePortrait(tier: number) {
  const { src, cell } = figureOf(tier);
  void prepare(src, cell);
}

function figureOf(tier: number) {
  const sheet = idleSheets[tier];
  return sheet ? { src: sheet, cell: SHEET_CELL, scale: SHEET_SCALE } : { src: stills[tier], cell: null, scale: STILL_SCALE };
}

type Prepared = { image: HTMLImageElement } & ReturnType<typeof readSheet>;
// Each image is loaded and read once per run of the app
const prepared = new Map<string, Promise<Prepared>>();

function prepare(src: string, cell: number | null): Promise<Prepared> {
  let figure = prepared.get(src);
  if (!figure) {
    const image = new Image();
    image.src = src;
    figure = image.decode().then(() => ({ image, ...readSheet(image, cell ?? image.width, cell ?? image.height) }));
    prepared.set(src, figure);
  }
  return figure;
}

// Plays the sheet's frames on a canvas (one frame for a still); `cell` null means the whole image
function Figure({ src, cell, scale }: { src: string; cell: number | null; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frameRequest = 0;
    let timer = 0;
    let gone = false;
    void prepare(src, cell).then(({ image, frames, crop, centre }) => {
      if (gone) return;
      // Wide enough on both sides of the body's centre that the centre is the canvas's middle
      const half = Math.max(centre - crop.x, crop.x + crop.width - centre);
      const canvas = canvasRef.current!;
      canvas.width = Math.ceil(2 * half);
      canvas.height = crop.height;
      canvas.style.width = `${canvas.width * scale}px`;
      canvas.style.height = `${canvas.height * scale}px`;
      const context = canvas.getContext("2d")!;
      const left = half - (centre - crop.x);
      const start = performance.now();
      const frameMs = 1000 / FRAMES_PER_SECOND;
      let shown = -1;
      const draw = (now: number) => {
        const elapsed = now - start;
        const frame = Math.floor(elapsed / frameMs) % frames.length;
        if (frame !== shown) {
          const at = frames[frame];
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, at.x + crop.x, at.y + crop.y, crop.width, crop.height, left, 0, crop.width, crop.height);
          shown = frame;
        }
        // Sleeps until the next frame is due rather than waking at every display refresh
        if (frames.length > 1) timer = window.setTimeout(() => (frameRequest = requestAnimationFrame(draw)), frameMs - (elapsed % frameMs));
      };
      frameRequest = requestAnimationFrame(draw);
    });
    return () => {
      gone = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(frameRequest);
    };
  }, [src, cell, scale]);

  // Enlarged pixel art stays crisp rather than blurred
  return <canvas ref={canvasRef} aria-hidden="true" className={scale > 1 ? "[image-rendering:pixelated]" : undefined} />;
}

// The cells holding a figure, in reading order; the smallest box (relative to a cell) holding the figure
// in every one of them; and the median column of the opaque pixels across all frames
function readSheet(image: HTMLImageElement, cellWidth: number, cellHeight: number) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;

  const frames: { x: number; y: number }[] = [];
  const columns = new Float64Array(cellWidth);
  let [left, top, right, bottom] = [cellWidth, cellHeight, 0, 0];
  for (let y = 0; y + cellHeight <= image.height; y += cellHeight) {
    for (let x = 0; x + cellWidth <= image.width; x += cellWidth) {
      let found = false;
      for (let py = 0; py < cellHeight; py++) {
        const row = ((y + py) * image.width + x) * 4 + 3;
        for (let px = 0; px < cellWidth; px++) {
          const alpha = pixels[row + px * 4];
          if (alpha <= HAZE_ALPHA) continue;
          if (px < left) left = px;
          if (px >= right) right = px + 1;
          if (py < top) top = py;
          if (py >= bottom) bottom = py + 1;
          columns[px] += alpha;
          found = true;
        }
      }
      if (found) frames.push({ x, y });
    }
  }

  const total = columns.reduce((sum, weight) => sum + weight, 0);
  let centre = 0;
  for (let seen = 0; seen < total / 2; centre++) seen += columns[centre];

  return { frames, crop: { x: left, y: top, width: right - left, height: bottom - top }, centre };
}

function byTier(files: Record<string, string>, pattern: RegExp): Record<number, string> {
  return Object.fromEntries(Object.entries(files).map(([path, url]) => [Number(pattern.exec(path)![1]), url]));
}
