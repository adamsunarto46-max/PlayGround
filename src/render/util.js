/* Shared geometry + drawing primitives for the engine cutaway. */

export const ART_W = 1400;
export const ART_H = 900;
export const CX = 640;
export const CRANK_Y = 600;
export const R = 70;
export const ROD = 246;
export const BORE = 156;
export const BORE_L = CX - BORE / 2;
export const BORE_R = CX + BORE / 2;
export const DECK = 250;
export const BLOCK_TOP = 250;
export const BLOCK_BOTTOM = 574;
export const PISTON_W = 150;
export const PISTON_H = 90;
export const PIN_OFFSET = 28;
export const CHAMBER_ROOF = 196;
export const MAX_LIFT_PX = 17;
export const CAM_Y = 138;
export const VALVE_IN_X = 592;
export const VALVE_EX_X = 688;
export const STACK_X = 1188;
export const STACK_Y = 54;
export const FLY_R = 106;
export const WINDOW_R = 118;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

export function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

export function alu(ctx, x0, y0, x1, y1) {
  return linear(ctx, x0, y0, x1, y1, [
    [0, '#15181c'],
    [0.1, '#464d54'],
    [0.26, '#b8c0c7'],
    [0.35, '#edf2f6'],
    [0.5, '#8a929a'],
    [0.7, '#3f454c'],
    [0.86, '#7b838b'],
    [1, '#1b1f23'],
  ]);
}

export function steel(ctx, x0, y0, x1, y1) {
  return linear(ctx, x0, y0, x1, y1, [
    [0, '#0a0c0e'],
    [0.18, '#2c3238'],
    [0.4, '#6e777f'],
    [0.52, '#aab2b9'],
    [0.7, '#41484f'],
    [1, '#090b0d'],
  ]);
}

export function makeNoise(size = 160) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 26;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export function drawSpring(ctx, x, top, bottom, width, coils) {
  const h = bottom - top;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  for (let i = 0; i <= coils * 2; i++) {
    const t = i / (coils * 2);
    const px = x + (i % 2 ? width : -width) * 0.5;
    const py = top + t * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.strokeStyle = linear(ctx, x - width, 0, x + width, 0, [
    [0, '#2b3137'],
    [0.35, '#c7cfd6'],
    [0.5, '#f2f6f9'],
    [0.66, '#868e96'],
    [1, '#1b2025'],
  ]);
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.restore();
}

let seed = 0x2f6e2b1;
export function rand() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

export function bolt(ctx, x, y, r = 7) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = radial(ctx, -r * 0.3, -r * 0.3, 0, r * 1.15, [
    [0, '#dfe6ec'],
    [0.45, '#8e979f'],
    [0.8, '#3d444b'],
    [1, '#101317'],
  ]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(10,12,14,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 0.2);
  ctx.lineTo(r * 0.55, -r * 0.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();
}
