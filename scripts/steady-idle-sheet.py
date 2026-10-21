"""Removes frame-to-frame colour flicker from an idle sheet by rebuilding every frame from the
first one by motion, so colour can only travel with the figure and never change on the spot.

For each frame and pixel, the shift (up to RADIUS pixels each way) is chosen whose PATCH x PATCH
neighbourhood of frame 1 best matches the frame there, plus SHIFT_COST per pixel of shift. The
pixel takes frame 1's colour from that shifted spot; where even the best match is more than
NEW_CONTENT (of 255, any channel) off, the frame keeps its own pixel. Frames are read like the app
reads them (src/pages/home/Portrait.tsx): CELL-pixel cells, row by row, empty cells skipped.

Needs numpy, scipy and Pillow (Fedora: sudo dnf install python3-numpy python3-scipy python3-pillow).
  python3 scripts/steady-idle-sheet.py <sheet.png> <out.png>
"""
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

CELL = 256
HAZE_ALPHA = 40  # pixels at most this opaque don't mark a cell as holding a frame
RADIUS = 2
PATCH = 5
SHIFT_COST = 1.5  # in mean absolute difference per channel, of 255
NEW_CONTENT = 48


def main():
    sheet_path, out_path = sys.argv[1:]
    sheet = np.asarray(Image.open(sheet_path).convert("RGBA")).astype(np.float32)
    corners = frame_corners(sheet)
    frames = [sheet[y:y + CELL, x:x + CELL] for x, y in corners]

    reference = frames[0]
    shifts = [(dy, dx) for dy in range(-RADIUS, RADIUS + 1) for dx in range(-RADIUS, RADIUS + 1)]
    moved = [np.roll(reference, (-dy, -dx), axis=(0, 1)) for dy, dx in shifts]  # moved[p] = reference[p + shift]
    moved_premultiplied = [premultiplied(m) for m in moved]

    out = sheet.copy()
    kept = 0
    for (x, y), frame in zip(corners, frames):
        target = premultiplied(frame)
        costs = np.stack([uniform_filter(np.abs(target - m).mean(-1), PATCH) + SHIFT_COST * (abs(dy) + abs(dx))
                          for m, (dy, dx) in zip(moved_premultiplied, shifts)])
        rebuilt = np.choose(costs.argmin(0)[..., None], moved)
        new = np.abs(rebuilt - frame).max(-1) > NEW_CONTENT
        rebuilt[new] = frame[new]
        kept += new.sum()
        out[y:y + CELL, x:x + CELL] = rebuilt
    Image.fromarray(out.round().astype(np.uint8)).save(out_path)
    print(f"{len(corners)} frames; pixels kept as new content: {kept / len(corners):.0f} per frame")


# Top-left corners of the cells holding a figure, in reading order
def frame_corners(sheet):
    height, width = sheet.shape[:2]
    return [(x, y) for y in range(0, height - CELL + 1, CELL) for x in range(0, width - CELL + 1, CELL)
            if (sheet[y:y + CELL, x:x + CELL, 3] > HAZE_ALPHA).any()]


# Colour weighted by opacity, so the colour of a nearly transparent pixel barely counts
def premultiplied(frame):
    return np.concatenate([frame[..., :3] * frame[..., 3:] / 255, frame[..., 3:]], axis=-1)


if __name__ == "__main__":
    main()
