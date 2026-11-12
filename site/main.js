// XLRI Jamshedpur in 3D. Static viewer: loads the baked files in ./data and
// raises every building footprint over satellite ground imagery.
// Scene units are metres. +X = east, +Y = up, -Z = north. Origin = middle of campus.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setupPlaces } from './places.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- loading
const loadState = { done: 0, total: 6 };
function step(msg) {
  loadState.done++;
  $('loader-fill').style.width = Math.round((loadState.done / loadState.total) * 100) + '%';
  if (msg) $('loader-msg').textContent = msg;
}
const texLoader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res, rej) => texLoader.load(url, res, undefined, rej));

// ---------------------------------------------------------------- renderer
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9db4c8, 2600, 11000);
const camera = new THREE.PerspectiveCamera(42, 1, 4, 60000);

const controls = new MapControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 60;
controls.maxDistance = 7500;
controls.maxPolarAngle = 84 * D2R;
controls.zoomToCursor = true;
controls.autoRotateSpeed = 0.5;

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.15, 0.6, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- sky and lights
const sky = new Sky();
sky.scale.setScalar(40000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6;
skyU.rayleigh.value = 1.6;
skyU.mieCoefficient.value = 0.006;
skyU.mieDirectionalG.value = 0.82;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a5346, 1);
scene.add(hemi);

const starGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 0.95 + 0.04);
    p.set([Math.cos(a) * Math.cos(e) * 30000, Math.sin(e) * 30000, Math.sin(a) * Math.cos(e) * 30000], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
scene.add(stars);

// shared uniforms for the custom shader bits
const U = { night: { value: 0 }, time: { value: 0 }, edge: { value: new THREE.Color(0x2c3527) } };
const sunDir = new THREE.Vector3(0, 1, 0);
let nightAmt = 0;

// ---------------------------------------------------------------- data
let meta, labelsOn = true, satTex = null, PL = null;   // PL: campus directory (places.js)   // satTex: shared by the ground and the roofs
const nightMats = [];   // materials that only show after dark
let trees = null, treeCount = 0;

async function boot() {
  const [m, bBuf, tBuf, ground, campusTex, placesData] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()).then((v) => (step('Laying out streets'), v)),
    fetch('data/buildings.bin').then((r) => r.arrayBuffer()).then((v) => (step('Reading building footprints'), v)),
    fetch('data/trees.bin').then((r) => r.arrayBuffer()).then((v) => (step('Counting trees'), v)),
    loadTex('data/ground.jpg').then((v) => (step('Unrolling the satellite image'), v)),
    loadTex('data/campus.jpg').then((v) => (step('Sharpening the campus'), v)),
    fetch('data/places.json').then((r) => (r.ok ? r.json() : { places: [] })).catch(() => ({ places: [] })),
  ]);
  meta = m;
  PL = setupPlaces(placesData, { goTo });
  buildGround(ground, campusTex);
  buildWater();
  await nextFrame();
  const t0 = performance.now();
  buildBuildings(new Int16Array(bBuf));
  const t1 = performance.now();
  buildTrees(new Int16Array(tBuf));
  window.__map.timing = { buildingsMs: Math.round(t1 - t0), treesMs: Math.round(performance.now() - t1) };
  buildRoads();
  await document.fonts.load('700 92px "Cormorant Garamond"').catch(() => {});   // the gate sign is drawn with it
  for (const g of meta.gates || []) buildGate(g);
  buildRoadGlow();
  buildLabels();
  buildPlaces();
  step('Raising buildings from their footprints');
  $('stats').innerHTML = `<b>${meta.counts.buildings.toLocaleString('en-IN')}</b> buildings and <b>${meta.counts.trees.toLocaleString('en-IN')}</b> trees placed from the map`;
  applyQuality();
  resize();
  setTime(+$('time').value);
  setView({ x: 0, y: -150, dist: 5200, heading: 0, tilt: 12 });
  renderer.setAnimationLoop(frame);
  await nextFrame();
  $('loader').classList.add('done');
  setTimeout(() => flyTo(HOME, 4200), 500);
  setTimeout(() => $('hint').classList.add('gone'), 9000);
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- ground
function buildGround(tex, hi) {
  const [x0, y0, x1, y1] = meta.bounds;
  for (const t of [tex, hi]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  const [cx0, cy0, cx1, cy1] = meta.campusImage;
  const rect = new THREE.Vector4((cx0 - x0) / (x1 - x0), (cy0 - y0) / (y1 - y0), (cx1 - x0) / (x1 - x0), (cy1 - y0) / (y1 - y0));
  satTex = { ground: { value: tex }, hi: { value: hi }, rect: { value: rect }, bounds: { value: new THREE.Vector4(x0, y0, x1, y1) } };
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHi = { value: hi };
    sh.uniforms.uHiRect = { value: rect };
    sh.uniforms.uEdge = U.edge;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uHi; uniform vec4 uHiRect; uniform vec3 uEdge;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 hUv = (vMapUv - uHiRect.xy) / (uHiRect.zw - uHiRect.xy);
        float hIn = min(min(hUv.x, 1.0 - hUv.x), min(hUv.y, 1.0 - hUv.y));
        if (hIn > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uHi, hUv).rgb, smoothstep(0.0, 0.05, hIn));
        float eIn = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
        diffuseColor.rgb = mix(uEdge, diffuseColor.rgb * 1.12, smoothstep(0.0, 0.045, eIn));`);
  };
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set((x0 + x1) / 2, 0, -(y0 + y1) / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = -3;   // ground first, then roads, then everything standing on it
  scene.add(mesh);
  // everything beyond the mapped square
  const far = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: U.edge.value, roughness: 1 }));
  far.position.y = -1.5;
  scene.add(far);
}

// ---------------------------------------------------------------- water
let waterMat;
function buildWater() {
  const geos = [];
  for (const rings of meta.water) {
    const ring = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push(new THREE.Vector2(r[i], r[i + 1])); return p; };
    const s = new THREE.Shape(ring(rings[0]));
    for (let k = 1; k < rings.length; k++) s.holes.push(new THREE.Path(ring(rings[k])));
    geos.push(new THREE.ShapeGeometry(s));
  }
  waterMat = new THREE.MeshStandardMaterial({ color: 0x1c4650, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = U.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform float uT;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 wv = vWp.xz;
        vec3 rip = vec3(sin(wv.x * 0.31 + uT * 1.2) + sin(wv.y * 0.19 - uT * 0.9) + sin((wv.x + wv.y) * 0.83 + uT * 2.1) * 0.5, 0.0,
                        cos(wv.y * 0.37 + uT * 1.0) + sin(wv.x * 0.23 + uT * 0.7) + cos((wv.x - wv.y) * 0.71 - uT * 1.7) * 0.5);
        normal = normalize(normal + (viewMatrix * vec4(rip, 0.0)).xyz * 0.045);`);
  };
  for (const g of geos) {
    const mesh = new THREE.Mesh(g.rotateX(-Math.PI / 2), waterMat);
    mesh.position.y = 0.25;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------- buildings
const WALLS = [[0.93, 0.9, 0.84], [0.88, 0.84, 0.76], [0.95, 0.93, 0.9], [0.9, 0.82, 0.72], [0.84, 0.86, 0.87], [0.93, 0.86, 0.8], [0.86, 0.8, 0.7]];
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

function buildBuildings(d) {
  // pass 1: index the records and bucket them into square chunks so off-screen parts are culled
  const [bx0, by0, bx1, by1] = meta.bounds;
  const GRID = 7, cw = (bx1 - bx0) / GRID, ch = (by1 - by0) / GRID;
  const chunks = Array.from({ length: GRID * GRID }, () => ({ recs: [], verts: 0, idx: 0 }));
  const stadiums = [];
  for (let o = 0; o < d.length;) {
    const n = d[o + 5];
    if (d[o] === 3) stadiums.push(o);
    else {
      const cx = clamp(Math.floor((d[o + 6] / 10 - bx0) / cw), 0, GRID - 1), cy = clamp(Math.floor((d[o + 7] / 10 - by0) / ch), 0, GRID - 1);
      const c = chunks[cy * GRID + cx];
      c.recs.push(o);
      c.verts += n * 5;
      c.idx += n * 6 + (n - 2) * 3;
    }
    o += 6 + n * 2;
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U.night;
    sh.uniforms.uSat = satTex.ground; sh.uniforms.uHi = satTex.hi; sh.uniforms.uHiRect = satTex.rect; sh.uniforms.uB = satTex.bounds;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aW; varying vec3 vW; varying vec2 vGuv; uniform vec4 uB;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = aW; vGuv = (vec2(position.x, -position.z) - uB.xy) / (uB.zw - uB.xy);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vW; varying vec2 vGuv; uniform float uNight; uniform sampler2D uSat; uniform sampler2D uHi; uniform vec4 uHiRect;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wLit = 0.0;
        if (vW.x > -500.0) {                       // walls only: x = metres along the wall, y = height, z = building seed
          float fade = 1.0 - smoothstep(450.0, 1500.0, length(vViewPosition));
          vec2 cell = vec2(vW.x / 3.3, (vW.y - 0.5) / 3.1);
          vec2 f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8) * step(0.5, vW.y);
          float r = h21(floor(cell) + vW.z * 61.0);
          diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 5.0, vW.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.4, 0.46, 0.55), win * fade);
          float on = step(1.0 - 0.4 * uNight, r);
          wLit = mix(0.07, win * on, fade) * uNight;
        } else {                                   // roofs wear the satellite picture of themselves
          vec3 sat = texture2D(uSat, vGuv).rgb;
          vec2 hUv = (vGuv - uHiRect.xy) / (uHiRect.zw - uHiRect.xy);
          float hIn = min(min(hUv.x, 1.0 - hUv.x), min(hUv.y, 1.0 - hUv.y));
          if (hIn > 0.0) sat = mix(sat, texture2D(uHi, hUv).rgb, smoothstep(0.0, 0.05, hIn));
          diffuseColor.rgb = mix(diffuseColor.rgb, sat, 0.85) * 1.15;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.68, 0.34) * wLit * 2.4;');
  };
  const col = new THREE.Color(), pts = [];
  for (const c of chunks) {
    if (!c.recs.length) continue;
    const pos = new Float32Array(c.verts * 3), nor = new Int8Array(c.verts * 3), colr = new Uint8Array(c.verts * 3), aw = new Float32Array(c.verts * 3);
    const idx = new Uint32Array(c.idx);
    let v = 0, ii = 0;
    const put = (x, y, z, nx, ny, nz, r, g, b, wu, wv, ws) => {
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      nor[v * 3] = nx * 127; nor[v * 3 + 1] = ny * 127; nor[v * 3 + 2] = nz * 127;
      colr[v * 3] = r; colr[v * 3 + 1] = g; colr[v * 3 + 2] = b;
      aw[v * 3] = wu; aw[v * 3 + 1] = wv; aw[v * 3 + 2] = ws;
      return v++;
    };
    for (const o of c.recs) {
      const h = d[o + 1] / 10, n = d[o + 5], seed = hash(o);
      col.setRGB(d[o + 2] / 255, d[o + 3] / 255, d[o + 4] / 255, THREE.SRGBColorSpace);
      const rr = col.r * 255, rg = col.g * 255, rb = col.b * 255;
      const w = WALLS[Math.floor(seed * WALLS.length)];
      col.setRGB(lerp(w[0], d[o + 2] / 255, 0.3), lerp(w[1], d[o + 3] / 255, 0.3), lerp(w[2], d[o + 4] / 255, 0.3), THREE.SRGBColorSpace);
      const wr = col.r * 255, wg = col.g * 255, wb = col.b * 255;
      pts.length = 0;
      for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(d[o + 6 + k * 2] / 10, d[o + 7 + k * 2] / 10));
      // roof
      const base = v;
      for (const p of pts) put(p.x, h, -p.y, 0, 1, 0, rr, rg, rb, -1000, 0, seed);
      for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) {
        const a = pts[t[0]], b = pts[t[1]], cc = pts[t[2]];
        const ccw = (b.x - a.x) * (cc.y - a.y) - (b.y - a.y) * (cc.x - a.x) > 0;
        idx[ii++] = base + t[0]; idx[ii++] = base + (ccw ? t[1] : t[2]); idx[ii++] = base + (ccw ? t[2] : t[1]);
      }
      // walls
      let run = seed * 3;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = dy / L, nz = dx / L;
        const i0 = put(a.x, 0, -a.y, nx, 0, nz, wr, wg, wb, run, 0, seed);
        put(b.x, 0, -b.y, nx, 0, nz, wr, wg, wb, run + L, 0, seed);
        put(b.x, h, -b.y, nx, 0, nz, wr, wg, wb, run + L, h, seed);
        put(a.x, h, -a.y, nx, 0, nz, wr, wg, wb, run, h, seed);
        idx[ii++] = i0; idx[ii++] = i0 + 1; idx[ii++] = i0 + 2; idx[ii++] = i0; idx[ii++] = i0 + 2; idx[ii++] = i0 + 3;
        run += L;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3, true));
    g.setAttribute('aW', new THREE.BufferAttribute(aw, 3));
    g.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // stadiums: a raked bowl instead of a solid block
  for (const o of stadiums) {
    const h = d[o + 1] / 10, n = d[o + 5];
    let cx = 0, cy = 0;
    const p = [];
    for (let k = 0; k < n; k++) { p.push([d[o + 6 + k * 2] / 10, d[o + 7 + k * 2] / 10]); cx += p[k][0] / n; cy += p[k][1] / n; }
    const pos = [], ix = [];
    for (let k = 0; k < n; k++) {
      const [x, y] = p[k];
      pos.push(x, 0, -y, x, h, -y, lerp(cx, x, 0.9), h, -lerp(cy, y, 0.9), lerp(cx, x, 0.58), 1.5, -lerp(cy, y, 0.58));
      const a = k * 4, b = ((k + 1) % n) * 4;
      for (let s = 0; s < 3; s++) ix.push(a + s, b + s, b + s + 1, a + s, b + s + 1, a + s + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(ix);
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------- trees
function buildTrees(d) {
  const n = d.length / 4;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(hash(i + 0.5) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }   // shuffled so a lower count thins evenly
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {   // knock the sphere a little out of round
    const k = 1 + (hash(Math.round(p.getX(i) * 91) + Math.round(p.getY(i) * 57) * 3 + Math.round(p.getZ(i) * 31) * 7) - 0.5) * 0.3;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  trees = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const o = order[i] * 4, size = d[o + 2] / 10, r = hash(o + 3.3), r2 = hash(o + 9.1);
    const rad = size * (0.34 + r * 0.14);
    t.set(d[o] / 10, size * 0.52, -d[o + 1] / 10);
    s.set(rad, size * 0.5, rad * (0.85 + r2 * 0.3));
    q.setFromAxisAngle(up, r * 6.283);
    trees.setMatrixAt(i, m.compose(t, q, s));
    c.setHSL(0.21 + r2 * 0.09, 0.36 + r * 0.2, 0.085 + (d[o + 3] / 255) * 0.17 + r2 * 0.04);
    trees.setColorAt(i, c);
  }
  trees.castShadow = trees.receiveShadow = true;
  trees.frustumCulled = false;
  treeCount = n;
  scene.add(trees);
}

// ---------------------------------------------------------------- roads
// Every mapped road is drawn twice: a slightly wider shoulder underneath, then the carriageway on top,
// so junctions merge cleanly. Neither writes depth; they sit on the ground and draw right after it.
function roadRibbon(roads, extra, y) {
  const pos = [], aR = [], idx = [];
  for (const r of roads) {
    const n = (r.length - 1) / 2, half = r[0] / 2 + extra;
    if (n < 2) continue;
    const base = pos.length / 3;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const x = r[1 + i * 2], yy = r[2 + i * 2];
      const px = r[1 + Math.max(i - 1, 0) * 2], py = r[2 + Math.max(i - 1, 0) * 2];
      const qx = r[1 + Math.min(i + 1, n - 1) * 2], qy = r[2 + Math.min(i + 1, n - 1) * 2];
      let ax = x - px, ay = yy - py, bx = qx - x, by = qy - yy;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      along += i ? la : 0;
      if (i === 0) { ax = bx; ay = by; } else { ax /= la; ay /= la; }
      if (i === n - 1) { bx = ax; by = ay; } else { bx /= lb; by /= lb; }
      if (i === 0) { const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l; }
      // mitre: average the two side normals, stretched so the edge stays parallel (capped on hairpins)
      let nx = -(ay + by), ny = ax + bx;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const k = half / Math.max(nx * -by + ny * bx, 0.45);
      pos.push(x + nx * k, y, -(yy + ny * k), x - nx * k, y, -(yy - ny * k));
      aR.push(along, 1, r[0], along, -1, r[0]);
      if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildRoads() {
  const roads = [...meta.roads].sort((a, b) => a[0] - b[0]);   // main roads last, so their markings stay on top
  const flat = { roughness: 0.96, metalness: 0, depthWrite: false, polygonOffset: true, side: THREE.DoubleSide };
  const shoulder = new THREE.Mesh(roadRibbon(roads.filter((r) => r[0] >= 4), 0.9, 0.1), new THREE.MeshStandardMaterial({ ...flat, color: 0x6f6a5f, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  const mat = new THREE.MeshStandardMaterial({ ...flat, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aR; varying vec3 vR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = aR;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vR;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float halfW = vR.z * 0.5, off = abs(vR.y) * halfW;          // metres from the centre line
        float near = 1.0 - smoothstep(500.0, 1600.0, length(vViewPosition));
        vec3 rc = vec3(0.088, 0.088, 0.09);                          // asphalt
        if (vR.z < 3.5) rc = vec3(0.36, 0.29, 0.19);                  // footpaths and tracks: packed earth
        else {
          if (vR.z >= 6.0) rc = mix(rc, vec3(0.55), near * 0.75 * smoothstep(halfW - 0.5, halfW - 0.4, off) * (1.0 - smoothstep(halfW - 0.25, halfW - 0.15, off)));
          if (vR.z >= 9.0) rc = mix(rc, vec3(0.62, 0.6, 0.5), near * step(0.55, fract(vR.x / 12.0)) * (1.0 - smoothstep(0.1, 0.2, off)));
        }
        diffuseColor.rgb = rc;`);
  };
  const top = new THREE.Mesh(roadRibbon(roads, 0, 0.18), mat);
  shoulder.renderOrder = -2; top.renderOrder = -1;
  shoulder.receiveShadow = top.receiveShadow = true;
  scene.add(shoulder, top);
}

// ---------------------------------------------------------------- campus gates
// Modelled on the XLRI main gate: a tall ochre pillar with the emblem panel, a cream pillar,
// an ochre beam carrying the name, and red sliding gates. Local X runs across the road, Z along it.
let gateTex = null;
function makeGateTextures() {
  const sign = document.createElement('canvas');
  sign.width = 1024; sign.height = 128;
  let c = sign.getContext('2d');
  c.fillStyle = '#c98b45'; c.fillRect(0, 0, 1024, 128);
  c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 116, 1024, 12);
  c.textBaseline = 'middle';
  c.fillStyle = '#7b1d18'; c.font = '700 92px "Cormorant Garamond", Georgia, serif';
  c.fillText('XLRI', 250, 62);
  c.fillStyle = '#fff6e6'; c.font = '500 40px Inter, Arial, sans-serif';
  c.fillText('Xavier School of Management', 505, 64);
  const emblem = document.createElement('canvas');
  emblem.width = emblem.height = 128;
  c = emblem.getContext('2d');
  c.fillStyle = '#f2e6cc'; c.fillRect(0, 0, 128, 128);
  c.fillStyle = '#1d4f9c'; c.fillRect(10, 10, 108, 108);
  c.strokeStyle = '#ffffff'; c.lineWidth = 6;
  c.beginPath(); c.moveTo(34, 30); c.lineTo(94, 30); c.lineTo(94, 70); c.quadraticCurveTo(94, 96, 64, 104); c.quadraticCurveTo(34, 96, 34, 70); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(64, 42); c.lineTo(64, 88); c.moveTo(46, 58); c.lineTo(82, 58); c.stroke();
  const bars = document.createElement('canvas');
  bars.width = 256; bars.height = 64;
  c = bars.getContext('2d');
  c.fillStyle = '#b8261f';
  c.fillRect(0, 0, 256, 7); c.fillRect(0, 57, 256, 7); c.fillRect(0, 30, 256, 5); c.fillRect(0, 0, 7, 64); c.fillRect(249, 0, 7, 64);
  for (let x = 16; x < 250; x += 16) c.fillRect(x, 0, 4, 64);
  const t = (cv) => { const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; return tx; };
  gateTex = { sign: t(sign), emblem: t(emblem), bars: t(bars) };
}
function buildGate(g) {
  if (!gateTex) makeGateTextures();
  const ochre = new THREE.MeshStandardMaterial({ color: 0xc98b45, roughness: 0.8 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xece0c6, roughness: 0.85 });
  const signM = new THREE.MeshStandardMaterial({ map: gateTex.sign, roughness: 0.75 });
  const grp = new THREE.Group();
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; grp.add(b); return b; };
  const o = g.w / 2 + 1.6;                         // half of the clear opening
  const L = -o - 2.6, R = o + 1.9;                 // outer edges of the two pillars
  box(2.6, 7.8, 2.0, -o - 1.3, 3.9, 0, ochre);     // tall pillar with the emblem
  box(2.9, 0.35, 2.3, -o - 1.3, 7.95, 0, cream);   // its cap
  box(1.9, 7.0, 1.7, o + 0.95, 3.5, 0, cream);     // plain pillar
  box(3.2, 2.2, 0.35, o + 3.4, 1.1, 0, cream);     // low wall running off the plain pillar
  box(3.0, 2.6, 0.35, L - 1.5, 1.3, 0, cream);     // and off the tall one
  box(R - L, 1.5, 1.3, (L + R) / 2, 6.25, 0, [ochre, ochre, ochre, cream, signM, signM]);   // beam: sign on both faces, cream underside
  box(R - L, 0.18, 1.5, (L + R) / 2, 7.08, 0, cream);
  for (const s of [1, -1]) {                       // emblem panel, both faces of the tall pillar
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshStandardMaterial({ map: gateTex.emblem, roughness: 0.6 }));
    p.position.set(-o - 1.3, 3.4, s * 1.01);
    p.rotation.y = s > 0 ? 0 : Math.PI;
    grp.add(p);
  }
  const barsM = new THREE.MeshStandardMaterial({ map: gateTex.bars, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  for (const s of [-1, 1]) {                       // sliding gates, pulled most of the way open
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(o * 0.95, 2.1), barsM);
    leaf.position.set(s * (o - o * 0.95 / 2 + 0.1), 1.05, s * 0.25 + 0.6);
    leaf.castShadow = true;
    grp.add(leaf);
  }
  grp.position.set(g.x, 0, -g.y);
  grp.rotation.y = Math.atan2(Math.cos(g.a), -Math.sin(g.a));
  scene.add(grp);
}

// ---------------------------------------------------------------- night: lit streets and lamps
function buildRoadGlow() {
  const pos = [], lamps = [];
  for (const r of meta.roads) {
    if (r[0] < 3.5) continue;   // footpaths are not lit
    const hw = r[0] * 0.42;
    let carry = 0;
    for (let i = 1; i + 3 < r.length; i += 2) {
      const ax = r[i], ay = r[i + 1], bx = r[i + 2], by = r[i + 3];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const nx = (-dy / L) * hw, ny = (dx / L) * hw;
      pos.push(ax + nx, 0.5, -(ay + ny), ax - nx, 0.5, -(ay - ny), bx - nx, 0.5, -(by - ny), ax + nx, 0.5, -(ay + ny), bx - nx, 0.5, -(by - ny), bx + nx, 0.5, -(by + ny));
      if (r[0] >= 6) {
        for (let s = carry; s < L; s += 42) lamps.push(ax + (dx * s) / L + nx * 1.6, 7.5, -(ay + (dy * s) / L + ny * 1.6));
        carry = (carry - L) % 42; if (carry < 0) carry += 42;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.16), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  glow.userData.max = 0.3;
  scene.add(new THREE.Mesh(g, glow));

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,170,0.7)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
  cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
  const lampMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), color: new THREE.Color(2.2, 1.5, 0.8), size: 15, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  lampMat.userData.max = 1;
  const lampPts = new THREE.Points(lg, lampMat);
  lampPts.frustumCulled = false;
  scene.add(lampPts);
  nightMats.push(glow, lampMat);
}

// ---------------------------------------------------------------- labels
const labels = [];
function buildLabels() {
  const host = $('labels');
  const rank = { home: -1, area: 0, water: 1, poi: 2, road: 2.5, campus: 3 };
  for (const l of [{ n: 'XLRI', x: 0, y: 0, h: 0, k: 'home' }, ...meta.labels]) {
    const el = document.createElement('div');
    el.className = 'lb off ' + l.k + (l.d || PL.get(l.n) ? ' has-d' : '');
    el.textContent = l.n;
    el.addEventListener('click', () => { flyToLabel(l); PL.showCard(l, true); });
    el.addEventListener('mouseenter', () => PL.showCard(l, false));
    el.addEventListener('mouseleave', () => PL.hideCard(false));
    host.appendChild(el);
    labels.push({ ...l, el, pos: new THREE.Vector3(l.x, l.h + (l.k === 'area' || l.k === 'home' ? 30 : 9), -l.y), w: l.n.length * 7.2 + 22, rank: rank[l.k], shown: false });
  }
  labels.sort((a, b) => a.rank - b.rank);
}
const v3 = new THREE.Vector3();
function updateLabels() {
  const dist = camera.position.distanceTo(controls.target);
  const W = innerWidth, H = innerHeight, taken = [];
  // close up: campus names win; far out: neighbourhoods win
  const order = dist < 1600 ? [...labels].reverse() : labels;
  for (const l of order) {
    let show = labelsOn;
    if (l.k === 'campus') show &&= dist < 2300;
    if (l.k === 'area') show &&= dist > 900;
    if (l.k === 'home') show &&= dist >= 2300;
    if (l.k === 'road') show &&= dist < 2600;
    let x = 0, y = 0;
    if (show) {
      v3.copy(l.pos).project(camera);
      x = (v3.x * 0.5 + 0.5) * W; y = (-v3.y * 0.5 + 0.5) * H;
      show = v3.z < 1 && x > -20 && x < W && y > 60 && y < H - 20;
      if (show && l.k === 'campus' && camera.position.distanceTo(l.pos) > 2600) show = false;
    }
    if (show) {
      const box = [x - 6, y - 10, x + l.w, y + 10];
      if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) show = false;
      else taken.push(box);
    }
    if (show) l.el.style.transform = `translate(${Math.round(x - 4)}px, ${Math.round(y - 9)}px)`;
    if (show !== l.shown) { l.shown = show; l.el.classList.toggle('off', !show); }
  }
}

// ---------------------------------------------------------------- camera moves
const HOME = { name: 'XLRI campus', x: 10, y: -40, dist: 1050, heading: -14, tilt: 60 };
function getView() {
  const d = v3.copy(controls.target).sub(camera.position);
  const dist = d.length();
  return { x: controls.target.x, y: -controls.target.z, dist, heading: Math.atan2(d.x, -d.z) / D2R, tilt: Math.acos(clamp(-d.y / dist, -1, 1)) / D2R };
}
function setView(v) {
  const h = v.heading * D2R, t = v.tilt * D2R;
  controls.target.set(v.x, 0, -v.y);
  camera.position.set(v.x - Math.sin(h) * Math.sin(t) * v.dist, Math.cos(t) * v.dist, -v.y + Math.cos(h) * Math.sin(t) * v.dist);
  camera.lookAt(controls.target);
}
let fly = null;
function flyTo(to, ms = 2400) {
  const from = getView();
  if (!(from.dist > 0)) return;   // camera not placed yet (still loading)
  const end = { heading: from.heading, tilt: from.tilt, ...to };
  end.heading = from.heading + ((((end.heading - from.heading) % 360) + 540) % 360) - 180;
  fly = { from, end, t0: performance.now(), ms };
  controls.enabled = false;
}
function stepFly(now) {
  if (!fly) return;
  let k = clamp((now - fly.t0) / fly.ms, 0, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const { from: a, end: b } = fly;
  // rise a little in the middle of long hops so the move reads as a flight
  const hop = Math.hypot(b.x - a.x, b.y - a.y);
  const lift = Math.sin(e * Math.PI) * Math.min(hop * 0.35, 900);
  setView({ x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), e)) + lift, heading: lerp(a.heading, b.heading, e), tilt: lerp(a.tilt, b.tilt, e) });
  if (k >= 1) { fly = null; controls.enabled = true; }
}
function cancelFly() { if (fly) { fly = null; controls.enabled = true; } $('hint').classList.add('gone'); }
function flyToLabel(l) {
  flyTo({ x: l.x, y: l.y, dist: l.k === 'area' ? 1500 : l.k === 'campus' ? 260 : l.k === 'home' ? HOME.dist : 700, tilt: 58 });
}
// used by search and the assistant: fly to a named place and pin its card
function goTo(name, quiet) {
  const l = labels.find((x) => x.n === name);
  if (!l) return;
  flyToLabel(l);
  if (!quiet || innerWidth > 760) PL.showCard(l, true);
}
// the card hides again as soon as the map itself is touched
canvas.addEventListener('pointerdown', () => PL && PL.hideCard(true));
canvas.addEventListener('pointerdown', cancelFly);
canvas.addEventListener('wheel', cancelFly, { passive: true });

function buildPlaces() {
  const at = (name) => meta.labels.find((l) => l.n === name);
  const list = [
    HOME,
    { name: 'Learning Centre', ref: 'Learning Center 2', dist: 330, heading: 20, tilt: 62 },
    { name: 'Main Gate', ref: 'Main Gate', dist: 120, heading: 15, tilt: 70 },
    { name: 'New Hostel', ref: 'NH Boys Hostel', dist: 380, heading: 150, tilt: 60 },
    { name: 'Old Hostels', ref: 'Nilima Hostel', dist: 340, heading: 0, tilt: 58 },
    { name: 'Bishu Da', ref: 'Bishu Da', dist: 140, heading: 70, tilt: 62 },
    { name: 'Library', ref: 'Jehangir Gandhy Library', dist: 300, heading: -40, tilt: 60 },
    { name: 'Tata Auditorium', ref: 'Tata Auditorium', dist: 300, heading: 60, tilt: 60 },
    { name: 'Jubilee Park', ref: 'Jubilee Park', dist: 1300, heading: 35, tilt: 58 },
    { name: 'Jayanti Sarovar', ref: 'Jayanti Sarovar', dist: 800, heading: -60, tilt: 64 },
    { name: 'Zoo', ref: 'Tata Zoological Park', dist: 700, heading: 100, tilt: 58 },
    { name: 'Keenan Stadium', ref: 'Keenan Stadium', dist: 620, heading: -30, tilt: 58 },
    { name: 'Subarnarekha', ref: 'Subarnarekha River', dist: 1500, heading: 70, tilt: 70 },
    { name: 'Whole area', x: 0, y: -350, dist: 6200, heading: 0, tilt: 28 },
  ];
  for (const p of list) {
    const l = p.ref && at(p.ref);
    if (p.ref && !l) continue;
    const view = l ? { ...p, x: l.x, y: l.y } : p;
    const b = document.createElement('button');
    b.textContent = p.name;
    if (p === HOME) b.className = 'home';
    b.addEventListener('click', () => flyTo(view));
    $('places').appendChild(b);
  }
}

// ---------------------------------------------------------------- time of day
const cDay = new THREE.Color(0xfff1dc), cLow = new THREE.Color(0xff8a3c), cFogDay = new THREE.Color(0xa9bfd4), cFogLow = new THREE.Color(0xd9a27a), cFogNight = new THREE.Color(0x0a1220);
const cHemiDay = new THREE.Color(0xbcd4ff), cHemiNight = new THREE.Color(0x4a5f9a), cWaterDay = new THREE.Color(0x1c4650), cWaterNight = new THREE.Color(0x060d16);
function setTime(t) {
  const lat = meta.origin[0] * D2R, dec = -12 * D2R, H = (t - 12) * 15 * D2R;
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H), north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  sunDir.set(east, up, -north).normalize();
  const day = smooth(-0.09, 0.1, up), low = 1 - smooth(0.02, 0.42, up);
  nightAmt = 1 - day;
  U.night.value = smooth(0.25, 0.95, nightAmt);
  skyU.sunPosition.value.copy(sunDir);
  skyU.rayleigh.value = lerp(1.4, 3.2, low * day);
  // after dark the "sun" light becomes a dim blue moon from a fixed direction
  if (up > -0.04) { sun.color.copy(cDay).lerp(cLow, low); sun.intensity = 5.2 * day * lerp(1, 1.7, low); sun.userData.dir = sunDir.clone().setY(Math.max(sunDir.y, 0.3)).normalize(); }   // light never rakes flatter than ~17 deg, or the ground goes murky
  else { sun.color.set(0x8fa6ff); sun.intensity = 0.55 * nightAmt; sun.userData.dir = new THREE.Vector3(-0.45, 0.75, 0.4).normalize(); }
  hemi.color.copy(cHemiNight).lerp(cHemiDay, day);
  hemi.groundColor.set(0x5a5346).multiplyScalar(lerp(0.35, 1, day));
  hemi.intensity = lerp(0.7, 1.8, day) * (1 + low * day * 0.35);
  scene.fog.color.copy(cFogNight).lerp(cFogDay.clone().lerp(cFogLow, low * 0.85), day);
  U.edge.value.set(0x2c3527);
  stars.material.opacity = smooth(0.5, 1, nightAmt) * 0.9;
  if (waterMat) waterMat.color.copy(cWaterNight).lerp(cWaterDay, day);
  for (const m of nightMats) { m.opacity = m.userData.max * U.night.value; m.visible = m.opacity > 0.01; }
  bloom.strength = lerp(0.1, 0.75, U.night.value) + low * day * 0.12;
  bloom.enabled = U.night.value > 0.02 || low * day > 0.35;   // skip the pass in plain daylight, it costs more than it shows
  bloom.threshold = lerp(1.0, 0.32, U.night.value);
  renderer.toneMappingExposure = lerp(0.8, 1.0, nightAmt);
  const hh = Math.floor(t) % 24, mm = Math.floor((t % 1) * 60);
  $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
$('time').addEventListener('input', (e) => { timeAnim = null; setTime(+e.target.value); });
let timeAnim = null;
for (const b of document.querySelectorAll('#presets button')) {
  b.addEventListener('click', () => { timeAnim = { from: +$('time').value, to: +b.dataset.t, t0: performance.now() }; });
}

// ---------------------------------------------------------------- UI
$('t-labels').addEventListener('click', (e) => { labelsOn = !labelsOn; e.currentTarget.classList.toggle('on', labelsOn); e.currentTarget.setAttribute('aria-pressed', labelsOn); });
$('t-spin').addEventListener('click', (e) => { controls.autoRotate = !controls.autoRotate; e.currentTarget.classList.toggle('on', controls.autoRotate); e.currentTarget.setAttribute('aria-pressed', controls.autoRotate); });
$('t-about').addEventListener('click', () => $('about').showModal());
$('compass').addEventListener('click', () => flyTo({ ...getView(), heading: 0 }, 900));
$('quality').addEventListener('change', applyQuality);
let quality = 'high';
function applyQuality() {
  const pick = $('quality').value;
  quality = pick === 'auto' ? (coarse || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 'low' : 'high') : pick;
  const low = quality === 'low';
  sun.castShadow = !low;
  if (trees) trees.count = low ? Math.floor(treeCount * 0.45) : treeCount;
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight, pr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.25 : 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const keys = new Set();
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
function stepKeys(dt) {
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  if (!f && !r) return;
  cancelFly();
  camera.getWorldDirection(fwd).setY(0).normalize();
  right.crossVectors(fwd, camera.up);
  const sp = camera.position.distanceTo(controls.target) * 0.9 * dt;
  fwd.multiplyScalar(f * sp).addScaledVector(right, r * sp);
  camera.position.add(fwd);
  controls.target.add(fwd);
}

// ---------------------------------------------------------------- frame
let last = performance.now(), whereTick = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  U.time.value = now / 1000;
  if (timeAnim) {
    const k = clamp((now - timeAnim.t0) / 1600, 0, 1), e = k * k * (3 - 2 * k);
    const t = lerp(timeAnim.from, timeAnim.to, e);
    $('time').value = t; setTime(t);
    if (k >= 1) timeAnim = null;
  }
  stepFly(now);
  stepKeys(dt);
  if (!fly) {
    // keep the map under the camera and the camera above the ground
    const [x0, y0, x1, y1] = meta.bounds;
    const tx = clamp(controls.target.x, x0, x1), tz = clamp(controls.target.z, -y1, -y0);
    camera.position.x += tx - controls.target.x; camera.position.z += tz - controls.target.z;
    controls.target.set(tx, 0, tz);
    controls.update(dt);
    if (camera.position.y < 12) camera.position.y = 12;
  }
  // the shadow box follows whatever is being looked at
  const dist = camera.position.distanceTo(controls.target);
  const size = clamp(dist * 0.85, 260, 1500);
  const sc = sun.shadow.camera;
  if (sc.right !== size) { sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size; sc.near = 100; sc.far = 6000; sc.updateProjectionMatrix(); }
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(sun.userData.dir, 3000);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  scene.fog.near = 1800 + dist * 0.9; scene.fog.far = 9000 + dist * 1.6;

  composer.render();
  updateLabels();

  const head = Math.atan2(controls.target.x - camera.position.x, -(controls.target.z - camera.position.z));
  $('compass').firstElementChild.style.transform = `rotate(${-head}rad)`;
  if (now - whereTick > 250) {
    whereTick = now;
    const x = controls.target.x, y = -controls.target.z;
    let best = dist > 2500 ? { n: 'Jamshedpur' } : null, bd = dist > 2500 ? 0 : 260;
    for (const l of meta.labels) { const dd = Math.hypot(l.x - x, l.y - y) * (l.k === 'area' ? 0.35 : 1); if (dd < bd) { bd = dd; best = l; } }
    $('where-name').textContent = best ? best.n : 'Jamshedpur';
    $('where-coords').textContent = `${(meta.origin[0] + y / meta.my).toFixed(4)}° N ${(meta.origin[1] + x / meta.mx).toFixed(4)}° E · eye ${Math.round(camera.position.y)} m`;
  }
}

window.__map = { renderer, scene, camera, composer, controls, flyTo, setTime };   // handy from the console
boot().catch((err) => {
  console.error(err);
  $('loader-msg').textContent = 'Could not load the map: ' + err.message;
});
