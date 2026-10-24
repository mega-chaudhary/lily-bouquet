// Builds the 3D scene for each frame as vertex grids (solid surfaces) plus a few
// loose points (stamens). The renderer fills the grids as triangles.
import { NU, NV, S, V } from './scene.js';
import { bezier, bezierD, cross, frameFromAxis, hexrgb, norm, smooth } from './math.js';

const FIELDS = ['px', 'py', 'pz', 'nx', 'ny', 'nz', 'cr', 'cg', 'cb', 'em'];

export class SceneBuffer {
  constructor(capacity = 120000) {
    this.n = 0;
    this.cap = 0;
    this.meshes = [];   // { start, nu, nv, wrap }  -> filled as triangles
    this.points = [];   // [start, end)              -> drawn as small dots
    this.alloc(capacity);
  }

  reset() {
    this.n = 0;
    this.meshes.length = 0;
    this.points.length = 0;
  }

  alloc(cap) {
    for (const f of FIELDS) {
      const a = new Float32Array(cap);
      if (this[f]) a.set(this[f].subarray(0, this.n));
      this[f] = a;
    }
    this.cap = cap;
  }

  ensure(k) {
    if (this.n + k > this.cap) this.alloc(Math.max(this.cap * 2, this.n + k));
  }

  push(x, y, z, nx, ny, nz, r, g, b, e) {
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.nx[i] = nx; this.ny[i] = ny; this.nz[i] = nz;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.em[i] = e;
  }

  // Save everything added since `mark()` (relative to an origin) so it can be re-used.
  mark() {
    return { n: this.n, m: this.meshes.length, p: this.points.length };
  }

  snapshot(mk, origin) {
    const snap = { meshes: [], points: [] };
    for (const f of FIELDS) snap[f] = this[f].slice(mk.n, this.n);
    for (let i = 0; i < snap.px.length; i++) {
      snap.px[i] -= origin[0]; snap.py[i] -= origin[1]; snap.pz[i] -= origin[2];
    }
    for (const m of this.meshes.slice(mk.m)) snap.meshes.push({ ...m, start: m.start - mk.n });
    for (const p of this.points.slice(mk.p)) snap.points.push([p[0] - mk.n, p[1] - mk.n]);
    return snap;
  }

  pushSnapshot(snap, o) {
    const k = snap.px.length;
    this.ensure(k);
    const s = this.n;
    for (const f of FIELDS) this[f].set(snap[f], s);
    for (let i = s; i < s + k; i++) {
      this.px[i] += o[0]; this.py[i] += o[1]; this.pz[i] += o[2];
    }
    this.n += k;
    for (const m of snap.meshes) this.meshes.push({ ...m, start: m.start + s });
    for (const p of snap.points) this.points.push([p[0] + s, p[1] + s]);
  }
}

// ------------------------------------------------------------ grid -> mesh
const GRID = new Float32Array(Math.max(NU * NV, 64 * 16) * 3);

function pushGrid(buf, nu, nv, colourAt, emis = 0) {
  buf.ensure(nu * nv);
  const start = buf.n;
  const at = (i, j, k) => GRID[(i * nv + j) * 3 + k];
  for (let i = 0; i < nu; i++) {
    const i0 = i > 0 ? i - 1 : i, i1 = i < nu - 1 ? i + 1 : i;
    for (let j = 0; j < nv; j++) {
      const j0 = j > 0 ? j - 1 : j, j1 = j < nv - 1 ? j + 1 : j;
      const du = [at(i1, j, 0) - at(i0, j, 0), at(i1, j, 1) - at(i0, j, 1), at(i1, j, 2) - at(i0, j, 2)];
      const dv = [at(i, j1, 0) - at(i, j0, 0), at(i, j1, 1) - at(i, j0, 1), at(i, j1, 2) - at(i, j0, 2)];
      let c = cross(du, dv);
      let l = Math.hypot(c[0], c[1], c[2]);
      if (l < 1e-12) { // degenerate (petal base / tip): borrow the neighbour row's normal
        const ii = i === 0 ? 1 : i - 1;
        const du2 = [at(Math.min(ii + 1, nu - 1), j, 0) - at(ii - (ii > 0), j, 0), at(Math.min(ii + 1, nu - 1), j, 1) - at(ii - (ii > 0), j, 1), at(Math.min(ii + 1, nu - 1), j, 2) - at(ii - (ii > 0), j, 2)];
        const dv2 = [at(ii, j1, 0) - at(ii, j0, 0), at(ii, j1, 1) - at(ii, j0, 1), at(ii, j1, 2) - at(ii, j0, 2)];
        c = cross(du2, dv2);
        l = Math.hypot(c[0], c[1], c[2]) || 1;
      }
      const col = colourAt(i, j);
      buf.push(at(i, j, 0), at(i, j, 1), at(i, j, 2), c[0] / l, c[1] / l, c[2] / l, col[0], col[1], col[2], emis);
    }
  }
  buf.meshes.push({ start, nu, nv, wrap: false });
}

// ------------------------------------------------------------ lily
const FILAMENT = hexrgb('#f2ffc0');
const ANTHER = hexrgb('#ff6a0a');
const PISTIL = hexrgb('#d8ff90');
const PISTIL_TIP = hexrgb('#a8f040');

function dots(buf, from, to, normal, col, emis, n) {
  buf.ensure(n);
  const s = buf.n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    buf.push(
      from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t,
      normal[0], normal[1], normal[2], col[0], col[1], col[2], emis,
    );
  }
  buf.points.push([s, buf.n]);
}

function blob(buf, sphere, centre, radii, col, emis) {
  buf.ensure(sphere.length);
  const s = buf.n;
  for (const p of sphere) {
    buf.push(
      centre[0] + p[0] * radii[0], centre[1] + p[1] * radii[1], centre[2] + p[2] * radii[2],
      p[0], p[1], p[2], col[0], col[1], col[2], emis,
    );
  }
  buf.points.push([s, buf.n]);
}

/** Petals + stamens. o = bloom (0..1), b = bud growth (0..1). */
export function lily(buf, f, pos, axis, o, b, sphere) {
  const [e1, e2] = frameFromAxis(axis);
  const size = f.size * 1.12;
  const L = size * b * (0.72 + 0.38 * o);
  const trough = 0.3 + 0.95 * (1 - o); // closed petals wrap around each other
  const ds = 1 / (NU - 1);

  // outer petals first, then the wider inner petals on top
  for (const p of [0, 2, 4, 1, 3, 5]) {
    const inner = p % 2;
    const phi = f.rot + (p * Math.PI) / 3;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const rdir = [e1[0] * cp + e2[0] * sp, e1[1] * cp + e2[1] * sp, e1[2] * cp + e2[2] * sp];
    const tdir = [-e1[0] * sp + e2[0] * cp, -e1[1] * sp + e2[1] * cp, -e1[2] * sp + e2[2] * cp];
    const theta0 = (0.1 + 0.68 * o) * (1 - 0.1 * inner);
    const curl = (1.9 + 0.2 * inner) * o; // tips curl back like a real lily
    const wmax = size * b * (0.12 + 0.07 * inner) * (0.45 + 0.55 * o);
    const twist = (inner ? -0.12 : 0.18) * o;
    let rho = 0, h = 0;
    for (let i = 0; i < NU; i++) {
      const s = S[i];
      const th = theta0 + curl * s * s;
      const ct = Math.cos(th), st = Math.sin(th);
      if (i > 0) { rho += st * ds * L; h += ct * ds * L; }
      const wp = wmax * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.68)), 0.85);
      const rip = 0.035 * size * o * Math.sin(16 * s + p);
      const tw = twist * s; // slight twist along the petal
      for (let j = 0; j < NV; j++) {
        const v = V[j], v2 = v * v;
        const lat = v * wp * Math.cos(tw);
        const off = trough * v2 * wp + rip * v2 * v2 + v * wp * Math.sin(tw);
        const R = rho - off * ct, Hh = h + off * st;
        const g = (i * NV + j) * 3;
        GRID[g] = pos[0] + axis[0] * Hh + rdir[0] * R + tdir[0] * lat;
        GRID[g + 1] = pos[1] + axis[1] * Hh + rdir[1] * R + tdir[1] * lat;
        GRID[g + 2] = pos[2] + axis[2] * Hh + rdir[2] * R + tdir[2] * lat;
      }
    }
    const cols = f.cols;
    pushGrid(buf, NU, NV, (i, j) => {
      const c = ((p * NU + i) * NV + j) * 3;
      return [cols[c], cols[c + 1], cols[c + 2]];
    });
  }

  if (o > 0.3) {
    const k = smooth((o - 0.3) / 0.5);
    for (let i = 0; i < 6; i++) {
      const a = f.rot + (i * Math.PI) / 3 + Math.PI / 6;
      const d = norm([0, 1, 2].map((q) => axis[q] + (Math.cos(a) * e1[q] + Math.sin(a) * e2[q]) * 0.55));
      const end = [0, 1, 2].map((q) => pos[q] + d[q] * size * 0.6 * k);
      dots(buf, pos, end, axis, FILAMENT, 0.35, 40);
      blob(buf, sphere, end, [0.045 * size, 0.022 * size, 0.022 * size], ANTHER, 0.55);
    }
    const pd = norm([0, 1, 2].map((q) => axis[q] + e1[q] * 0.2));
    const end = [0, 1, 2].map((q) => pos[q] + pd[q] * size * 0.68 * k);
    dots(buf, pos, end, axis, PISTIL, 0.35, 44);
    blob(buf, sphere, end, [0.045 * size, 0.045 * size, 0.045 * size], PISTIL_TIP, 0.5);
  }
}

// ------------------------------------------------------------ stems
const TS = 64, RING = 6;
const GREEN_DK = hexrgb('#1c7a26'), GREEN_LT = hexrgb('#7be05a');

export function stem(buf, ctrl, g, radius) {
  const count = Math.floor(g * (TS - 1)) + 1;
  if (count < 2) return;
  buf.ensure(count * RING);
  const start = buf.n;
  for (let i = 0; i < count; i++) {
    const t = i / (TS - 1);
    const c = bezier(ctrl, t);
    const T = norm(bezierD(ctrl, t));
    const n1 = norm(cross(T, [0, 0, 1]));
    const n2 = cross(T, n1);
    const shade = 0.45 + 0.55 * t;
    const col = [0, 1, 2].map((k) => GREEN_DK[k] * (1 - shade) + GREEN_LT[k] * shade);
    for (let a = 0; a < RING; a++) {
      const ang = (a / RING) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const r = [ca * n1[0] + sa * n2[0], ca * n1[1] + sa * n2[1], ca * n1[2] + sa * n2[2]];
      buf.push(c[0] + r[0] * radius, c[1] + r[1] * radius, c[2] + r[2] * radius,
        r[0], r[1], r[2], col[0], col[1], col[2], 0);
    }
  }
  buf.meshes.push({ start, nu: count, nv: RING, wrap: true });
}

// ------------------------------------------------------------ leaves
const LS = 34, LV = 7;
const LEAF_DK = hexrgb('#145f1c'), LEAF_LT = hexrgb('#5fcf45');
const LEAF_MID = hexrgb('#a8f08a');

export function leaf(buf, A, dir, length, width, droop, roll, grow) {
  if (grow <= 0.01) return;
  const d = norm(dir);
  let sv = norm(cross(d, [0, 0, 1]));
  let nl = cross(sv, d);
  sv = [0, 1, 2].map((k) => sv[k] * Math.cos(roll) + nl[k] * Math.sin(roll));
  nl = cross(sv, d);
  const ln = length * grow;
  for (let i = 0; i < LS; i++) {
    const s = i / (LS - 1);
    const w = width * (0.3 + 0.7 * grow) * Math.sin(Math.PI * Math.pow(s, 0.6));
    const c = [A[0] + d[0] * ln * s, A[1] + d[1] * ln * s - droop * ln * s * s, A[2] + d[2] * ln * s];
    for (let j = 0; j < LV; j++) {
      const v = -1 + (2 * j) / (LV - 1);
      const g = (i * LV + j) * 3;
      for (let k = 0; k < 3; k++) GRID[g + k] = c[k] + sv[k] * v * w + nl[k] * 0.4 * w * Math.abs(v);
    }
  }
  pushGrid(buf, LS, LV, (i, j) => {
    const s = i / (LS - 1);
    const base = [0, 1, 2].map((k) => LEAF_DK[k] * (1 - s) + LEAF_LT[k] * s);
    if (j === (LV - 1) / 2) return base.map((x, k) => x * 0.5 + LEAF_MID[k] * 0.5);
    const edge = Math.abs(-1 + (2 * j) / (LV - 1)) > 0.9 ? 0.7 : 1;
    return base.map((x) => x * edge);
  });
}
