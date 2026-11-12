"""Download Esri World Imagery tiles and stitch two ground mosaics:
  site/data/ground.jpg  - whole 5 km area (zoom 17)
  site/data/campus.jpg  - XLRI campus close-up (zoom 18, the sharpest Esri has here)
Run:  tools/.venv/Scripts/python tools/fetch_tiles.py
"""
import io, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "raw", "tiles")
OUT = os.path.join(ROOT, "site", "data")
URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

# (name, zoom, south, west, north, east, max_px, jpeg_quality)
JOBS = [
    ("ground", 17, 22.790, 86.1655, 22.835, 86.2145, 4096, 82),
    ("campus", 18, 22.8085, 86.1855, 22.8210, 86.1960, 4096, 86),
]


def px(lat, lon, z):
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def get(z, x, y):
    p = os.path.join(CACHE, f"{z}_{x}_{y}.jpg")
    if os.path.exists(p) and os.path.getsize(p) > 500:
        return p
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "campus-3d-map/0.1"})
            data = urllib.request.urlopen(req, timeout=30).read()
            with open(p, "wb") as f:
                f.write(data)
            return p
        except Exception as e:  # noqa
            time.sleep(1 + attempt * 2)
    print("FAILED", z, x, y, file=sys.stderr)
    return None


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for name, z, s, w, n, e, max_px, q in JOBS:
        x0, y0 = px(n, w, z)
        x1, y1 = px(s, e, z)
        tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
        coords = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
        print(name, "tiles:", len(coords))
        with ThreadPoolExecutor(8) as ex:
            paths = list(ex.map(lambda c: get(z, *c), coords))
        mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
        for (x, y), p in zip(coords, paths):
            if p:
                mosaic.paste(Image.open(p).convert("RGB"), ((x - tx0) * 256, (y - ty0) * 256))
        crop = mosaic.crop((round(x0 - tx0 * 256), round(y0 - ty0 * 256), round(x1 - tx0 * 256), round(y1 - ty0 * 256)))
        k = max_px / max(crop.size)
        if k < 1:
            crop = crop.resize((round(crop.width * k), round(crop.height * k)), Image.LANCZOS)
        crop.save(os.path.join(OUT, name + ".jpg"), quality=q, optimize=True, progressive=True)
        print(name, crop.size, os.path.getsize(os.path.join(OUT, name + ".jpg")) // 1024, "KB")


if __name__ == "__main__":
    main()
