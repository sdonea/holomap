"use client";

import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";
import { fromMerc, rhumb, sample, toMerc, type Field } from "@/lib/geo";
import { loadGrid, loadWindForecast, type Layer } from "@/lib/currents";
import { bestSaving, gcAt, gcMetres, legSeconds, planRoute, windAt, type Env, type LandMask, type LonLat, type Route, type Search, type WindSeries } from "@/lib/route";
import { matchDestination, parseAisEta, PORTS, type Port } from "@/lib/ports";
import { DEFAULT_MARKET, type Market } from "@/lib/economics";
import RoutePanel, { type PlayState, type RouteInfo } from "./RoutePanel";
import AboutPanel from "./AboutPanel";
import Toolbar, { type Tool } from "./Toolbar";

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
// Route planner calibration: ship speed choices (knots) and the shallowest sea it will enter (12 m draught +
// margin). Fuel burn and prices live in lib/economics.ts.
const SPEEDS = [6, 8, 10, 12, 14, 16, 18, 20, 24];
const SHIP_KN_START = 12;
const MIN_DEPTH_M = 15;
const ROUTE = "#ffd27a"; // plotted course: amber, so it stands apart from the cyan bearing and streaks

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
// What the ship panel shows: /api/ships?mmsi= (fields missing until that ship's static data arrives, ~6 min)
type ShipInfo = {
  mmsi: number; name: string; type: number; lat: number; lon: number; sog: number; cog: number | null; hdg?: number | null;
  cls?: "A" | "B"; nav?: number; call?: string; imo?: number; dest?: string; eta?: string; len?: number; beam?: number; draught?: number;
  age?: number; lost?: boolean; track?: number[]; // [lon, lat, ...] reported positions, last 6 h, oldest first
};
const NAV_STATUS = ["UNDER WAY", "AT ANCHOR", "NOT UNDER COMMAND", "RESTRICTED MANOEUVRE", "CONSTRAINED BY DRAUGHT", "MOORED", "AGROUND", "FISHING", "UNDER WAY (SAIL)"];
const deg3 = (v?: number | null) => (v == null ? undefined : `${Math.round(v % 360).toString().padStart(3, "0")}°`);

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

// Initial great-circle bearing a -> b, degrees true.
const gcBearing = ([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) => {
  const r = Math.PI / 180, dl = (lon2 - lon1) * r;
  const e = Math.sin(dl) * Math.cos(lat2 * r);
  const n = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dl);
  return ((Math.atan2(e, n) / r) + 360) % 360;
};
// First-visit demo: every trip between these offshore points (500 km or more), and the one where today's
// Gulf Stream makes the optimal route beat the straight line by the most gets plotted. Usually a
// southbound trip that swings out around the stream instead of fighting it.
const DEMO_PTS: [string, LonLat][] = [
  ["Miami", [-79.7, 25.8]], ["Cape Canaveral", [-79.6, 28.5]], ["Charleston", [-78.3, 31.8]], ["Cape Hatteras", [-74.9, 35.2]],
  ["New York", [-72.0, 39.6]], ["Georges Bank", [-67.5, 40.8]], ["Nova Scotia", [-63.5, 43.0]], ["Bermuda", [-64.8, 32.1]], ["Abaco", [-76.0, 26.5]],
];
const DEMO_TRIPS = DEMO_PTS.flatMap(([na, a]) => DEMO_PTS.filter(([, b]) => b !== a && gcMetres(a, b) >= 500e3).map(([nb, b]) => ({ name: `${na} to ${nb}`, a, b })));
const DEMO_FALLBACK = DEMO_TRIPS.find((t) => t.name === "Nova Scotia to Charleston")!;
// Isochrones for "watch it think": a settled cell is on a ring when a settled neighbour was reached in an
// earlier time band (band = secs). Rings of equal travel time bulge where the current helps.
const isochrones = (S: Search, band: number) => {
  const b = new Int32Array(S.cols * S.rows).fill(-1), ring = new Uint8Array(S.cols * S.rows);
  S.order.forEach((c, q) => { b[c] = Math.floor(S.secs[q] / band); });
  for (const c of S.order) {
    const i = c % S.cols;
    for (const nb of [c - 1, c + 1, c - S.cols, c + S.cols])
      if (nb >= 0 && nb < b.length && Math.abs((nb % S.cols) - i) <= 1 && b[nb] >= 0 && b[nb] < b[c]) { ring[c] = 1; break; }
  }
  return ring;
};
const SEEN = "holomap.seen";
const THINK = "holomap.think";
// Ports on the map, hubs first: a label only draws where it doesn't overlap one drawn before it, so
// zoomed out you see these, and the rest of lib/ports.ts fills in as you zoom.
const HUBS = ("SGSIN CNSHA NLRTM USLAX USNYC AEJEA HKHKG KRPUS CNNGB DEHAM BEANR EGPSD PABLB BRSSZ ZADUR LKCMB " +
  "MYPKG USHOU TWKHH JPTYO ESALG GRPIR MATNG AUMEL INNSA SAJED OMSLL CAVAN CAHAL USSAV USMIA USSEA USORF " +
  "DJJIB KEMBA NGAPP ARBUE CLSAI PECLL MXZLO GBFXT FRLEH ITGOA TRIST CNYTN CNTAO JPYOK").split(" ");
const hubRank = (p: Port) => (HUBS.includes(p.code) ? HUBS.indexOf(p.code) : HUBS.length);
const MAP_PORTS = [...PORTS].sort((a, b) => hubRank(a) - hubRank(b)).map((p) => ({ p, m: toMerc(p.lon, p.lat) }));
const NO_PLAY: PlayState = { t: -1, playing: false, total: 0, wind: "", current: "" };
// What the ship panel's ROUTE TO button hands the engine.
type ShipLeg = { name: string; port: string; lon: number; lat: number; portLon: number; portLat: number; kn: number; cog: number | null; eta: number | null };
type Api = {
  setTool: (t: Tool) => void; clear: () => void; share: () => void; play: () => void; seek: (t: number) => void;
  routeShip: (s: ShipLeg) => void; closeRoute: () => void;
};

export default function Holomap() {
  const [tilt, setTilt] = useState(true);
  const [layer, setLayer] = useState<Layer>("ocean");
  const setModeRef = useRef<(m: Layer) => void>(() => {});
  const [showShips, setShowShips] = useState(true);
  const setShipsRef = useRef<(on: boolean) => void>(() => {});
  const [ship, setShip] = useState<ShipInfo | null>(null);
  const [panel, setPanel] = useState<"ship" | "route" | null>(null);
  const shipOpen = panel === "ship";
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [play, setPlay] = useState<PlayState>(NO_PLAY);
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const [about, setAbout] = useState(false);
  // "Watch it think" (? panel): replay the planner's search before each route appears. Remembered per browser.
  const [think, setThink] = useState(false);
  const thinkRef = useRef(false);
  useEffect(() => {
    try { setThink(localStorage.getItem(THINK) === "1"); } catch { /* storage blocked: stays off */ }
  }, []);
  useEffect(() => {
    thinkRef.current = think;
    try { localStorage.setItem(THINK, think ? "1" : "0"); } catch { /* storage blocked: this visit only */ }
  }, [think]);
  const [toolUi, setToolUi] = useState<Tool>("none");
  const [hint, setHint] = useState("");
  const [copied, setCopied] = useState(false);
  const api = useRef<Api | null>(null);
  const thinkCapRef = useRef<HTMLDivElement>(null); // the step caption while a search replays
  const routePanelOpen = useRef(false); // the engine hides the map label while the panel shows the same numbers
  useEffect(() => { routePanelOpen.current = panel === "route"; }, [panel]);
  const closeShipRef = useRef<() => void>(() => {});
  const shipRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef<HTMLCanvasElement>(null);
  const bearingLabelRef = useRef<HTMLDivElement>(null);
  const routeLabelRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(SHIP_KN_START);
  const setKnotsRef = useRef<(k: number) => void>(() => {});
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
    let selMmsi: number | null = null; // ship shown in the side panel
    let selTrack: [number, number][] = []; // its past reported positions, merc, oldest first
    const toolCanvas = toolRef.current!;
    const tctx = toolCanvas.getContext("2d", { willReadFrequently: true })!; // read back every frame to threshold
    let bearingFrom: [number, number] | null = null; // merc point where E was pressed / the bearing drag began
    let bearingTo: [number, number] | null = null; // pinned end of a finished bearing drag (touch has no hover)
    let tool: Tool = "none";
    let toolDrawn = false, toolKey = "";
    // Plotted route (ROUTE tool or hold E + click). line = densified great-circle legs in merc, x unwrapped
    // from the start so a date-line crossing stays one piece; joints = waypoints where the legs meet;
    // times = seconds after departure at each line point (for playback).
    type Plot = {
      from: [number, number]; to: [number, number]; line: [number, number][]; joints: [number, number][]; text: string[];
      times: number[]; wind: WindSeries | null; current: Field | null; ship?: ShipLeg;
    };
    let route: Plot | null = null, routeJob = 0, routeVer = 0;
    let playT = -1, playing = false, playPush = 0; // voyage clock (s after departure), -1 = not started

    let W = 0, H = 0, dpr = 1, fw = 0, fh = 0;
    let img: ImageData | null = null;
    // Land mask at streak resolution (1 = land). The current grid is ~1° coarse and interpolates up
    // to the shore, so without this, ocean streaks drift up to a grid cell inland.
    let landMask = new Uint8Array(0);
    const maskCanvas = document.createElement("canvas");
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    const [mx0, my0] = toMerc(START.lon, START.lat);
    const view = { cx: mx0, cy: my0, scale: 0 }; // merc centre + CSS px per merc unit
    let startKm = START.widthKm; // width of the first view (a shared link can set it)
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
    let scratch = new Uint8ClampedArray(0); // reused by shiftTrails/zoomTrails: a fresh 0.6 MB per pan frame fed the GC
    const scratchFor = (n: number) => (scratch.length === n ? scratch : (scratch = new Uint8ClampedArray(n)));
    const shiftTrails = (dx: number, dy: number) => {
      shift.x += dx / PIX;
      shift.y += dy / PIX;
      const ix = Math.round(shift.x), iy = Math.round(shift.y);
      shift.x -= ix;
      shift.y -= iy;
      if (!ix && !iy) return;
      for (let i = 0; i < px.length; i++) { px[i] += ix; py[i] += iy; }
      if (!img) return;
      const src = img.data, out = scratchFor(src.length);
      out.fill(0);
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
      const d = new Uint32Array(img.data.buffer), old = new Uint32Array(scratchFor(img.data.length).buffer);
      old.set(d);
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
      saveHash();
    };
    // The address bar always holds the view, layer, speed and route, so copying it is sharing:
    // #v=lon,lat,widthKm&l=wind&kn=10&r=lon1,lat1,lon2,lat2
    let hashTimer = 0;
    const hashNow = () => {
      if (!W) return location.hash;
      const [lon, lat] = fromMerc(view.cx, view.cy);
      const km = (W / view.scale) * EARTH_KM * Math.cos((lat * Math.PI) / 180);
      const q = [`v=${lon.toFixed(2)},${lat.toFixed(2)},${Math.round(km)}`];
      if (mode !== "ocean") q.push(`l=${mode}`);
      if (knots !== SHIP_KN_START) q.push(`kn=${knots}`);
      if (route) q.push(`r=${[...fromMerc(...route.from), ...fromMerc(...route.to)].map((v) => v.toFixed(3)).join(",")}`);
      return `#${q.join("&")}`;
    };
    const saveHash = () => {
      clearTimeout(hashTimer);
      hashTimer = window.setTimeout(() => history.replaceState(null, "", hashNow()), 400);
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
      let [w, n] = toLonLat(0, 0);
      let [e, s] = toLonLat(W, H);
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
    async function pollSelected() {
      const id = selMmsi;
      if (id == null) return;
      try {
        const r = (await (await fetch(`/api/ships?mmsi=${id}`)).json()) as { ship: ShipInfo | null };
        if (selMmsi !== id) return; // picked another ship meanwhile
        const t = r.ship?.track;
        if (t) {
          selTrack = [];
          for (let i = 0; i < t.length; i += 2) selTrack.push(toMerc(t[i], t[i + 1]));
          shipsDirty = true;
        }
        setShip((p) => r.ship ?? (p && { ...p, lost: true }));
      } catch {
        // keep showing the last good data; the next poll retries
      }
    }
    const selectShip = (sh: Ship | null) => {
      selMmsi = sh?.mmsi ?? null;
      selTrack = [];
      shipsDirty = true;
      setPanel((p) => (sh ? "ship" : p === "ship" ? null : p));
      if (!sh) return;
      const [lon, lat] = fromMerc(sh.x, sh.y);
      setShip({ mmsi: sh.mmsi, name: sh.name, type: sh.type, lat, lon, sog: sh.sog, cog: sh.cog }); // instant, then fill in
      pollSelected();
    };
    closeShipRef.current = () => selectShip(null);
    const every3 = window.setInterval(() => { pollShips(); pollSelected(); }, 3000);

    // Ships that crowd together on screen merge into one small radar blip: a ring split into arcs by ship
    // type, with the count beside it (click to zoom in). Cells are pinned to the map, so blips don't
    // reshuffle while panning. Lone ships get a course arrow (or a diamond when stopped).
    type Mark = { x: number; y: number; r: number; ships: Ship[]; kinds: [{ name: string; color: string }, number][]; from?: [number, number] };
    let marks: Mark[] = [];
    const CELL = 72;
    // Selected ship's past course: an X on each reported position, straight lines between, ending at the
    // ship. Xs that would pile up on screen are skipped (newest kept); the line still runs through them all.
    // ponytail: a track across the date line draws a line across the screen; split at |dx| > W/2 if it shows up
    const drawTrack = (sel: Ship) => {
      if (!selTrack.length) return;
      const pts = selTrack.map(([x, y]) => toScreen(x, y));
      const [ex, ey] = toScreen(sel.x, sel.y);
      sctx.strokeStyle = sctx.shadowColor = shipKind(sel.type).color;
      sctx.lineCap = "round";
      sctx.shadowBlur = 6;
      sctx.lineWidth = 1.5;
      sctx.globalAlpha = 0.65;
      sctx.beginPath();
      pts.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
      sctx.lineTo(ex, ey);
      sctx.stroke();
      sctx.globalAlpha = 1;
      sctx.lineWidth = 2.5;
      sctx.beginPath();
      let lx = ex, ly = ey;
      for (let i = pts.length - 1; i >= 0; i--) {
        const [x, y] = pts[i];
        if (Math.hypot(x - lx, y - ly) < 14) continue;
        lx = x;
        ly = y;
        sctx.moveTo(x - 5, y - 5); sctx.lineTo(x + 5, y + 5);
        sctx.moveTo(x + 5, y - 5); sctx.lineTo(x - 5, y + 5);
      }
      sctx.stroke();
      sctx.shadowBlur = 0;
      sctx.lineCap = "butt";
    };
    // Ports: a small square and name, hubs first, skipping any whose label would overlap one already
    // drawn. While picking a route's ends they turn amber: tapping one starts/ends the route there.
    let portMarks: { p: Port; m: [number, number]; box: [number, number, number, number] }[] = [];
    let portsHot = false;
    const pickingEnds = () => tool === "route" || (tool === "none" && !!bearingFrom && keys.has("e"));
    const drawPorts = () => {
      portMarks = [];
      sctx.font = `13px ${pixelFont}`;
      sctx.textAlign = "left";
      sctx.textBaseline = "middle";
      sctx.lineWidth = 1.5;
      sctx.strokeStyle = sctx.fillStyle = sctx.shadowColor = portsHot ? "#ffd27a" : "#cfefff";
      sctx.globalAlpha = portsHot ? 0.95 : 0.6;
      const squares = new Path2D(); // stroked once at the end: one glow pass, not one per port
      for (const { p, m } of MAP_PORTS) {
        const [x, y] = toScreen(...m).map(Math.round);
        if (x < -80 || y < -10 || x > W + 10 || y > H + 10) continue;
        const box: [number, number, number, number] = [x - 5, y - 7, x + 8 + sctx.measureText(p.name).width, y + 7];
        if (portMarks.some(({ box: b }) => box[0] < b[2] + 4 && box[2] + 4 > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        portMarks.push({ p, m, box });
        squares.rect(x - 2.5, y - 2.5, 5, 5);
        sctx.fillText(p.name, x + 7, y + 1);
      }
      sctx.shadowBlur = portsHot ? 6 : 0;
      sctx.stroke(squares);
      sctx.globalAlpha = 1;
      sctx.shadowBlur = 0;
    };
    // The drawn port under a tap (its square or its name), with a little slack for fingers.
    const portAt = (sx: number, sy: number) =>
      portMarks.find(({ box: b }) => sx >= b[0] - 8 && sx <= b[2] + 4 && sy >= b[1] - 8 && sy <= b[3] + 8);
    // Ports go under the ships, except while picking route ends: then ships can't be clicked and
    // ports on top keep busy harbours (all blips) tappable.
    const drawShips = () => {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, W, H);
      marks = [];
      portsHot = pickingEnds();
      if (!portsHot) drawPorts();
      if (shipsOn) drawShipMarks();
      if (portsHot) drawPorts();
    };
    const drawShipMarks = () => {
      const sel = selMmsi == null ? undefined : ships.find((sh) => sh.mmsi === selMmsi);
      if (sel) drawTrack(sel); // under the ship markers
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

      // Glow (shadowBlur) is one GPU blur pass per draw call, so glowing shapes are gathered into one path
      // per colour and drawn once: ~6 passes a frame instead of one per ship (the difference while panning
      // was 41% vs 18% GPU at 2x). Unlit parts (keylines, tints, labels) draw as they go.
      const lit = new Map<string, { line: Path2D; fill: Path2D; lead: Path2D; dot: Path2D }>();
      const litOf = (col: string) =>
        lit.get(col) ?? lit.set(col, { line: new Path2D(), fill: new Path2D(), lead: new Path2D(), dot: new Path2D() }).get(col)!;
      sctx.shadowBlur = 0;
      sctx.textBaseline = "middle";
      sctx.font = `14px ${pixelFont}`;
      sctx.textAlign = "left";
      for (const m of marks) {
        if (m.ships.length === 1) continue;
        const { x, y, r } = m, n = m.ships.length, color = m.kinds[0][0].color;
        sctx.beginPath();
        sctx.arc(x, y, r, 0, 2 * Math.PI);
        sctx.strokeStyle = "rgba(3,14,24,0.8)"; // dark keyline so blips separate from the glowing coast
        sctx.lineWidth = 4.5;
        sctx.stroke();
        sctx.globalAlpha = 0.14;
        sctx.fillStyle = color;
        sctx.fill();
        let a = -Math.PI / 2; // ring split into arcs by type share, clockwise from north
        const gap = m.kinds.length > 1 ? 0.35 : 0;
        for (const [kd, cnt] of m.kinds) {
          const da = (2 * Math.PI * cnt) / n, arc = litOf(kd.color).line;
          arc.moveTo(x + r * Math.cos(a + gap / 2), y + r * Math.sin(a + gap / 2));
          arc.arc(x, y, r, a + gap / 2, a + Math.max(gap / 2 + 0.05, da - gap / 2));
          a += da;
        }
        litOf(color).dot.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        const label = n > 999 ? "999+" : String(n);
        sctx.strokeStyle = "rgba(3,14,24,0.85)";
        sctx.lineWidth = 3;
        sctx.globalAlpha = 1;
        sctx.strokeText(label, x + r + 4, y + 1);
        sctx.globalAlpha = 0.9;
        sctx.fillText(label, x + r + 4, y + 1);
        sctx.globalAlpha = 1;
      }

      const singles = marks.filter((m) => m.ships.length === 1);
      sctx.lineWidth = 1;
      sctx.strokeStyle = "rgba(160,235,255,0.35)";
      sctx.beginPath();
      for (const m of singles) if (m.from) { sctx.moveTo(m.from[0], m.from[1]); sctx.lineTo(m.x, m.y); }
      sctx.stroke();
      for (const { x: fx, y: fy, ships: [sh] } of singles) {
        const x = Math.round(fx), y = Math.round(fy), g = litOf(shipKind(sh.type).color);
        if (sh.cog == null || sh.sog < 0.5) { // stopped / anchored: hollow diamond with a centre pip
          // Chrome's closePath gets slower the more subpaths a path holds (quadratic over a busy port), so
          // outlines close by retracing their first edge and fills rely on fill() closing subpaths itself.
          g.line.moveTo(x, y - 6); g.line.lineTo(x + 6, y); g.line.lineTo(x, y + 6); g.line.lineTo(x - 6, y); g.line.lineTo(x, y - 6); g.line.lineTo(x + 6, y);
          g.dot.rect(x - 1, y - 1, 2, 2);
        } else { // moving: holo arrow along course, leader line length = speed
          const a = (sh.cog * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a); // 0 = north, clockwise
          const at = (px: number, py: number): [number, number] => [x + px * cs - py * sn, y + px * sn + py * cs];
          for (const path of [g.line, g.fill]) {
            path.moveTo(...at(0, -9)); path.lineTo(...at(6.5, 7)); path.lineTo(...at(0, 3)); path.lineTo(...at(-6.5, 7));
          }
          g.line.lineTo(...at(0, -9)); g.line.lineTo(...at(6.5, 7));
          g.lead.moveTo(...at(0, -12));
          g.lead.lineTo(...at(0, -12 - Math.min(40, 4 + sh.sog * 2)));
        }
      }
      sctx.lineWidth = 1.5;
      for (const [col, g] of lit) {
        sctx.strokeStyle = sctx.fillStyle = sctx.shadowColor = col;
        sctx.shadowBlur = 8;
        sctx.globalAlpha = 0.3;
        sctx.fill(g.fill);
        sctx.globalAlpha = 0.6;
        sctx.stroke(g.lead);
        sctx.globalAlpha = 1;
        sctx.stroke(g.line);
        sctx.fill(g.dot);
      }
      sctx.shadowBlur = 0;

      // Names under single ships, skipping any that would overlap one already drawn.
      if (singles.length <= 50) {
        const placed: [number, number, number, number][] = [];
        sctx.font = `15px ${pixelFont}`;
        sctx.textAlign = "center";
        sctx.globalAlpha = 0.75;
        for (const { x: fx, y: fy, ships: [sh], from } of singles) {
          if (!sh.name || from) continue;
          const x = Math.round(fx), y = Math.round(fy), lw = sctx.measureText(sh.name).width / 2 + 3;
          const box: [number, number, number, number] = [x - lw, y + 12, x + lw, y + 26];
          if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
          placed.push(box);
          sctx.fillStyle = shipKind(sh.type).color;
          sctx.fillText(sh.name, x, y + 19);
        }
        sctx.globalAlpha = 1;
      }
      // Selected ship: corner brackets on its true position (even when it's inside a blip)
      if (sel) {
        const [x, y] = toScreen(sel.x, sel.y), s = 16, k = 6;
        sctx.strokeStyle = sctx.shadowColor = "#e6fdff";
        sctx.shadowBlur = 8;
        sctx.lineWidth = 2;
        sctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          sctx.moveTo(x + dx * s, y + dy * (s - k));
          sctx.lineTo(x + dx * s, y + dy * s);
          sctx.lineTo(x + dx * (s - k), y + dy * s);
        }
        sctx.stroke();
      }
      sctx.shadowBlur = 0;
    };

    // ---------- route (hold E + click) ----------
    // Land raster for the planner: the same land/lake polygons as the map, filled onto a small canvas
    // covering the route's box (copies shifted a world east/west so date-line boxes work). Cells more
    // than half land are 2 (blocked), cells touching land are 1; then seabed shallower than MIN_DEPTH_M
    // (from the same AWS terrain tiles as the relief, which carry sea depth too) is 3: blocked as well,
    // but a port behind shallows can still be reached across them.
    const routeLand: LandMask = async (x0, y0, step, cols, rows) => {
      const cv = document.createElement("canvas");
      cv.width = cols;
      cv.height = rows;
      const c = cv.getContext("2d", { willReadFrequently: true })!;
      const p = new Path2D(), x1 = x0 + cols * step, y1 = y0 + rows * step;
      for (const tx of [-1, 0, 1])
        for (const r of [...land, ...lakes]) {
          if (r.x1 + tx < x0 || r.x0 + tx > x1 || r.y1 < y0 || r.y0 > y1) continue;
          p.moveTo(r.pts[0] + tx, r.pts[1]);
          for (let i = 2; i < r.pts.length; i += 2) p.lineTo(r.pts[i] + tx, r.pts[i + 1]); // fill() closes it (no closePath: see drawShipMarks)
        }
      c.setTransform(1 / step, 0, 0, 1 / step, -x0 / step, -y0 / step);
      c.fill(p, "evenodd");
      const d = c.getImageData(0, 0, cols, rows).data, m = new Uint8Array(cols * rows);
      for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 2 : d[i * 4 + 3] ? 1 : 0;

      // Depth: one terrain pixel per cell centre, at the zoom where a pixel is about one cell.
      const z = Math.max(0, Math.min(12, Math.ceil(Math.log2(1 / (256 * step))))), Z = 2 ** z;
      const want = new Map<string, Promise<Float32Array | null>>();
      for (let ty = Math.max(0, Math.floor(y0 * Z)); ty <= Math.min(Z - 1, Math.floor(y1 * Z)); ty++)
        for (let tx = Math.floor(x0 * Z); tx <= Math.floor(x1 * Z); tx++) want.set(`${tx},${ty}`, elevTile(z, ((tx % Z) + Z) % Z, ty));
      const elev = new Map<string, Float32Array | null>();
      await Promise.all([...want].map(async ([k, pr]) => elev.set(k, await pr)));
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const ci = j * cols + i;
          if (m[ci] === 2) continue;
          const fx = (x0 + (i + 0.5) * step) * Z, fy = (y0 + (j + 0.5) * step) * Z;
          const e = elev.get(`${Math.floor(fx)},${Math.floor(fy)}`);
          if (!e) continue; // tile failed: trust the coastline alone
          const h = e[Math.floor((fy % 1) * 256) * 256 + Math.floor((fx - Math.floor(fx)) * 256)];
          if (h > -MIN_DEPTH_M && h < 5) m[ci] = 3; // shallow sea; above +5 m is a lake surface or a coastline mismatch
        }
      return m;
    };
    // Raw elevations of one terrain tile (terrarium encoding), cached for later routes.
    const elevTiles = new Map<string, Promise<Float32Array | null>>();
    const elevTile = (z: number, x: number, y: number) => {
      const key = `${z}/${x}/${y}`;
      if (!elevTiles.has(key)) {
        // ponytail: never evicted; ~260 KB per tile, a route loads ~10, fine for a session
        elevTiles.set(key, new Promise((done) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const cv = document.createElement("canvas");
            cv.width = cv.height = 256;
            const tc = cv.getContext("2d", { willReadFrequently: true })!;
            tc.drawImage(img, 0, 0);
            const px = tc.getImageData(0, 0, 256, 256).data, e = new Float32Array(256 * 256);
            for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
            done(e);
          };
          img.onerror = () => { elevTiles.delete(key); done(null); }; // retry on the next route
          img.src = `${TERRAIN}/${key}.png`;
        }));
      }
      return elevTiles.get(key)!;
    };
    const setRoute = (r: Plot | null) => {
      route = r;
      routeVer++;
      playT = -1;
      playing = false;
      pushPlay(true);
      saveHash();
    };
    let knots = SHIP_KN_START;
    const blankInfo = (status: RouteInfo["status"], kn: number): RouteInfo =>
      ({ status, knots: kn, nm: 0, hours: 0, delayHours: 0, legs: 0, depart: Date.now(), via: [], directHours: null, note: "", bySpeed: [] });
    // fit: once the first version is drawn, fly out to show the whole route (used for a ship's ROUTE TO)
    const plotRoute = async (from: [number, number], to: [number, number], ship?: ShipLeg, fit = false) => {
      const job = ++routeJob, kn = knots;
      thinking = null;
      caption("", "");
      const empty = (text: string): Plot => ({ from, to, line: [], joints: [], text: [text], times: [], wind: null, current: null, ship });
      setRoute(empty("PLOTTING ROUTE…"));
      setRouteInfo(blankInfo("plotting", kn));
      if (window.innerWidth > 700) setPanel("route");
      // Both layers feed the planner whichever one is on screen; a missing one just counts as calm.
      const sig = new AbortController().signal;
      const [current, now] = await Promise.all([loadGrid("ocean", sig).catch(() => null), loadGrid("wind", sig).catch(() => null)]);
      await new Promise((r) => setTimeout(r, 30)); // let "PLOTTING" paint before the search blocks the thread
      if (job !== routeJob) return;
      const a = fromMerc(...from), b = fromMerc(...to);
      // Pass 1 with today's wind gives the ETA, which says how many days of forecast to fetch for pass 2.
      const env0: Env = { current, wind: now && { start: 0, step: 3600, fields: [now] }, knots: kn };
      const first = await planRoute(a, b, env0, routeLand);
      if (job !== routeJob) return;
      if (!first) {
        setRoute(empty("NO SEA ROUTE"));
        setRouteInfo(blankInfo("none", kn));
        return;
      }
      if (thinkRef.current) { // replay the search in three captioned steps, then let the route appear over it
        const S = first.search, n = S.order.length, dur = Math.min(4500, Math.max(2500, n * 0.12));
        const band = [1, 2, 3, 6, 12, 24, 48, 72].find((h) => h >= first.hours / 6) ?? 96;
        const bandText = band < 24 ? `${band} hours` : band === 24 ? "a day" : `${band / 24} days`;
        const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
        setRoute(empty("SEARCHING…"));
        thinking = { s: S, t0: performance.now(), dur, k: 0, back: 0, end: 0, img: new ImageData(2 * S.cols, 2 * S.rows), ring: isochrones(S, band * 3600) };
        caption("1/3 SPREADING OUT", `Each dot is a spot the ship can reach, filled in fastest first. The rings are ${bandText} of sailing apart: wide where the current helps, squeezed where it fights.`);
        await pause(dur);
        if (job !== routeJob) return;
        thinking.back = performance.now();
        caption("2/3 FOUND IT", "The wave reached the destination. Following the fastest chain of dots back to the start.");
        await pause(1300);
        if (job !== routeJob) return;
        thinking.end = performance.now();
        const legs = first.pts.length - 1;
        caption("3/3 PULLED TIGHT", `The zig-zag grid path becomes ${legs} straight leg${legs > 1 ? "s" : ""}, just as fast, and that's the route.`);
        window.setTimeout(() => { if (job === routeJob) caption("", ""); }, 3500);
      }
      show(from, to, first, env0, "refining", "REFINING WITH WIND FORECAST…", ship);
      if (fit && route) flyToFit(route.line);
      const lons = first.pts.map((p) => p[0]), lats = first.pts.map((p) => p[1]);
      let [w, e] = [Math.min(...lons) - 10, Math.max(...lons) + 10];
      if (e - w > 180) [w, e] = [-180, 180]; // probably across the date line: take the full width
      const box = [Math.max(-180, w), Math.max(-89, Math.min(...lats) - 10), Math.min(180, e), Math.min(89, Math.max(...lats) + 10)];
      const wind = await loadWindForecast(first.hours * 1.3 + 12, box).catch(() => null);
      if (job !== routeJob) return;
      if (!wind) return show(from, to, first, env0, "done", "WIND: NOW ONLY (NO FORECAST)", ship);
      const env1: Env = { current, wind, knots: kn };
      const r = await planRoute(a, b, env1, routeLand);
      if (job !== routeJob) return;
      show(from, to, r ?? first, r ? env1 : env0, "done", r ? "FORECAST WIND · TODAY'S CURRENTS" : "WIND: NOW ONLY (NO FORECAST)", ship);
    };
    const show = (from: [number, number], to: [number, number], r: Route, env: Env, status: "refining" | "done", note: string, ship?: ShipLeg) => {
      const line: [number, number][] = [], joints: [number, number][] = [], times: number[] = [];
      let ux = from[0], t = 0, prev = r.pts[0];
      for (let k = 1; k < r.pts.length; k++) {
        const n = Math.min(200, Math.max(1, Math.ceil(gcMetres(r.pts[k - 1], r.pts[k]) / 25e3)));
        for (let q = k === 1 ? 0 : 1; q <= n; q++) {
          const p = gcAt(r.pts[k - 1], r.pts[k], q / n);
          if (line.length) t += legSeconds(env, prev, p, 20e3, t);
          prev = p;
          const [x, y] = toMerc(...p);
          ux += near(x - ux);
          line.push([ux, y]);
          times.push(t);
        }
        if (k < r.pts.length - 1) joints.push(line[line.length - 1]);
      }
      // the planner timed the legs at its own sample spacing; scale so playback ends at its ETA exactly
      const f = t > 0 && Number.isFinite(t) ? (r.hours * 3600) / t : 1;
      for (let i = 0; i < times.length; i++) times[i] *= f;
      // The same path timed at every speed option, for the cost chart (the path itself is for this speed).
      const kn = env.knots;
      const bySpeed = [...new Set([...SPEEDS, kn])].sort((p, q) => p - q).map((s) => {
        if (s === kn) return { kn: s, hours: r.hours };
        const e = { ...env, knots: s };
        let sec = 0;
        for (let k = 1; k < r.pts.length; k++) sec += legSeconds(e, r.pts[k - 1], r.pts[k], 20e3, sec);
        return { kn: s, hours: sec / 3600 };
      });
      const nm = r.km / 1.852, h = r.hours + r.delayHours;
      const dur = h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} H` : `${Math.floor(h / 24)} D ${Math.round(h % 24)} H`;
      setRoute({
        from, to, line, joints, times, wind: env.wind, current: env.current, ship,
        text: [`FUEL-OPTIMAL · ${kn} KN`, `${nm < 10 ? nm.toFixed(1) : Math.round(nm).toLocaleString("en-US")} NM · ${dur}`],
      });
      const hd = ship?.cog == null || r.pts.length < 2 ? null : Math.abs(((ship.cog - gcBearing(r.pts[0], r.pts[1]) + 540) % 360) - 180);
      setRouteInfo({
        status, knots: kn, nm, hours: r.hours, delayHours: r.delayHours, legs: r.pts.length - 1, depart: Date.now(),
        via: r.via, directHours: r.directHours, note, bySpeed,
        ship: ship && { name: ship.name, port: ship.port, headingDiff: hd, reportedEta: ship.eta },
      });
    };
    // Smooth camera move to frame a line (merc, x unwrapped), clear of the route panel, top bar and toolbar.
    // Steps through panBy/zoomAt each frame so the streaks and ships travel with the map.
    let fly: { t0: number; cx: number; cy: number; ls: number; tx: number; ty: number; tls: number } | null = null;
    const flyToFit = (line: [number, number][]) => {
      if (!line.length || !W) return;
      const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const right = routePanelOpen.current && window.innerWidth > 700 ? 330 : 0, top = 100, bottom = 130, side = 80;
      const scale = Math.min((W - right - 2 * side) / Math.max(x1 - x0, 1e-9), (H - top - bottom) / Math.max(y1 - y0, 1e-9));
      const tls = Math.log(Math.min(maxScale(), Math.max(W, H, scale)));
      const k = Math.exp(tls);
      // centre the box in the free area: shift the view centre right by half the panel, down by the bar difference
      const tx = (x0 + x1) / 2 + right / 2 / k, ty = (y0 + y1) / 2 + (bottom - top) / 2 / k;
      const target = { cx: view.cx + near(tx - view.cx), cy: ty };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        zoomAt(W / 2, H / 2, k / view.scale);
        panBy((view.cx - target.cx) * view.scale, (view.cy - target.cy) * view.scale);
        return;
      }
      fly = { t0: performance.now(), cx: view.cx, cy: view.cy, ls: Math.log(view.scale), tx: target.cx, ty: target.cy, tls };
    };
    const stepFly = (now: number) => {
      if (!fly) return;
      const f = Math.min(1, (now - fly.t0) / 900), e = f < 0.5 ? 4 * f ** 3 : 1 - (-2 * f + 2) ** 3 / 2; // ease in-out
      const cx = fly.cx + (fly.tx - fly.cx) * e, cy = fly.cy + (fly.ty - fly.cy) * e;
      zoomAt(W / 2, H / 2, Math.exp(fly.ls + (fly.tls - fly.ls) * e) / view.scale);
      panBy(near(view.cx - cx) * view.scale, (view.cy - cy) * view.scale);
      if (f >= 1) fly = null;
    };
    setKnotsRef.current = (k) => {
      knots = k;
      // re-plot the route on the table at the new speed (a ship's route is only "its own" at its own speed)
      if (route) plotRoute(route.from, route.to, route.ship?.kn === k ? route.ship : undefined);
      saveHash();
    };

    // ---------- voyage playback ----------
    // Where the ship is t seconds into the voyage: merc point on the drawn line + screen heading (radians,
    // 0 = up, clockwise).
    const routePos = (t: number): [number, number, number] => {
      const L = route!.line, T = route!.times;
      let lo = 0, hi = T.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      const f = T[hi] > T[lo] ? Math.min(1, Math.max(0, (t - T[lo]) / (T[hi] - T[lo]))) : 0;
      const [x0, y0] = L[lo], [x1, y1] = L[hi];
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(x1 - x0, -(y1 - y0))];
    };
    const playTotal = () => (route && route.times.length > 1 ? route.times[route.times.length - 1] : 0);
    // The panel's clock and the weather at the ship, pushed to React at ~8 Hz.
    const pushPlay = (force = false) => {
      const tNow = performance.now();
      if (!force && tNow - playPush < 125) return;
      playPush = tNow;
      const total = playTotal();
      if (!route || playT < 0 || !total) return setPlay({ ...NO_PLAY, total });
      const [x, y] = routePos(playT), [lon, lat] = fromMerc(x - Math.floor(x), y);
      const w = windAt(route.wind, lon, lat, playT), c = route.current && sample(route.current, lon, lat);
      const deg = (u: number, v: number, from = 0) => `${Math.round(((Math.atan2(u, v) * 180) / Math.PI + 360 + from) % 360).toString().padStart(3, "0")}°`;
      setPlay({
        t: playT, playing, total,
        wind: w ? `WIND ${(Math.hypot(w[0], w[1]) * MS_TO_KN).toFixed(0)} KN FROM ${deg(w[0], w[1], 180)}` : "WIND --",
        current: c ? `CURRENT ${(Math.hypot(c[0], c[1]) * MS_TO_KN).toFixed(1)} KN ${deg(c[0], c[1])}` : "CURRENT --",
      });
    };
    const stepPlay = (dt: number) => {
      const total = playTotal();
      if (!playing || !total) return;
      // about one voyage-day per 2 s, kept between 8 and 25 s for the whole trip
      playT += (dt * total) / Math.min(25, Math.max(8, (total / 86400) * 2));
      if (playT >= total) { playT = total; playing = false; }
      pushPlay(!playing);
    };
    const drawRoute = () => {
      if (!route) return;
      const [sx, sy] = toScreen(...route.from);
      const at = (x: number, y: number): [number, number] => [sx + (x - route!.from[0]) * view.scale, sy + (y - route!.from[1]) * view.scale];
      const [ex, ey] = route.line.length ? at(...route.line[route.line.length - 1]) : toScreen(...route.to);
      tctx.strokeStyle = tctx.fillStyle = ROUTE;
      tctx.setLineDash([PIX * 3, PIX * 2]); // pixel dashes: a plotted course, not a live measurement
      tctx.beginPath();
      route.line.forEach(([x, y], i) => (i ? tctx.lineTo(...at(x, y)) : tctx.moveTo(...at(x, y))));
      tctx.stroke();
      tctx.setLineDash([]);
      let [lx, ly] = [sx, sy]; // waypoint dots (2x2 grid px), skipping any that would crowd the last one drawn
      for (const [x, y] of route.joints) {
        const [jx, jy] = at(x, y);
        if (Math.hypot(jx - lx, jy - ly) < 40 || Math.hypot(jx - ex, jy - ey) < 40) continue;
        tctx.fillRect(jx - PIX, jy - PIX, 2 * PIX, 2 * PIX);
        [lx, ly] = [jx, jy];
      }
      tctx.strokeRect(sx - 6, sy - 6, 12, 12); // start: square + dot, like the bearing anchor
      tctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      tctx.beginPath(); // destination: diamond + dot
      tctx.moveTo(ex, ey - 9); tctx.lineTo(ex + 9, ey); tctx.lineTo(ex, ey + 9); tctx.lineTo(ex - 9, ey); tctx.closePath();
      tctx.stroke();
      tctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      if (playT >= 0 && route.times.length > 1) { // the ship sailing it: solid amber arrow along the course
        const [x, y, ang] = routePos(playT), [qx, qy] = at(x, y);
        tctx.save();
        tctx.translate(qx, qy);
        tctx.rotate(ang);
        tctx.beginPath();
        tctx.moveTo(0, -13); tctx.lineTo(9, 10); tctx.lineTo(0, 4); tctx.lineTo(-9, 10); tctx.closePath();
        tctx.fill();
        tctx.restore();
        tctx.beginPath();
        tctx.arc(qx, qy, 18, 0, 2 * Math.PI);
        tctx.stroke();
      }
      const label = routeLabelRef.current!;
      if (routePanelOpen.current) return; // drawBearing hid it already
      label.style.display = "block";
      if (label.dataset.v !== String(routeVer)) {
        label.dataset.v = String(routeVer);
        label.textContent = route.text.join("\n");
      }
      // Beyond the destination, continuing the way the route arrives, so it never covers the course.
      let [bx, by] = [sx, sy];
      for (let k = route.line.length - 1; k >= 0; k--) {
        const q = at(...route.line[k]);
        if (Math.hypot(q[0] - ex, q[1] - ey) > 60) { [bx, by] = q; break; }
      }
      const vx = ex - bx, vy = ey - by, vl = Math.hypot(vx, vy) || 1, lw = label.offsetWidth, lh = label.offsetHeight;
      const tx = ex + (vx / vl) * 22 + (vx < 0 ? -lw : 0), ty = ey + (vy / vl) * 22 + (vy < 0 ? -lh : 0);
      label.style.left = `${Math.max(8, Math.min(tx, W - lw - 8))}px`;
      label.style.top = `${Math.max(tx < 250 ? 270 : 8, Math.min(ty, H - lh - 8))}px`; // keep clear of the layer picker
    };

    // Hold-E bearing tool: north reference, clockwise arc to the arrow, arrow to cursor, bearing +
    // distance. Mercator straight line = rhumb line, so the drawn angle is the true course to steer.
    // Drawn on the same low-res grid as the current streaks (1 px = PIX CSS px), then hard-thresholded
    // so every pixel is fully on/off and the CSS upscale stays chunky. Glow comes from a CSS drop-shadow.
    // "Watch it think": every settled cell becomes a dot on a small lattice image (2x2 px per planner cell,
    // one lit, so the map shows between the dots; cells on a time ring light all four, so rings read as lines),
    // stretched over the map. Rings and the wavefront (the newest cells) are white, apart from the cyan current
    // streaks; then the grid path is traced back from the destination in amber, turning white as the tight
    // amber route appears over it, and everything fades.
    let thinking: { s: Search; t0: number; dur: number; k: number; back: number; end: number; img: ImageData; ring: Uint8Array } | null = null;
    const thinkCanvas = document.createElement("canvas");
    const caption = (step: string, text: string) => {
      const el = thinkCapRef.current;
      if (!el) return;
      el.style.display = step ? "block" : "none";
      el.firstElementChild!.textContent = step;
      el.lastElementChild!.textContent = text;
    };
    const drawThinking = () => {
      if (!thinking) return;
      const { s, img, ring } = thinking, n = s.order.length, now = performance.now(), w = img.width * 4;
      const fade = thinking.end ? 1 - (now - thinking.end) / 2500 : 1;
      if (fade <= 0) { thinking = null; return; }
      const k = Math.min(n, Math.floor((n * (now - thinking.t0)) / thinking.dur));
      for (let q = thinking.k; q < k; q++) {
        const c = s.order[q], o = ((c / s.cols | 0) * 2 * w) + (c % s.cols) * 8, on = ring[c];
        for (const p of on ? [o, o + 4, o + w, o + w + 4] : [o]) { // rings white, so they don't read as current streaks
          img.data[p] = on ? 255 : 159; img.data[p + 1] = on ? 255 : 240; img.data[p + 2] = 255; img.data[p + 3] = on ? 240 : 90;
        }
      }
      thinking.k = k;
      thinkCanvas.width = img.width; // also clears it
      thinkCanvas.height = img.height;
      thinkCanvas.getContext("2d")!.putImageData(img, 0, 0);
      const [x0, y0] = toScreen(s.x0, s.y0), cell = s.step * view.scale, sz = Math.max(2 * PIX, cell);
      const box = (c: number) => tctx.fillRect(x0 + (c % s.cols) * cell, y0 + Math.floor(c / s.cols) * cell, sz, sz);
      tctx.imageSmoothingEnabled = false;
      tctx.globalAlpha = fade;
      tctx.drawImage(thinkCanvas, x0, y0, s.cols * cell, s.rows * cell);
      if (!thinking.back) {
        tctx.fillStyle = "#e6fdff";
        for (let q = Math.max(0, k - Math.max(60, n / 30)); q < k; q++) box(s.order[q]);
      } else if (!thinking.end) { // traced back in amber: this is the route being found
        tctx.fillStyle = ROUTE;
        const m = Math.ceil(s.path.length * Math.min(1, (now - thinking.back) / 1200));
        for (let i = s.path.length - m; i < s.path.length; i++) box(s.path[i]);
      } else { // then a thin white trail of the grid path beside the tight amber route that replaces it
        tctx.fillStyle = "#ffffff";
        for (const c of s.path) tctx.fillRect(x0 + (c % s.cols + 0.5) * cell - PIX / 2, y0 + (Math.floor(c / s.cols) + 0.5) * cell - PIX / 2, PIX, PIX);
      }
      tctx.globalAlpha = 1;
    };
    const drawBearing = () => {
      const key = `${view.cx},${view.cy},${view.scale},${W},${H},${cursor.x},${cursor.y},${bearingFrom},${bearingTo},${routeVer},${playT.toFixed(0)},${routePanelOpen.current},${thinking ? performance.now() : ""}`;
      if (key === toolKey) return; // the route stays up, so skip the readback while nothing moves
      toolKey = key;
      tctx.setTransform(1 / PIX, 0, 0, 1 / PIX, 0, 0); // draw in CSS px, land on the low-res grid
      tctx.clearRect(0, 0, W, H);
      toolDrawn = !!(bearingFrom || route);
      const label = bearingLabelRef.current!;
      label.style.display = "none";
      routeLabelRef.current!.style.display = "none";
      if (!toolDrawn) return;
      tctx.lineWidth = PIX; // one low-res pixel
      tctx.lineCap = "square";
      drawRoute();
      if (bearingFrom) {
        const [ax, ay] = toScreen(bearingFrom[0], bearingFrom[1]);
        tctx.strokeStyle = tctx.fillStyle = "#bff8ff";
        drawBearingShapes(ax, ay);
      }
      const img = tctx.getImageData(0, 0, fw, fh);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 70 ? 255 : 0;
      tctx.putImageData(img, 0, 0);
      drawThinking();
    };
    const drawBearingShapes = (ax: number, ay: number) => {
      if (!bearingFrom) return;
      tctx.strokeRect(ax - 6, ay - 6, 12, 12); // anchor mark: pixel square with a centre dot
      tctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
      if (!bearingTo && cursor.x < 0) return;
      const [bx, by] = bearingTo ? toScreen(...bearingTo) : [cursor.x, cursor.y];
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
      surface.style.cursor = m || (portsHot && sx >= 0 && portAt(sx, sy)) ? "pointer" : "";
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
          // "fill" paths are only filled/clipped, which close each subpath themselves; an explicit closePath
          // is quadratic in Chrome and cost 100+ ms a frame over thousands of rings when zoomed out.
          if (how === "outline" && !onCut(p, n - 2, 0)) ctx.lineTo(ox + p[0] * k, oy + p[1] * k);
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
      // During voyage playback the wind streaks show the forecast for that moment inside the route's forecast
      // box (live wind outside it), so you watch the weather move past the ship.
      const fc = mode === "wind" && playT >= 0 && route?.wind && route.wind.fields.length > 1 ? route.wind : null;
      for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = (d[i] * keep) | 0; // floor so it reaches 0
      for (let i = 0; i < px.length; i++) {
        const x = px[i], y = py[i];
        const inView = x >= 0 && y >= 0 && x < fw && y < fh;
        const lon = lonLeft + x * dLon, lat = rowLat[y | 0];
        const s = field && inView && !mask?.[(y | 0) * fw + (x | 0)] ? (fc && windAt(fc, lon, lat, playT)) || sample(field, lon, lat) : null;
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
      stepFly(t);
      stepPlay(dt);
      if (!paused) stepFlow(dt);
      if (portsHot !== pickingEnds()) shipsDirty = true;
      if (shipsDirty && W) { drawShips(); shipsDirty = false; }
      if (W && (bearingFrom || route || toolDrawn)) drawBearing();
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
      if (!view.scale) view.scale = W / (startKm / (EARTH_KM * Math.cos((fromMerc(0, view.cy)[1] * Math.PI) / 180)));
      clampView();
      respawnAll();
      viewChanged();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(surface);

    // ---------- tools, sharing, playback controls (the toolbar and panels call these) ----------
    let demoHint = false;
    const dismissHint = () => { if (demoHint) { demoHint = false; setHint(""); } };
    const setTool = (t: Tool) => {
      tool = t;
      bearingFrom = bearingTo = null;
      setToolUi(t);
      demoHint = false;
      setHint(t === "route" ? "TAP START · A PORT OR ANY SEA POINT" : t === "bearing" ? "DRAG TO MEASURE" : "");
    };
    const clearAll = () => {
      thinking = null;
      caption("", "");
      setTool("none");
      routeJob++; // drop a route still being plotted
      setRoute(null);
      setRouteInfo(null);
      setPanel((p) => (p === "route" ? null : p));
    };
    let copiedTimer = 0;
    api.current = {
      setTool,
      clear: clearAll,
      share: async () => {
        const h = hashNow();
        history.replaceState(null, "", h);
        try {
          await navigator.clipboard.writeText(location.href);
          setCopied(true);
          clearTimeout(copiedTimer);
          copiedTimer = window.setTimeout(() => setCopied(false), 1800);
        } catch {
          setHint("COPY THE ADDRESS BAR TO SHARE THIS VIEW"); // clipboard blocked (e.g. not https)
        }
      },
      play: () => {
        const total = playTotal();
        if (!total) return;
        if (playT < 0 || playT >= total) playT = 0;
        playing = !playing;
        pushPlay(true);
      },
      seek: (t) => {
        if (!playTotal()) return;
        playing = false;
        playT = t;
        pushPlay(true);
      },
      routeShip: (s) => {
        knots = s.kn;
        setSpeed(s.kn);
        plotRoute(toMerc(s.lon, s.lat), toMerc(s.portLon, s.portLat), s, true);
      },
      closeRoute: () => setPanel((p) => (p === "route" ? null : p)),
    };

    // Shared link or first visit: #v=lon,lat,km&l=wind&kn=10&r=lon1,lat1,lon2,lat2 (see hashNow).
    const hp = new URLSearchParams(location.hash.slice(1));
    const nums = (k: string, n: number) => {
      const v = hp.get(k)?.split(",").map(Number);
      return v?.length === n && v.every(Number.isFinite) ? v : null;
    };
    const hv = nums("v", 3);
    if (hv) {
      [view.cx, view.cy] = toMerc(hv[0], hv[1]);
      startKm = Math.max(5, hv[2]);
    }
    if (hp.get("l") === "wind") {
      mode = "wind";
      setLayer("wind");
    }
    const hk = Number(hp.get("kn"));
    if (hk >= 1 && hk <= 40) {
      knots = hk;
      setSpeed(hk);
    }
    const hr = nums("r", 4);
    let seen = true;
    try { seen = !!localStorage.getItem(SEEN); localStorage.setItem(SEEN, "1"); } catch { /* storage blocked: no demo */ }
    const pending: [LonLat, LonLat] | null = hr ? [[hr[0], hr[1]], [hr[2], hr[3]]] : null;
    const demo = !hr && !seen && !location.hash;
    if (demo) { // frame all the demo points while they're compared; the winner then gets a fly-to
      const wide = window.innerWidth > 700;
      [view.cx, view.cy] = toMerc(wide ? -67 : -71.5, 34.5);
      startKm = wide ? 4200 : 2400;
    }
    if (window.innerWidth < 700) setTilt(false); // tilted wastes a phone screen

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
        // the planner needs the land loaded
        if (pending) plotRoute(toMerc(...pending[0]), toMerc(...pending[1]));
        if (demo) pickDemo();
      })
      .catch((e) => console.error("geo load failed", e));

    // Compare every demo trip on today's currents and plot the one where the optimal route saves most.
    const pickDemo = async () => {
      demoHint = true;
      setHint(`Comparing ${DEMO_TRIPS.length} Gulf Stream trips…`);
      const job = routeJob, sig = new AbortController().signal;
      const [current, now] = await Promise.all([loadGrid("ocean", sig).catch(() => null), loadGrid("wind", sig).catch(() => null)]);
      const env: Env = { current, wind: now && { start: 0, step: 3600, fields: [now] }, knots };
      const best = current ? await bestSaving(DEMO_TRIPS, env, routeLand).catch(() => null) : null;
      if (job !== routeJob || !demoHint) return; // they started using the map meanwhile: leave it to them
      const trip = best && best.saving > 0 ? best.pair : DEMO_FALLBACK;
      plotRoute(toMerc(...trip.a), toMerc(...trip.b), undefined, true);
      setHint(`${trip.name}: the biggest fuel saving of ${DEMO_TRIPS.length} trips on today's Gulf Stream. Tap ROUTE to plot your own.`);
    };

    // offsetX/Y are in the surface's own (untransformed) coordinates, so this stays correct when tilted.
    // Two pointers pinch-zoom and pan together; one pointer drags (or measures, with the BEARING tool).
    const pointers = new Map<number, [number, number]>();
    let pinch: { d: number; mx: number; my: number } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    const pinchNow = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    };
    const onDown = (e: PointerEvent) => {
      // Buttons/links on the table (layer picker, attribution) must get their click. React's
      // stopPropagation runs too late to stop this native listener, and capturing the pointer on
      // a button swallows its click in WebKit, so bail out here.
      dismissHint(); // any touch counts as the first interaction, UI included
      if ((e.target as Element).closest("button, a, [data-ui]")) return;
      fly = null; // grabbing the map stops a camera move
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events have no live pointer to capture; dragging still works without it
      }
      if (pointers.size === 2) { // second finger: a pinch, not a click or a drag
        pinch = pinchNow();
        cursor.down = false;
        if (tool === "bearing" && !bearingTo) bearingFrom = null;
        return;
      }
      if (pointers.size > 2) return;
      cursor.down = true;
      cursor.lx = cursor.dx = cursor.x = e.offsetX;
      cursor.ly = cursor.dy = cursor.y = e.offsetY;
      if (tool === "bearing") {
        bearingFrom = toMercAt(e.offsetX, e.offsetY);
        bearingTo = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      // over the ship panel offsetX/Y are panel-relative, not map coordinates
      if (!cursor.down && !pinch && (e.target as Element).closest("[data-ui]")) { cursor.x = -1; return; }
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch) {
        if (pointers.size !== 2) return;
        const p = pinchNow();
        panBy(p.mx - pinch.mx, p.my - pinch.my);
        zoomAt(p.mx, p.my, p.d / pinch.d);
        pinch = p;
        return;
      }
      cursor.x = e.offsetX;
      cursor.y = e.offsetY;
      if (!cursor.down || (tool === "bearing" && bearingFrom)) return; // BEARING: dragging measures instead of panning
      panBy(e.offsetX - cursor.lx, e.offsetY - cursor.ly);
      cursor.lx = e.offsetX;
      cursor.ly = e.offsetY;
    };
    const click = (x: number, y: number) => {
      const port = portsHot ? portAt(x, y) : undefined, at = port ? port.m : toMercAt(x, y); // a tapped port snaps the end onto it
      if (tool === "route") { // tap the start, then the destination
        if (!bearingFrom) {
          bearingFrom = at;
          setHint(port ? `FROM ${port.p.name} · TAP DESTINATION` : "TAP DESTINATION");
        } else {
          plotRoute(bearingFrom, at);
          setTool("none");
        }
        return;
      }
      if (tool === "bearing") { bearingFrom = bearingTo = null; return; } // a tap clears the measurement
      if (bearingFrom) return plotRoute(bearingFrom, at); // E held: click = destination
      const m = markAt(x, y);
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
        return;
      }
      const now = performance.now();
      if (!m && now - lastTap.t < 350 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) { // double-tap: zoom in
        lastTap.t = 0;
        zoomAt(x, y, 2);
        return;
      }
      lastTap = { t: now, x, y };
      selectShip(m?.ships[0] ?? null); // click a ship to open its panel, empty map to close it
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) { // the finger left behind after a pinch neither clicks nor drags
        if (pointers.size < 2) pinch = null;
        cursor.down = false;
        return;
      }
      if (cursor.down) {
        if (Math.hypot(e.offsetX - cursor.dx, e.offsetY - cursor.dy) < 4) click(e.offsetX, e.offsetY); // a click, not a drag
        else if (tool === "bearing" && bearingFrom) bearingTo = toMercAt(e.offsetX, e.offsetY); // pin the measurement
      }
      cursor.down = false;
    };
    const onLeave = () => { if (!cursor.down) cursor.x = -1; };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest("[data-ui]")) return; // let the ship panel scroll
      e.preventDefault();
      dismissHint();
      fly = null;
      zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.2 : 0.006))); // ~1.8x per wheel notch (line-mode wheels send ~3/notch)
    };
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.type === "keyup") {
        keys.delete(key);
        if (key === "e" && tool === "none") bearingFrom = null;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select")) return; // typing in the route panel
      dismissHint();
      if (key === "escape") { // step back: a tool first, then everything on the table
        if (tool !== "none" || bearingTo) setTool("none");
        else {
          selectShip(null);
          clearAll();
        }
      }
      if (key === "e" && !e.repeat && tool === "none") {
        // anchor where the cursor is (map centre if it's off the table); stays put while panning
        const sx = cursor.x >= 0 ? cursor.x : W / 2, sy = cursor.x >= 0 ? cursor.y : H / 2;
        bearingFrom = toMercAt(sx, sy);
        bearingTo = null;
      }
      if (e.repeat) return;
      if (key === "r") setTool(tool === "route" ? "none" : "route");
      if (key === "b") setTool(tool === "bearing" ? "none" : "bearing");
      if (key === "?") setAbout(true);
      if (key === " ") {
        e.preventDefault(); // don't scroll or press a focused button
        api.current!.play();
      }
      if (key === "t") setTilt((v) => !v);
      if (key === "p") {
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
      if (tool === "none") bearingFrom = null; // keyup never arrives if focus leaves while E is held
    };
    setShipsRef.current = (on) => {
      shipsOn = on;
      shipsDirty = true;
      if (!on) selectShip(null);
      setShipStatus(on ? "SHIPS…" : "");
      if (on) pollShips();
    };
    setModeRef.current = (m) => {
      if (m === mode) return;
      mode = m;
      field = null;
      respawnAll();
      refresh();
      saveHash();
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
      routeJob++;
      cancelAnimationFrame(raf);
      clearTimeout(fetchTimer);
      clearInterval(every15);
      clearInterval(every3);
      clearTimeout(shipTimer);
      clearTimeout(hashTimer);
      clearTimeout(copiedTimer);
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
  const shipColor = ship ? shipKind(ship.type).color : OTHER_SHIP.color;
  // Class B (small craft) transponders have no status, destination, ETA, draught or IMO: drop those rows.
  const classB = ship?.cls === "B";
  const port = matchDestination(ship?.dest);
  const noB = new Set(classB ? ["STATUS", "DESTINATION", "ETA", "DRAUGHT", "IMO"] : []);
  const shipRows: [string, [string, string | undefined][]][] = ship
    ? [
        ["VOYAGE", [
          ["STATUS", ship.lost ? "SIGNAL LOST" : NAV_STATUS[ship.nav ?? -1]],
          ["SPEED", `${ship.sog.toFixed(1)} KN`],
          ["COURSE", deg3(ship.cog)],
          ["HEADING", deg3(ship.hdg)],
          ["DESTINATION", ship.dest],
          ["ETA", ship.eta],
        ]],
        ["VESSEL", [
          ["SIZE", ship.len && ship.beam ? `${ship.len} × ${ship.beam} M` : ship.len ? `${ship.len} M` : undefined],
          ["DRAUGHT", ship.draught ? `${ship.draught.toFixed(1)} M` : undefined],
          ["CALL SIGN", ship.call],
          ["IMO", ship.imo ? String(ship.imo) : undefined],
        ]],
        ["POSITION", [
          ["LAT", fmt(ship.lat, "N", "S", 6)],
          ["LON", fmt(ship.lon, "E", "W", 7)],
          ["LAST SIGNAL", ship.age == null ? undefined : ship.age < 60 ? `${ship.age} S AGO` : `${Math.round(ship.age / 60)} MIN AGO`],
        ]],
      ]
    : [];

  return (
    <main
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_15%,#1a2633_0%,#070a0f_65%)] font-[family-name:var(--font-pixel)]"
      style={{ perspective: "1800px" }}
    >
      {/* Sign above the tilted table; it lifts away as the view flattens (the table fills the screen then). */}
      <h1
        className={`pointer-events-none absolute left-1/2 top-[3.5vh] flex -translate-x-1/2 select-none items-center gap-3 text-5xl leading-none tracking-[0.2em] transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${glow} ${tilt ? "opacity-100" : "-translate-y-8 opacity-0"}`}
      >
        <NextImage src="/icon.svg" alt="" width={36} height={36} unoptimized className="drop-shadow-[0_0_6px_rgba(90,220,255,0.45)]" />
        HOLOMAP
      </h1>
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
              ref={routeLabelRef}
              data-ui
              role="button"
              tabIndex={-1}
              title="Route details"
              onClick={() => setPanel("route")}
              className="absolute hidden cursor-pointer whitespace-pre border border-[#ffd27a]/40 bg-[#1a1204]/80 px-2 py-0.5 text-xl leading-5 text-[#ffd27a] [text-shadow:0_0_6px_rgba(255,200,110,0.7)] hover:bg-[#2a1d06]/90"
            />
            <div
              ref={thinkCapRef}
              role="status"
              className="pointer-events-none absolute left-1/2 top-12 hidden w-max max-w-[min(620px,80%)] -translate-x-1/2 border border-[#9ff0ff]/40 bg-[#041019]/85 px-3 py-1 text-center text-lg leading-6 text-[#bfefff] max-[700px]:top-10 max-[700px]:text-base max-[700px]:leading-5"
            >
              <b className="mr-2 tracking-widest text-[#9ff0ff] [text-shadow:0_0_6px_rgba(90,220,255,0.7)]" />
              <span />
            </div>
            <div
              ref={shipTipRef}
              className="pointer-events-none absolute hidden whitespace-pre border border-current/40 bg-black/60 px-2 py-0.5 text-lg leading-5 [text-shadow:0_0_6px_currentColor]"
            />

            <div className={`pointer-events-none absolute inset-x-4 top-3 flex items-center gap-3 border-b border-[#7ff0ff]/25 bg-black/30 px-3 py-0.5 text-xl italic max-[700px]:inset-x-2 max-[700px]:px-1.5 max-[700px]:text-base ${glow}`}>
              <span ref={hud.current}>OCEAN CURRENT: --</span>
              <span ref={hud.arrow} className="inline-block opacity-0">↑</span>
              <span className="ml-auto flex items-center gap-4 text-base not-italic opacity-70 max-[700px]:hidden">
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
            <div role="radiogroup" aria-label="Map layer" className="absolute left-5 top-14 flex flex-col gap-2 max-[700px]:left-2.5 max-[700px]:top-16 max-[700px]:origin-top-left max-[700px]:scale-[0.8]">
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
              {/* Ship speed for the route planner; changing it re-plots the route on the table. */}
              <div className={`mt-2 flex items-center gap-1.5 text-xl italic ${glow}`}>
                <span className="opacity-80">SPEED</span>
                {([-1, 1] as const).map((dir) => {
                  // a ship's route can run at its own speed, between the options
                  const next = dir < 0 ? SPEEDS.findLast((s) => s < speed) : SPEEDS.find((s) => s > speed);
                  return (
                    <button
                      key={dir}
                      type="button"
                      aria-label={dir < 0 ? "Slower" : "Faster"}
                      disabled={next == null}
                      onClick={() => {
                        if (next == null) return;
                        setSpeed(next);
                        setKnotsRef.current(next);
                      }}
                      className={`cursor-pointer px-1 not-italic outline-none transition-opacity focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff] disabled:cursor-default disabled:opacity-25 ${dir < 0 ? "order-1" : "order-3"} opacity-70 hover:opacity-100`}
                    >
                      {dir < 0 ? "◀" : "▶"}
                    </button>
                  );
                })}
                <span className="order-2 w-14 text-center">{speed} KN</span>
              </div>
            </div>

            <div ref={hud.paused} className={`pointer-events-none absolute left-1/2 top-12 hidden -translate-x-1/2 text-2xl ${glow}`}>
              ‖ PAUSED
            </div>

            <div className={`pointer-events-none absolute left-5 -skew-x-12 text-4xl leading-none text-[#8fe9ff]/35 transition-[bottom] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] max-[700px]:hidden ${tilt ? "bottom-3" : "bottom-16"}`}>
              <div ref={hud.lat}>N 00.000°</div>
              <div ref={hud.lon}>W 000.000°</div>
            </div>

            {/* Ship panel: opens when a ship is clicked, refreshes every 3 s. data-ui keeps map drag/zoom/hover off it. */}
            <aside
              data-ui
              aria-label="Ship details"
              aria-hidden={!shipOpen}
              inert={!shipOpen}
              className={`absolute bottom-20 right-4 top-12 w-[300px] overflow-y-auto border border-t-[3px] border-[#9ff0ff]/35 bg-[#041019]/85 px-4 pb-3 pt-3 text-lg leading-6 text-[#bfefff] shadow-[0_0_24px_rgba(80,220,255,0.2)] transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none max-[700px]:inset-x-2 max-[700px]:bottom-16 max-[700px]:top-auto max-[700px]:h-[52%] max-[700px]:w-auto ${shipOpen ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+24px)] opacity-0 max-[700px]:translate-x-0 max-[700px]:translate-y-[calc(100%+80px)]"}`}
              style={{ borderTopColor: shipColor }}
            >
              {ship && (
                <>
                  <button
                    type="button"
                    aria-label="Close ship details"
                    onClick={() => closeShipRef.current()}
                    className="absolute right-2 top-1 cursor-pointer px-1 text-2xl leading-none opacity-60 outline-none hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff]"
                  >
                    ×
                  </button>
                  <div className="text-base tracking-wider" style={{ color: shipColor, textShadow: `0 0 6px ${shipColor}` }}>
                    {shipKind(ship.type).name}
                  </div>
                  <h2 className={`pr-6 text-3xl leading-7 ${glow}`}>{ship.name || "UNNAMED VESSEL"}</h2>
                  <div className="text-base opacity-60">MMSI {ship.mmsi}{classB && " · SMALL CRAFT (AIS CLASS B)"}</div>
                  {shipRows.map(([title, rows]) => (
                    <section key={title} className="mt-3 border-t border-[#9ff0ff]/20 pt-1.5">
                      <h3 className="text-sm tracking-widest opacity-50">{title}</h3>
                      <dl>
                        {rows.filter(([k]) => !noB.has(k) || (k === "STATUS" && ship.lost)).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3">
                            <dt className="opacity-60">{k}</dt>
                            <dd className={`text-right ${v ? "" : "opacity-35"}`}>{v ?? "--"}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                  {!classB && ship.dest && (
                    port ? (
                      <button
                        type="button"
                        onClick={() => api.current?.routeShip({
                          name: ship.name, port: port.name, lon: ship.lon, lat: ship.lat, portLon: port.lon, portLat: port.lat,
                          kn: ship.sog >= 1 ? Math.max(6, Math.round(ship.sog)) : SHIP_KN_START,
                          cog: ship.sog >= 1 ? ship.cog : null, eta: parseAisEta(ship.eta),
                        })}
                        className="mt-3 block w-full cursor-pointer border border-[#ffd27a]/50 px-2 text-left text-[#ffd27a] outline-none [text-shadow:0_0_6px_rgba(255,200,110,0.6)] hover:bg-[#ffd27a]/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#ffd27a]"
                      >
                        ROUTE TO {port.name} →
                        <span className="block text-sm leading-4 opacity-70">Compare its heading and ETA with the optimal route</span>
                      </button>
                    ) : (
                      <p className="mt-2 text-sm leading-5 opacity-45">DESTINATION NOT RECOGNISED</p>
                    )
                  )}
                  {!ship.len && !ship.call && !ship.lost && (
                    <p className="mt-2 text-sm leading-5 opacity-45">
                      {classB ? "Type, call sign and size arrive every ~6 min." : "Size, voyage and call sign arrive every ~6 min per ship."}
                    </p>
                  )}
                  <a
                    href={`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ship.mmsi}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-3 inline-block border border-[#9ff0ff]/40 px-2 hover:bg-[#9ff0ff]/10 ${glow}`}
                  >
                    MARINETRAFFIC ↗
                  </a>
                </>
              )}
            </aside>

            <RoutePanel
              open={panel === "route"}
              info={routeInfo}
              play={play}
              market={market}
              setMarket={setMarket}
              onClose={() => api.current?.closeRoute()}
              onSpeed={(k) => {
                setSpeed(k);
                setKnotsRef.current(k);
              }}
              onPlay={() => api.current?.play()}
              onSeek={(t) => api.current?.seek(t)}
            />

            <Toolbar
              tool={toolUi}
              hint={hint}
              copied={copied}
              onTool={(t) => api.current?.setTool(t)}
              onClear={() => api.current?.clear()}
              onShare={() => api.current?.share()}
              onAbout={() => setAbout(true)}
            />

            <div className={`pointer-events-none absolute bottom-4 right-6 flex flex-col items-end gap-1 max-[700px]:hidden ${glow}`}>
              <span ref={hud.scaleLabel} className="text-2xl leading-none">--</span>
              <div ref={hud.scaleBar} className="relative h-2 border-x-2 border-b-2 border-[#9ff0ff]/70">
                <div className="absolute bottom-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-[#9ff0ff]/70" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <AboutPanel open={about} onClose={() => setAbout(false)} think={think} onThink={setThink} />

      {/* Key help folds into a one-line chip so it never covers the table's coordinates; hover or focus
          unfolds it, click opens the full "How it works" panel (which lists every key too). */}
      <div className="group fixed bottom-3 left-3 rounded-sm bg-black/85 px-2 py-1.5 text-lg leading-6 text-white/90 max-[700px]:hidden">
        <div className="hidden pb-1 group-focus-within:block group-hover:block">
        {[
          [["drag", "w", "a", "s", "d"], "pan"],
          [["scroll", "up", "down"], "zoom"],
          [["r"], "route tool"],
          [["b"], "bearing tool"],
          [["space"], "play voyage"],
          [["esc"], "clear"],
          [["t"], tilt ? "flatten" : "tilt"],
          [["p"], "pause streaks"],
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
        <button type="button" onClick={() => setAbout(true)} className="flex cursor-pointer items-center gap-1 outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#9ff0ff]">
          <kbd className="rounded-[3px] bg-white/15 px-1 font-[family-name:var(--font-pixel)] leading-5">?</kbd>
          <span className="ml-1">keys</span>
        </button>
      </div>
    </main>
  );
}
