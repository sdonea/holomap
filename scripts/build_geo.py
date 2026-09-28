# One-off: shrink Natural Earth land + bathymetry into public/geo.json
# Usage: python3 scripts/build_geo.py <dir with Natural Earth .geojson> public/geo.json
# Land = closed rings (filled). Depth = open polylines (only stroked), with artificial edges removed.
# Fill = the same depth areas as closed rings (coarser), for shading deeper water darker; the
# artificial edges don't matter there because fills are never stroked.
# Lakes = closed rings cut out of the land (none are already holes in ne_50m_land).
# Rivers = open polylines keyed by Natural Earth scalerank (1 = biggest), so small ones can hide when zoomed out.
# Coordinates are flat, delta-encoded int arrays: [lon*100, lat*100, dlon, dlat, ...].
import json, sys, os, math

def rings(path):
    for f in json.load(open(path))["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for p in polys:
            for r in p:
                yield r

def cut_straight_runs(ring, min_len=2.0, tol_deg=0.3):
    """Natural Earth depth polygons contain perfectly straight artificial edges: out-and-back
    'bridges' joining holes to the outer ring (e.g. 34° across the Atlantic and back), plus
    date-line and pole cut edges. Real contours never run dead straight for 2°+, so drop any
    such run and split the ring into polylines there."""
    pieces, cur, i = [], [ring[0]], 0
    while i < len(ring) - 1:
        j = i + 1
        b0 = math.atan2(ring[j][1] - ring[i][1], ring[j][0] - ring[i][0])
        while j + 1 < len(ring):
            b = math.atan2(ring[j + 1][1] - ring[j][1], ring[j + 1][0] - ring[j][0])
            if abs((b - b0 + math.pi) % (2 * math.pi) - math.pi) > math.radians(tol_deg): break
            j += 1
        if math.dist(ring[i], ring[j]) > min_len:
            if len(cur) > 1: pieces.append(cur)
            cur = [ring[j]]
        else:
            cur += ring[i + 1:j + 1]
        i = j
    if len(cur) > 1: pieces.append(cur)
    return pieces

def encode(pts, q, min_extent, min_pts):
    out, last = [], None
    for lon, lat in pts:
        pt = (round(lon / q) * q, round(lat / q) * q)
        if pt != last:
            out.append(pt); last = pt
    if len(out) < min_pts: return None
    xs = [p[0] for p in out]; ys = [p[1] for p in out]
    if max(xs) - min(xs) < min_extent and max(ys) - min(ys) < min_extent: return None
    flat, px, py = [], 0, 0
    for x, y in out:
        ix, iy = round(x * 100), round(y * 100)
        flat += [ix - px, iy - py]; px, py = ix, iy
    return flat

src, dst = sys.argv[1], sys.argv[2]
land = [e for e in (encode(r, 0.02, 0.0, 4) for r in rings(f"{src}/ne_50m_land.geojson")) if e]
geo = {"land": land, "depth": {}, "fill": {}}
for name, d, q, ext in [("K_200", 200, 0.05, 0.3), ("J_1000", 1000, 0.05, 0.5), ("I_2000", 2000, 0.1, 1),
                        ("H_3000", 3000, 0.1, 1), ("G_4000", 4000, 0.1, 1.5)]:
    lines = []
    for r in rings(f"{src}/ne_10m_bathymetry_{name}.geojson"):
        for piece in cut_straight_runs(r):
            e = encode(piece, q, ext, 2)
            if e: lines.append(e)
    geo["depth"][d] = lines
    geo["fill"][d] = [e for e in (encode(r, 0.15, 1.0, 4) for r in rings(f"{src}/ne_10m_bathymetry_{name}.geojson")) if e]
geo["lakes"] = [e for e in (encode(r, 0.02, 0.0, 4) for r in rings(f"{src}/ne_50m_lakes.geojson")) if e]
geo["rivers"] = {}
for f in json.load(open(f"{src}/ne_10m_rivers_lake_centerlines.geojson"))["features"]:
    if f["properties"]["featurecla"] != "River": continue  # centerlines through lakes would cross open water
    g = f["geometry"]
    for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
        e = encode(line, 0.005, 0.0, 2)  # finer than land: rivers are thin, so steps show when zoomed in
        if e: geo["rivers"].setdefault(int(f["properties"]["scalerank"]), []).append(e)
json.dump(geo, open(dst, "w"), separators=(",", ":"))
print(os.path.getsize(dst), {k: len(v) for k, v in geo["depth"].items()}, {k: len(v) for k, v in geo["fill"].items()}, len(geo["land"]),
      "lakes", len(geo["lakes"]), "rivers", {k: len(v) for k, v in sorted(geo["rivers"].items())})
