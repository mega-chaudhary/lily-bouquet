// Small math helpers shared by the engine.

export function makeRng(seed) {
  let s = seed | 0;
  const random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    uniform: (a, b) => a + (b - a) * random(),
    normal: (m = 0, sd = 1) => {
      let u = 0;
      while (u === 0) u = random();
      return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    },
    choice: (arr) => arr[Math.floor(random() * arr.length)],
  };
}

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const smooth = (x) => {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
};

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) + 1e-9;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function hexrgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export function bezier(P, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [0, 1, 2].map((k) => a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k]);
}

export function bezierD(P, t) {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return [0, 1, 2].map(
    (k) => a * (P[1][k] - P[0][k]) + b * (P[2][k] - P[1][k]) + c * (P[3][k] - P[2][k]),
  );
}

export function frameFromAxis(a) {
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(a, ref));
  const e2 = cross(a, e1);
  return [e1, e2];
}
