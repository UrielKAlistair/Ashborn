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

// `zoom` enlarges the figure beyond its usual size (the phone's character screen)
export function Portrait({ tier, zoom = 1 }: { tier: number; zoom?: number }) {
  const sheet = idleSheets[tier];
  return sheet ? (
    <Figure key={sheet} src={sheet} cell={SHEET_CELL} scale={SHEET_SCALE * zoom} />
  ) : (
    <Figure key={stills[tier]} src={stills[tier]} cell={null} scale={STILL_SCALE * zoom} />
  );
}

// Plays the sheet's frames on a canvas (one frame for a still); `cell` null means the whole image
function Figure({ src, cell, scale }: { src: string; cell: number | null; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frameRequest = 0;
    const image = new Image();
    image.onload = () => {
      const { frames, crop, centre } = readSheet(image, cell ?? image.width, cell ?? image.height);
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
      let shown = -1;
      const draw = (now: number) => {
        const frame = Math.floor(((now - start) / 1000) * FRAMES_PER_SECOND) % frames.length;
        if (frame !== shown) {
          const at = frames[frame];
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, at.x + crop.x, at.y + crop.y, crop.width, crop.height, left, 0, crop.width, crop.height);
          shown = frame;
        }
        if (frames.length > 1) frameRequest = requestAnimationFrame(draw);
      };
      frameRequest = requestAnimationFrame(draw);
    };
    image.src = src;
    return () => {
      image.onload = null;
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

  const frames: { x: number; y: number }[] = [];
  const columns = new Float64Array(cellWidth);
  let [left, top, right, bottom] = [cellWidth, cellHeight, 0, 0];
  for (let y = 0; y + cellHeight <= image.height; y += cellHeight) {
    for (let x = 0; x + cellWidth <= image.width; x += cellWidth) {
      const pixels = context.getImageData(x, y, cellWidth, cellHeight).data;
      let found = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] <= HAZE_ALPHA) continue;
        const pixel = (i - 3) / 4;
        const [px, py] = [pixel % cellWidth, Math.floor(pixel / cellWidth)];
        [left, top, right, bottom] = [Math.min(left, px), Math.min(top, py), Math.max(right, px + 1), Math.max(bottom, py + 1)];
        columns[px] += pixels[i];
        found = true;
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
