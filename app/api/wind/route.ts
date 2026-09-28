import { decodeGrib2 } from "@/lib/grib2";

// Global 10 m wind from NOAA GFS 0.25° on AWS Open Data (free, no key, public domain).
// We byte-range just the UGRD/VGRD 10 m fields (~2 MB of a 500 MB file) using the .idx index,
// decode them, and return a 0.5° global grid as Int16 (0.01 m/s units):
//   [u rows south->north x 721 cols lon -180..180] then the same for v.
// One fetch per model hour serves every visitor and every pan/zoom.
const BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
const COLS = 721, ROWS = 361, STEP = 0.5; // lon -180..180 (180 repeats -180 so sampling can reach it)

type Grid = { body: ArrayBuffer; valid: string; run: string };
const g = globalThis as unknown as { __wind?: { key: string; grid: Grid }; __windJob?: { key: string; p: Promise<Grid> } };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// Newest run whose file for the hour nearest "now" is already published (runs land ~4 h late).
async function locate(now: number) {
  const hourNow = Math.round(now / 3600_000) * 3600_000;
  for (let back = 0; back < 5; back++) {
    const run = new Date(Math.floor(now / 21600_000) * 21600_000 - back * 21600_000);
    const f = (hourNow - run.getTime()) / 3600_000;
    const ymd = `${run.getUTCFullYear()}${pad(run.getUTCMonth() + 1)}${pad(run.getUTCDate())}`;
    const hh = pad(run.getUTCHours());
    const url = `${BUCKET}/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.0p25.f${pad(f, 3)}`;
    const idx = await fetch(`${url}.idx`, { cache: "no-store" });
    if (idx.ok) return { url, idx: await idx.text(), run: `${ymd}${hh}z+${f}h`, valid: new Date(hourNow).toISOString() };
  }
  throw new Error("no recent GFS run found");
}

async function build(now: number): Promise<Grid> {
  const { url, idx, run, valid } = await locate(now);
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

export async function GET() {
  const now = Date.now();
  const key = new Date(Math.round(now / 3600_000) * 3600_000).toISOString();
  try {
    if (g.__wind?.key !== key) {
      if (g.__windJob?.key !== key) g.__windJob = { key, p: build(now) }; // concurrent requests share one download
      g.__wind = { key, grid: await g.__windJob.p };
    }
  } catch (e) {
    console.error(e);
    g.__windJob = undefined; // let the next request retry
    if (!g.__wind) return Response.json({ error: "wind data unavailable" }, { status: 502 });
    // fall through with the previous hour's grid rather than nothing
  }
  const { body, valid, run } = g.__wind.grid;
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "x-valid-time": valid,
      "x-gfs-run": run,
      "cache-control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
