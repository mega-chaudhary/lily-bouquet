// Bouquet layout, palette and per-flower random setup.
import { makeRng, hexrgb, norm, smooth, clamp } from './math.js';

export const NU = 40; // petal grid: along the petal
export const NV = 13; // petal grid: across the petal
export const S = Float32Array.from({ length: NU }, (_, i) => i / (NU - 1));
export const V = Float32Array.from({ length: NV }, (_, j) => -1 + (2 * j) / (NV - 1));
export const GATHER = [0, -2.45, 0.1]; // where the stems are bunched together

const HEX = {
  red: { c: '#ff2a1a', tip: '#ff7a55', throat: '#ffd23a', speck: '#5a0505' },
  peach: { c: '#ffa060', tip: '#ffe6c8', throat: '#ffe060', speck: '#9a3a14' },
  cream: { c: '#fff0d2', tip: '#ffffff', throat: '#f2ea70', speck: '#b88448' },
  white: { c: '#ffffff', tip: '#ffffff', throat: '#d4f070', speck: null },
  yellow: { c: '#ffd010', tip: '#fff59a', throat: '#ff9400', speck: '#7a3c00' },
  magenta: { c: '#ff45cc', tip: '#ffbdf0', throat: '#fff2a0', speck: '#6e0650' },
  rose: { c: '#ff2e78', tip: '#ff96bc', throat: '#ffe488', speck: '#520028' },
  crimson: { c: '#ee1030', tip: '#ff5e6a', throat: '#ffa040', speck: '#440010' },
};
export const PALETTE = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [
    k,
    Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv ? hexrgb(vv) : null])),
  ]),
);

// [x, y, z, size, colour] in world units (y up, z toward the viewer)
export const FLOWERS = [
  [0.2, 2.3, -0.4, 0.95, 'peach'],
  [-1.15, 1.9, -0.2, 0.95, 'white'],
  [1.2, 1.85, -0.25, 0.9, 'yellow'],
  [0.0, 1.4, 0.15, 1.1, 'red'],
  [1.55, 0.95, 0.0, 0.9, 'rose'],
  [-1.5, 0.8, 0.05, 0.95, 'yellow'],
  [-0.7, 0.3, 0.45, 1.1, 'magenta'],
  [0.8, 0.25, 0.4, 1.15, 'cream'],
  [-1.4, -0.45, 0.3, 0.9, 'yellow'],
  [0.1, -0.55, 0.6, 1.1, 'peach'],
  [1.4, -0.6, 0.35, 0.9, 'crimson'],
];
export const BUDS = [
  [-0.4, 3.0, -0.5, 0.55, 'red'],
  [0.6, 3.1, -0.5, 0.5, 'rose'],
  [-1.0, 2.75, -0.4, 0.5, 'peach'],
  [1.75, 2.4, -0.4, 0.5, 'crimson'],
  [-1.9, 1.55, -0.3, 0.45, 'yellow'],
];

function petalColours(pal, rng) {
  const out = new Float32Array(6 * NU * NV * 3);
  for (let p = 0; p < 6; p++) {
    for (let i = 0; i < NU; i++) {
      const s = S[i];
      const a = smooth(s / 0.3), b = smooth((s - 0.7) / 0.3);
      for (let j = 0; j < NV; j++) {
        let col = [0, 1, 2].map((k) => {
          const base = pal.throat[k] * (1 - a) + pal.c[k] * a;
          return base * (1 - b) + pal.tip[k] * b;
        });
        const av = Math.abs(V[j]);
        // soft highlight along the middle vein
        const vein = Math.max(0, 1 - av / 0.22) * smooth((s - 0.08) / 0.2) * (1 - s * 0.6);
        col = col.map((x) => clamp(x + (1 - x) * 0.35 * vein));
        // darker rim so every petal has a clean edge
        const rim = smooth((av - 0.62) / 0.38);
        col = col.map((x) => x * (1 - 0.42 * rim));
        if (p % 2 === 0) col = col.map((x) => x * 0.9); // outer petals a touch darker
        // lily speckles, clustered on the inner half of the petal
        if (pal.speck && av < 0.75) {
          const prob = 0.16 * clamp(1 - Math.abs(s - 0.3) / 0.2);
          if (rng.random() < prob) col = col.map((x, k) => x * 0.25 + pal.speck[k] * 0.75);
        }
        out.set(col, ((p * NU + i) * NV + j) * 3);
      }
    }
  }
  return out;
}

export function buildScene(seed = 3) {
  const rng = makeRng(seed);
  const order = FLOWERS.map((_, i) => i).sort((a, b) => FLOWERS[b][1] - FLOWERS[a][1]);
  const rank = new Map(order.map((i, r) => [i, r]));

  const make = ([x, y, z, size, colour], bud, rk) => {
    const pos = [x, y, z];
    const face = norm([
      x * 0.35 + rng.normal(0, 0.12),
      0.35 + (y - 0.8) * 0.12 + rng.normal(0, 0.12),
      1 + rng.normal(0, 0.12),
    ]);
    const bx = rng.normal(0, 0.12), bz = rng.normal(0, 0.08);
    const ctrl = [
      [bx * 0.6, -3.3, bz * 0.5],
      [bx, -2.45, bz + 0.1],
      [x * 0.55, (y - 2.45) * 0.5 - 0.6, z * 0.5],
      pos,
    ];
    const side = Math.abs(x) > 0.2 ? Math.sign(x) : rng.choice([-1, 1]);
    return {
      pos, face, size, bud, ctrl,
      pal: PALETTE[colour],
      delay: rng.uniform(0, 0.5),
      phase: rng.uniform(0, 6.28),
      rot: rng.uniform(0, Math.PI),
      bloomAt: bud ? 1e9 : 3.0 + rk * 0.16 + rng.uniform(0, 0.25),
      cols: petalColours(PALETTE[colour], rng),
      leaf: { t: rng.uniform(0.38, 0.55), side, length: rng.uniform(0.55, 0.85) },
      cache: null,
      leafCache: null,
    };
  };

  const flowers = FLOWERS.map((f, i) => make(f, false, rank.get(i)));
  BUDS.forEach((b) => flowers.push(make(b, true, 0)));

  const base = [];
  for (let i = 0; i < 13; i++) {
    const a = ((-75 + (150 * i) / 12 + rng.normal(0, 5)) * Math.PI) / 180;
    base.push({
      dir: norm([Math.sin(a), Math.cos(a), rng.uniform(-0.25, 0.7)]),
      length: rng.uniform(0.85, 1.45),
      width: rng.uniform(0.085, 0.115),
      droop: 0.25 + 0.5 * Math.abs(Math.sin(a)),
      delay: rng.uniform(0.1, 0.7),
      roll: rng.uniform(-0.6, 0.6),
      cache: null,
    });
  }

  // small unit sphere used for anthers and pistil tips
  const sphere = [];
  for (let i = 0; i < 50; i++) {
    const u = rng.uniform(-1, 1), th = rng.uniform(0, Math.PI * 2), r = Math.sqrt(1 - u * u);
    sphere.push([r * Math.cos(th), u, r * Math.sin(th)]);
  }
  return { flowers, base, sphere };
}
