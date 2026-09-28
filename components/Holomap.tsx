"use client";

import { useEffect, useRef, useState } from "react";
import { fromMerc, rhumb, sample, toMerc, type Field } from "@/lib/geo";
import { loadGrid, type Layer } from "@/lib/currents";

const TABLE = 0.84; // the map takes 84% of the screen each way when tilted; flat view is the same table scaled up by 1/TABLE
const PIX = 3; // one current "pixel" = 3x3 CSS px, upscaled with nearest-neighbour
const TRAIL = 0.15; // fraction of streak brightness left after 1 s (shorter = crisper streaks)
// Per-mode look. flow = streak speed in low-res px/s per m/s (visual exaggeration, same at every
// zoom); wind runs ~15x faster than water, so it gets a far smaller multiplier.
// full = speed (m/s) that draws at full brightness; still = below this, don't draw.
const MODES = {
  ocean: { label: "OCEAN CURRENT", flow: 22, full: 0.6, still: 0.03, skipLand: true, slow: [40, 150, 185], fast: [120, 255, 215] },
  wind: { label: "WIND", flow: 1.6, full: 9, still: 0.5, skipLand: false, slow: [110, 140, 185], fast: [235, 245, 255] },
} as const;
const EARTH_KM = 40075;
const MS_TO_KN = 1.943844;
const START = { lon: -71, lat: 36.5, widthKm: 2600 }; // Gulf Stream off Cape Hatteras
const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const LAND = "#0d3b50";

// AIS ship type code -> category (ITU-R M.1371 table: 30 fishing, 31/32/52 tug, 35 military,
// 36/37 sailing/pleasure, 6x passenger, 7x cargo, 8x tanker).
const SHIP_KINDS = [
  { name: "CARGO", color: "#9ff0ff", match: (t: number) => t >= 70 && t < 80 },
  { name: "TANKER", color: "#ffcf6b", match: (t: number) => t >= 80 && t < 90 },
  { name: "PASSENGER", color: "#d7b4ff", match: (t: number) => t >= 60 && t < 70 },
  { name: "FISHING", color: "#8dffb5", match: (t: number) => t === 30 },
  { name: "MILITARY", color: "#ff6b7d", match: (t: number) => t === 35 },
  { name: "TUG", color: "#7fb6d6", match: (t: number) => t === 31 || t === 32 || t === 52 },
  { name: "PLEASURE", color: "#7fb6d6", match: (t: number) => t === 36 || t === 37 },
];
const OTHER_SHIP = { name: "VESSEL", color: "#7fb6d6" };
const shipKind = (t: number) => SHIP_KINDS.find((k) => k.match(t)) ?? OTHER_SHIP;
type Ship = { mmsi: number; x: number; y: number; cog: number | null; sog: number; name: string; type: number };

type Ring = { pts: Float64Array; x0: number; y0: number; x1: number; y1: number };
type Geo = {
  land: number[][]; lakes: number[][]; depth: Record<string, number[][]>; fill: Record<string, number[][]>;
  rivers: Record<string, number[][]>; // keyed by Natural Earth scalerank, 0-1 = biggest
};

function decode(flat: number[]): Ring {
  const pts = new Float64Array(flat.length);
  let lon = 0, lat = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let i = 0; i < flat.length; i += 2) {
    lon += flat[i];
    lat += flat[i + 1];
    const [x, y] = toMerc(lon / 100, lat / 100);
    pts[i] = x;
    pts[i + 1] = y;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { pts, x0, y0, x1, y1 };
}

const fmt = (v: number, pos: string, neg: string, pad: number) =>
  `${v >= 0 ? pos : neg} ${Math.abs(v).toFixed(3).padStart(pad, "0")}°`;

export default function Holomap() {
  const [tilt, setTilt] = useState(true);
  const [layer, setLayer] = useState<Layer>("ocean");
  const setModeRef = useRef<(m: Layer) => void>(() => {});
  const [showShips, setShowShips] = useState(true);
  const setShipsRef = useRef<(on: boolean) => void>(() => {});
  const shipRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef<HTMLCanvasElement>(null);
  const bearingLabelRef = useRef<HTMLDivElement>(null);
  const shipTipRef = useRef<HTMLDivElement>(null);
  const shipStatusRef = useRef<HTMLSpanElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLCanvasElement>(null);
  const hud = {
    current: useRef<HTMLSpanElement>(null),
    arrow: useRef<HTMLSpanElement>(null),
    lat: useRef<HTMLDivElement>(null),
    lon: useRef<HTMLDivElement>(null),
    status: useRef<HTMLSpanElement>(null),
    scaleBar: useRef<HTMLDivElement>(null),
    scaleLabel: useRef<HTMLSpanElement>(null),
    paused: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    const surface = surfaceRef.current!;
    const base = baseRef.current!;
    const flow = flowRef.current!;
    const bctx = base.getContext("2d")!;
    const fctx = flow.getContext("2d")!;
    const shipCanvas = shipRef.current!;
    const sctx = shipCanvas.getContext("2d")!;
    const pixelFont = getComputedStyle(surface).fontFamily;
    let ships: Ship[] = [];
    let shipsOn = true, shipsDirty = true, shipsInflight = false;
    const toolCanvas = toolRef.current!;
    const tctx = toolCanvas.getContext("2d")!;
    let bearingFrom: [number, number] | null = null; // merc point where E was pressed
    let toolDrawn = false;

    let W = 0, H = 0, dpr = 1, fw = 0, fh = 0;
    let img: ImageData | null = null;
    // Land mask at streak resolution (1 = land). The current grid is ~1° coarse and interpolates up
    // to the shore, so without this, ocean streaks drift up to a grid cell inland.
    let landMask = new Uint8Array(0);
    const maskCanvas = document.createElement("canvas");
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    const [mx0, my0] = toMerc(START.lon, START.lat);
    const view = { cx: mx0, cy: my0, scale: 0 }; // merc centre + CSS px per merc unit
    let land: Ring[] = [], lakes: Ring[] = [];
    let depth: [number, Ring[]][] = [];
    let depthFill = new Map<number, Ring[]>(); // area deeper than each contour, for terrace shading
    let rivers: [number, Ring[]][] = [];
    let field: Field | null = null;
    let dirty = true, paused = false;
    let mode: Layer = "ocean";
    let px = new Float32Array(0), py = new Float32Array(0), age = new Float32Array(0), life = new Float32Array(0);
    let rowLat = new Float32Array(0), lonLeft = 0, dLon = 0;
    const shift = { x: 0, y: 0 };
    const keys = new Set<string>();
    const cursor = { x: -1, y: -1, down: false, lx: 0, ly: 0, dx: 0, dy: 0 };

    // ---------- view math ----------
    // The world repeats east-west (the Mercator unit square is one tile), so panning sideways never ends.
    // Min zoom is one world across, so any single point has at most one copy on screen: its nearest one.
    const near = (d: number) => d - Math.round(d);
    const mod1 = (v: number) => v - Math.floor(v);
    const toScreen = (x: number, y: number): [number, number] => [
      near(x - view.cx) * view.scale + W / 2,
      (y - view.cy) * view.scale + H / 2,
    ];
    const toMercAt = (sx: number, sy: number): [number, number] =>
      [mod1(view.cx + (sx - W / 2) / view.scale), view.cy + (sy - H / 2) / view.scale];
    const toLonLat = (sx: number, sy: number) => fromMerc(...toMercAt(sx, sy));
    const maxScale = () => W / (20 / (EARTH_KM * Math.cos((fromMerc(0, view.cy)[1] * Math.PI) / 180))); // ~20 km across
    const clampView = () => {
      const minS = Math.max(W, H); // at most one world across the screen either way (so one copy of any point)
      view.scale = Math.min(maxScale(), Math.max(minS, view.scale));
      const hy = H / 2 / view.scale;
      view.cx = mod1(view.cx);
      view.cy = Math.min(1 - hy, Math.max(hy, view.cy)); // north-south stops at the map's edge
    };
    // Per-row latitude + linear longitude, so particles skip the Mercator inverse every frame.
    const recomputeRows = () => {
      rowLat = new Float32Array(fh);
      for (let y = 0; y < fh; y++) rowLat[y] = toLonLat(0, y * PIX + PIX / 2)[1];
      lonLeft = toLonLat(0, 0)[0];
      dLon = (PIX / view.scale) * 360;
    };

    // ---------- particles ----------
    const spawn = (i: number) => {
      px[i] = Math.random() * fw;
      py[i] = Math.random() * fh;
      age[i] = 0;
      life[i] = 1.5 + Math.random() * 3.5;
    };
    const respawnAll = () => {
      for (let i = 0; i < px.length; i++) spawn(i);
      for (let i = 0; i < px.length; i++) age[i] = Math.random() * life[i]; // desync lifetimes
      img?.data.fill(0);
    };
    const shiftTrails = (dx: number, dy: number) => {
      shift.x += dx / PIX;
      shift.y += dy / PIX;
      const ix = Math.round(shift.x), iy = Math.round(shift.y);
      shift.x -= ix;
      shift.y -= iy;
      if (!ix && !iy) return;
      for (let i = 0; i < px.length; i++) { px[i] += ix; py[i] += iy; }
      if (!img) return;
      const src = img.data, out = new Uint8ClampedArray(src.length);
      const a = Math.max(0, ix), b = Math.min(fw, fw + ix);
      if (b > a)
        for (let y = 0; y < fh; y++) {
          const sy = y - iy;
          if (sy < 0 || sy >= fh) continue;
          out.set(src.subarray((sy * fw + a - ix) * 4, (sy * fw + b - ix) * 4), (y * fw + a) * 4);
        }
      src.set(out);
    };
    // Zoom keeps the streaks: particles and trails scale about the zoom point (screen p -> a*p + b)
    // instead of respawning, so zooming reads as one continuous motion.
    const zoomTrails = (a: number, bx: number, by: number) => {
      const cx = bx / PIX, cy = by / PIX; // screen px -> low-res grid
      if (a === 1 && Math.abs(cx) < 0.5 && Math.abs(cy) < 0.5) return;
      // Zooming out shrinks the particles into the middle; re-scatter the share that belongs in the new
      // edge band (rejection-sampled outside the shrunk rect) so density stays even.
      const keep = Math.min(1, a * a);
      for (let i = 0; i < px.length; i++) {
        px[i] = px[i] * a + cx;
        py[i] = py[i] * a + cy;
        const out = px[i] < 0 || py[i] < 0 || px[i] >= fw || py[i] >= fh;
        if (!out && Math.random() < keep) continue;
        for (let n = 0; n < 20; n++) {
          spawn(i);
          if (a >= 1 || px[i] < cx || py[i] < cy || px[i] >= cx + a * fw || py[i] >= cy + a * fh) break;
        }
      }
      if (!img) return;
      const d = new Uint32Array(img.data.buffer), old = d.slice();
      for (let y = 0; y < fh; y++) {
        const sy = Math.floor((y + 0.5 - cy) / a);
        for (let x = 0; x < fw; x++) {
          const sx = Math.floor((x + 0.5 - cx) / a);
          d[y * fw + x] = sx >= 0 && sy >= 0 && sx < fw && sy < fh ? old[sy * fw + sx] : 0;
        }
      }
    };

    // ---------- interaction ----------
    let fetchTimer = 0;
    let shipTimer = 0;
    const viewChanged = () => {
      dirty = true;
      shipsDirty = true;
      recomputeRows();
      clearTimeout(fetchTimer);
      fetchTimer = window.setTimeout(refresh, 350);
      clearTimeout(shipTimer);
      shipTimer = window.setTimeout(pollShips, 400);
    };
    const panBy = (dx: number, dy: number) => {
      const oy = view.cy;
      view.cx -= dx / view.scale;
      view.cy -= dy / view.scale;
      clampView();
      shiftTrails(dx, (oy - view.cy) * view.scale);
      viewChanged();
    };
    const zoomAt = (sx: number, sy: number, f: number) => {
      const s0 = view.scale, cx0 = view.cx, cy0 = view.cy;
      const mx = view.cx + (sx - W / 2) / view.scale, my = view.cy + (sy - H / 2) / view.scale;
      view.scale *= f;
      clampView();
      view.cx = mx - (sx - W / 2) / view.scale;
      view.cy = my - (sy - H / 2) / view.scale;
      clampView();
      const a = view.scale / s0; // actual zoom after clamping
      zoomTrails(a, (W / 2) * (1 - a) + near(cx0 - view.cx) * view.scale, (H / 2) * (1 - a) + (cy0 - view.cy) * view.scale);
      viewChanged();
    };

    // ---------- current data ----------
    let ctrl: AbortController | null = null;
    const setStatus = (s: string) => { if (hud.status.current) hud.status.current.textContent = s; };
    async function refresh() {
      if (!W) return;
      clearTimeout(fetchTimer);
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      setStatus("SYNCING…");
      try {
        const f = await loadGrid(mode, c.signal); // one cached global grid per layer, so pan/zoom costs nothing
        if (c.signal.aborted) return;
        field = f;
        setStatus(!f.time ? "" : mode === "ocean" ? `DATA ${f.time.slice(0, 10)}` : `DATA ${f.time.slice(11, 16)}Z`);
      } catch (e) {
        if (!c.signal.aborted) {
          console.error(e);
          setStatus("DATA OFFLINE");
        }
      }
    }
    const every15 = window.setInterval(refresh, 15 * 60 * 1000);

    // ---------- ships (AIS via /api/ships) ----------
    const setShipStatus = (s: string) => { if (shipStatusRef.current) shipStatusRef.current.textContent = s; };
    async function pollShips() {
      if (!W || !shipsOn || shipsInflight) return;
      shipsInflight = true;
      const [w0, n] = toLonLat(0, 0);
      const [e0, s] = toLonLat(W, H);
      let w = w0, e = e0;
      // ponytail: a view across the date line asks for the whole latitude band; split into two boxes if that gets heavy
      if (w >= e || W / view.scale > 0.999) [w, e] = [-180, 180];
      try {
        const q = `w=${Math.max(-180, w).toFixed(3)}&e=${Math.min(180, e).toFixed(3)}&s=${Math.max(-89, s).toFixed(3)}&n=${Math.min(89, n).toFixed(3)}`;
        const r = (await (await fetch(`/api/ships?${q}`)).json()) as { status?: string; ships?: [number, number, number, number | null, number, string, number][] };
        if (!shipsOn) return;
        ships = (r.ships ?? []).map(([mmsi, lon, lat, cog, sog, name, type]) => {
          const [x, y] = toMerc(lon, lat);
          return { mmsi, x, y, cog, sog, name, type };
        });
        shipsDirty = true;
        setShipStatus(r.status === "LIVE" ? `SHIPS ${ships.length}` : `SHIPS: ${r.status ?? "OFFLINE"}`);
      } catch {
        setShipStatus("SHIPS: OFFLINE");
      } finally {
        shipsInflight = false;
      }
    }
    const every3 = window.setInterval(pollShips, 3000);

    // Ships that crowd together on screen merge into one small radar blip: a ring split into arcs by ship
    // type, with the count beside it (click to zoom in). Cells are pinned to the map, so blips don't
    // reshuffle while panning. Lone ships get a course arrow (or a diamond when stopped).
    type Mark = { x: number; y: number; r: number; ships: Ship[]; kinds: [{ name: string; color: string }, number][]; from?: [number, number] };
    let marks: Mark[] = [];
    const CELL = 72;
    const drawShips = () => {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, W, H);
      marks = [];
      if (!shipsOn) return;
      const ox = view.cx * view.scale - W / 2, oy = view.cy * view.scale - H / 2; // screen px -> map-pinned px
      // At max zoom a blip could never be split, so only ships practically on top of each other group,
      // and those fan out instead of merging.
      // Groups are fixed per zoom level (each doubling of scale), not per scroll tick: between levels the
      // cell grows with the map (CELL..2*CELL px), so blips glide with it and only split/merge at a level.
      const atMax = view.scale >= maxScale() * 0.999;
      const cell = atMax ? 10 : (CELL * view.scale) / 2 ** Math.floor(Math.log2(view.scale));
      const cells = new Map<string, { ci: number; cj: number; sx: number; sy: number; ships: Ship[] }>();
      for (const sh of ships) {
        const [x, y] = toScreen(sh.x, sh.y);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        const ci = Math.floor((x + ox) / cell), cj = Math.floor((y + oy) / cell), k = `${ci},${cj}`;
        const c = cells.get(k) ?? cells.set(k, { ci, cj, sx: 0, sy: 0, ships: [] }).get(k)!;
        c.sx += x;
        c.sy += y;
        c.ships.push(sh);
      }
      for (const c of cells.values()) {
        const n = c.ships.length;
        const tally = new Map<{ name: string; color: string }, number>();
        for (const sh of c.ships) { const kd = shipKind(sh.type); tally.set(kd, (tally.get(kd) ?? 0) + 1); }
        const kinds = [...tally].sort((a, b) => b[1] - a[1]);
        if (n === 1) { marks.push({ x: c.sx, y: c.sy, r: 12, ships: c.ships, kinds }); continue; }
        if (atMax) { // sunflower spiral around the shared spot, each ship tethered back to it
          const fx = c.sx / n, fy = c.sy / n;
          c.ships.forEach((sh, i) => {
            const rr = 19 * Math.sqrt(i + 0.6), a = i * 2.39996;
            marks.push({ x: fx + rr * Math.cos(a), y: fy + rr * Math.sin(a), r: 9, ships: [sh], kinds: [[shipKind(sh.type), 1]], from: [fx, fy] });
          });
          continue;
        }
        const r = Math.min(13, 4 + 2.2 * Math.log2(n));
        // centroid, kept inside its own cell (leaving room for the count) so blips never overlap
        const x0 = c.ci * cell - ox + r + 2, y0 = c.cj * cell - oy + r + 2, span = cell - 2 * r - 28;
        const x = Math.round(Math.min(x0 + span, Math.max(x0, c.sx / n)));
        const y = Math.round(Math.min(y0 + span, Math.max(y0, c.sy / n)));
        marks.push({ x, y, r, ships: c.ships, kinds });
      }

      sctx.lineWidth = 1.5;
      sctx.textBaseline = "middle";
      sctx.font = `14px ${pixelFont}`;
      for (const m of marks) {
        if (m.ships.length === 1) continue;
        const { x, y, r } = m, n = m.ships.length, color = m.kinds[0][0].color;
        sctx.shadowBlur = 0;
        sctx.beginPath();
        sctx.arc(x, y, r, 0, 2 * Math.PI);
        sctx.strokeStyle = "rgba(3,14,24,0.8)"; // dark keyline so blips separate from the glowing coast
        sctx.lineWidth = 4.5;
        sctx.stroke();
        sctx.lineWidth = 1.5;
        sctx.globalAlpha = 0.14;
        sctx.fillStyle = color;
        sctx.fill();
        sctx.globalAlpha = 1;
        sctx.shadowBlur = 6;
        let a = -Math.PI / 2; // ring split into arcs by type share, clockwise from north
        const gap = m.kinds.length > 1 ? 0.35 : 0;
        for (const [kd, cnt] of m.kinds) {
          const da = (2 * Math.PI * cnt) / n;
          sctx.strokeStyle = sctx.shadowColor = kd.color;
          sctx.beginPath();
          sctx.arc(x, y, r, a + gap / 2, a + Math.max(gap / 2 + 0.05, da - gap / 2));
          sctx.stroke();
          a += da;
        }
        sctx.fillStyle = sctx.shadowColor = color;
        sctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        sctx.shadowBlur = 0;
        const label = n > 999 ? "999+" : String(n);
        sctx.textAlign = "left";
        sctx.strokeStyle = "rgba(3,14,24,0.85)";
        sctx.lineWidth = 3;
        sctx.strokeText(label, x + r + 4, y + 1);
        sctx.lineWidth = 1.5;
        sctx.globalAlpha = 0.9;
        sctx.fillText(label, x + r + 4, y + 1);
        sctx.globalAlpha = 1;
      }

      const singles = marks.filter((m) => m.ships.length === 1);
      const labels = singles.length <= 50;
      const placed: [number, number, number, number][] = []; // label boxes already drawn, to skip collisions
      sctx.shadowBlur = 0;
      sctx.lineWidth = 1;
      sctx.strokeStyle = "rgba(160,235,255,0.35)";
      sctx.beginPath();
      for (const m of singles) if (m.from) { sctx.moveTo(m.from[0], m.from[1]); sctx.lineTo(m.x, m.y); }
      sctx.stroke();
      sctx.lineWidth = 1.5;
      sctx.font = `15px ${pixelFont}`;
      sctx.textAlign = "center";
      for (const { x: fx, y: fy, ships: [sh], from } of singles) {
        const x = Math.round(fx), y = Math.round(fy), color = shipKind(sh.type).color;
        sctx.strokeStyle = sctx.fillStyle = sctx.shadowColor = color;
        sctx.shadowBlur = 8;
        sctx.beginPath();
        if (sh.cog == null || sh.sog < 0.5) { // stopped / anchored: hollow diamond with a centre pip
          sctx.moveTo(x, y - 6); sctx.lineTo(x + 6, y); sctx.lineTo(x, y + 6); sctx.lineTo(x - 6, y); sctx.closePath();
          sctx.stroke();
          sctx.fillRect(x - 1, y - 1, 2, 2);
        } else { // moving: holo arrow along course, leader line length = speed
          const a = (sh.cog * Math.PI) / 180; // 0 = north, clockwise
          sctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
          sctx.rotate(a);
          sctx.moveTo(0, -9); sctx.lineTo(6.5, 7); sctx.lineTo(0, 3); sctx.lineTo(-6.5, 7); sctx.closePath();
          sctx.globalAlpha = 0.3;
          sctx.fill();
          sctx.globalAlpha = 1;
          sctx.stroke();
          sctx.beginPath();
          sctx.moveTo(0, -12);
          sctx.lineTo(0, -12 - Math.min(40, 4 + sh.sog * 2));
          sctx.globalAlpha = 0.6;
          sctx.stroke();
          sctx.globalAlpha = 1;
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        const lw = sh.name ? sctx.measureText(sh.name).width / 2 + 3 : 0;
        const box: [number, number, number, number] = [x - lw, y + 12, x + lw, y + 26];
        if (labels && sh.name && !from && !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
          placed.push(box);
          sctx.shadowBlur = 0;
          sctx.globalAlpha = 0.75;
          sctx.fillText(sh.name, x, y + 19);
          sctx.globalAlpha = 1;
        }
      }
      sctx.shadowBlur = 0;
    };

    // Hold-E bearing tool: north reference, clockwise arc to the arrow, arrow to cursor, bearing +
    // distance. Mercator straight line = rhumb line, so the drawn angle is the true course to steer.
    // Drawn on the same low-res grid as the current streaks (1 px = PIX CSS px), then hard-thresholded
    // so every pixel is fully on/off and the CSS upscale stays chunky. Glow comes from a CSS drop-shadow.
    const drawBearing = () => {
      tctx.setTransform(1 / PIX, 0, 0, 1 / PIX, 0, 0); // draw in CSS px, land on the low-res grid
      tctx.clearRect(0, 0, W, H);
      toolDrawn = !!bearingFrom;
      const label = bearingLabelRef.current!;
      label.style.display = "none";
      if (!bearingFrom) return;
      const [ax, ay] = toScreen(bearingFrom[0], bearingFrom[1]);
      tctx.strokeStyle = tctx.fillStyle = "#bff8ff";
      tctx.lineWidth = PIX; // one low-res pixel
      tctx.lineCap = "square";
      drawBearingShapes(ax, ay);
      const img = tctx.getImageData(0, 0, fw, fh);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 70 ? 255 : 0;
      tctx.putImageData(img, 0, 0);
    };
    const drawBearingShapes = (ax: number, ay: number) => {
      if (!bearingFrom) return;
      tctx.strokeRect(ax - 6, ay - 6, 12, 12); // anchor mark: pixel square with a centre dot
      tctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
      if (cursor.x < 0) return;
      const bx = cursor.x, by = cursor.y;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 6) return;

      const [lon1, lat1] = fromMerc(bearingFrom[0], bearingFrom[1]);
      const [lon2, lat2] = toLonLat(bx, by);
      const { bearing, km } = rhumb(lon1, lat1, lon2, lat2);
      const b = (bearing * Math.PI) / 180;
      const arcR = Math.min(36, len * 0.6);

      tctx.beginPath(); // north reference
      tctx.moveTo(ax, ay);
      tctx.lineTo(ax, ay - Math.max(arcR + 21, 51));
      tctx.stroke();
      tctx.beginPath(); // clockwise sweep from north to the course
      tctx.arc(ax, ay, arcR, -Math.PI / 2, -Math.PI / 2 + b);
      tctx.stroke();
      tctx.beginPath(); // course line + arrowhead
      tctx.moveTo(ax, ay);
      tctx.lineTo(bx, by);
      const ang = Math.atan2(by - ay, bx - ax);
      tctx.moveTo(bx, by);
      tctx.lineTo(bx - 15 * Math.cos(ang - 0.45), by - 15 * Math.sin(ang - 0.45));
      tctx.moveTo(bx, by);
      tctx.lineTo(bx - 15 * Math.cos(ang + 0.45), by - 15 * Math.sin(ang + 0.45));
      tctx.stroke();

      // Label on the far side of the mark from the arrow so they never overlap; if that lands on
      // the north line (course roughly south), swing it off to the side.
      let side = bearing + 180;
      if (Math.abs(((side % 360) + 540) % 360 - 180) < 30) side += bearing < 180 ? -45 : 45; // within 30° of north
      const la = ((side - 90) * Math.PI) / 180; // compass -> canvas angle
      // Text is a crisp DOM label (same pixel font as the HUD) rather than going through the
      // 3 px grid, which made small glyphs unreadable. Dark plate keeps it legible over streaks.
      const nm = km / 1.852;
      const label = bearingLabelRef.current!;
      label.firstElementChild!.textContent = `${Math.round(bearing) % 360}°`.padStart(4, "0");
      label.lastElementChild!.textContent = `${km < 10 ? km.toFixed(1) : Math.round(km)} KM · ${nm < 10 ? nm.toFixed(1) : Math.round(nm)} NM`;
      label.style.display = "block";
      // push the box out by its own half-size along the label direction so its edge clears the arc
      const lr = arcR + 16 + Math.abs(Math.cos(la)) * (label.offsetWidth / 2) + Math.abs(Math.sin(la)) * (label.offsetHeight / 2);
      label.style.left = `${ax + Math.cos(la) * lr}px`;
      label.style.top = `${ay + Math.sin(la) * lr}px`;

    };

    let hoverKey = "";
    const markAt = (sx: number, sy: number) =>
      marks.find((m) => sx >= m.x - m.r - 4 && sx <= m.x + m.r + (m.ships.length > 1 ? 26 : 4) && Math.abs(m.y - sy) <= m.r + 4);
    const updateShipTip = (sx: number, sy: number, active: boolean) => {
      const m = active && shipsOn ? markAt(sx, sy) : undefined;
      const tip = shipTipRef.current!;
      surface.style.cursor = m && m.ships.length > 1 ? "pointer" : "";
      if (!m) {
        if (hoverKey) { tip.style.display = "none"; hoverKey = ""; }
        return;
      }
      tip.style.display = "block";
      tip.style.left = `${m.x + m.r + (m.ships.length > 1 ? 32 : 6)}px`;
      tip.style.top = `${m.y - 10}px`;
      const one = m.ships.length === 1 ? m.ships[0] : null;
      const key = one ? `s${one.mmsi}` : `c${m.x},${m.y},${m.ships.length}`;
      if (hoverKey === key) return;
      hoverKey = key;
      tip.style.color = m.kinds[0][0].color;
      tip.textContent = one
        ? `${one.name || `MMSI ${one.mmsi}`}\n${shipKind(one.type).name}  ${one.sog.toFixed(1)} KN` +
          (one.cog != null ? `  ${Math.round(one.cog).toString().padStart(3, "0")}°` : "")
        : `${m.ships.length} SHIPS · CLICK TO ZOOM\n` + m.kinds.slice(0, 4).map(([kd, n]) => `${n} ${kd.name}`).join("  ");
    };

    // ---------- drawing: static layers ----------
    // Natural Earth cuts land along the date line and at ±85° (where toMerc clamps). With the world
    // repeating sideways (and the map edge at ±85°), those cut edges would glow as fake coastline,
    // so outlines skip segments lying on one.
    const [, yN] = toMerc(0, 90), [, yS] = toMerc(0, -90);
    const onCut = (p: Float64Array, i: number, j: number) =>
      (p[i] === p[j] && (p[i] <= 0 || p[i] >= 1)) || (p[i + 1] <= yN && p[j + 1] <= yN) || (p[i + 1] >= yS && p[j + 1] >= yS);
    // "fill": closed polygons for land fill/mask. "outline": closed, minus cut edges. "open": depth polylines.
    const trace = (ctx: CanvasRenderingContext2D | Path2D, rings: Ring[], how: "fill" | "outline" | "open") => {
      const k = view.scale, hw = W / 2 / k, hh = H / 2 / k;
      const vx0 = view.cx - hw, vx1 = view.cx + hw, vy0 = view.cy - hh, vy1 = view.cy + hh;
      for (let tx = Math.floor(vx0); tx <= Math.floor(vx1); tx++) { // every copy of the world in view
        const ox = (tx - view.cx) * k + W / 2, oy = H / 2 - view.cy * k;
        for (const r of rings) {
          if (r.x1 + tx < vx0 || r.x0 + tx > vx1 || r.y1 < vy0 || r.y0 > vy1) continue;
          const p = r.pts, n = p.length;
          let lx = ox + p[0] * k, ly = oy + p[1] * k;
          ctx.moveTo(lx, ly);
          for (let i = 2; i < n; i += 2) {
            const x = ox + p[i] * k, y = oy + p[i + 1] * k;
            if (how !== "fill" && onCut(p, i - 2, i)) ctx.moveTo(x, y);
            else if (Math.abs(x - lx) + Math.abs(y - ly) < 1 && i < n - 2) continue;
            else ctx.lineTo(x, y);
            lx = x;
            ly = y;
          }
          if (how === "fill") ctx.closePath();
          else if (how === "outline" && !onCut(p, n - 2, 0)) ctx.lineTo(ox + p[0] * k, oy + p[1] * k);
        }
      }
    };

    const drawGrid = (c: CanvasRenderingContext2D) => {
      const latc = Math.round(fromMerc(0, view.cy)[1]); // rounded so the grid doesn't swim while panning
      const kmPerUnit = EARTH_KM * Math.cos((latc * Math.PI) / 180);
      const kmPerPx = kmPerUnit / view.scale;
      const km = NICE_KM.find((k) => k / kmPerPx >= 150) ?? 5000;
      const gp = (km / kmPerUnit) * view.scale; // grid cell in px
      const ox = (((W / 2 - view.cx * view.scale) % gp) + gp) % gp;
      const oy = (((H / 2 - view.cy * view.scale) % gp) + gp) % gp;

      c.fillStyle = "rgba(90,170,230,0.22)";
      for (let x = ox - gp; x < W; x += gp / 4)
        for (let y = oy - gp; y < H; y += gp / 4) c.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      c.fillStyle = "rgba(90,180,240,0.35)"; // dotted half-lines
      for (let x = ox - gp / 2; x < W; x += gp)
        for (let y = 0; y < H; y += gp / 16) c.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      for (let y = oy - gp / 2; y < H; y += gp)
        for (let x = 0; x < W; x += gp / 16) c.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);

      c.strokeStyle = "rgba(80,170,235,0.28)";
      c.lineWidth = 1;
      c.beginPath();
      for (let x = ox; x < W; x += gp) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, H); }
      for (let y = oy; y < H; y += gp) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); }
      c.stroke();
      c.strokeStyle = "rgba(150,215,255,0.75)";
      c.beginPath();
      for (let x = ox; x < W; x += gp)
        for (let y = oy; y < H; y += gp) {
          c.moveTo(x - 5, y); c.lineTo(x + 5, y);
          c.moveTo(x, y - 5); c.lineTo(x, y + 5);
        }
      c.stroke();

      if (hud.scaleBar.current) hud.scaleBar.current.style.width = `${gp}px`;
      if (hud.scaleLabel.current) hud.scaleLabel.current.textContent = `${km}km`;
    };

    // ---------- terrain: AWS Terrain Tiles ("terrarium" PNGs; free, public, no key, no rate limit) ----------
    // Web Mercator tiles, the same projection as this map, so each drops straight onto the view. A tile is
    // baked once into shaded relief: height bands step lighter going up, thin cyan lines mark the band
    // edges (real elevation contours), and slopes are lit from the north-west like the rest of the table.
    const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
    const BANDS = [200, 500, 1000, 2000, 3000, 4500]; // metres
    const tiles = new Map<string, HTMLCanvasElement | null>(); // null = loading (or failed: plain land shows)
    const bakeQueue: (() => void)[] = []; // baking is ~5 ms/tile, so the frame loop drains this on a time budget
    const bakeTile = (img: HTMLImageElement, z: number, ty: number) => {
      const S = 256, cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const tc = cv.getContext("2d", { willReadFrequently: true })!;
      tc.drawImage(img, 0, 0);
      const d = tc.getImageData(0, 0, S, S), px = d.data;
      const e = new Float32Array(S * S), band = new Uint8Array(S * S);
      for (let i = 0; i < S * S; i++) {
        e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768; // terrarium encoding
        let b = 0;
        while (b < BANDS.length && e[i] >= BANDS[b]) b++;
        band[i] = b;
      }
      const mpp = (40075016 * Math.cos((fromMerc(0, (ty + 0.5) / 2 ** z)[1] * Math.PI) / 180)) / (S * 2 ** z);
      const k = Math.max(1, 2 ** ((11 - z) * 0.6)) / (2 * mpp); // slope scale; exaggerated when zoomed out
      const [lx, ly, lz] = [-0.55, -0.55, 0.63]; // towards the light: north-west (screen up-left), fairly high
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const i = y * S + x, o = i * 4, b = band[i];
          if ((x < S - 1 && band[i + 1] !== b) || (y < S - 1 && band[i + S] !== b)) { // contour between bands
            px[o] = 120; px[o + 1] = 225; px[o + 2] = 240; px[o + 3] = 70;
            continue;
          }
          const gx = (e[y * S + Math.min(S - 1, x + 1)] - e[y * S + Math.max(0, x - 1)]) * k;
          const gy = (e[Math.min(S - 1, y + 1) * S + x] - e[Math.max(0, y - 1) * S + x]) * k;
          const shade = Math.max(0.45, Math.min(1.5, (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1) / lz));
          const lift = (0.92 + b * 0.09) * shade; // each band a step brighter, times the hillshade
          px[o] = 13 * lift; px[o + 1] = 59 * lift; px[o + 2] = 80 * lift; px[o + 3] = 255;
        }
      tc.putImageData(d, 0, 0);
      return cv;
    };
    const terrainTile = (z: number, x: number, y: number) => {
      const key = `${z}/${x}/${y}`;
      if (tiles.has(key)) return tiles.get(key)!;
      // ponytail: FIFO eviction (~40 MB of baked tiles); an LRU would re-fetch less when panning back
      if (tiles.size >= 160) for (const old of tiles.keys()) { tiles.delete(old); if (tiles.size < 120) break; }
      tiles.set(key, null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => bakeQueue.push(() => tiles.has(key) && tiles.set(key, bakeTile(img, z, y))); // skip if evicted meanwhile
      img.src = `${TERRAIN}/${key}.png`;
      return null;
    };
    const drawTerrain = (c: CanvasRenderingContext2D) => {
      const z = Math.max(1, Math.min(13, Math.round(Math.log2((view.scale * 1.5) / 256)))); // ~1.5 tile px per screen px
      const n = 2 ** z, ts = view.scale / n, hw = W / 2 / view.scale, hh = H / 2 / view.scale;
      const tx0 = Math.floor((view.cx - hw) * n), tx1 = Math.floor((view.cx + hw) * n);
      const ty0 = Math.max(0, Math.floor((view.cy - hh) * n)), ty1 = Math.min(n - 1, Math.floor((view.cy + hh) * n));
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = ((tx % n) + n) % n; // the world repeats east-west
          let img = terrainTile(z, wx, ty), up = 0;
          while (!img && up < 5 && z - up > 1) { // until it arrives, stretch an already-loaded parent tile
            up++;
            img = tiles.get(`${z - up}/${wx >> up}/${ty >> up}`) ?? null;
          }
          if (!img) continue;
          const sub = 256 >> up;
          c.drawImage(img, (wx % (1 << up)) * sub, (ty % (1 << up)) * sub, sub, sub,
            (tx / n - view.cx) * view.scale + W / 2, (ty / n - view.cy) * view.scale + H / 2, ts + 0.5, ts + 0.5);
        }
    };

    const drawBase = () => {
      const c = bctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, "#0f3257");
      g.addColorStop(1, "#061425");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);

      // Sea floor in terraces: each deeper contour steps the water down a shade, and the edge of the
      // step above casts a soft shadow (light from the north-west) onto the deeper level below it.
      c.lineJoin = "round";
      const contours = depth.map(([d, rings]) => {
        const lp = new Path2D();
        trace(lp, rings, "open");
        return [d, lp] as const;
      });
      for (const [d, lp] of [...contours].reverse()) {
        const rings = depthFill.get(d);
        if (!rings) continue;
        const f = new Path2D();
        trace(f, rings, "fill");
        c.save();
        c.clip(f, "evenodd");
        c.fillStyle = "rgba(1,6,18,0.2)";
        c.fillRect(0, 0, W, H);
        c.strokeStyle = "rgba(0,3,10,0.16)";
        for (const [o, w] of [[5, 16], [3, 8], [1.5, 3]]) { // stacked strokes = cheap soft shadow
          c.setTransform(dpr, 0, 0, dpr, o * 0.6 * dpr, o * dpr);
          c.lineWidth = w;
          c.stroke(lp);
        }
        c.restore();
      }
      drawGrid(c);

      c.lineWidth = 1;
      for (const [d, lp] of contours) {
        c.strokeStyle = `rgba(70,150,235,${d <= 200 ? 0.6 : d <= 1000 ? 0.42 : d <= 2000 ? 0.3 : 0.2})`;
        c.stroke(lp);
      }

      const p = new Path2D(); // land area; lakes are rings inside it, so evenodd cuts them out as water
      trace(p, land, "fill");
      trace(p, lakes, "fill");
      const edge = new Path2D(); // sea coastline: gets the halo, inland contour rings and full glow
      trace(edge, land, "outline");
      const shore = new Path2D(); // lake shores: just a plain glowing line
      trace(shore, lakes, "outline");

      maskCanvas.width = fw; // also clears it
      maskCanvas.height = fh;
      mctx.setTransform(1 / PIX, 0, 0, 1 / PIX, 0, 0);
      mctx.fill(p, "evenodd");
      const md = mctx.getImageData(0, 0, fw, fh).data;
      landMask = new Uint8Array(fw * fh);
      for (let i = 0; i < landMask.length; i++) landMask[i] = md[i * 4 + 3] > 127 ? 1 : 0;

      // Land sits a layer up: a soft drop shadow onto the sea, then a dark side wall showing on the
      // south-east faces, then the top surface. Offsets are in CSS px (canvas shadows ignore the transform).
      c.save();
      c.shadowColor = "rgba(0,2,8,0.85)";
      c.shadowBlur = 18 * dpr;
      c.shadowOffsetX = 7 * dpr;
      c.shadowOffsetY = 12 * dpr;
      c.fillStyle = "#020e16";
      c.fill(p, "evenodd");
      c.restore();
      c.fillStyle = "#03151f";
      for (let k = 6; k >= 1; k--) {
        c.setTransform(dpr, 0, 0, dpr, k * 0.6 * dpr, k * dpr);
        c.fill(p, "evenodd");
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.strokeStyle = "rgba(90,210,255,0.07)"; // soft halo out to sea
      c.lineWidth = 22;
      c.stroke(edge);
      c.lineWidth = 10;
      c.stroke(edge);
      c.fillStyle = LAND;
      c.fill(p, "evenodd");
      // Inland: real terrain (shaded relief + elevation bands) clipped to the land, then a lit rim.
      c.save();
      c.clip(p, "evenodd");
      drawTerrain(c);
      c.setTransform(dpr, 0, 0, dpr, 1.2 * dpr, 2 * dpr); // lit rim on the north-west faces of the raised land
      c.lineWidth = 2.5;
      c.strokeStyle = "rgba(170,245,255,0.28)";
      c.stroke(edge);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.restore();

      // Rivers: faint glowing lines on the land. Small ones only appear as you zoom in.
      const kmPerPx = (EARTH_KM * Math.cos((fromMerc(0, view.cy)[1] * Math.PI) / 180)) / view.scale;
      const maxRank = kmPerPx < 0.4 ? 10 : kmPerPx < 1 ? 7 : kmPerPx < 3 ? 5 : 3;
      c.lineCap = "round";
      for (const [rank, lines] of rivers) {
        if (rank > maxRank) continue;
        const rp = new Path2D();
        trace(rp, lines, "open");
        const big = rank <= 3, mid = rank <= 6;
        c.lineWidth = big ? 4 : 3;
        c.strokeStyle = "rgba(120,235,255,0.1)";
        c.stroke(rp);
        c.lineWidth = big ? 1.4 : mid ? 1.1 : 0.8;
        c.strokeStyle = `rgba(150,240,255,${big ? 0.6 : mid ? 0.45 : 0.32})`;
        c.stroke(rp);
      }
      c.lineCap = "butt";
      for (const [w, col] of [[7, "rgba(120,240,255,0.14)"], [3.5, "rgba(120,240,255,0.4)"], [1.4, "#c4fcff"]] as const) {
        c.lineWidth = w;
        c.strokeStyle = col;
        c.stroke(edge);
      }
      for (const [w, col] of [[3.5, "rgba(120,240,255,0.25)"], [1.2, "rgba(196,252,255,0.85)"]] as const) {
        c.lineWidth = w;
        c.strokeStyle = col;
        c.stroke(shore);
      }

      const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,4,12,0.55)");
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    };

    // ---------- drawing: current streaks ----------
    const stepFlow = (dt: number) => {
      if (!img) return;
      const d = img.data;
      const M = MODES[mode];
      const mask = M.skipLand && landMask.length === fw * fh ? landMask : null;
      const keep = Math.pow(TRAIL, dt);
      for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = (d[i] * keep) | 0; // floor so it reaches 0
      for (let i = 0; i < px.length; i++) {
        const x = px[i], y = py[i];
        const inView = x >= 0 && y >= 0 && x < fw && y < fh;
        const s = field && inView && !mask?.[(y | 0) * fw + (x | 0)] ? sample(field, lonLeft + x * dLon, rowLat[y | 0]) : null;
        age[i] += dt;
        if (age[i] > life[i]) { spawn(i); continue; }
        // On land / no data: sit out the rest of this life invisibly. Re-rolling at once would
        // funnel every particle into the visible sea and carpet it when the view is mostly land.
        if (!s) continue;
        // Screen follows the flow: east -> right, north -> up.
        px[i] = x + s[0] * M.flow * dt;
        py[i] = y - s[1] * M.flow * dt;
        const sp = Math.hypot(s[0], s[1]);
        if (sp < M.still) continue; // slack: keep moving, don't draw a static dot
        const t = Math.min(1, sp / (M.full * 2));
        const fade = Math.min(1, age[i] * 3, (life[i] - age[i]) * 3);
        const k = ((y | 0) * fw + (x | 0)) * 4;
        const a = 255 * fade * (0.12 + 0.88 * Math.min(1, sp / M.full));
        if (a <= d[k + 3]) continue;
        d[k] = M.slow[0] + (M.fast[0] - M.slow[0]) * t;
        d[k + 1] = M.slow[1] + (M.fast[1] - M.slow[1]) * t;
        d[k + 2] = M.slow[2] + (M.fast[2] - M.slow[2]) * t;
        d[k + 3] = a;
      }
      fctx.putImageData(img, 0, 0);
    };

    // ---------- HUD ----------
    let lastHud = "";
    const updateHud = () => {
      const sx = cursor.x >= 0 ? cursor.x : W / 2, sy = cursor.x >= 0 ? cursor.y : H / 2;
      const [lon, lat] = toLonLat(sx, sy);
      const s = field ? sample(field, lon, lat) : null;
      const kn = s ? Math.hypot(s[0], s[1]) * MS_TO_KN : 0;
      const hdg = s ? ((Math.atan2(s[0], s[1]) * 180) / Math.PI + 360) % 360 : 0; // direction of travel
      const deg = (v: number) => `${Math.round(v % 360).toString().padStart(3, "0")}°`;
      // Mariner conventions: current is quoted by where it goes, wind by where it comes from.
      const txt = !s
        ? `${MODES[mode].label}: --`
        : mode === "wind"
          ? `WIND: ${kn.toFixed(1)} KN  FROM ${deg(hdg + 180)}`
          : `OCEAN CURRENT: ${kn.toFixed(2)} KN  ${deg(hdg)}`;
      const key = txt + lat.toFixed(3) + lon.toFixed(3);
      if (key === lastHud) return;
      lastHud = key;
      hud.current.current!.textContent = txt;
      hud.arrow.current!.style.opacity = s ? "1" : "0";
      hud.arrow.current!.style.transform = `rotate(${hdg}deg)`;
      hud.lat.current!.textContent = fmt(lat, "N", "S", 6);
      hud.lon.current!.textContent = fmt(lon, "E", "W", 7);
    };

    // ---------- loop ----------
    let raf = 0, last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const k = 650 * dt;
      const dx = (keys.has("a") ? k : 0) - (keys.has("d") ? k : 0);
      const dy = (keys.has("w") ? k : 0) - (keys.has("s") ? k : 0);
      if (dx || dy) panBy(dx, dy);
      if (keys.has("arrowup")) zoomAt(W / 2, H / 2, Math.exp(3 * dt));
      if (keys.has("arrowdown")) zoomAt(W / 2, H / 2, Math.exp(-3 * dt));
      if (bakeQueue.length) { // a few ms of tile baking per frame, so tiles arriving together can't stall a pan
        const t0 = performance.now();
        while (bakeQueue.length && performance.now() - t0 < 6) bakeQueue.shift()!();
        dirty = true;
      }
      if (dirty && W) { drawBase(); dirty = false; }
      if (!paused) stepFlow(dt);
      if (shipsDirty && W) { drawShips(); shipsDirty = false; }
      if (W && (bearingFrom || toolDrawn)) drawBearing();
      if (W) {
        updateHud();
        updateShipTip(cursor.x, cursor.y, cursor.x >= 0 && !cursor.down);
      }
      raf = requestAnimationFrame(frame);
    };

    // ---------- setup ----------
    const resize = () => {
      W = surface.clientWidth;
      H = surface.clientHeight;
      if (!W || !H) return;
      dpr = (window.devicePixelRatio || 1) / TABLE; // extra resolution so the flat (scaled-up) view stays sharp
      base.width = Math.round(W * dpr);
      base.height = Math.round(H * dpr);
      base.style.width = `${W}px`;
      base.style.height = `${H}px`;
      shipCanvas.width = base.width;
      shipCanvas.height = base.height;
      shipCanvas.style.width = `${W}px`;
      shipCanvas.style.height = `${H}px`;
      fw = Math.ceil(W / PIX);
      fh = Math.ceil(H / PIX);
      for (const c of [flow, toolCanvas]) { // low-res layers: chunky pixel look when upscaled
        c.width = fw;
        c.height = fh;
        c.style.width = `${fw * PIX}px`;
        c.style.height = `${fh * PIX}px`;
      }
      img = fctx.createImageData(fw, fh);
      const n = Math.floor((fw * fh) / 40);
      px = new Float32Array(n); py = new Float32Array(n); age = new Float32Array(n); life = new Float32Array(n);
      if (!view.scale) view.scale = W / (START.widthKm / (EARTH_KM * Math.cos((START.lat * Math.PI) / 180)));
      clampView();
      respawnAll();
      viewChanged();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(surface);

    fetch("/geo.json")
      .then((r) => r.json() as Promise<Geo>)
      .then((g) => {
        land = g.land.map(decode);
        lakes = g.lakes.map(decode);
        rivers = Object.entries(g.rivers).map(([k, lines]) => [Number(k), lines.map(decode)] as [number, Ring[]]);
        depth = Object.entries(g.depth)
          .map(([d, rings]) => [Number(d), rings.map(decode)] as [number, Ring[]])
          .sort((a, b) => b[0] - a[0]);
        depthFill = new Map(Object.entries(g.fill).map(([d, rings]) => [Number(d), rings.map(decode)]));
        dirty = true;
      })
      .catch((e) => console.error("geo load failed", e));

    // offsetX/Y are in the surface's own (untransformed) coordinates, so this stays correct when tilted.
    const onDown = (e: PointerEvent) => {
      // Buttons/links on the table (layer picker, attribution) must get their click. React's
      // stopPropagation runs too late to stop this native listener, and capturing the pointer on
      // a button swallows its click in WebKit, so bail out here.
      if ((e.target as Element).closest("button, a")) return;
      cursor.down = true;
      cursor.lx = cursor.dx = e.offsetX;
      cursor.ly = cursor.dy = e.offsetY;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events have no live pointer to capture; dragging still works without it
      }
    };
    const onMove = (e: PointerEvent) => {
      cursor.x = e.offsetX;
      cursor.y = e.offsetY;
      if (!cursor.down) return;
      panBy(e.offsetX - cursor.lx, e.offsetY - cursor.ly);
      cursor.lx = e.offsetX;
      cursor.ly = e.offsetY;
    };
    const onUp = (e: PointerEvent) => {
      if (cursor.down && Math.hypot(e.offsetX - cursor.dx, e.offsetY - cursor.dy) < 4) { // a click, not a drag
        const m = markAt(e.offsetX, e.offsetY);
        if (m && m.ships.length > 1) {
          // centre on it and zoom until its ships spread past a cell (clampView stops at max zoom,
          // where whatever still overlaps fans out)
          const pts = m.ships.map((sh) => toScreen(sh.x, sh.y));
          const spread = Math.max(
            Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])),
            Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])),
          );
          panBy(W / 2 - m.x, H / 2 - m.y);
          zoomAt(W / 2, H / 2, Math.min(64, Math.max(2, (2.5 * CELL) / Math.max(spread, 1))));
        }
      }
      cursor.down = false;
    };
    const onLeave = () => { if (!cursor.down) cursor.x = -1; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.2 : 0.006))); // ~1.8x per wheel notch (line-mode wheels send ~3/notch)
    };
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.type === "keyup") {
        keys.delete(key);
        if (key === "e") bearingFrom = null;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key === "e" && !e.repeat) {
        // anchor where the cursor is (map centre if it's off the table); stays put while panning
        const sx = cursor.x >= 0 ? cursor.x : W / 2, sy = cursor.x >= 0 ? cursor.y : H / 2;
        bearingFrom = toMercAt(sx, sy);
      }
      if (key === "t" && !e.repeat) setTilt((v) => !v);
      if (key === "p" && !e.repeat) {
        paused = !paused;
        hud.paused.current!.style.display = paused ? "block" : "none";
      }
      if (["w", "a", "s", "d", "arrowup", "arrowdown"].includes(key)) {
        keys.add(key);
        e.preventDefault();
      }
    };
    const onBlur = () => {
      keys.clear();
      bearingFrom = null; // keyup never arrives if focus leaves while E is held
    };
    setShipsRef.current = (on) => {
      shipsOn = on;
      shipsDirty = true;
      setShipStatus(on ? "SHIPS…" : "");
      if (on) pollShips();
    };
    setModeRef.current = (m) => {
      if (m === mode) return;
      mode = m;
      field = null;
      respawnAll();
      refresh();
    };

    surface.addEventListener("pointerdown", onDown);
    surface.addEventListener("pointermove", onMove);
    surface.addEventListener("pointerup", onUp);
    surface.addEventListener("pointercancel", onUp);
    surface.addEventListener("pointerleave", onLeave);
    surface.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fetchTimer);
      clearInterval(every15);
      clearInterval(every3);
      clearTimeout(shipTimer);
      ctrl?.abort();
      ro.disconnect();
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointermove", onMove);
      surface.removeEventListener("pointerup", onUp);
      surface.removeEventListener("pointercancel", onUp);
      surface.removeEventListener("pointerleave", onLeave);
      surface.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
    // hud refs are stable; the engine runs once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glow = "text-[#9ff0ff] [text-shadow:0_0_6px_rgba(90,220,255,0.7)]";

  return (
    <main
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_15%,#1a2633_0%,#070a0f_65%)] font-[family-name:var(--font-pixel)]"
      style={{ perspective: "1800px" }}
    >
      {/* One table, one layout. Flat is the same table pitched level and scaled to fill the screen, so the move
          reads as dipping your head over it; the bezel hangs outside the map box and slides off-screen. */}
      <div
        className="relative h-[84vh] w-[84vw] transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
        style={{ transform: tilt ? "rotateX(34deg) translateY(-6%) scale(1)" : `rotateX(0deg) translateY(0%) scale(${1 / TABLE})` }}
      >
        <div className="pointer-events-none absolute -inset-6 rounded-[26px] bg-[linear-gradient(180deg,#a9b8c5,#61707e)] shadow-[0_40px_80px_rgba(0,0,0,0.7)]" />
        <div className="pointer-events-none absolute -inset-2.5 rounded-[14px] bg-[#08121d] shadow-[inset_0_0_0_2px_#7ff0ff,inset_0_0_16px_2px_rgba(80,220,255,0.55),0_0_28px_rgba(80,220,255,0.35)]" />
        <div className="h-full w-full">
          <div
            ref={surfaceRef}
            className="relative h-full w-full cursor-crosshair touch-none select-none overflow-hidden rounded-[4px]"
          >
            <canvas ref={baseRef} className="absolute left-0 top-0" />
            <canvas ref={flowRef} className="absolute left-0 top-0 mix-blend-screen [image-rendering:pixelated]" />
            <canvas ref={shipRef} className="pointer-events-none absolute left-0 top-0" />
            <canvas
              ref={toolRef}
              className="pointer-events-none absolute left-0 top-0 [image-rendering:pixelated] [filter:drop-shadow(0_0_4px_rgba(120,235,255,0.85))]"
            />
            <div
              ref={bearingLabelRef}
              className={`pointer-events-none absolute hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-[#9ff0ff]/40 bg-[#041019]/80 px-2 pb-0.5 text-center leading-none ${glow}`}
            >
              <div className="text-4xl">000°</div>
              <div className="text-xl">0 KM · 0 NM</div>
            </div>
            <div
              ref={shipTipRef}
              className="pointer-events-none absolute hidden whitespace-pre border border-current/40 bg-black/60 px-2 py-0.5 text-lg leading-5 [text-shadow:0_0_6px_currentColor]"
            />

            <div className={`pointer-events-none absolute inset-x-4 top-3 flex items-center gap-3 border-b border-[#7ff0ff]/25 bg-black/30 px-3 py-0.5 text-xl italic ${glow}`}>
              <span ref={hud.current}>OCEAN CURRENT: --</span>
              <span ref={hud.arrow} className="inline-block opacity-0">↑</span>
              <span className="ml-auto flex items-center gap-4 text-base not-italic opacity-70">
                <span ref={shipStatusRef}>SHIPS…</span>
                <span ref={hud.status}>SYNCING…</span>
                <a
                  href={layer === "wind" ? "https://registry.opendata.aws/noaa-gfs-bdp-pds/" : "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.html"}
                  target="_blank"
                  rel="noreferrer"
                  className="pointer-events-auto underline-offset-2 hover:underline"
                >
                  {layer === "wind" ? "DATA: NOAA GFS" : "DATA: NOAA COASTWATCH"}
                </a>
              </span>
            </div>

            {/* Layer picker: holo radio squares. onDown skips buttons, so clicks never start a map drag. */}
            <div role="radiogroup" aria-label="Map layer" className="absolute left-5 top-14 flex flex-col gap-2">
              {(["ocean", "wind"] as const).map((m) => {
                const on = layer === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setLayer(m);
                      setModeRef.current(m);
                    }}
                    className={`group flex cursor-pointer items-center gap-2.5 text-xl italic outline-none transition-opacity ${glow} ${on ? "opacity-100" : "opacity-55 hover:opacity-90"}`}
                  >
                    <span className="flex h-[18px] w-[18px] items-center justify-center border-2 border-[#9ff0ff] shadow-[0_0_8px_rgba(90,220,255,0.6),inset_0_0_6px_rgba(90,220,255,0.35)] group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-offset-2 group-focus-visible:outline-[#9ff0ff]">
                      <span
                        className={`h-2 w-2 bg-[#bff8ff] shadow-[0_0_8px_2px_rgba(120,235,255,0.9)] transition-transform duration-200 ease-out ${on ? "scale-100" : "scale-0"}`}
                      />
                    </span>
                    {m === "ocean" ? "OCEAN CURRENT" : "WIND"}
                  </button>
                );
              })}
              <button
                type="button"
                role="switch"
                aria-checked={showShips}
                onClick={() => {
                  setShowShips(!showShips);
                  setShipsRef.current(!showShips);
                }}
                className={`group mt-2 flex cursor-pointer items-center gap-2.5 text-xl italic outline-none transition-opacity ${glow} ${showShips ? "opacity-100" : "opacity-55 hover:opacity-90"}`}
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center border-2 border-[#9ff0ff] shadow-[0_0_8px_rgba(90,220,255,0.6),inset_0_0_6px_rgba(90,220,255,0.35)] group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-offset-2 group-focus-visible:outline-[#9ff0ff]">
                  <span
                    className={`h-2 w-2 bg-[#bff8ff] shadow-[0_0_8px_2px_rgba(120,235,255,0.9)] transition-transform duration-200 ease-out ${showShips ? "scale-100" : "scale-0"}`}
                  />
                </span>
                SHIPS
              </button>
            </div>

            <div ref={hud.paused} className={`pointer-events-none absolute left-1/2 top-12 hidden -translate-x-1/2 text-2xl ${glow}`}>
              ‖ PAUSED
            </div>

            <div className={`pointer-events-none absolute left-5 -skew-x-12 text-4xl leading-none text-[#8fe9ff]/35 transition-[bottom] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] ${tilt ? "bottom-3" : "bottom-32"}`}>
              <div ref={hud.lat}>N 00.000°</div>
              <div ref={hud.lon}>W 000.000°</div>
            </div>

            <div className={`pointer-events-none absolute bottom-4 right-6 flex flex-col items-end gap-1 ${glow}`}>
              <span ref={hud.scaleLabel} className="text-2xl leading-none">--</span>
              <div ref={hud.scaleBar} className="relative h-2 border-x-2 border-b-2 border-[#9ff0ff]/70">
                <div className="absolute bottom-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-[#9ff0ff]/70" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-3 left-3 rounded-sm bg-black/85 px-2 py-1.5 text-lg leading-6 text-white/90">
        {[
          [["drag", "w", "a", "s", "d"], "pan"],
          [["scroll", "up", "down"], "zoom"],
          [["e"], "hold: bearing"],
          [["t"], tilt ? "flatten" : "tilt"],
          [["p"], "pause"],
        ].map(([ks, label]) => (
          <div key={label as string} className="flex items-center gap-1">
            {(ks as string[]).map((k) => (
              <kbd key={k} className="rounded-[3px] bg-white/15 px-1 font-[family-name:var(--font-pixel)] leading-5">
                {k}
              </kbd>
            ))}
            <span className="ml-1">{label as string}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
