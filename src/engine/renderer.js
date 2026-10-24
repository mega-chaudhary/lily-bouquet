// Software 3D renderer: fills the bouquet's surfaces as shaded triangles into a
// supersampled buffer, then turns each character cell into a coloured glyph.
import { buildScene, GATHER } from './scene.js';
import { SceneBuffer, leaf, lily, stem } from './geometry.js';
import { bezier, bezierD, ease, makeRng, norm, smooth } from './math.js';

export const SETTINGS = {
  cellW: 4,                          // character cell width  (CSS px)
  cellH: 6,                          // character cell height (CSS px)
  ss: 2,                             // supersampling per cell axis (smoother edges)
  ramp: ".,:;-=+*oxX#%@",           // sparse -> dense characters
  brightness: 1.25,
  tint: 0.42,                        // soft colour behind the characters (0 = none)
  camZ: 9,
  viewY: 0.15,
  edge: 0.28,                        // depth jump that draws an outline between flowers
};

const LIGHT = norm([-0.4, 0.62, 0.68]);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

export class Renderer {
  constructor(mainCanvas, glowCanvas) {
    this.main = mainCanvas;
    this.glow = glowCanvas;
    this.mctx = mainCanvas.getContext('2d');
    this.gctx = glowCanvas ? glowCanvas.getContext('2d') : null;
    this.colour = document.createElement('canvas');
    this.cctx = this.colour.getContext('2d');
    this.glyphLayer = document.createElement('canvas');
    this.lctx = this.glyphLayer.getContext('2d');
    this.atlas = document.createElement('canvas');
    this.scene = buildScene(3);
    this.buf = new SceneBuffer();
    this.vcap = 0;
  }

  resize(w, h, dpr = 1) {
    const { ramp, ss } = SETTINGS;
    // smaller characters on small screens so the flowers keep their detail
    const small = Math.min(w, h * 0.72) < 620;
    const cellW = (this.cellW = small ? 3 : SETTINGS.cellW);
    const cellH = (this.cellH = small ? 5 : SETTINGS.cellH);
    this.W = w; this.H = h; this.dpr = dpr;
    this.cols = Math.ceil(w / cellW);
    this.rows = Math.ceil(h / cellH);
    this.SW = this.cols * ss;
    this.SH = this.rows * ss;
    for (const c of [this.main, this.glow]) {
      if (!c) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    // glyph layer is written pixel-by-pixel: one cell = cwD x chD device pixels
    this.cwD = Math.max(1, Math.round(cellW * dpr));
    this.chD = Math.max(1, Math.round(cellH * dpr));
    this.glyphLayer.width = this.cols * this.cwD;
    this.glyphLayer.height = this.rows * this.chD;
    this.glyphImg = this.lctx.createImageData(this.glyphLayer.width, this.glyphLayer.height);
    this.colour.width = this.cols;
    this.colour.height = this.rows;
    this.img = this.cctx.createImageData(this.cols, this.rows);

    const sub = this.SW * this.SH, cells = this.cols * this.rows;
    this.zb = new Float32Array(sub);
    this.si = new Float32Array(sub);   // shaded intensity
    this.sr = new Float32Array(sub);
    this.sg = new Float32Array(sub);
    this.sbl = new Float32Array(sub);
    this.cellDepth = new Float32Array(cells);
    this.charIdx = new Uint8Array(cells);
    this.cellCol = new Float32Array(cells * 3);
    this.px = Math.min(h / 7.0, w / 5.0); // world -> pixel scale, keeps the bouquet in view

    // glyph atlas: white characters on transparent
    const glyphs = ' ' + ramp;
    this.glyphs = glyphs;
    const { cwD, chD } = this;
    this.atlas.width = glyphs.length * cwD;
    this.atlas.height = chD;
    const a = this.atlas.getContext('2d', { willReadFrequently: true });
    a.setTransform(cwD / cellW, 0, 0, chD / cellH, 0, 0);
    a.clearRect(0, 0, glyphs.length * cellW, cellH);
    a.fillStyle = '#fff';
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.font = `${cellH + 0.5}px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace`;
    [...glyphs].forEach((ch, i) => a.fillText(ch, i * cellW + cellW / 2, cellH / 2 + 0.5));
    // per-glyph coverage masks (0..255) used to write the glyph layer directly
    const ad = a.getImageData(0, 0, this.atlas.width, chD).data;
    this.masks = new Uint8Array(glyphs.length * cwD * chD);
    for (let g = 0; g < glyphs.length; g++) {
      for (let y = 0; y < chD; y++) {
        for (let x = 0; x < cwD; x++) {
          this.masks[(g * chD + y) * cwD + x] = ad[(y * this.atlas.width + g * cwD + x) * 4 + 3];
        }
      }
    }

    // faint stars
    const r = makeRng(11);
    const n = Math.round(cells / 260);
    this.stars = Array.from({ length: n }, () => ({
      cell: Math.floor(r.random() * this.rows) * this.cols + Math.floor(r.random() * this.cols),
      ph: r.uniform(0, 6.28), sp: r.uniform(0.5, 1.6), b: r.uniform(0.25, 0.6),
    }));
  }

  // ---------------------------------------------------------------- scene
  buildGeometry(t) {
    const { flowers, base, sphere } = this.scene;
    const buf = this.buf;
    buf.reset();

    for (const f of flowers) {
      const g = ease((t - f.delay) / 1.8);
      const amt = 0.045 * smooth(t - 3);
      const sway = [Math.sin(t * 0.8 + f.phase) * amt, 0, Math.cos(t * 0.6 + f.phase) * 0.5 * amt];
      const tip = [f.pos[0] + sway[0], f.pos[1], f.pos[2] + sway[2]];
      const ctrl = [f.ctrl[0], f.ctrl[1],
        [f.ctrl[2][0] + sway[0] * 0.5, f.ctrl[2][1], f.ctrl[2][2] + sway[2] * 0.5], tip];
      stem(buf, ctrl, g, f.bud ? 0.02 : 0.026);

      const lf = f.leaf;
      const lg = ease((t - f.delay - 0.8) / 1.0);
      if (g > lf.t && lg > 0) {
        const A = bezier(ctrl, lf.t);
        if (lg >= 1 && f.leafCache) buf.pushSnapshot(f.leafCache, A);
        else {
          const T = norm(bezierD(ctrl, lf.t));
          const out = norm([lf.side, 0, 0.35]);
          const mk = buf.mark();
          leaf(buf, A, [T[0] * 0.6 + out[0] * 0.8, T[1] * 0.6 + out[1] * 0.8, T[2] * 0.6 + out[2] * 0.8],
            lf.length, 0.075, 0.35, 0.3 * lf.side, lg);
          if (lg >= 1) f.leafCache = buf.snapshot(mk, A);
        }
      }

      if (g > 0.99) {
        const b = ease((t - f.delay - 1.6) / 0.9);
        if (b > 0.01) {
          const o = f.bud ? 0 : ease((t - f.bloomAt) / 1.6);
          const done = b >= 1 && (f.bud || o >= 1);
          if (done && f.cache) buf.pushSnapshot(f.cache, tip);
          else {
            const td = norm(bezierD(ctrl, 1));
            const k = smooth(o * 1.3);
            const axis = norm([0, 1, 2].map((q) => td[q] * (1 - k) + f.face[q] * k));
            const mk = buf.mark();
            lily(buf, f, tip, axis, o, b, sphere);
            f.cache = done ? buf.snapshot(mk, tip) : null;
          }
        }
      }
    }

    for (const bl of base) {
      const gr = ease((t - bl.delay) / 1.5);
      if (gr >= 1 && bl.cache) { buf.pushSnapshot(bl.cache, GATHER); continue; }
      const mk = buf.mark();
      leaf(buf, GATHER, bl.dir, bl.length, bl.width, bl.droop, bl.roll, gr);
      if (gr >= 1) bl.cache = buf.snapshot(mk, GATHER);
    }
  }

  // ---------------------------------------------------------------- vertices
  transform(t) {
    const { camZ, viewY, ss, brightness } = SETTINGS;
    const cellW = this.cellW, cellH = this.cellH;
    const buf = this.buf, n = buf.n;
    if (n > this.vcap) {
      this.vcap = Math.max(n, this.vcap * 2);
      this.vx = new Float32Array(this.vcap); this.vy = new Float32Array(this.vcap);
      this.vd = new Float32Array(this.vcap); this.vi = new Float32Array(this.vcap);
      this.vr = new Float32Array(this.vcap); this.vg = new Float32Array(this.vcap);
      this.vb = new Float32Array(this.vcap);
    }
    const yaw = 0.16 * Math.sin(t * 0.3), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const px = this.px, hw = this.W / 2, hh = this.H / 2;
    const kx = ss / cellW, ky = ss / cellH;
    for (let i = 0; i < n; i++) {
      const x = cy * buf.px[i] + sy * buf.pz[i];
      const z = -sy * buf.px[i] + cy * buf.pz[i];
      const depth = camZ - z, f = camZ / depth;
      this.vx[i] = (hw + x * px * f) * kx;
      this.vy[i] = (hh - (buf.py[i] - viewY) * px * f) * ky;
      this.vd[i] = depth;

      let nx = cy * buf.nx[i] + sy * buf.nz[i];
      let ny = buf.ny[i];
      let nz = -sy * buf.nx[i] + cy * buf.nz[i];
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; } // two-sided petals
      const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 36);
      const rim = (1 - nz) * (1 - nz);
      const inten = Math.max(buf.em[i], Math.min(1, 0.16 + 0.78 * diff + 0.38 * spec + 0.12 * rim));
      const k = (0.5 + 0.7 * inten) * brightness;
      this.vi[i] = inten;
      this.vr[i] = Math.min(1.25, buf.cr[i] * k + spec * 0.25);
      this.vg[i] = Math.min(1.25, buf.cg[i] * k + spec * 0.25);
      this.vb[i] = Math.min(1.25, buf.cb[i] * k + spec * 0.25);
    }
  }

  // ---------------------------------------------------------------- rasterising
  tri(a, b, c) {
    const { vx, vy, vd, vi, vr, vg, vb, SW, SH, zb, si, sr, sg, sbl } = this;
    const xa = vx[a], ya = vy[a], xb = vx[b], yb = vy[b], xc = vx[c], yc = vy[c];
    const area = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
    if (area > -1e-7 && area < 1e-7) return;
    let x0 = Math.floor(Math.min(xa, xb, xc)), x1 = Math.ceil(Math.max(xa, xb, xc));
    let y0 = Math.floor(Math.min(ya, yb, yc)), y1 = Math.ceil(Math.max(ya, yb, yc));
    if (x1 < 0 || y1 < 0 || x0 >= SW || y0 >= SH) return;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > SW - 1) x1 = SW - 1; if (y1 > SH - 1) y1 = SH - 1;
    const inv = 1 / area, eps = -1e-4;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      let idx = y * SW + x0;
      for (let x = x0; x <= x1; x++, idx++) {
        const pxx = x + 0.5;
        const w0 = ((xb - pxx) * (yc - py) - (xc - pxx) * (yb - py)) * inv;
        if (w0 < eps) continue;
        const w1 = ((xc - pxx) * (ya - py) - (xa - pxx) * (yc - py)) * inv;
        if (w1 < eps) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < eps) continue;
        const z = w0 * vd[a] + w1 * vd[b] + w2 * vd[c];
        if (z >= zb[idx]) continue;
        zb[idx] = z;
        si[idx] = w0 * vi[a] + w1 * vi[b] + w2 * vi[c];
        sr[idx] = w0 * vr[a] + w1 * vr[b] + w2 * vr[c];
        sg[idx] = w0 * vg[a] + w1 * vg[b] + w2 * vg[c];
        sbl[idx] = w0 * vb[a] + w1 * vb[b] + w2 * vb[c];
      }
    }
  }

  rasterise() {
    const buf = this.buf, { SW, SH, zb } = this;
    zb.fill(Infinity);
    for (const m of buf.meshes) {
      const { start, nu, nv, wrap } = m;
      const cols = wrap ? nv : nv - 1;
      for (let i = 0; i < nu - 1; i++) {
        for (let j = 0; j < cols; j++) {
          const j1 = (j + 1) % nv;
          const a = start + i * nv + j, b = start + i * nv + j1;
          const c = start + (i + 1) * nv + j, d = start + (i + 1) * nv + j1;
          this.tri(a, b, d);
          this.tri(a, d, c);
        }
      }
    }
    // stamens: tiny 2x2 dots
    const { vx, vy, vd, vi, vr, vg, vb, si, sr, sg, sbl } = this;
    for (const [s, e] of buf.points) {
      for (let i = s; i < e; i++) {
        const x = Math.floor(vx[i] - 0.5), y = Math.floor(vy[i] - 0.5);
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= SW || Y >= SH) continue;
            const idx = Y * SW + X;
            if (vd[i] >= zb[idx]) continue;
            zb[idx] = vd[i]; si[idx] = vi[i]; sr[idx] = vr[i]; sg[idx] = vg[i]; sbl[idx] = vb[i];
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- frame
  render(t) {
    const { ss, ramp, edge } = SETTINGS;
    const cellW = this.cellW, cellH = this.cellH;
    const { cols, rows, W, H, dpr, zb, si, sr, sg, sbl, SW, charIdx, cellCol, cellDepth } = this;
    this.buildGeometry(t);
    this.transform(t);
    this.rasterise();

    // supersampled buffer -> one value per character cell
    const nss = ss * ss;
    for (let r = 0, cell = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, cell++) {
        let cnt = 0, I = 0, R = 0, G = 0, B = 0, dmin = Infinity;
        for (let dy = 0; dy < ss; dy++) {
          let idx = (r * ss + dy) * SW + c * ss;
          for (let dx = 0; dx < ss; dx++, idx++) {
            const z = zb[idx];
            if (z === Infinity) continue;
            cnt++; I += si[idx]; R += sr[idx]; G += sg[idx]; B += sbl[idx];
            if (z < dmin) dmin = z;
          }
        }
        cellDepth[cell] = dmin;
        if (cnt === 0) { charIdx[cell] = 0; continue; }
        const cov = cnt / nss;
        const inten = (I / cnt) * (0.45 + 0.55 * cov);
        charIdx[cell] = 1 + Math.min(ramp.length - 1, Math.round(Math.pow(inten, 0.9) * (ramp.length - 1)));
        const k = (0.55 + 0.45 * cov) / cnt;
        cellCol[cell * 3] = R * k; cellCol[cell * 3 + 1] = G * k; cellCol[cell * 3 + 2] = B * k;
      }
    }

    // outlines: darken cells that sit just behind a nearer surface
    for (let r = 0, cell = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, cell++) {
        if (!charIdx[cell]) continue;
        // compare with the neighbours on both sides: a real edge is a sudden jump,
        // a tilted petal changes depth smoothly (both sides differ about equally)
        const d0 = cellDepth[cell];
        const jump = (a, b) => (a < d0 - edge) && !(b > d0 + edge * 0.5);
        const L = c > 0 ? cellDepth[cell - 1] : Infinity, Rr = c < cols - 1 ? cellDepth[cell + 1] : Infinity;
        const U = r > 0 ? cellDepth[cell - cols] : Infinity, D = r < rows - 1 ? cellDepth[cell + cols] : Infinity;
        if (jump(L, Rr) || jump(Rr, L) || jump(U, D) || jump(D, U)) {
          cellCol[cell * 3] *= 0.4; cellCol[cell * 3 + 1] *= 0.4; cellCol[cell * 3 + 2] *= 0.4;
          charIdx[cell] = Math.max(1, charIdx[cell] - 4);
        }
      }
    }


    // 1) colour per cell (used for the soft fill) + coloured glyphs written as pixels
    const data = this.img.data, gd = this.glyphImg.data, masks = this.masks;
    const { cwD, chD } = this, gw = this.glyphLayer.width, msz = cwD * chD;
    gd.fill(0);
    for (let cell = 0, p = 0; cell < charIdx.length; cell++, p += 4) {
      const ci = charIdx[cell];
      if (ci === 0) { data[p + 3] = 0; continue; }
      const R = Math.min(255, cellCol[cell * 3] * 255);
      const G = Math.min(255, cellCol[cell * 3 + 1] * 255);
      const B = Math.min(255, cellCol[cell * 3 + 2] * 255);
      data[p] = R; data[p + 1] = G; data[p + 2] = B; data[p + 3] = 255;
      const c = cell % cols, r = (cell - c) / cols;
      const mo = ci * msz;
      for (let y = 0; y < chD; y++) {
        let q = ((r * chD + y) * gw + c * cwD) * 4;
        const mrow = mo + y * cwD;
        for (let x = 0; x < cwD; x++, q += 4) {
          const a = masks[mrow + x];
          if (a === 0) continue;
          const k = a / 255;
          gd[q] = R * k; gd[q + 1] = G * k; gd[q + 2] = B * k; gd[q + 3] = 255;
        }
      }
    }
    this.cctx.putImageData(this.img, 0, 0);
    this.lctx.putImageData(this.glyphImg, 0, 0);

    // 2) final image: soft colour fill + glowing characters on top
    const o = this.mctx;
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;
    o.fillStyle = '#000';
    o.fillRect(0, 0, W, H);
    if (SETTINGS.tint > 0) {
      o.globalAlpha = SETTINGS.tint;
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'high';
      o.drawImage(this.colour, 0, 0, cols * cellW, rows * cellH);
      o.globalAlpha = 1;
    }
    o.globalCompositeOperation = 'lighter';
    o.imageSmoothingEnabled = true;
    o.drawImage(this.glyphLayer, 0, 0, cols * cellW, rows * cellH);
    o.globalCompositeOperation = 'source-over';

    // faint twinkling stars in empty space
    const sa = smooth((t - 4) / 2);
    if (sa > 0) {
      for (const s of this.stars) {
        if (charIdx[s.cell]) continue;
        const c = s.cell % cols, r = (s.cell - c) / cols;
        o.globalAlpha = sa * s.b * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
        o.drawImage(this.atlas, cwD, 0, cwD, chD, c * cellW, r * cellH, cellW, cellH);
      }
      o.globalAlpha = 1;
    }

    if (this.gctx) {
      this.gctx.setTransform(1, 0, 0, 1, 0, 0);
      this.gctx.clearRect(0, 0, this.glow.width, this.glow.height);
      this.gctx.drawImage(this.main, 0, 0);
    }
  }
}
