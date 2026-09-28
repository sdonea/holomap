import { toUV } from "@/lib/geo";

// Server-side proxy + shared cache for Open-Meteo Marine ocean surface currents.
// (Wind comes from NOAA GFS grids instead: see app/api/wind.)
// Open-Meteo counts EVERY location as one API call (free tier: 600/min, 5k/hour, 10k/day,
// non-commercial). So each point is fetched once as a 2-day hourly forecast and cached;
// later requests interpolate to "now" without touching the API.
const LAYERS = {
  ocean: { api: "https://marine-api.open-meteo.com/v1/marine", speed: "ocean_current_velocity", dir: "ocean_current_direction", uv: toUV },
} as const;
type Layer = keyof typeof LAYERS;

const CHUNK = 400; // ~500 points trips nginx's URL-length limit (414)
const TTL = 3 * 3600 * 1000; // re-pull after 3 h to pick up newer model runs
const MAX_POINTS = 2000;

type Series = { t0: number; u: Float32Array; v: Float32Array; ok: Uint8Array; fetched: number };
// Kept on globalThis so dev hot-reloads don't wipe it and re-spend the free API budget.
const g = globalThis as unknown as { __currents?: { cache: Map<string, Series>; blockedUntil: number } };
const mem = (g.__currents ??= { cache: new Map(), blockedUntil: 0 }); // rate limit is per IP, shared by both layers
const cache = mem.cache;

const key = (layer: Layer, lon: number, lat: number) => `${layer}:${lon.toFixed(4)},${lat.toFixed(4)}`;
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

type ApiPoint = { hourly?: Record<string, (number | null)[]> & { time: string[] }; hourly_units?: Record<string, string> };

async function fetchChunk(layer: Layer, pts: [number, number][]) {
  const L = LAYERS[layer];
  const url =
    `${L.api}?latitude=${pts.map((p) => p[1].toFixed(4)).join(",")}` +
    `&longitude=${pts.map((p) => wrapLon(p[0]).toFixed(4)).join(",")}` +
    `&hourly=${L.speed},${L.dir}&forecast_days=2&timezone=GMT`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429) {
    // reason is e.g. "Minutely/Hourly/Daily API request limit exceeded..." — wait out the right window
    const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
    const now = new Date();
    if (/daily/i.test(reason)) mem.blockedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 60_000;
    else if (/hourly/i.test(reason)) mem.blockedUntil = (Math.floor(now.getTime() / 3600_000) + 1) * 3600_000 + 60_000;
    else mem.blockedUntil = now.getTime() + 61_000;
    return false;
  }
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = (await res.json()) as ApiPoint | ApiPoint[];
  const list = Array.isArray(json) ? json : [json];
  const now = Date.now();
  list.forEach((d, n) => {
    const h = d.hourly;
    const unit = d.hourly_units?.[L.speed];
    if (!h || (unit && unit !== "km/h")) return;
    const len = h.time.length;
    const s: Series = { t0: Date.parse(h.time[0] + "Z"), u: new Float32Array(len), v: new Float32Array(len), ok: new Uint8Array(len), fetched: now };
    for (let i = 0; i < len; i++) {
      const sp = h[L.speed]?.[i], dir = h[L.dir]?.[i];
      if (sp == null || dir == null) continue;
      [s.u[i], s.v[i]] = L.uv(sp, dir);
      s.ok[i] = 1;
    }
    cache.set(key(layer, pts[n][0], pts[n][1]), s);
  });
  return true;
}

// Linear in u/v between the two surrounding hours.
function at(s: Series, t: number): [number, number] | null {
  const f = (t - s.t0) / 3600_000;
  const i = Math.floor(f);
  if (i < 0 || i + 1 >= s.u.length || !s.ok[i] || !s.ok[i + 1]) return null;
  const w = f - i;
  return [s.u[i] * (1 - w) + s.u[i + 1] * w, s.v[i] * (1 - w) + s.v[i + 1] * w];
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { points?: unknown; layer?: unknown } | null;
  const points = body?.points;
  const layer = body?.layer ?? "ocean";
  if (layer !== "ocean") return Response.json({ error: "layer must be ocean" }, { status: 400 });
  if (
    !Array.isArray(points) ||
    points.length > MAX_POINTS ||
    !points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n)) && Math.abs(p[1]) <= 90)
  )
    return Response.json({ error: "points must be [[lon,lat],...] (max 2000)" }, { status: 400 });
  const pts = points as [number, number][];

  const now = Date.now();
  const stale = pts.filter((p) => {
    const s = cache.get(key(layer, p[0], p[1]));
    return !s || now - s.fetched > TTL || !at(s, now);
  });
  let limited = now < mem.blockedUntil;
  try {
    for (let n = 0; n < stale.length && !limited; n += CHUNK) limited = !(await fetchChunk(layer, stale.slice(n, n + CHUNK)));
  } catch (e) {
    console.error(e);
  }

  // null = land (ocean layer) or not fetched yet; `pending` tells the client which points to retry later.
  const data: ([number, number] | null)[] = [];
  const pending: number[] = [];
  pts.forEach((p, i) => {
    const s = cache.get(key(layer, p[0], p[1]));
    if (!s) pending.push(i);
    data.push(s ? at(s, now) : null);
  });
  return Response.json({
    time: new Date(Math.floor(now / 900_000) * 900_000).toISOString(),
    data,
    pending,
    retryAfter: pending.length ? Math.max(5, Math.ceil((mem.blockedUntil - Date.now()) / 1000)) : 0,
  });
}
