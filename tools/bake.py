"""Bake raw map downloads into the compact files the viewer loads.

Inputs  (raw/):   overture_buildings.geojson, osm.json
        (site/data/): ground.jpg (from fetch_tiles.py)
Outputs (site/data/): buildings.bin, trees.bin, meta.json

Run:  tools/.venv/Scripts/python tools/bake.py
"""
import json, math, os, random, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "site", "data")

# --- area ------------------------------------------------------------------
S, W, N, E = 22.790, 86.1655, 22.835, 86.2145          # whole map
CS, CW, CN, CE = 22.8085, 86.1855, 22.8210, 86.1960    # campus close-up image
LAT0, LON0 = 22.8155, 86.1902                          # scene origin = middle of XLRI
MX = 111320 * math.cos(math.radians(LAT0))
MY = 110574
# box that holds the named XLRI buildings in OpenStreetMap
XL_S, XL_W, XL_N, XL_E = 22.8115, 86.1880, 22.8197, 86.1920


def proj(lon, lat):
    return (lon - LON0) * MX, (lat - LAT0) * MY


BX0, BY0 = proj(W, S)
BX1, BY1 = proj(E, N)

# heights (m) for buildings whose real size is roughly known; rest are estimated
KNOWN_H = {
    "Hostel 1st Year": 16, "Hostel 2nd Year": 16, "International Center": 19,
    "Learning Center 1": 13, "Learning Center 2": 15, "Admin Building": 12,
    "Jehangir Gandhy Library": 13, "TATA Auditorium": 15, "A-Block": 16, "B-Block": 16,
    "C-Block": 16, "D-Block": 16, "Fr. Tome": 9, "GMP Mess": 6, "XLRI Dhaba": 4,
    "Campus Cafe": 4, "Dadoos": 4, "Security Check": 3.5, "Aziz Juice Store": 3.5,
    "Brubeck": 4, "Gents Saloon": 3.5, "Shaligram": 5,
    "Pratap Tower": 30, "Kamani Center": 22, "Bharucha Mansion": 16,
}

# neighbourhood labels: OpenStreetMap has no place nodes here, positions are approximate
AREAS = [
    ("Circuit House Area", 22.8128, 86.1848), ("Sonari", 22.8225, 86.1760),
    ("Kadma", 22.8085, 86.1700), ("Bistupur", 22.7990, 86.1855),
    ("Sakchi", 22.8060, 86.2085), ("Northern Town", 22.8035, 86.1905),
]


# street names (metres east, north of the origin), approximate; snapped to the nearest mapped road when baking
STREETS = [
    ("Marine Drive", 706, 250), ("Marine Drive", -520, 640), ("Baichela Road", -833, -150), ("Road No. 5", -710, -10),
    ("Road No. 4", -710, -277), ("Road No. 3", -710, -410), ("Road No. 9", -60, -517), ("Circuit House Link Road", -660, -690),
    ("Jubilee Road", -393, -773), ("Park Arterial Road", 473, -550), ("Beldih Road", -826, -850),
]


def area_of(p):
    a = 0
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % len(p)]
        a += x0 * y1 - x1 * y0
    return a / 2


def centroid(p):
    return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)


def simplify(p, tol):
    """Drop near-collinear vertices of a closed ring."""
    out = list(p)
    changed = True
    while changed and len(out) > 4:
        changed = False
        for i in range(len(out)):
            a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
            dx, dy = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dy)
            d = math.hypot(b[0] - a[0], b[1] - a[1]) if L < 1e-6 else abs(dx * (a[1] - b[1]) - (a[0] - b[0]) * dy) / L
            if d < tol:
                del out[i]
                changed = True
                break
    return out


def hull(points):
    pts = sorted(set(points))
    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lo, up = half(pts), half(reversed(pts))
    return lo[:-1] + up[:-1]


def inside(pt, poly):
    x, y = pt
    c = False
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def clip(poly):
    """Sutherland-Hodgman clip of a ring to the map rectangle."""
    def cut(p, f, isect):
        out = []
        for i in range(len(p)):
            a, b = p[i - 1], p[i]
            ia, ib = f(a), f(b)
            if ib:
                if not ia:
                    out.append(isect(a, b))
                out.append(b)
            elif ia:
                out.append(isect(a, b))
        return out
    def ix(v):
        return lambda a, b: (v, a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]))
    def iy(v):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]), v)
    for f, isect in ((lambda q: q[0] >= BX0, ix(BX0)), (lambda q: q[0] <= BX1, ix(BX1)),
                     (lambda q: q[1] >= BY0, iy(BY0)), (lambda q: q[1] <= BY1, iy(BY1))):
        if len(poly) < 3:
            return []
        poly = cut(poly, f, isect)
    return poly


def rnd(x, y):
    """Stable 0..1 hash so heights do not change between bakes."""
    h = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return h - math.floor(h)


def main():
    img = Image.open(os.path.join(OUT, "ground.jpg")).convert("RGB")
    IW, IH = img.size
    px = np.asarray(img).astype(np.int32)

    def to_px(x, y):
        return (x - BX0) / (BX1 - BX0) * IW, (BY1 - y) / (BY1 - BY0) * IH

    # ---------------- buildings ----------------
    gj = json.load(open(os.path.join(RAW, "overture_buildings.geojson"), encoding="utf8"))
    blds = []
    for f in gj["features"]:
        g = f["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]] if g["type"] == "MultiPolygon" else []
        props = f["properties"]
        name = (props.get("names") or {}).get("primary")
        for ring in rings:
            p = [proj(lo, la) for lo, la in ring[:-1]]
            if len(p) < 3:
                continue
            if area_of(p) < 0:
                p.reverse()
            p = simplify(p, 0.35)
            a = area_of(p)
            cx, cy = centroid(p)
            if a < 9 or not (BX0 < cx < BX1 and BY0 < cy < BY1):
                continue
            blds.append({"p": p, "a": a, "c": (cx, cy), "name": name, "floors": props.get("num_floors"), "h": props.get("height")})

    # hand-traced campus buildings replace whatever footprint sits under them
    ov = json.load(open(os.path.join(ROOT, "tools", "campus_overrides.json"), encoding="utf8"))
    fixed = []
    for i, o in enumerate(ov["buildings"]):
        p = [proj(lo, la) for lo, la in o["ring"]]
        if area_of(p) < 0:
            p.reverse()
        # the few cm of stagger stop touching parts of one building from flickering where roofs overlap
        fixed.append({"p": p, "a": area_of(p), "c": centroid(p), "name": o["name"], "floors": None, "h": o["height"] + (i % 5) * 0.12, "fixed": True})
    drop = set(ov["replace_names"])
    blds = [b for b in blds if b["name"] not in drop and not any(inside(b["c"], f["p"]) for f in fixed)] + fixed
    print("campus overrides", len(fixed))
    RENAME, DESC = ov.get("rename", {}), ov.get("desc", {})
    for b in blds:
        if b["name"] in RENAME:
            b["name"] = RENAME[b["name"]]

    # campus = hull around the named XLRI buildings, pushed out a little
    xl0, xl1 = proj(XL_W, XL_S), proj(XL_E, XL_N)
    named = [b for b in blds if b["name"] and xl0[0] < b["c"][0] < xl1[0] and xl0[1] < b["c"][1] < xl1[1]]
    hp = hull([q for b in named for q in b["p"]])
    hc = centroid(hp)
    campus = []
    for x, y in hp:
        d = math.hypot(x - hc[0], y - hc[1])
        campus.append((x + (x - hc[0]) / d * 28, y + (y - hc[1]) / d * 28))

    out = bytearray()
    labels = []
    n_campus = 0
    for b in blds:
        cx, cy = b["c"]
        a, name = b["a"], b["name"]
        r = rnd(cx, cy)
        in_campus = inside(b["c"], campus)
        typ = 1 if in_campus else 0
        if b.get("fixed"):
            typ, h = 1, b["h"]
        elif name and ("Stadium" in name or "Sports Complex" in name) and a > 4000:
            typ, h = 3, 15
        elif name in KNOWN_H:
            h = KNOWN_H[name]
        elif b["h"]:
            h = float(b["h"])
        elif b["floors"]:
            h = 3.2 * float(b["floors"]) + 1
        elif in_campus:
            h = 4 + 5 * r if a < 250 else 8 + 5 * r
        elif a < 45:
            h = 3 + 2.5 * r
        elif a < 140:
            h = 3.5 + 5.5 * r * r
        elif a < 450:
            h = 4.5 + 9 * r * r
        elif a < 1500:
            h = 6 + 11 * r * r
        else:
            h = 7 + 8 * r
        if in_campus:
            n_campus += 1
        # roof colour from the satellite image under the footprint
        ix, iy = to_px(cx, cy)
        ix, iy = int(min(max(ix, 1), IW - 2)), int(min(max(iy, 1), IH - 2))
        col = px[iy - 1:iy + 2, ix - 1:ix + 2].reshape(-1, 3).mean(0)
        pts = b["p"][:120]
        out += struct.pack("<6h", typ, round(h * 10), int(col[0]), int(col[1]), int(col[2]), len(pts))
        for x, y in pts:
            out += struct.pack("<2h", max(-32000, min(32000, round(x * 10))), max(-32000, min(32000, round(y * 10))))
        if name and (in_campus or typ == 3):
            labels.append({"n": name, "x": round(cx, 1), "y": round(cy, 1), "h": round(h, 1), "k": "campus" if in_campus else "poi", "d": DESC.get(name, "")})
    for l in ov.get("labels", []):
        x, y = proj(*l["lonlat"])
        labels.append({"n": l["name"], "x": round(x, 1), "y": round(y, 1), "h": l["h"], "k": "campus", "d": l["desc"]})
    open(os.path.join(OUT, "buildings.bin"), "wb").write(out)
    print("buildings", len(blds), "campus", n_campus, "bytes", len(out))

    # ---------------- OSM: roads, water, parks, labels ----------------
    osm = json.load(open(os.path.join(RAW, "osm.json"), encoding="utf8"))["elements"]
    WIDTH = {"trunk": 15, "trunk_link": 8, "primary": 13, "secondary": 11, "secondary_link": 7, "tertiary": 9,
             "tertiary_link": 6, "unclassified": 7, "residential": 6, "living_street": 5, "service": 4, "road": 5,
             "pedestrian": 4, "track": 3, "footway": 2.5, "path": 2.5}
    roads, water, greens = [], [], []
    POI = {"Jubilee Park", "Jayanti Sarovar", "Tata Zoological Park", "Keenan Stadium", "JRD Tata Sports Complex Stadium",
           "Beldih Lake", "Beldih Golf Course", "Sir Dorabji Tata Park", "Tata Main Hospital", "Sacred Heart Convent School",
           "Diamond Jubilee Park", "Football Turf", "Tennis Court"}
    seen = {l["n"] for l in labels}

    def ring_of(e):
        return [proj(q["lon"], q["lat"]) for q in e["geometry"]]

    for e in osm:
        t = e.get("tags", {})
        name = t.get("name")
        if e["type"] == "way" and "highway" in t and t["highway"] in WIDTH:
            pts = [q for q in ring_of(e)]
            pts = [q for q in pts if BX0 - 50 < q[0] < BX1 + 50 and BY0 - 50 < q[1] < BY1 + 50]
            if len(pts) > 1:
                roads.append([WIDTH[t["highway"]]] + [round(v, 1) for q in pts for v in q])
        if t.get("natural") == "water" and t.get("water") != "wastewater":
            def closed(r):
                return len(r) > 3 and math.hypot(r[0][0] - r[-1][0], r[0][1] - r[-1][1]) < 1
            if e["type"] == "way":
                outers, holes = [ring_of(e)], []
            else:
                mem = [(m["role"], [proj(q["lon"], q["lat"]) for q in m["geometry"]]) for m in e["members"] if m.get("geometry")]
                outers = [r for role, r in mem if role == "outer"]
                holes = [r[:-1] for role, r in mem if role == "inner" and closed(r)]
            for r in outers:
                if closed(r):
                    r = clip(r[:-1])
                    if len(r) > 2 and abs(area_of(r)) > 150:
                        # one entry = outer ring followed by its holes (islands)
                        water.append([[round(v, 1) for q in ring for v in q] for ring in [r] + (holes if len(outers) == 1 else [])])
        if e["type"] == "way" and (t.get("leisure") in ("park", "golf_course", "pitch", "playground") or t.get("natural") == "wood" or t.get("landuse") in ("grass", "recreation_ground")):
            r = ring_of(e)
            if len(r) > 3:
                greens.append(r)
        if name in POI and name not in seen:
            seen.add(name)
            if e["type"] == "node":
                x, y = proj(e["lon"], e["lat"])
            else:
                b = e["bounds"]
                x, y = proj((b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2)
            in_c = inside((x, y), campus)
            labels.append({"n": name.replace(" Stadium", "") if "Sports Complex" in name else name, "x": round(x, 1), "y": round(y, 1), "h": 0, "k": "campus" if in_c else "poi"})
    for n, la, lo in AREAS:
        x, y = proj(lo, la)
        labels.append({"n": n, "x": round(x, 1), "y": round(y, 1), "h": 0, "k": "area"})
    for n, la, lo in (("Subarnarekha River", 22.8215, 86.1960), ("Kharkai River", 22.7990, 86.1690)):
        x, y = proj(lo, la)
        labels.append({"n": n, "x": round(x, 1), "y": round(y, 1), "h": 0, "k": "water"})
    # street names: OpenStreetMap has few here, so the well-known ones are placed by hand and snapped onto the nearest road
    for n, x, y in STREETS:
        best, bd = None, 150
        for r in roads:
            if r[0] < 6:
                continue
            for i in range(1, len(r), 2):
                dd = math.hypot(r[i] - x, r[i + 1] - y)
                if dd < bd:
                    bd, best = dd, (r[i], r[i + 1])
        if best:
            labels.append({"n": n, "x": best[0], "y": best[1], "h": 0, "k": "road"})
    # gates stand across the nearest real road, square to it
    gates = []
    for g in ov.get("gates", []):
        px_, py_ = proj(*g["lonlat"])
        best = None
        for r in roads:
            if r[0] < 4:
                continue
            for i in range(1, len(r) - 3, 2):
                ax, ay, bx, by = r[i], r[i + 1], r[i + 2], r[i + 3]
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                if L2 < 0.01:
                    continue
                t = max(0, min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / L2))
                qx, qy = ax + dx * t, ay + dy * t
                dd = math.hypot(qx - px_, qy - py_)
                if best is None or dd < best[0]:
                    best = (dd, qx, qy, math.atan2(dy, dx), r[0])
        dd, qx, qy, ang, wd = best
        print("gate", g["name"], "snapped", round(dd, 1), "m")
        gates.append({"n": g["name"], "x": round(qx, 2), "y": round(qy, 2), "a": round(ang, 4), "w": wd})
        labels.append({"n": g["name"], "x": round(qx, 1), "y": round(qy, 1), "h": 7, "k": "campus", "d": g["desc"]})
    print("roads", len(roads), "water", len(water), "labels", len(labels))

    # ---------------- trees from the satellite image ----------------
    soft = np.asarray(img.filter(ImageFilter.GaussianBlur(1.2))).astype(np.int32)
    R, G, B = soft[..., 0], soft[..., 1], soft[..., 2]
    bright = (R + G + B) / 3
    veg = (G > R + 2) & (G > B + 6) & (bright > 28) & (bright < 118)
    block = Image.new("L", (IW, IH), 0)       # where trees must not stand
    d = ImageDraw.Draw(block)
    for b in blds:
        d.polygon([to_px(*q) for q in b["p"]], fill=255)
    for w in water:
        for k, ring in enumerate(w):
            d.polygon([to_px(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)], fill=0 if k else 255)
    sx = IW / (BX1 - BX0)
    for r in roads:
        d.line([to_px(r[i], r[i + 1]) for i in range(1, len(r), 2)], fill=255, width=max(2, round((r[0] + 7) * sx)))   # +7 m so canopies do not hang over the carriageway
    for e in osm:
        if e["type"] == "way" and e.get("tags", {}).get("leisure") == "pitch":
            d.polygon([to_px(*q) for q in ring_of(e)], fill=255)
    for ring in ov.get("no_trees", []):
        d.polygon([to_px(*proj(lo, la)) for lo, la in ring], fill=255)
    block = np.asarray(block.filter(ImageFilter.MaxFilter(3))) > 0
    ok = veg & ~block
    random.seed(7)
    trees = bytearray()
    nt = 0
    y = BY0 + 4
    while y < BY1 - 4:
        x = BX0 + 4
        near_y = abs(y) < 900
        while x < BX1 - 4:
            near = near_y and abs(x) < 800
            step = 7.5 if near else 13
            jx, jy = x + random.uniform(-0.4, 0.4) * step, y + random.uniform(-0.4, 0.4) * step
            ix, iy = to_px(jx, jy)
            ix, iy = int(ix), int(iy)
            if 0 <= ix < IW and 0 <= iy < IH and ok[iy, ix]:
                dark = 1 - (bright[iy, ix] - 28) / 90          # darker canopy = bigger tree
                size = 6 + 9 * dark * random.uniform(0.6, 1.1)
                trees += struct.pack("<4h", round(jx * 10), round(jy * 10), round(size * 10), int(G[iy, ix]))
                nt += 1
            x += step
        y += 7.5 if near_y else 13
    open(os.path.join(OUT, "trees.bin"), "wb").write(trees)
    print("trees", nt)
    if "--debug" in sys.argv:
        dbg = img.copy()
        dd = ImageDraw.Draw(dbg)
        for i in range(0, len(trees), 8):
            tx, ty, ts, _ = struct.unpack_from("<4h", trees, i)
            qx, qy = to_px(tx / 10, ty / 10)
            dd.ellipse([qx - 2, qy - 2, qx + 2, qy + 2], fill=(255, 40, 200))
        cx, cy = to_px(0, 0)
        dbg.crop((int(cx - 700), int(cy - 700), int(cx + 700), int(cy + 700))).save(os.path.join(RAW, "debug_trees.jpg"), quality=80)

    c0, c1 = proj(CW, CS), proj(CE, CN)
    meta = {
        "origin": [LAT0, LON0], "mx": MX, "my": MY,
        "bounds": [round(BX0, 1), round(BY0, 1), round(BX1, 1), round(BY1, 1)],
        "campusImage": [round(c0[0], 1), round(c0[1], 1), round(c1[0], 1), round(c1[1], 1)],
        "campus": [round(v, 1) for q in campus for v in q],
        "counts": {"buildings": len(blds), "campus": n_campus, "trees": nt},
        "labels": labels, "roads": roads, "water": water, "gates": gates,
    }
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print("meta.json", os.path.getsize(os.path.join(OUT, "meta.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
