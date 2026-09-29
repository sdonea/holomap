// Live ship positions (AIS) from aisstream.io: free, needs AISSTREAM_API_KEY (sign in with GitHub at
// aisstream.io, create a key under Account, put it in .env.local). Their rules: no direct browser
// connections, so this server holds ONE websocket and the map polls GET /api/ships?w=&s=&e=&n=.
// The subscription covers every area requested in the last minute, so we only stream what's viewed.
//
// ponytail: in-memory state in one long-lived process. Fine for `next dev`/a single server; on
// serverless (Vercel) each cold instance reconnects and starts empty. Upgrade: a small always-on
// worker writing to Redis/KV, with this route reading from it.

const WS_URL = "wss://stream.aisstream.io/v0/stream";
const SHIP_TTL = 30 * 60 * 1000; // drop ships not heard from in 30 min
const BOX_TTL = 60 * 1000;
const MAX_SHIPS = 20000;
// Past course for the ship panel: reported positions from the last 6 h, at most one per 30 s, and a
// ship sitting still only adds a point every 10 min. Kept only while this process runs.
// ponytail: in memory, up to 720 points per ship; move to a DB if tracks must survive restarts
const TRACK_MS = 6 * 3600 * 1000, TRACK_GAP = 30_000, TRACK_STILL = 10 * 60_000;

type Ship = {
  mmsi: number; lat: number; lon: number; cog: number | null; sog: number; hdg: number | null; name: string; type: number; t: number;
  // static/voyage data (ShipStaticData, every ~6 min) + nav status (position reports), for the ship panel
  trk?: number[]; // [t, lon, lat, t, lon, lat, ...] oldest first
  cls?: "A" | "B"; nav?: number; call?: string; imo?: number; dest?: string; eta?: string; len?: number; beam?: number; draught?: number;
};
type Box = { w: number; s: number; e: number; n: number; t: number };
type State = {
  ws: WebSocket | null;
  ships: Map<number, Ship>;
  boxes: Box[];
  status: string;
  sentKey: string;
  lastSend: number;
  retry: number;
};

// Survive Next dev hot-reloads so we don't open a new socket on every edit (aisstream allows 3).
const g = globalThis as unknown as { __ais?: State };
const st: State = (g.__ais ??= { ws: null, ships: new Map(), boxes: [], status: "CONNECTING", sentKey: "", lastSend: 0, retry: 0 });
// ...but a surviving socket still runs the previous module's handlers, so reconnect with this code.
if (st.ws) { const old = st.ws; st.ws = null; old.close(); }

type Dim = { A?: number; B?: number; C?: number; D?: number };
// Call sign + size, shared by Class A (ShipStaticData) and Class B (StaticDataReport part B).
// AIS "not available" is 0 / blank / @-padding throughout.
function setHull(ship: Ship, call?: string, d?: Dim) {
  ship.call = call?.replace(/@/g, "").trim() || ship.call;
  if (d && (d.A || d.B)) ship.len = (d.A ?? 0) + (d.B ?? 0);
  if (d && (d.C || d.D)) ship.beam = (d.C ?? 0) + (d.D ?? 0);
}

type Msg = {
  MessageType?: string;
  MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number; Latitude?: number; Longitude?: number };
  Message?: Record<string, {
    Latitude?: number; Longitude?: number; Cog?: number; Sog?: number; TrueHeading?: number; Name?: string; Type?: number; Valid?: boolean;
    NavigationalStatus?: number; CallSign?: string; ImoNumber?: number; Destination?: string; MaximumStaticDraught?: number;
    Eta?: { Month?: number; Day?: number; Hour?: number; Minute?: number };
    Dimension?: Dim;
    ReportA?: { Valid?: boolean; Name?: string }; // StaticDataReport (Class B) comes in two parts
    ReportB?: { Valid?: boolean; ShipType?: number; CallSign?: string; Dimension?: Dim };
  }>;
};

function onMessage(raw: string) {
  let m: Msg;
  try { m = JSON.parse(raw); } catch { return; }
  if ((m as { error?: string }).error) { st.status = `ERROR: ${(m as { error: string }).error}`; return; }
  const type = m.MessageType ?? "";
  const body = m.Message?.[type];
  const mmsi = m.MetaData?.MMSI;
  if (!body || !mmsi) return;
  const now = Date.now();
  const ship = st.ships.get(mmsi) ?? { mmsi, lat: NaN, lon: NaN, cog: null, sog: 0, hdg: null, name: "", type: 0, t: now };
  const metaName = m.MetaData?.ShipName?.trim();
  if (metaName) ship.name = metaName;

  if (type === "ShipStaticData") {
    if (body.Name?.trim()) ship.name = body.Name.trim();
    if (body.Type) ship.type = body.Type;
    setHull(ship, body.CallSign, body.Dimension);
    ship.imo = body.ImoNumber || ship.imo;
    ship.dest = body.Destination?.replace(/@/g, "").trim() || ship.dest;
    ship.draught = body.MaximumStaticDraught || ship.draught;
    const e = body.Eta; // month 0 / hour 24 / minute 60 = not available
    if (e?.Month && e.Day && (e.Hour ?? 24) < 24 && (e.Minute ?? 60) < 60)
      ship.eta = `${"JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ")[e.Month - 1] ?? "?"} ${String(e.Day).padStart(2, "0")} ${String(e.Hour).padStart(2, "0")}:${String(e.Minute).padStart(2, "0")} UTC`;
  } else if (type === "StaticDataReport") { // Class B small craft: never send destination/ETA/draught/IMO
    const a = body.ReportA, b = body.ReportB;
    if (a?.Valid && a.Name?.replace(/@/g, "").trim()) ship.name = a.Name.replace(/@/g, "").trim();
    if (b?.Valid) {
      if (b.ShipType) ship.type = b.ShipType;
      setHull(ship, b.CallSign, b.Dimension);
    }
  } else if (type.endsWith("PositionReport")) {
    const { Latitude: lat, Longitude: lon } = body;
    // AIS "not available" sentinels (ITU-R M.1371): lat 91, lon 181, COG 360, heading 511, SOG 102.3
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    ship.lat = lat;
    ship.lon = lon;
    ship.cog = body.Cog != null && body.Cog < 360 ? body.Cog : null;
    ship.hdg = body.TrueHeading != null && body.TrueHeading < 360 ? body.TrueHeading : null;
    ship.sog = body.Sog != null && body.Sog < 102.3 ? body.Sog : 0;
    if (body.NavigationalStatus != null && body.NavigationalStatus < 15) ship.nav = body.NavigationalStatus;
    ship.t = now;
    ship.cls = type === "PositionReport" ? "A" : "B";
    const trk = (ship.trk ??= []), n = trk.length;
    const moved = !n || Math.abs(trk[n - 2] - lon) + Math.abs(trk[n - 1] - lat) > 0.0003; // ~30 m
    if (!n || now - trk[n - 3] >= (moved ? TRACK_GAP : TRACK_STILL)) trk.push(now, lon, lat);
    let old = 0;
    while (old < trk.length && trk[old] < now - TRACK_MS) old += 3;
    if (old) trk.splice(0, old);
  } else return;

  st.ships.set(mmsi, ship);
  if (st.ships.size > MAX_SHIPS) {
    const oldest = [...st.ships.values()].sort((a, b) => a.t - b.t).slice(0, st.ships.size - MAX_SHIPS);
    oldest.forEach((s) => st.ships.delete(s.mmsi));
  }
}

function subscribe() {
  const key = process.env.AISSTREAM_API_KEY;
  const ws = st.ws;
  if (!key || !ws || ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  st.boxes = st.boxes.filter((b) => now - b.t < BOX_TTL).slice(-10);
  if (!st.boxes.length) return;
  // aisstream boxes are [[lat, lon], [lat, lon]] corners
  const boxes = st.boxes.map((b) => [[b.s, b.w], [b.n, b.e]]);
  const sig = JSON.stringify(boxes);
  if (sig === st.sentKey || now - st.lastSend < 1100) return; // their limit: 1 update/s
  st.sentKey = sig;
  st.lastSend = now;
  ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: boxes, FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"] }));
}

function connect() {
  if (!process.env.AISSTREAM_API_KEY) { st.status = "NO API KEY"; return; }
  if (st.ws && st.ws.readyState <= WebSocket.OPEN) return;
  st.status = "CONNECTING";
  st.sentKey = "";
  const ws = new WebSocket(WS_URL);
  st.ws = ws;
  ws.onopen = () => { st.status = "LIVE"; st.retry = 0; st.lastSend = 0; subscribe(); };
  ws.onmessage = async (e) => onMessage(typeof e.data === "string" ? e.data : await new Blob([e.data]).text());
  ws.onclose = () => {
    if (st.ws !== ws) return;
    st.ws = null;
    if (!st.status.startsWith("ERROR")) st.status = "RECONNECTING";
    st.retry = Math.min(st.retry + 1, 6);
    setTimeout(connect, 1000 * 2 ** st.retry);
  };
  ws.onerror = () => {}; // onclose handles retry
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  // ?mmsi=N: everything we know about one ship (the ship panel polls this while it's open)
  if (q.has("mmsi")) {
    const sh = st.ships.get(Number(q.get("mmsi")));
    const live = sh && Number.isFinite(sh.lat) && Date.now() - sh.t < SHIP_TTL;
    if (!live) return Response.json({ status: st.status, ship: null });
    const { trk = [], ...rest } = sh;
    const track = trk.filter((_, i) => i % 3); // [lon, lat, lon, lat, ...] oldest first
    return Response.json({ status: st.status, ship: { ...rest, track, age: Math.round((Date.now() - sh.t) / 1000) } });
  }
  const [w, s, e, n] = ["w", "s", "e", "n"].map((k) => Number(q.get(k)));
  if (![w, s, e, n].every(Number.isFinite) || w >= e || s >= n || Math.abs(s) > 90 || Math.abs(n) > 90)
    return Response.json({ error: "need w<e, s<n bounds in degrees" }, { status: 400 });

  const now = Date.now();
  st.boxes.push({ w: Math.max(-180, w), s, e: Math.min(180, e), n, t: now });
  connect();
  subscribe();

  const ships: (string | number | null)[][] = [];
  for (const sh of st.ships.values()) {
    if (now - sh.t > SHIP_TTL) { st.ships.delete(sh.mmsi); continue; }
    // written as "not inside" so ships with only static data so far (NaN position) are skipped too
    if (!(sh.lon >= w && sh.lon <= e && sh.lat >= s && sh.lat <= n)) continue;
    // compact rows: mmsi, lon, lat, course (deg or null), speed (kn), name, AIS ship type
    ships.push([sh.mmsi, sh.lon, sh.lat, sh.cog ?? sh.hdg, Math.round(sh.sog * 10) / 10, sh.name, sh.type]);
    if (ships.length >= 3000) break;
  }
  return Response.json({ status: st.status, ships });
}
