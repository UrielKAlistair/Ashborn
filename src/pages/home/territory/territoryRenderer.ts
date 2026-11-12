import type { Hue } from "../../../lib/theme";
import { fabricOpacity, territoryCellRadius, territoryReach } from "./territoryGrid";
import type { CellLook, Grid, TerritoryQuest } from "./territoryGrid";

// The fabric and the territories, drawn by the GPU (WebGL 1) in one pass over the canvas.
// For each pixel the fragment shader finds the hex cell it falls in and draws the fabric's outline.
// For a cell some quest owns, it reads the owner's box (one texel pair per quest) and works out the
// pixel's own distance from that box, so a territory's light falls off smoothly from its card rather
// than in steps per cell; the theme decides how that light is drawn. Each frame
// the page sends only the camera. A cell changing owner fades from its old paint to its new one;
// that fade is computed here and the (small) paint texture re-uploaded each frame while it runs. Nothing
// is drawn while nothing changes.

const paintFadeMs = 200;
const focusFadeMs = 150;
const maxPixelRatio = 2;

const vertexShader = `
attribute vec2 a_corner;
void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }
`;

const fragmentShader = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_size;        // canvas, CSS pixels
uniform float u_ratio;      // device pixels per CSS pixel
uniform vec3 u_camera;      // x, y, zoom: screen = map * zoom + (x, y)
uniform float u_radius;     // a cell's circumradius, map units
uniform vec4 u_fabric;      // rgb, alpha
uniform vec4 u_grid;        // first column, first row, columns, rows
uniform sampler2D u_paint;  // per cell: hue rgb, presence (fades in and out)
uniform sampler2D u_owner;  // per cell: owner's index + 1 (0: none) as 16 bits in r and b
uniform sampler2D u_rects;  // per quest, a column: row 0 its box's corner, row 1 its size, 16 bits each
uniform vec3 u_rectInfo;    // quests, and the map point the corners are measured from
uniform float u_reach;      // how far a territory's light runs past its quest's edge, map units
uniform vec2 u_focus;       // the hovered quest's index + 1 (0: none), and how far the others are dimmed in (0-1)
uniform float u_dark;       // 1 on the dark theme: light is added; 0 on paper: colour is laid down

vec4 over(vec4 below, vec3 rgb, float alpha) {
  alpha = clamp(alpha, 0.0, 1.0);
  return vec4(rgb * alpha + below.rgb * (1.0 - alpha), alpha + below.a * (1.0 - alpha));
}

// How much of a pixel (width px) at distance d from a line's centre the line (half-width w) covers
float line(float d, float w, float px) {
  return clamp(min(w, d + 0.5 * px) - max(-w, d - 0.5 * px), 0.0, px) / px;
}

// A 16-bit number held in two bytes of a texel
float word(vec2 bytes) {
  return floor(bytes.x * 255.0 + 0.5) * 256.0 + floor(bytes.y * 255.0 + 0.5);
}

// A territory's light at distance fromBox from its quest's box: full at the edge, nothing at the reach
float lightAt(float fromBox) {
  float t = clamp(fromBox / u_reach, 0.0, 1.0);
  return exp(-2.2 * t) * (1.0 - smoothstep(0.7, 1.0, t));
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_size.y * u_ratio - gl_FragCoord.y) / u_ratio;
  vec2 p = (css - u_camera.xy) / u_camera.z;

  // The nearest cell centre: flat-topped cells, odd columns shifted down half a row
  float columnWidth = 1.5 * u_radius;
  float rowHeight = sqrt(3.0) * u_radius;
  float nearest = 1e20;
  vec2 centre = vec2(0.0);
  vec2 cell = vec2(0.0);
  float column = floor(p.x / columnWidth + 0.5);
  for (int k = -1; k <= 1; k++) {
    float c = column + float(k);
    float shift = mod(c, 2.0) * 0.5 * rowHeight;
    float r = floor((p.y - shift) / rowHeight + 0.5);
    vec2 candidate = vec2(c * columnWidth, r * rowHeight + shift);
    float d = dot(p - candidate, p - candidate);
    if (d < nearest) {
      nearest = d;
      centre = candidate;
      cell = vec2(c, r);
    }
  }

  // h is the hexagon's own distance from the centre: a hexagon is where h <= its apothem
  vec2 q = abs(p - centre);
  float h = max(q.y, 0.8660254 * q.x + 0.5 * q.y);
  float edge = 0.8660254 * u_radius;  // where two cells meet
  float px = 1.0 / (u_camera.z * u_ratio); // one device pixel, in map units
  float cssPx = 1.0 / u_camera.z;          // one CSS pixel, in map units
  vec4 colour = vec4(0.0);
  colour = over(colour, u_fabric.rgb, u_fabric.a * line(abs(h - edge), 0.5 * cssPx, px));

  vec2 texel = cell - u_grid.xy;
  if (texel.x < 0.0 || texel.y < 0.0 || texel.x >= u_grid.z || texel.y >= u_grid.w) {
    gl_FragColor = colour;
    return;
  }
  vec2 uv = (texel + 0.5) / u_grid.zw;
  vec4 paint = texture2D(u_paint, uv);
  vec4 owner = texture2D(u_owner, uv);
  float index = word(owner.rb);
  if (index < 0.5 || paint.a <= 0.0) {
    gl_FragColor = colour;
    return;
  }

  // The pixel's distance from its owner's box, and the light there: full at the box's edge,
  // falling to nothing at the territory's reach
  float u = (index - 0.5) / u_rectInfo.x;
  vec4 corner = texture2D(u_rects, vec2(u, 0.25));
  vec4 extent = texture2D(u_rects, vec2(u, 0.75));
  vec2 low = vec2(word(corner.rg), word(corner.ba)) + u_rectInfo.yz;
  vec2 high = low + vec2(word(extent.rg), word(extent.ba));
  float fromBox = length(max(max(low - p, p - high), 0.0));
  // While a quest is hovered, every other territory dims, more on paper than in the dark
  float others = u_focus.x > 0.5 && abs(index - u_focus.x) > 0.5 ? u_focus.y : 0.0;
  float dim = 1.0 - (u_dark > 0.5 ? 0.3 : 0.4) * others;
  float light = paint.a * dim * lightAt(fromBox);
  vec3 hue = paint.rgb;
  // The light pools round the card, whatever the cells, and shows up the grid's lines where it falls
  float core = line(abs(h - edge), 0.5 * cssPx, px);

  if (u_dark > 0.5) {
    // In the dark light is added: a glow, and the lines burning whiter
    colour = over(colour, hue, light * 0.24);
    colour = over(colour, mix(hue, vec3(1.0), 0.3), light * 0.5 * core);
  } else {
    // On paper the hue is laid down as a pigment, a little browned so the four sit on the parchment
    vec3 ink = u_fabric.rgb;
    vec3 pigment = mix(hue, ink, 0.12);
    // Board tiles: each cell a flat tile set in a gap, shaded by the light at its centre
    float centreLight = paint.a * dim * lightAt(length(max(max(low - centre, centre - high), 0.0)));
    float gap = 0.09 * u_radius;
    float tile = clamp((edge - gap - h) / px + 0.5, 0.0, 1.0);
    colour = over(colour, pigment, (0.1 + 0.5 * centreLight) * paint.a * dim * tile);
    float rim = 0.75 * cssPx;
    colour = over(colour, mix(pigment, ink, 0.3), (0.25 + 0.5 * centreLight) * paint.a * dim * line(abs(h - (edge - gap - rim)), rim, px));
  }
  gl_FragColor = colour;
}
`;

type Camera = { x: number; y: number; zoom: number };

// How the theme wants the canvas drawn: the fabric's colour and strength,
// whether light is added (dark) or laid down (paper), and each hue's colour (0-255), from the theme
export type RGB = [number, number, number];
export type CanvasStyle = { ink: RGB; fabricAlpha: number; dark: boolean; hues: Record<Hue, RGB> };

// The paint of one cell that fades: hue rgb (0-255), presence (0-1)
const paintSize = 4;
// Quest boxes are sent as 16-bit offsets from a corner below every box
const rectRange = 65535;

export class TerritoryRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private textures: { paint: WebGLTexture; owner: WebGLTexture; rects: WebGLTexture } | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private lost = false;
  private dirty = true;

  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  // The hovered quest, and the others' dimming fading towards `focusTarget` (1 while hovered, 0 after)
  private focusId: string | null = null;
  private focusShown = 0;
  private focusTarget = 0;
  private focusAt = 0;
  private style: CanvasStyle = { ink: [255, 255, 255], fabricAlpha: 0, dark: true, hues: { 1: [255, 255, 255], 2: [255, 255, 255], 3: [255, 255, 255], 4: [255, 255, 255], none: [255, 255, 255] } };

  // Cell state, by texel (row-major over the grid's columns and rows)
  private grid: Grid | null = null;
  private looks: CellLook[] = [];
  private quests: TerritoryQuest[] = [];
  private texelOf = new Int32Array(0); // grid cell index -> texel
  private from = new Float32Array(0);
  private to = new Float32Array(0);
  private fadeStart = new Float64Array(0);
  private fading = new Set<number>();
  // The quest each texel's light comes from: its owner, or while fading out its last owner
  private ownerOf: Array<string | undefined> = [];
  private paintBytes = new Uint8Array(0);
  private ownerBytes = new Uint8Array(0);
  private rectBytes = new Uint8Array(8);
  private rectOrigin: [number, number] = [0, 0];
  private uploaded = false; // the textures hold the current bytes
  private paintOnly = false; // of those bytes only the paint has changed since (a fade's step)
  private corners: WebGLBuffer | null = null;

  // Null when WebGL isn't available
  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const renderer = new TerritoryRenderer(canvas, gl);
    if (renderer.setUp()) return renderer;
    renderer.destroy();
    return null;
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    const { gl } = this;
    if (this.textures) Object.values(this.textures).forEach((texture) => gl.deleteTexture(texture));
    if (this.program) gl.deleteProgram(this.program);
    if (this.corners) gl.deleteBuffer(this.corners);
  }

  // No quests: no territory, only the bare fabric
  clear() {
    this.grid = null;
    this.looks = [];
    this.quests = [];
    this.invalidate();
  }

  // Every cell is repainted at once in the new style, without fading
  setStyle(style: CanvasStyle) {
    this.style = style;
    if (this.grid) this.paint(this.grid, this.looks, this.quests, true);
    this.invalidate();
  }

  // Dims every territory but this quest's (null: none), fading in or out
  setFocus(id: string | null) {
    // Leaving one card for another of the same quest changes nothing
    if (id === null ? this.focusTarget === 0 : id === this.focusId && this.focusTarget === 1) return;
    const now = performance.now();
    this.focusShown = this.focusLevel(now);
    // From one quest straight to another the dimming stays, and moves to the new one
    if (id) this.focusId = id;
    this.focusTarget = id ? 1 : 0;
    this.focusAt = now;
    this.invalidate();
  }

  private focusLevel(now: number) {
    // A frame's timestamp can be a little before the change that started the fade
    const progress = Math.max(0, Math.min(1, (now - this.focusAt) / focusFadeMs));
    return this.focusShown + (this.focusTarget - this.focusShown) * progress;
  }

  setCamera(camera: Camera) {
    this.camera = camera;
    this.invalidate();
  }

  // The cells' owners and the quests' boxes. Cells whose paint changes fade to it, except when the
  // grid itself has changed (or `fresh`): then every cell simply shows its paint.
  paint(grid: Grid, looks: CellLook[], quests: TerritoryQuest[], fresh = grid !== this.grid) {
    const now = performance.now();
    if (fresh) this.allocate(grid);
    this.looks = looks;
    this.quests = quests;
    const indexOf = this.writeRects(quests);
    const target = new Float32Array(paintSize);
    grid.cells.forEach((_, i) => {
      const t = this.texelOf[i];
      const look = looks[i];
      const at = t * paintSize;
      if (look.color) {
        this.ownerOf[t] = look.owner;
        target.set([...this.style.hues[look.color], 1]);
      } else {
        // Unowned: no presence, keeping the hue and the owner it fades out from while that quest is shown
        if (this.ownerOf[t] && !indexOf.has(this.ownerOf[t]!)) this.ownerOf[t] = undefined;
        target.set([this.to[at], this.to[at + 1], this.to[at + 2], 0]);
      }
      if (!fresh && target.every((value, k) => value === this.to[at + k])) return;
      if (fresh) {
        this.from.set(target, at);
        this.to.set(target, at);
        this.write(t, target);
        return;
      }
      const shown = this.shown(t, now);
      // Fading in from nothing, take the new hue at once
      if (shown[3] === 0) shown.set(target.subarray(0, 3));
      this.from.set(shown, at);
      this.to.set(target, at);
      this.fadeStart[t] = now;
      this.fading.add(t);
    });
    this.writeOwners(indexOf);
    this.uploaded = false;
    this.invalidate();
  }

  private allocate(grid: Grid) {
    const width = grid.cols[1] - grid.cols[0] + 1;
    const height = grid.rows[1] - grid.rows[0] + 1;
    const count = width * height;
    this.grid = grid;
    this.texelOf = new Int32Array(grid.cells.map((cell) => (cell.row - grid.rows[0]) * width + (cell.col - grid.cols[0])));
    this.from = new Float32Array(count * paintSize);
    this.to = new Float32Array(count * paintSize);
    this.fadeStart = new Float64Array(count);
    this.fading.clear();
    this.ownerOf = new Array(count);
    this.paintBytes = new Uint8Array(count * 4);
    this.ownerBytes = new Uint8Array(count * 4);
  }

  // Each quest's box, as 16-bit offsets from a corner below them all; returns each quest's index + 1
  private writeRects(quests: TerritoryQuest[]) {
    const indexOf = new Map(quests.map((quest, i) => [quest.id, i + 1]));
    const count = Math.max(1, quests.length);
    this.rectOrigin = [Math.floor(Math.min(0, ...quests.map((quest) => quest.rect.x))), Math.floor(Math.min(0, ...quests.map((quest) => quest.rect.y)))];
    this.rectBytes = new Uint8Array(count * 2 * 4);
    const clamp = (value: number) => Math.max(0, Math.min(rectRange, Math.round(value)));
    const put = (row: number, column: number, a: number, b: number) =>
      this.rectBytes.set([clamp(a) >> 8, clamp(a) & 255, clamp(b) >> 8, clamp(b) & 255], (row * count + column) * 4);
    quests.forEach(({ rect }, i) => {
      put(0, i, rect.x - this.rectOrigin[0], rect.y - this.rectOrigin[1]);
      put(1, i, rect.width, rect.height);
    });
    return indexOf;
  }

  private writeOwners(indexOf: Map<string, number>) {
    for (let t = 0; t < this.ownerOf.length; t++) {
      const owner = this.ownerOf[t];
      const index = owner ? (indexOf.get(owner) ?? 0) : 0;
      this.ownerBytes[t * 4] = index >> 8;
      this.ownerBytes[t * 4 + 2] = index & 255;
    }
  }

  // A cell's paint as on screen now, partway through a fade or not
  private shown(t: number, now: number) {
    const at = t * paintSize;
    const progress = this.fading.has(t) ? Math.min(1, (now - this.fadeStart[t]) / paintFadeMs) : 1;
    const eased = progress * progress * (3 - 2 * progress);
    return this.from.subarray(at, at + paintSize).map((value, k) => value + (this.to[at + k] - value) * eased);
  }

  private write(t: number, paint: Float32Array) {
    const [r, g, b, presence] = paint;
    this.paintBytes.set([r, g, b, Math.round(presence * 255)], t * 4);
  }

  private stepFades(now: number) {
    for (const t of this.fading) {
      this.write(t, this.shown(t, now));
      if (now - this.fadeStart[t] >= paintFadeMs) this.fading.delete(t);
    }
    if (this.uploaded) this.paintOnly = true;
  }

  private invalidate() {
    this.dirty = true;
    if (!this.frame && !this.lost) this.frame = requestAnimationFrame(this.render);
  }

  private render = (now: number) => {
    this.frame = 0;
    const fading = this.fading.size > 0;
    // One frame past the fade's end, so its last level is drawn
    const focusing = now - this.focusAt < focusFadeMs + 20;
    if (fading) this.stepFades(now);
    if (this.dirty || fading || focusing) this.draw(now);
    this.dirty = false;
    // Fades run frame by frame; otherwise nothing is redrawn until something changes
    if (fading || focusing) this.frame = requestAnimationFrame(this.render);
  };

  private resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
    this.invalidate();
  }

  private draw(now = performance.now()) {
    const { gl, canvas, uniforms: u } = this;
    if (!this.program || !this.textures) return;
    const ratio = canvas.width / Math.max(1, canvas.clientWidth);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.program);

    if ((!this.uploaded || this.paintOnly) && this.grid) {
      const width = this.grid.cols[1] - this.grid.cols[0] + 1;
      const height = this.grid.rows[1] - this.grid.rows[0] + 1;
      this.upload(0, this.textures.paint, width, height, this.paintBytes);
      if (!this.uploaded) {
        this.upload(1, this.textures.owner, width, height, this.ownerBytes);
        this.upload(2, this.textures.rects, this.rectBytes.length / 8, 2, this.rectBytes);
      }
      this.uploaded = true;
      this.paintOnly = false;
    }

    gl.uniform2f(u.size, canvas.clientWidth, canvas.clientHeight);
    gl.uniform1f(u.ratio, ratio);
    gl.uniform3f(u.camera, this.camera.x, this.camera.y, this.camera.zoom);
    gl.uniform1f(u.radius, territoryCellRadius);
    const { ink: [r, g, b] } = this.style;
    gl.uniform4f(u.fabric, r / 255, g / 255, b / 255, this.style.fabricAlpha * fabricOpacity(this.camera.zoom));
    gl.uniform3f(u.rectInfo, this.rectBytes.length / 8, this.rectOrigin[0], this.rectOrigin[1]);
    gl.uniform1f(u.reach, territoryReach);
    gl.uniform1f(u.dark, this.style.dark ? 1 : 0);
    const focusIndex = this.focusId ? this.quests.findIndex((quest) => quest.id === this.focusId) + 1 : 0;
    gl.uniform2f(u.focus, focusIndex, this.focusLevel(now));
    const grid = this.grid;
    if (grid) gl.uniform4f(u.grid, grid.cols[0], grid.rows[0], grid.cols[1] - grid.cols[0] + 1, grid.rows[1] - grid.rows[0] + 1);
    else gl.uniform4f(u.grid, 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private upload(unit: number, texture: WebGLTexture, width: number, height: number, bytes: Uint8Array) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  // Compiles the shaders and makes the textures; false if the GPU won't
  private setUp() {
    const { gl } = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("The hex canvas's shaders did not build:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }
    this.program = program;
    gl.useProgram(program);

    // One triangle covering the whole canvas
    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, "a_corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    for (const name of ["size", "ratio", "camera", "radius", "fabric", "grid", "rectInfo", "reach", "dark", "focus"]) {
      this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    }
    const texture = (unit: number, name: string) => {
      const made = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, made);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.uniform1i(gl.getUniformLocation(program, `u_${name}`), unit);
      return made;
    };
    this.textures = { paint: texture(0, "paint"), owner: texture(1, "owner"), rects: texture(2, "rects") };
    this.uploaded = false;
    this.resize();
    return true;
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.program = null;
    this.textures = null;
  };

  private onContextRestored = () => {
    this.lost = false;
    this.setUp();
  };
}
