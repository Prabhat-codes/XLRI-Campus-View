# XLRI Jamshedpur in 3D

A browser 3D map of the XLRI campus and about 5 km around it. Everything the site needs is in `site/` — plain HTML, CSS and one JavaScript module, no build step. Three.js loads from the jsDelivr CDN.

## Run locally

```bash
python -m http.server 5173 --directory site
```

Then open http://localhost:5173.

## Deploy to Vercel

`vercel.json` already points Vercel at the `site/` folder, and `.vercelignore` keeps the raw downloads out of the upload.

- **CLI:** run `npx vercel` in this folder for a preview, `npx vercel --prod` to go live.
- **Git:** push this folder to GitHub and import the repo in Vercel. Leave every build setting at its default.

## What is in the map

| Layer | Source | Notes |
| --- | --- | --- |
| 33,820 building footprints | Overture Maps (Google Open Buildings, Microsoft ML Buildings, OpenStreetMap) | Heights are estimated from footprint size; none of the sources record them here. Named campus buildings use hand-set heights in `tools/bake.py`. |
| Campus buildings | Hand-traced from the satellite image, in `tools/campus_overrides.json` | 39 roof outlines with estimated heights; edit that file and rebake to adjust a shape or height. |
| Roads and footpaths (2,287) | OpenStreetMap contributors (ODbL) | Drawn as surfaces with class-based widths. Network cross-checked against Google Maps by eye; street names are hand-placed in `tools/bake.py` because OpenStreetMap has few here. |
| Building and place names, water | OpenStreetMap contributors (ODbL) | |
| Ground and roof imagery | Esri World Imagery | Zoom 17 for the whole area, zoom 18 over the campus (the sharpest available). Check Esri's terms before any commercial use. |
| 67,065 trees | Detected from green canopy in the satellite image | Positions are plausible, not surveyed. |
| Neighbourhood labels | Hand-placed in `tools/bake.py` | Approximate. |

## Rebuild the data

The raw downloads live in `raw/` (not committed). To regenerate `site/data/`:

```bash
python -m venv tools/.venv
tools/.venv/Scripts/python -m pip install overturemaps pillow numpy
tools/.venv/Scripts/overturemaps download --bbox=86.1655,22.790,86.2145,22.835 -f geojson --type=building -o raw/overture_buildings.geojson
tools/.venv/Scripts/python tools/fetch_tiles.py
tools/.venv/Scripts/python tools/bake.py
```

`raw/osm.json` is an Overpass API export of buildings, highways, water, parks and named amenities for the same bounding box.

To cover a different area, change the bounding box and origin at the top of `tools/fetch_tiles.py` and `tools/bake.py`.
