import { decodeGrib2 } from "@/lib/grib2";

// Global 10 m wind from NOAA GFS 0.25° on AWS Open Data (free, no key, public domain).
// We byte-range just the UGRD/VGRD 10 m fields (~2 MB of a 500 MB file) using the .idx index,
// decode them, and return a 0.5° global grid as Int16 (0.01 m/s units):
//   [u rows south->north x 721 cols lon -180..180] then the same for v.
// One fetch per model hour serves every visitor and every pan/zoom.
// The route planner also asks for forecast hours (?at=ISO hour, up to 16 days out) cropped to its box
// (?box=w,s,e,n), so it can use the wind the ship will actually meet along the way.
const BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
const COLS = 721, ROWS = 361, STEP = 0.5; // lon -180..180 (180 repeats -180 so sampling can reach it)

type Grid = { body: ArrayBuffer; valid: string; run: string };
// Grids by valid hour, shared by every visitor. Capped so a run of route requests can't grow it forever.
const g = globalThis as unknown as { __winds?: Map<string, Grid>; __windJobs?: Map<string, Promise<Grid>> };
const grids = (g.__winds ??= new Map()), jobs = (g.__windJobs ??= new Map());

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// Newest run whose file for this valid hour is already published (runs land ~4 h late). GFS has
// hourly steps to 120 h, then 3-hourly to 384 h.
async function locate(valid: number, now: number) {
  for (let back = 0; back < 5; back++) {
    const run = new Date(Math.floor(now / 21600_000) * 21600_000 - back * 21600_000);
    const f = (valid - run.getTime()) / 3600_000;
    if (f < 0 || f > 384 || (f > 120 && f % 3)) continue;
    const ymd = `${run.getUTCFullYear()}${pad(run.getUTCMonth() + 1)}${pad(run.getUTCDate())}`;
    const hh = pad(run.getUTCHours());
    const url = `${BUCKET}/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.0p25.f${pad(f, 3)}`;
    const idx = await fetch(`${url}.idx`, { cache: "no-store" });
    if (idx.ok) return { url, idx: await idx.text(), run: `${ymd}${hh}z+${f}h`, valid: new Date(valid).toISOString() };
  }
  throw new Error("no recent GFS run found");
}

async function build(validAt: number, now: number): Promise<Grid> {
  const { url, idx, run, valid } = await locate(validAt, now);
  const lines = idx.trim().split("\n");
  const at = lines.findIndex((l) => l.includes(":UGRD:10 m above ground:"));
  if (at < 0 || !lines[at + 1]?.includes(":VGRD:10 m above ground:")) throw new Error("10 m wind not found in index");
  const start = Number(lines[at].split(":")[1]);
  const mid = Number(lines[at + 1].split(":")[1]);
  const end = Number(lines[at + 2]?.split(":")[1]) - 1; // next record start - 1
  const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` }, cache: "no-store" });
  if (res.status !== 206) throw new Error(`GFS range fetch ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const u = decodeGrib2(buf.subarray(0, mid - start));
  const v = decodeGrib2(buf.subarray(mid - start));

  const out = new Int16Array(2 * ROWS * COLS);
  for (const [k, f] of [[0, u], [1, v]] as const) {
    for (let j = 0; j < ROWS; j++) {
      const lat = -90 + j * STEP;
      const r = Math.round((f.la1 - lat) / f.dj); // source rows run north->south
      for (let i = 0; i < COLS; i++) {
        const lon = -180 + i * STEP;
        const c = Math.round((((lon - f.lo1) % 360) + 360) % 360 / f.di) % f.ni;
        out[k * ROWS * COLS + j * COLS + i] = Math.round(f.values[r * f.ni + c] * 100);
      }
    }
  }
  return { body: out.buffer, valid, run };
}

export async function GET(req: Request) {
  const now = Date.now(), q = new URL(req.url).searchParams;
  const want = q.get("at") ? Date.parse(q.get("at")!) : now;
  if (!Number.isFinite(want) || want < now - 86400_000 || want > now + 385 * 3600_000)
    return Response.json({ error: "at must be an ISO time from now to 16 days ahead" }, { status: 400 });
  const at = Math.round(want / 3600_000) * 3600_000;
  const key = new Date(at).toISOString();
  let grid = grids.get(key);
  try {
    if (!grid) {
      if (!jobs.has(key)) jobs.set(key, build(at, now).finally(() => jobs.delete(key))); // concurrent requests share one download
      grid = await jobs.get(key)!;
      grids.set(key, grid);
      for (const k of grids.keys()) if (grids.size > 80) grids.delete(k); // oldest first
    }
  } catch (e) {
    console.error(e);
    // the live map falls back to the newest grid we have rather than nothing; a forecast request just fails
    grid = q.get("at") ? undefined : [...grids.values()].pop();
    if (!grid) return Response.json({ error: "wind data unavailable" }, { status: 502 });
  }
  const { body, valid, run } = grid;
  // Optional crop to the route's box; a box across the date line gets the full width.
  let [i0, j0, cols, rows] = [0, 0, COLS, ROWS];
  const box = q.get("box")?.split(",").map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[0] < box[2] && box[1] < box[3]) {
    const [w, s, e, n] = box;
    if (w >= -180 && e <= 180) { i0 = Math.max(0, Math.floor((w + 180) / STEP)); cols = Math.min(COLS - 1, Math.ceil((e + 180) / STEP)) - i0 + 1; }
    j0 = Math.max(0, Math.floor((s + 90) / STEP));
    rows = Math.min(ROWS - 1, Math.ceil((n + 90) / STEP)) - j0 + 1;
  }
  let out = body;
  if (cols !== COLS || rows !== ROWS) {
    const src = new Int16Array(body), dst = new Int16Array(2 * rows * cols);
    for (let k = 0; k < 2; k++)
      for (let j = 0; j < rows; j++)
        dst.set(src.subarray(k * ROWS * COLS + (j0 + j) * COLS + i0, k * ROWS * COLS + (j0 + j) * COLS + i0 + cols), (k * rows + j) * cols);
    out = dst.buffer;
  }
  return new Response(out, {
    headers: {
      "content-type": "application/octet-stream",
      "x-grid": `${-180 + i0 * STEP},${-90 + j0 * STEP},${STEP},${cols},${rows}`,
      "x-valid-time": valid,
      "x-gfs-run": run,
      "cache-control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
