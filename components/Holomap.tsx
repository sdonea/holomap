"use client";

import { useEffect, useRef, useState } from "react";
import { fromMerc, pickStep, rhumb, sample, toMerc, type Field } from "@/lib/geo";
import { loadField, loadWindField, type Layer } from "@/lib/currents";

const PIX = 3; // one current "pixel" = 3x3 CSS px, upscaled with nearest-neighbour
const TRAIL = 0.15; // fraction of streak brightness left after 1 s (shorter = crisper streaks)
// Per-mode look. flow = streak speed in low-res px/s per m/s (visual exaggeration, same at every
// zoom); wind runs ~15x faster than water, so it gets a far smaller multiplier.
// full = speed (m/s) that draws at full brightness; still = below this, don't draw.
const MODES = {
  ocean: { label: "OCEAN CURRENT", flow: 22, full: 0.6, still: 0.03, cols: 24, skipLand: true, slow: [40, 150, 185], fast: [120, 255, 215] },
  wind: { label: "WIND", flow: 1.6, full: 9, still: 0.5, cols: 0, skipLand: false, slow: [110, 140, 185], fast: [235, 245, 255] }, // cols unused: wind is one global grid
} as const;
const EARTH_KM = 40075;
const MS_TO_KN = 1.943844;
const START = { lon: -71, lat: 36.5, widthKm: 2600 }; // Gulf Stream off Cape Hatteras
const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const LAND = "#0a3144";

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
type Geo = { land: number[][]; depth: Record<string, number[][]> };

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

// Even-odd point-in-polygon against the land rings (merc coords), bbox-culled.
function onLand(rings: Ring[], x: number, y: number) {
  let inside = false;
  for (const r of rings) {
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const p = r.pts;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
      if (p[i + 1] > y !== p[j + 1] > y && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  }
  return inside;
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
    let land: Ring[] = [];
    let depth: [number, Ring[]][] = [];
    let field: Field | null = null;
    let dirty = true, paused = false;
    let mode: Layer = "ocean";
    let px = new Float32Array(0), py = new Float32Array(0), age = new Float32Array(0), life = new Float32Array(0);
    let rowLat = new Float32Array(0), lonLeft = 0, dLon = 0;
    const shift = { x: 0, y: 0 };
    const keys = new Set<string>();
    const cursor = { x: -1, y: -1, down: false, lx: 0, ly: 0 };

    // ---------- view math ----------
    const toScreen = (x: number, y: number): [number, number] => [
      (x - view.cx) * view.scale + W / 2,
      (y - view.cy) * view.scale + H / 2,
    ];
    const toLonLat = (sx: number, sy: number) =>
      fromMerc(view.cx + (sx - W / 2) / view.scale, view.cy + (sy - H / 2) / view.scale);
    const clampView = () => {
      const minS = W; // whole world across the screen
      const latc = fromMerc(0, view.cy)[1];
      const maxS = W / (20 / (EARTH_KM * Math.cos((latc * Math.PI) / 180))); // ~20 km across
      view.scale = Math.min(maxS, Math.max(minS, view.scale));
      const hx = W / 2 / view.scale, hy = H / 2 / view.scale;
      view.cx = hx >= 0.5 ? 0.5 : Math.min(1 - hx, Math.max(hx, view.cx));
      view.cy = hy >= 0.5 ? 0.5 : Math.min(1 - hy, Math.max(hy, view.cy));
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
      const ox = view.cx, oy = view.cy;
      view.cx -= dx / view.scale;
      view.cy -= dy / view.scale;
      clampView();
      shiftTrails((ox - view.cx) * view.scale, (oy - view.cy) * view.scale);
      viewChanged();
    };
    const zoomAt = (sx: number, sy: number, f: number) => {
      const mx = view.cx + (sx - W / 2) / view.scale, my = view.cy + (sy - H / 2) / view.scale;
      view.scale *= f;
      clampView();
      view.cx = mx - (sx - W / 2) / view.scale;
      view.cy = my - (sy - H / 2) / view.scale;
      clampView();
      respawnAll();
      viewChanged();
    };

    // ---------- current data ----------
    let ctrl: AbortController | null = null;
    let geoReady = false;
    const setStatus = (s: string) => { if (hud.status.current) hud.status.current.textContent = s; };
    const isLand = (lon: number, lat: number) => onLand(land, ...toMerc(lon, lat));
    async function refresh() {
      if (!W || !geoReady) return; // need coastlines first so we never pay for ocean points on land
      clearTimeout(fetchTimer);
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      const M = MODES[mode];
      const [west, north] = toLonLat(-W * 0.08, -H * 0.08);
      const [east, south] = toLonLat(W * 1.08, H * 1.08);
      setStatus("SYNCING…");
      try {
        const { field: f, retryAfter } =
          mode === "wind"
            ? { field: await loadWindField(c.signal), retryAfter: 0 }
            : await loadField(
                mode,
                { west: Math.max(-180, west), east: Math.min(180, east), south, north },
                pickStep(east - west, M.cols),
                c.signal,
                isLand,
              );
        if (c.signal.aborted) return;
        field = f;
        if (retryAfter) {
          // Free tier is 600 points/min: show what we have, fill the rest in later.
          setStatus(`API LIMIT · MORE IN ${retryAfter > 120 ? `${Math.ceil(retryAfter / 60)} MIN` : `${retryAfter}s`}`);
          fetchTimer = window.setTimeout(refresh, retryAfter * 1000);
        } else setStatus(f.time ? `DATA ${f.time.slice(11, 16)}Z` : "");
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
      const [w, n] = toLonLat(0, 0);
      const [e, s] = toLonLat(W, H);
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

    // CC2-style marker: chevron along course + a leader line whose length is speed; square if stopped.
    const drawShips = () => {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, W, H);
      if (!shipsOn) return;
      const visible = ships.filter((s) => {
        const [x, y] = toScreen(s.x, s.y);
        return x > -20 && y > -20 && x < W + 20 && y < H + 20;
      });
      const labels = visible.length <= 60;
      const glowPx = visible.length > 150 ? 0 : 6; // glow on crowded ports merges into blobs
      if (visible.length > 300) {
        // Zoomed far out: speed lines merge into starbursts, so plot plain dots.
        for (const s of visible) {
          const [x, y] = toScreen(s.x, s.y);
          sctx.fillStyle = shipKind(s.type).color;
          sctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        }
        return;
      }
      sctx.font = `15px ${pixelFont}`;
      sctx.textAlign = "center";
      sctx.lineWidth = 1.5;
      for (const s of visible) {
        const [x, y] = toScreen(s.x, s.y).map(Math.round);
        const kind = shipKind(s.type);
        sctx.strokeStyle = sctx.fillStyle = kind.color;
        sctx.shadowColor = kind.color;
        sctx.shadowBlur = glowPx;
        if (s.cog == null || s.sog < 0.5) {
          sctx.strokeRect(x - 3, y - 3, 6, 6);
        } else {
          const a = (s.cog * Math.PI) / 180; // 0 = north, clockwise
          const dx = Math.sin(a), dy = -Math.cos(a);
          sctx.beginPath();
          sctx.moveTo(x + dx * 7, y + dy * 7);
          sctx.lineTo(x - dx * 4 - dy * 4, y - dy * 4 + dx * 4);
          sctx.lineTo(x - dx * 1.5, y - dy * 1.5);
          sctx.lineTo(x - dx * 4 + dy * 4, y - dy * 4 - dx * 4);
          sctx.closePath();
          sctx.fill();
          const lead = Math.min(45, 8 + s.sog * 2);
          sctx.beginPath();
          sctx.moveTo(x + dx * 8, y + dy * 8);
          sctx.lineTo(x + dx * lead, y + dy * lead);
          sctx.stroke();
        }
        if (labels && s.name) {
          sctx.shadowBlur = 0;
          sctx.globalAlpha = 0.8;
          sctx.fillText(s.name, x, y + 18);
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

    let hoverShip = -1;
    const updateShipTip = (sx: number, sy: number, active: boolean) => {
      let best: Ship | null = null, bd = 14 * 14;
      if (active && shipsOn)
        for (const s of ships) {
          const [x, y] = toScreen(s.x, s.y);
          const d = (x - sx) ** 2 + (y - sy) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
      const tip = shipTipRef.current!;
      if (!best) {
        if (hoverShip !== -1) { tip.style.display = "none"; hoverShip = -1; }
        return;
      }
      const [x, y] = toScreen(best.x, best.y);
      tip.style.display = "block";
      tip.style.left = `${x + 14}px`;
      tip.style.top = `${y - 10}px`;
      if (hoverShip === best.mmsi) return;
      hoverShip = best.mmsi;
      const kind = shipKind(best.type);
      tip.style.color = kind.color;
      tip.textContent =
        `${best.name || `MMSI ${best.mmsi}`}\n${kind.name}  ${best.sog.toFixed(1)} KN` +
        (best.cog != null ? `  ${Math.round(best.cog).toString().padStart(3, "0")}°` : "");
    };

    // ---------- drawing: static layers ----------
    // close=false for depth contours: they're open polylines (artificial seam edges were cut out)
    const trace = (ctx: CanvasRenderingContext2D | Path2D, rings: Ring[], close = true) => {
      const vx0 = view.cx - W / 2 / view.scale, vx1 = view.cx + W / 2 / view.scale;
      const vy0 = view.cy - H / 2 / view.scale, vy1 = view.cy + H / 2 / view.scale;
      for (const r of rings) {
        if (r.x1 < vx0 || r.x0 > vx1 || r.y1 < vy0 || r.y0 > vy1) continue;
        let [lx, ly] = toScreen(r.pts[0], r.pts[1]);
        ctx.moveTo(lx, ly);
        for (let i = 2; i < r.pts.length; i += 2) {
          const [x, y] = toScreen(r.pts[i], r.pts[i + 1]);
          if (Math.abs(x - lx) + Math.abs(y - ly) < 1 && i < r.pts.length - 2) continue;
          ctx.lineTo(x, y);
          lx = x;
          ly = y;
        }
        if (close) ctx.closePath();
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

    const drawBase = () => {
      const c = bctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, "#0f3257");
      g.addColorStop(1, "#061425");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      drawGrid(c);

      c.lineJoin = "round";
      c.lineWidth = 1;
      for (const [d, rings] of depth) {
        c.beginPath();
        trace(c, rings, false);
        c.strokeStyle = `rgba(70,150,235,${d <= 200 ? 0.6 : d <= 1000 ? 0.42 : d <= 2000 ? 0.3 : 0.2})`;
        c.stroke();
      }

      const p = new Path2D();
      trace(p, land);

      maskCanvas.width = fw; // also clears it
      maskCanvas.height = fh;
      mctx.setTransform(1 / PIX, 0, 0, 1 / PIX, 0, 0);
      mctx.fill(p, "evenodd");
      const md = mctx.getImageData(0, 0, fw, fh).data;
      landMask = new Uint8Array(fw * fh);
      for (let i = 0; i < landMask.length; i++) landMask[i] = md[i * 4 + 3] > 127 ? 1 : 0;

      c.strokeStyle = "rgba(90,210,255,0.07)"; // soft halo out to sea
      c.lineWidth = 22;
      c.stroke(p);
      c.lineWidth = 10;
      c.stroke(p);
      c.fillStyle = LAND;
      c.fill(p, "evenodd");
      // Inland contour rings: paint a band, then paint land colour over all but its outer edge.
      // Largest first, so each smaller band leaves the bigger rings intact.
      c.save();
      c.clip(p, "evenodd");
      for (const d of [40, 28, 18, 10, 4]) {
        c.lineWidth = 2 * d + 1.5;
        c.strokeStyle = `rgba(110,235,250,${0.18 + (40 - d) / 150})`;
        c.stroke(p);
        c.lineWidth = 2 * d;
        c.strokeStyle = LAND;
        c.stroke(p);
      }
      c.restore();
      for (const [w, col] of [[7, "rgba(120,240,255,0.14)"], [3.5, "rgba(120,240,255,0.4)"], [1.4, "#c4fcff"]] as const) {
        c.lineWidth = w;
        c.strokeStyle = col;
        c.stroke(p);
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
      if (keys.has("arrowup")) zoomAt(W / 2, H / 2, Math.exp(1.6 * dt));
      if (keys.has("arrowdown")) zoomAt(W / 2, H / 2, Math.exp(-1.6 * dt));
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
      dpr = window.devicePixelRatio || 1;
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
        depth = Object.entries(g.depth)
          .map(([d, rings]) => [Number(d), rings.map(decode)] as [number, Ring[]])
          .sort((a, b) => b[0] - a[0]);
        dirty = true;
        geoReady = true;
        refresh();
      })
      .catch((e) => console.error("geo load failed", e));

    // offsetX/Y are in the surface's own (untransformed) coordinates, so this stays correct when tilted.
    const onDown = (e: PointerEvent) => {
      // Buttons/links on the table (layer picker, attribution) must get their click. React's
      // stopPropagation runs too late to stop this native listener, and capturing the pointer on
      // a button swallows its click in WebKit, so bail out here.
      if ((e.target as Element).closest("button, a")) return;
      cursor.down = true;
      cursor.lx = e.offsetX;
      cursor.ly = e.offsetY;
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
    const onUp = () => { cursor.down = false; };
    const onLeave = () => { if (!cursor.down) cursor.x = -1; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
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
        bearingFrom = [view.cx + (sx - W / 2) / view.scale, view.cy + (sy - H / 2) / view.scale];
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
      <div
        className={
          tilt
            ? "aspect-[16/10] w-[min(88vw,128vh)] rounded-[26px] bg-[linear-gradient(180deg,#a9b8c5,#61707e)] p-[14px] shadow-[0_40px_80px_rgba(0,0,0,0.7)]"
            : "absolute inset-0"
        }
        style={{ transform: tilt ? "rotateX(34deg) translateY(-6%)" : "none" }}
      >
        <div
          className={
            tilt
              ? "h-full w-full rounded-[14px] bg-[#08121d] p-[10px] shadow-[inset_0_0_0_2px_#7ff0ff,inset_0_0_16px_2px_rgba(80,220,255,0.55),0_0_28px_rgba(80,220,255,0.35)]"
              : "h-full w-full"
          }
        >
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
                  href={layer === "wind" ? "https://registry.opendata.aws/noaa-gfs-bdp-pds/" : "https://open-meteo.com/"}
                  target="_blank"
                  rel="noreferrer"
                  className="pointer-events-auto underline-offset-2 hover:underline"
                >
                  {layer === "wind" ? "DATA: NOAA GFS" : "DATA: OPEN-METEO"}
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

            <div className={`pointer-events-none absolute left-5 -skew-x-12 text-4xl leading-none text-[#8fe9ff]/35 ${tilt ? "bottom-3" : "bottom-32"}`}>
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
