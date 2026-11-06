/* Hand-drawn 2D cutaway of the single-cylinder dyno mule. */

import {
  clamp, lerp, rr, linear, radial, alu, steel, makeNoise, drawSpring, bolt,
} from './util.js';

const W = 1500;
const H = 950;
const CX = 720;
const CY = 650;
const CRANK_R = 92;
const ROD = 300;
const BORE = 200;
const BORE_L = CX - BORE / 2;
const BORE_R = CX + BORE / 2;
const DECK = 195;
const BLOCK_BOTTOM = 550;
const CRANKCASE_BOTTOM = 812;
const HEAD_TOP = 92;
const CHAMBER_ROOF = 142;
const VALVE_SEAT = 196;
const PISTON_CROWN_OFF = 54;
const PISTON_H = 112;
const VALVE_X = [655, 785];
const MAX_VALVE_PX = 19;
const FLY_R = 173;
const DYNO = { x: 1110, y: 735, r: 82 };
const STACK = { x: 1268, y: 108 };

const TAU = Math.PI * 2;

function pistonPinY(theta) {
  const s = Math.sin(theta);
  return CRANK_R * Math.cos(theta) + Math.sqrt(ROD * ROD - (CRANK_R * s) ** 2);
}

function metalPanel(ctx, x0, y0, x1, y1, warm = 0) {
  const g = linear(ctx, x0, y0, x1, y1, [
    [0, '#07090b'],
    [0.1, '#23292f'],
    [0.26, '#59636c'],
    [0.4, '#aab4bd'],
    [0.52, '#727d87'],
    [0.7, '#333a41'],
    [0.86, '#5b656e'],
    [1, '#0d1013'],
  ]);
  return g;
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.time = 0;
    this.noise = makeNoise(192);
    this.exhaust = [];
    this.intake = [];
    this.sparks = [];
    this.splashes = [];
    this.embers = [];
    this.exhaustClock = 0;
    this.intakeClock = 0;
    this.beltPhase = 0;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    // keep the back-buffer modest on wide screens; phones have fewer pixels
    // and benefit from the extra sharpness.
    const base = this.w < 620 ? 1 : 0.82;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1) * base;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  render(engine, dt = 1 / 60, opts = {}) {
    const ctx = this.ctx;
    this.time += dt;
    this.dt = dt;
    const { w, h, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050708';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const fit = Math.min(w / W, h / H);
    const cover = Math.max(w / W, h / H);
    const s = w / h < 1.1 ? cover : fit;
    const ox = (w - W * s) / 2;
    const oy = (h - H * s) / 2;    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    const shake = (engine.knock || 0) * 3.1 + (engine.detonation || 0) * 2.2 + (engine.combustion || 0) * 0.5;
    if (shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    this.drawBackground(ctx, engine);
    this.drawDyno(ctx, engine, dt);
    this.drawCrankAndFlywheel(ctx, engine);
    this.drawBlock(ctx, engine);
    this.drawReciprocating(ctx, engine);
    this.drawHead(ctx, engine);
    this.drawPorts(ctx, engine);
    this.drawEffects(ctx, engine, dt);
    this.drawLabels(ctx, engine, opts);
    ctx.restore();

    // bars outside the 3:2 art box, fading into the panel colour
    if (ox > 0.5 || oy > 0.5) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ------------------------------------------------------------------ */
  drawBackground(ctx, e) {
    const bg = linear(ctx, 0, 0, 0, H, [
      [0, '#0b1116'],
      [0.42, '#111920'],
      [0.7, '#0a0f13'],
      [1, '#050708'],
    ]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // blueprint grid on the back wall
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#3d596b';
    ctx.lineWidth = 1;
    for (let x = 60; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, 760);
      ctx.stroke();
    }
    for (let y = 60; y < 780; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#54758a';
    for (let x = 60; x < W; x += 300) {
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x, 780);
      ctx.stroke();
    }
    ctx.restore();

    // overhead pools of light
    for (const [x, y, r, col] of [[240, -90, 560, 'rgba(255,190,110,0.12)'], [1230, -120, 640, 'rgba(105,170,210,0.10)']]) {
      const g = radial(ctx, x, y, 0, r, [[0, col], [0.5, col.replace(/0\.\d+\)/, '0.04)')], [1, 'rgba(0,0,0,0)']]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // lamp housings
    for (const [x, y, r] of [[232, 90, 52], [1238, 78, 58]]) {
      const g = radial(ctx, x, y, 0, r, [[0, '#ffd9a0'], [0.25, '#b37a3d'], [0.7, '#2c2b28'], [1, '#0b0c0d']]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#08090a';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,215,160,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.7, 0, TAU);
      ctx.stroke();
    }

    // back wall signage
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#8aa0b0';
    ctx.font = '600 15px "Arial Narrow", "Helvetica Neue", sans-serif';
    ctx.letterSpacing = '7px';
    ctx.fillText('APEX POWERTRAIN — DYNO CELL 04', 82, 296);
    ctx.font = '600 12px "Arial Narrow", sans-serif';
    ctx.fillStyle = '#4d6272';
    ctx.fillText('MAX 8000 RPM   /   FUEL 98 RON   /   DO NOT LEAN MIXTURE', 82, 320);
    ctx.restore();

    // hanging cables
    ctx.strokeStyle = 'rgba(10,12,14,0.9)';
    ctx.lineWidth = 5;
    for (const [x0, x1, sag] of [[600, 520, 46], [900, 1000, 40], [1300, 1420, 60]]) {
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.quadraticCurveTo((x0 + x1) / 2, sag, x1, 0);
      ctx.stroke();
    }

    // workbench silhouette on the left
    ctx.fillStyle = '#0a0e12';
    ctx.beginPath();
    ctx.moveTo(0, 620);
    ctx.lineTo(150, 620);
    ctx.lineTo(150, 760);
    ctx.lineTo(0, 760);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,180,90,0.12)';
    ctx.fillRect(20, 640, 110, 7);

    // floor
    const floor = linear(ctx, 0, 770, 0, H, [[0, '#151a1e'], [0.25, '#0b0e11'], [1, '#040506']]);
    ctx.fillStyle = floor;
    ctx.fillRect(0, 770, W, H - 770);
    ctx.strokeStyle = 'rgba(120,150,170,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 772);
    ctx.lineTo(W, 772);
    ctx.stroke();
    // floor reflection of the engine
    const ref = radial(ctx, CX, 840, 20, 420, [[0, 'rgba(255,150,60,0.06)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillStyle = ref;
    ctx.fillRect(0, 770, W, 180);

    // hazard stripe at the front of the cell
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 916, W, 20);
    ctx.clip();
    ctx.fillStyle = '#121619';
    ctx.fillRect(0, 916, W, 20);
    ctx.fillStyle = 'rgba(232,170,62,0.42)';
    for (let x = -40; x < W + 40; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 936);
      ctx.lineTo(x + 20, 916);
      ctx.lineTo(x + 40, 916);
      ctx.lineTo(x + 20, 936);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  drawDyno(ctx, e, dt) {
    const load = clamp((e.load || 0) / 100, 0, 1);
    const hot = clamp(load * 0.9 + Math.max(0, (e.wallC - 70) / 60), 0, 1);
    this.beltPhase += dt * (2 + (e.omega || 0) * 1.5);
    const fx = CX + CRANK_R * Math.sin(e.theta);
    const fy = CY - CRANK_R * Math.cos(e.theta);

    // belt loop behind the flywheel
    const d = Math.hypot(DYNO.x - CX, DYNO.y - CY);
    const a1 = Math.atan2(DYNO.y - CY, DYNO.x - CX);
    const r1 = FLY_R + 10;
    const r2 = DYNO.r + 10;
    const off = Math.acos(clamp((r1 - r2) / d, -1, 1));
    const p1 = [CX + r1 * Math.cos(a1 + off), CY + r1 * Math.sin(a1 + off)];
    const p2 = [DYNO.x + r2 * Math.cos(a1 + off), DYNO.y + r2 * Math.sin(a1 + off)];
    const p3 = [DYNO.x + r2 * Math.cos(a1 - off), DYNO.y + r2 * Math.sin(a1 - off)];
    const p4 = [CX + r1 * Math.cos(a1 - off), CY + r1 * Math.sin(a1 - off)];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111417';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p4[0], p4[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.stroke();
    ctx.strokeStyle = '#2d3338';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, CY, r1, a1 + off, a1 - off + TAU);
    ctx.arc(DYNO.x, DYNO.y, r2, a1 - off, a1 + off);
    ctx.closePath();
    ctx.strokeStyle = '#23282c';
    ctx.lineWidth = 8;
    ctx.stroke();
    // belt cleats
    ctx.strokeStyle = 'rgba(190,200,208,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + this.beltPhase * 0.08;
      const x = CX + r1 * Math.cos(a);
      const y = CY + r1 * Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      ctx.stroke();
    }
    ctx.restore();

    // dyno chassis
    ctx.save();
    const chassis = linear(ctx, 1020, 690, 1280, 890, [
      [0, '#1a2026'], [0.3, '#3a444c'], [0.6, '#1b2126'], [1, '#080a0c'],
    ]);
    ctx.fillStyle = chassis;
    rr(ctx, 1010, 688, 268, 200, 22);
    ctx.fill();
    ctx.strokeStyle = '#050607';
    ctx.lineWidth = 4;
    ctx.stroke();
    // cooling slots
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(1040, 712 + i * 13);
      ctx.lineTo(1105, 712 + i * 13);
      ctx.stroke();
    }
    // warning label
    ctx.fillStyle = '#c9a24a';
    ctx.font = '700 11px "Arial Narrow", sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText('DYNO BRAKE', 1042, 858);
    ctx.fillStyle = '#8b99a4';
    ctx.font = '600 9px "Arial Narrow", sans-serif';
    ctx.fillText('WATER-COOLED / 30 kW', 1042, 873);
    ctx.restore();

    // rotor
    ctx.save();
    ctx.translate(DYNO.x, DYNO.y);
    ctx.rotate(e.theta * 0.6);
    const rotor = radial(ctx, -18, -18, 4, 86, [
      [0, '#c8d2da'], [0.2, '#68747e'], [0.55, '#252c32'], [0.85, '#59656f'], [1, '#101417'],
    ]);
    ctx.fillStyle = rotor;
    ctx.beginPath();
    ctx.arc(0, 0, DYNO.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#0a0c0e';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#0b0e11';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 45, Math.sin(a) * 45, 10, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 55, Math.sin(a) * 55);
      ctx.lineTo(Math.cos(a) * 78, Math.sin(a) * 78);
      ctx.stroke();
    }
    ctx.restore();

    if (hot > 0.02) {
      const halo = radial(ctx, DYNO.x, DYNO.y, DYNO.r * 0.55, DYNO.r * 1.7, [
        [0, `rgba(255,120,40,${0.22 * hot})`],
        [0.5, `rgba(255,70,20,${0.08 * hot})`],
        [1, 'rgba(0,0,0,0)'],
      ]);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(DYNO.x, DYNO.y, DYNO.r * 1.7, 0, TAU);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ */
  drawCrankAndFlywheel(ctx, e) {
    // flywheel
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(e.theta);
    const fw = radial(ctx, -40, -40, 10, FLY_R + 4, [
      [0, '#3c444b'], [0.45, '#232a30'], [0.8, '#4a545d'], [1, '#0a0d0f'],
    ]);
    ctx.fillStyle = fw;
    ctx.beginPath();
    ctx.arc(0, 0, FLY_R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#06080a';
    ctx.lineWidth = 7;
    ctx.stroke();
    // ring gear teeth
    ctx.fillStyle = '#20262b';
    for (let i = 0; i < 54; i++) {
      const a = (i / 54) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(FLY_R - 4, -6, 18, 12);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(210,220,228,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, FLY_R - 22, 0, TAU);
    ctx.stroke();
    // lightening holes
    ctx.fillStyle = '#070a0c';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 104, Math.sin(a) * 104, 23, 15, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#12171b';
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,220,228,0.25)';
    ctx.stroke();
    ctx.restore();

    // crankcase shell
    const caseGrad = linear(ctx, 540, 530, 900, 810, [
      [0, '#0b0e11'], [0.2, '#303840'], [0.36, '#79848d'], [0.5, '#4f5962'], [0.68, '#1b2126'], [1, '#07090b'],
    ]);
    ctx.fillStyle = caseGrad;
    ctx.beginPath();
    ctx.moveTo(552, 532);
    ctx.lineTo(888, 532);
    ctx.bezierCurveTo(928, 610, 918, 738, 822, 792);
    ctx.bezierCurveTo(768, 822, 672, 822, 618, 792);
    ctx.bezierCurveTo(525, 736, 514, 610, 552, 532);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 5;
    ctx.stroke();

    // cut-away crank cavity
    const cavity = radial(ctx, CX, CY, 30, 235, [
      [0, '#0a0d0f'], [0.55, '#0d1114'], [1, '#171c20'],
    ]);
    ctx.fillStyle = cavity;
    ctx.beginPath();
    ctx.ellipse(CX, CY + 28, 196, 168, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,195,205,0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // oil in the sump
    const oilY = 715;
    const oil = linear(ctx, 0, oilY, 0, 790, [[0, '#3a2814'], [0.5, '#21160b'], [1, '#0b0805']]);
    ctx.fillStyle = oil;
    ctx.beginPath();
    ctx.moveTo(565, oilY);
    ctx.bezierCurveTo(640, oilY - 6 + Math.sin(this.time * 1.7) * 2, 800, oilY + 5, 872, oilY - 2);
    ctx.lineTo(872, 780);
    ctx.bezierCurveTo(800, 800, 640, 800, 565, 780);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,70,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(565, oilY);
    ctx.bezierCurveTo(640, oilY - 6 + Math.sin(this.time * 1.7) * 2, 800, oilY + 5, 872, oilY - 2);
    ctx.stroke();

    // crank webs + pin (behind rod, drawn first)
    const px = CX + CRANK_R * Math.sin(e.theta);
    const py = CY - CRANK_R * Math.cos(e.theta);
    const cwAngle = Math.atan2(py - CY, px - CX) + Math.PI;
    ctx.save();
    ctx.translate(CX + Math.cos(cwAngle) * 28, CY + Math.sin(cwAngle) * 28);
    ctx.rotate(cwAngle);
    const web = radial(ctx, -26, -26, 5, 100, [
      [0, '#9aa5ae'], [0.25, '#4a545c'], [0.62, '#20262b'], [0.86, '#69747d'], [1, '#0d1013'],
    ]);
    ctx.fillStyle = web;
    ctx.beginPath();
    ctx.ellipse(0, 0, 104, 74, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#07090b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // crank pin journal
    const pinGrad = radial(ctx, px - 6, py - 6, 2, 24, [
      [0, '#eef4f8'], [0.35, '#9aa6af'], [0.7, '#3c454c'], [1, '#0a0c0e'],
    ]);
    ctx.fillStyle = pinGrad;
    ctx.beginPath();
    ctx.arc(px, py, 21, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 3;
    ctx.stroke();

    // spinning crank centre
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(e.theta);
    ctx.fillStyle = radial(ctx, -10, -10, 2, 42, [[0, '#d9e1e7'], [0.4, '#7d8992'], [1, '#161b1f']]);
    ctx.beginPath();
    ctx.arc(0, 0, 39, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#090b0d';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#11161a';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 23, Math.sin(a) * 23, 4.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // oil splashes
    if (e.omega > 5 && Math.random() < Math.min(0.5, e.omega / 90)) {
      this.splashes.push({
        x: CX + (Math.random() - 0.5) * 150,
        y: 716,
        vx: (Math.random() - 0.5) * 90,
        vy: -80 - Math.random() * 100,
        life: 0.35 + Math.random() * 0.25,
        max: 0.6,
      });
    }
    ctx.fillStyle = 'rgba(214,150,64,0.55)';
    for (const p of this.splashes) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ */
  drawBlock(ctx, e) {
    // main block with cast ribs
    const block = linear(ctx, 596, 190, 844, 552, [
      [0, '#0a0d10'], [0.12, '#3b444c'], [0.25, '#8b969f'], [0.4, '#4d5860'],
      [0.6, '#22292e'], [0.78, '#68737c'], [0.9, '#2e353b'], [1, '#090b0d'],
    ]);
    ctx.fillStyle = block;
    rr(ctx, 588, 184, 264, 374, 16);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 5;
    ctx.stroke();

    // side ribs
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(600, 360 + i * 40);
      ctx.lineTo(620, 348 + i * 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(840, 360 + i * 40);
      ctx.lineTo(820, 348 + i * 40);
      ctx.stroke();
    }

    // water jacket channels
    const hot = clamp((e.wallC - 20) / 90, 0, 1);
    for (const x0 of [606, 822]) {
      const grad = linear(ctx, x0, 220, x0 + 12, 520, [
        [0, `rgba(${lerp(50, 210, hot) | 0},${lerp(150, 110, hot) | 0},${lerp(180, 60, hot) | 0},0.7)`],
        [1, 'rgba(20,50,60,0.5)'],
      ]);
      ctx.fillStyle = grad;
      rr(ctx, x0, 218, 12, 302, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // bubbles
      if (e.omega > 3) {
        const n = 4;
        for (let i = 0; i < n; i++) {
          const t = ((this.time * (0.05 + i * 0.011) + i / n) % 1);
          ctx.fillStyle = `rgba(190,230,240,${0.35 * (1 - t)})`;
          ctx.beginPath();
          ctx.arc(x0 + 6, 510 - t * 280, 1.6 + i * 0.4, 0, TAU);
          ctx.fill();
        }
      }
    }

    // cylinder bore / liner
    ctx.save();
    ctx.beginPath();
    ctx.rect(BORE_L, 196, BORE, 352);
    ctx.clip();
    const liner = linear(ctx, BORE_L, 0, BORE_R, 0, [
      [0, '#0b0e11'], [0.08, '#4f5a63'], [0.18, '#c4cdd4'], [0.26, '#7e8a93'],
      [0.7, '#2a3137'], [0.88, '#535e67'], [1, '#090c0e'],
    ]);
    ctx.fillStyle = liner;
    ctx.fillRect(BORE_L, 196, BORE, 352);
    // honing marks
    ctx.strokeStyle = 'rgba(235,242,247,0.075)';
    ctx.lineWidth = 1;
    for (let y = 200; y < 552; y += 9) {
      ctx.beginPath();
      ctx.moveTo(BORE_L, y);
      ctx.lineTo(BORE_R, y + 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(BORE_R, y);
      ctx.lineTo(BORE_L, y + 7);
      ctx.stroke();
    }
    ctx.restore();

    // shadow at the bottom of the bore
    const depth = linear(ctx, 0, 430, 0, 552, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.85)']]);
    ctx.fillStyle = depth;
    ctx.fillRect(BORE_L, 430, BORE, 122);

    // deck + head gasket
    ctx.fillStyle = '#272e34';
    ctx.fillRect(580, 184, 280, 13);
    ctx.fillStyle = '#a36f38';
    ctx.fillRect(588, 183, 264, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(588, 186, 264, 1.5);

    // block bolts
    for (const [x, y] of [[604, 212], [836, 212], [604, 528], [836, 528]]) bolt(ctx, x, y, 7);

    // engine mount + stand
    ctx.strokeStyle = '#101417';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(612, 760);
    ctx.lineTo(570, 900);
    ctx.moveTo(828, 760);
    ctx.lineTo(870, 900);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,175,185,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0b0e11';
    ctx.fillRect(530, 894, 380, 16);

    // engine designation plate
    ctx.save();
    ctx.translate(720, 500);
    ctx.fillStyle = 'rgba(8,10,12,0.88)';
    rr(ctx, -58, -15, 116, 30, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,190,120,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#c9ad76';
    ctx.font = '700 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SC-1  449cc', 0, 5);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  drawReciprocating(ctx, e) {
    const theta = e.theta;
    const pin = pistonPinY(theta);
    const pinY = CY - pin;
    const crown = pinY - PISTON_CROWN_OFF;
    const px = CX + CRANK_R * Math.sin(theta);
    const py = CY - CRANK_R * Math.cos(theta);
    const lean = Math.asin((CRANK_R * Math.sin(theta)) / ROD);

    // connecting rod
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-lean);
    const rodLen = 300;
    const grad = linear(ctx, -18, 0, 18, 0, [
      [0, '#101417'], [0.22, '#5d6871'], [0.44, '#c3ccd3'], [0.6, '#626d76'], [0.82, '#232a2f'], [1, '#090b0d'],
    ]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.bezierCurveTo(-20, -40, -15, -190, -13, -rodLen + 26);
    ctx.lineTo(13, -rodLen + 26);
    ctx.bezierCurveTo(15, -190, 20, -40, 34, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 3;
    ctx.stroke();
    // I-beam web
    ctx.strokeStyle = 'rgba(240,247,252,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(0, -rodLen + 30);
    ctx.stroke();
    // small end
    ctx.fillStyle = radial(ctx, -5, -rodLen + 4, 2, 30, [[0, '#d6dee5'], [0.45, '#6b767f'], [1, '#111519']]);
    ctx.beginPath();
    ctx.arc(0, -rodLen + 16, 17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 2;
    ctx.stroke();
    // big end
    ctx.fillStyle = radial(ctx, -10, -4, 2, 46, [[0, '#c8d2d9'], [0.42, '#5b666f'], [1, '#0e1215']]);
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#0a0d0f';
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, TAU);
    ctx.fill();
    for (const bx of [-23, 23]) bolt(ctx, bx, 0, 3.4);
    ctx.restore();

    // piston (clipped to bore)
    ctx.save();
    ctx.beginPath();
    ctx.rect(BORE_L + 1, 198, BORE - 2, 350);
    ctx.clip();
    const pistonGrad = linear(ctx, BORE_L + 4, 0, BORE_R - 4, 0, [
      [0, '#14191d'], [0.12, '#7d8891'], [0.25, '#d7dfe5'], [0.34, '#9aa5ae'],
      [0.55, '#58626b'], [0.78, '#8e99a2'], [0.9, '#2f363c'], [1, '#0d1013'],
    ]);
    ctx.fillStyle = pistonGrad;
    rr(ctx, CX - PISTON_H * 0.86, crown, PISTON_H * 1.72, PISTON_H, 10);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 3;
    ctx.stroke();
    // crown highlight
    ctx.fillStyle = 'rgba(235,245,252,0.30)';
    rr(ctx, CX - 82, crown + 4, 164, 7, 3);
    ctx.fill();
    // ring grooves
    for (let i = 0; i < 3; i++) {
      const y = crown + 20 + i * 13;
      ctx.fillStyle = '#07090b';
      ctx.fillRect(CX - 84, y, 168, 6);
      ctx.fillStyle = 'rgba(225,235,240,0.26)';
      ctx.fillRect(CX - 84, y + 6, 168, 1.4);
    }
    // skirt cut-outs
    ctx.fillStyle = 'rgba(8,11,13,0.8)';
    ctx.beginPath();
    ctx.ellipse(CX - 62, crown + 94, 16, 12, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(CX + 62, crown + 94, 16, 12, 0, 0, TAU);
    ctx.fill();
    // wrist pin
    ctx.fillStyle = radial(ctx, CX - 5, pinY - 5, 2, 18, [[0, '#e8f0f5'], [0.4, '#89949d'], [1, '#151a1e']]);
    ctx.beginPath();
    ctx.arc(CX, pinY, 15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#06080a';
    ctx.lineWidth = 2;
    ctx.stroke();
    // piston direction arrow / forging mark
    ctx.strokeStyle = 'rgba(20,26,30,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CX, crown + 48);
    ctx.lineTo(CX, crown + 68);
    ctx.moveTo(CX - 6, crown + 62);
    ctx.lineTo(CX, crown + 68);
    ctx.lineTo(CX + 6, crown + 62);
    ctx.stroke();
    ctx.restore();

    // piston shadow on the liner
    const sg = linear(ctx, 0, crown, 0, crown + PISTON_H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']]);
    ctx.fillStyle = sg;
    ctx.fillRect(BORE_L, crown + PISTON_H - 20, BORE, 20);
  }

  /* ------------------------------------------------------------------ */
  drawHead(ctx, e) {
    // head casting
    const head = linear(ctx, 560, 88, 880, 200, [
      [0, '#090c0e'], [0.16, '#424c54'], [0.32, '#9aa5ae'], [0.48, '#626d76'],
      [0.68, '#272e34'], [0.84, '#707b84'], [1, '#0a0d0f'],
    ]);
    ctx.fillStyle = head;
    rr(ctx, 566, 92, 308, 108, 12);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 5;
    ctx.stroke();

    // combustion chamber cut-away
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(618, 195);
    ctx.lineTo(618, 162);
    ctx.quadraticCurveTo(630, 138, 668, 136);
    ctx.lineTo(772, 136);
    ctx.quadraticCurveTo(810, 138, 822, 162);
    ctx.lineTo(822, 195);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#050607';
    ctx.fillRect(610, 130, 220, 70);
    // heat staining
    const stain = radial(ctx, 720, 165, 4, 120, [[0, 'rgba(200,120,60,0.20)'], [0.5, 'rgba(90,50,30,0.10)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillStyle = stain;
    ctx.fillRect(610, 130, 220, 70);
    ctx.restore();
    // chamber outline
    ctx.strokeStyle = 'rgba(210,222,230,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(618, 195);
    ctx.lineTo(618, 162);
    ctx.quadraticCurveTo(630, 138, 668, 136);
    ctx.lineTo(772, 136);
    ctx.quadraticCurveTo(810, 138, 822, 162);
    ctx.lineTo(822, 195);
    ctx.stroke();

    // intake / exhaust ports
    ctx.fillStyle = '#080b0d';
    ctx.beginPath();
    ctx.moveTo(566, 138);
    ctx.lineTo(620, 145);
    ctx.lineTo(620, 184);
    ctx.lineTo(566, 190);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(874, 138);
    ctx.lineTo(820, 145);
    ctx.lineTo(820, 184);
    ctx.lineTo(874, 190);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,195,205,0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // valve seats
    ctx.strokeStyle = 'rgba(235,225,190,0.35)';
    ctx.lineWidth = 3;
    for (const x of VALVE_X) {
      ctx.beginPath();
      ctx.moveTo(x - 25, VALVE_SEAT);
      ctx.lineTo(x - 16, VALVE_SEAT + 4);
      ctx.moveTo(x + 25, VALVE_SEAT);
      ctx.lineTo(x + 16, VALVE_SEAT + 4);
      ctx.stroke();
    }

    // head bolts
    for (const x of [592, 848]) {
      for (const y of [112, 178]) bolt(ctx, x, y, 6);
    }

    // cam cover / cutaway
    ctx.fillStyle = linear(ctx, 600, 20, 840, 88, [
      [0, '#0b0e11'], [0.3, '#3b2c28'], [0.5, '#63443a'], [0.75, '#281d1b'], [1, '#080a0c'],
    ]);
    ctx.beginPath();
    ctx.moveTo(596, 92);
    ctx.lineTo(606, 30);
    ctx.quadraticCurveTo(720, 12, 834, 30);
    ctx.lineTo(844, 92);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#06080a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220,180,150,0.14)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(614, 44 + i * 10);
      ctx.lineTo(826, 44 + i * 10);
      ctx.stroke();
    }
    // cover badge
    ctx.fillStyle = 'rgba(8,10,12,0.8)';
    rr(ctx, 684, 46, 72, 30, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,160,100,0.35)';
    ctx.stroke();
    ctx.fillStyle = '#d0a86b';
    ctx.font = '700 12px "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SC-1', 720, 66);
    ctx.textAlign = 'left';

    // cams and valve gear
    const crankDeg = (e.theta * 180) / Math.PI;
    const camAngle = (crankDeg / 2) * (Math.PI / 180);
    const lifts = [e.intakeLift || 0, e.exhaustLift || 0];
    const maxLift = e.maxLift || 0.0105;
    for (let i = 0; i < 2; i++) {
      const x = VALVE_X[i];
      const liftPx = clamp(lifts[i] / maxLift, 0, 1) * MAX_VALVE_PX;
      const camX = x;
      const camY = 70;
      // cam lobe
      ctx.save();
      ctx.translate(camX, camY);
      ctx.rotate(camAngle + (i === 0 ? Math.PI : Math.PI * 0.42));
      ctx.fillStyle = radial(ctx, -8, -8, 3, 40, [
        [0, '#eef4f8'], [0.3, '#aab4bc'], [0.62, '#59636c'], [1, '#12171b'],
      ]);
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, -18);
      ctx.quadraticCurveTo(0, -43, 14, -18);
      ctx.lineTo(10, 0);
      ctx.lineTo(-10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#080a0c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#0d1114';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, TAU);
      ctx.fill();
      ctx.restore();

      // bucket
      ctx.fillStyle = linear(ctx, x - 22, 96, x + 22, 118, [
        [0, '#14181c'], [0.35, '#b5bfc7'], [0.55, '#dce4ea'], [0.8, '#5d686f'], [1, '#0b0e11'],
      ]);
      rr(ctx, x - 22, 94 + liftPx, 44, 20, 4);
      ctx.fill();
      ctx.strokeStyle = '#07090b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // spring
      drawSpring(ctx, x, 126 + liftPx * 0.7, 190 + liftPx, 11, 7);
      // valve stem
      ctx.fillStyle = steel(ctx, x - 4, 120, x + 4, 195);
      ctx.fillRect(x - 3.5, 116 + liftPx, 7, 78);
      // valve head
      ctx.fillStyle = linear(ctx, x - 20, 0, x + 20, 0, [
        [0, '#0b0e10'], [0.3, '#9aa5ad'], [0.55, '#e2e9ee'], [0.8, '#68737b'], [1, '#0b0e10'],
      ]);
      ctx.beginPath();
      ctx.moveTo(x - 20, VALVE_SEAT + liftPx);
      ctx.lineTo(x + 20, VALVE_SEAT + liftPx);
      ctx.lineTo(x + 14, VALVE_SEAT + 8 + liftPx);
      ctx.lineTo(x - 14, VALVE_SEAT + 8 + liftPx);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#050708';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // spark plug
    ctx.save();
    ctx.translate(720, 0);
    ctx.fillStyle = radial(ctx, -5, 54, 2, 24, [[0, '#f0f6fa'], [0.35, '#9ba6ad'], [1, '#1a1f23']]);
    ctx.beginPath();
    ctx.arc(0, 58, 18, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#07090b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#d9d1bf';
    ctx.fillRect(-8, 58, 16, 52);
    ctx.fillStyle = '#6c5d47';
    for (let i = 0; i < 5; i++) ctx.fillRect(-8, 64 + i * 9, 16, 3);
    ctx.fillStyle = '#aeb8bf';
    ctx.fillRect(-4, 108, 8, 54);
    ctx.fillStyle = '#1b1f22';
    ctx.fillRect(-5, 158, 10, 18);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  drawPorts(ctx, e) {
    const running = e.omega > 1;
    const wall = clamp((e.wallC - 20) / 90, 0, 1);

    // intake airbox
    ctx.fillStyle = linear(ctx, 250, 92, 382, 246, [
      [0, '#0b0f12'], [0.22, '#2f3a42'], [0.45, '#59656e'], [0.7, '#1c2328'], [1, '#07090b'],
    ]);
    rr(ctx, 250, 92, 132, 154, 14);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(90,110,122,0.35)';
    for (let i = 0; i < 8; i++) ctx.fillRect(266, 108 + i * 16, 100, 6);
    ctx.fillStyle = '#b7c4cc';
    ctx.font = '700 10px "Arial Narrow", sans-serif';
    ctx.fillText('AIRBOX / 98 RON', 264, 238);

    // intake pipe
    ctx.strokeStyle = linear(ctx, 0, 140, 0, 190, [
      [0, '#080b0d'], [0.2, '#525e67'], [0.42, '#a9b4bc'], [0.6, '#5e6972'], [0.8, '#1a2025'], [1, '#07090b'],
    ]);
    ctx.lineWidth = 42;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(380, 160);
    ctx.bezierCurveTo(430, 158, 500, 152, 570, 158);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(392, 145);
    ctx.bezierCurveTo(445, 142, 500, 139, 565, 144);
    ctx.stroke();

    // throttle body
    ctx.fillStyle = linear(ctx, 448, 128, 508, 192, [
      [0, '#0b0e11'], [0.3, '#3d474f'], [0.55, '#8b969f'], [0.8, '#2a3137'], [1, '#090b0d'],
    ]);
    rr(ctx, 450, 128, 58, 64, 10);
    ctx.fill();
    ctx.strokeStyle = '#050708';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.save();
    ctx.translate(479, 160);
    ctx.rotate(0.25 + (e.throttle || 0) * 1.25);
    ctx.fillStyle = radial(ctx, -8, -8, 2, 26, [[0, '#e8eef3'], [0.5, '#9aa6ae'], [1, '#2c343a']]);
    ctx.beginPath();
    ctx.ellipse(0, 0, 23, 9, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#151a1e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#7d8b95';
    ctx.font = '600 9px "Arial Narrow", sans-serif';
    ctx.fillText('THROTTLE', 453, 208);

    // intake airflow streaks
    if (running) {
      for (const p of this.intake) {
        ctx.strokeStyle = `rgba(90,190,230,${p.life / p.max * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 26, p.y);
        ctx.stroke();
      }
    }

    // exhaust header
    const heat = clamp((e.wallC - 40) / 65, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = linear(ctx, 0, 140, 0, 240, [
      [0, '#0b0d0f'], [0.22, '#4f4238'], [0.45, '#8a7562'], [0.66, '#3d332c'], [1, '#090b0d'],
    ]);
    ctx.lineWidth = 44;
    ctx.beginPath();
    ctx.moveTo(874, 160);
    ctx.bezierCurveTo(930, 154, 958, 162, 1000, 190);
    ctx.bezierCurveTo(1038, 216, 1080, 224, 1132, 218);
    ctx.bezierCurveTo(1190, 212, 1232, 200, 1258, 190);
    ctx.stroke();
    if (heat > 0.02) {
      ctx.strokeStyle = `rgba(255,90,25,${0.22 * heat})`;
      ctx.lineWidth = 20;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,120,40,${0.14 * heat})`;
      ctx.lineWidth = 58;
      ctx.stroke();
    }
    ctx.restore();

    // heat wrap bands
    ctx.strokeStyle = 'rgba(210,190,160,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      const x = 890 + t * 210;
      const y = 160 + Math.sin(t * 3.2) * 26;
      ctx.beginPath();
      ctx.moveTo(x - 2, y - 21);
      ctx.lineTo(x + 5, y + 21);
      ctx.stroke();
    }

    // tail pipe / stack
    ctx.strokeStyle = linear(ctx, 0, 180, 0, 110, [
      [0, '#2b211b'], [0.3, '#8c7c6c'], [0.55, '#3b3029'], [1, '#0a0c0e'],
    ]);
    ctx.lineWidth = 52;
    ctx.beginPath();
    ctx.moveTo(1258, 190);
    ctx.lineTo(1268, 118);
    ctx.stroke();
    ctx.fillStyle = '#0a0c0e';
    ctx.beginPath();
    ctx.ellipse(1268, 110, 29, 13, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,190,175,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // exhaust puffs
    for (const p of this.exhaust) {
      const a = clamp(p.life / p.max, 0, 1);
      const g = radial(ctx, p.x, p.y, 0, p.size * (1.6 - a * 0.6), [
        [0, `rgba(${p.hot},${p.hot * 0.72},${p.hot * 0.55},${0.22 * a})`],
        [1, 'rgba(0,0,0,0)'],
      ]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.7 - a * 0.7), 0, TAU);
      ctx.fill();
    }

    // injector
    ctx.save();
    ctx.translate(608, 130);
    ctx.rotate(0.20);
    ctx.fillStyle = linear(ctx, -7, 0, 7, 0, [[0, '#0a0c0e'], [0.45, '#aab6be'], [1, '#1a1f23']]);
    rr(ctx, -7, 0, 14, 34, 4);
    ctx.fill();
    ctx.strokeStyle = '#07090b';
    ctx.stroke();
    ctx.fillStyle = '#2e3840';
    ctx.fillRect(-5, 34, 10, 8);
    if (running && e.intakeLift > 0.0004) {
      ctx.fillStyle = 'rgba(140,210,255,0.30)';
      ctx.beginPath();
      ctx.moveTo(0, 42);
      ctx.lineTo(28, 58);
      ctx.lineTo(4, 86);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  drawEffects(ctx, e, dt) {
    const phase = ((e.theta / (Math.PI * 4)) * 720) % 720;

    // combustion glow/flame
    if (e.combustion > 0.01 && e.omega > 0.2) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(620, 194);
      ctx.lineTo(620, 160);
      ctx.quadraticCurveTo(632, 138, 668, 136);
      ctx.lineTo(772, 136);
      ctx.quadraticCurveTo(808, 138, 820, 160);
      ctx.lineTo(820, 194);
      ctx.closePath();
      ctx.clip();
      const flick = 0.78 + Math.random() * 0.22;
      const intensity = clamp(e.combustion * 1.4, 0, 1) * flick;
      const g = radial(ctx, 720, 178, 2, 110, [
        [0, `rgba(255,255,245,${0.95 * intensity})`],
        [0.16, `rgba(255,235,170,${0.85 * intensity})`],
        [0.4, `rgba(255,150,40,${0.62 * intensity})`],
        [0.72, `rgba(220,60,15,${0.28 * intensity})`],
        [1, 'rgba(0,0,0,0)'],
      ]);
      ctx.fillStyle = g;
      ctx.fillRect(610, 130, 220, 70);
      // flame tongues
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const bx = 650 + Math.random() * 140;
        const bh = 12 + Math.random() * 38 * intensity;
        const fg = linear(ctx, 0, 190, 0, 190 - bh, [
          [0, `rgba(255,190,70,${0.5 * intensity})`],
          [0.65, `rgba(255,120,30,${0.3 * intensity})`],
          [1, 'rgba(255,80,10,0)'],
        ]);
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(bx - 9, 194);
        ctx.quadraticCurveTo(bx - 10, 194 - bh * 0.5, bx, 194 - bh);
        ctx.quadraticCurveTo(bx + 11, 194 - bh * 0.5, bx + 9, 194);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // detonation flashes
    if (e.detonation > 0.05) {
      const a = clamp(e.detonation, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = radial(ctx, 720, 172, 2, 120, [
        [0, `rgba(255,230,220,${0.75 * a})`],
        [0.3, `rgba(255,80,30,${0.45 * a})`],
        [1, 'rgba(255,0,0,0)'],
      ]);
      ctx.fillStyle = g;
      ctx.fillRect(600, 120, 240, 90);
      if (Math.random() < 0.6) {
        for (let i = 0; i < 5; i++) {
          this.sparks.push({
            x: 690 + Math.random() * 60,
            y: 170 + Math.random() * 22,
            vx: (Math.random() - 0.5) * 320,
            vy: (Math.random() - 0.5) * 320,
            life: 0.12 + Math.random() * 0.16,
            max: 0.28,
          });
        }
      }
      ctx.restore();
    }

    // spark
    if (e.sparkPulse > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(170,225,255,${clamp(e.sparkPulse, 0, 1)})`;
      ctx.lineWidth = 2;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        let x = 720 + (Math.random() - 0.5) * 3;
        let y = 176;
        ctx.moveTo(x, y);
        const steps = 5;
        for (let i = 0; i < steps; i++) {
          x += (Math.random() - 0.5) * 16;
          y += 4 + Math.random() * 3;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const g = radial(ctx, 720, 178, 1, 28, [[0, 'rgba(210,240,255,0.8)'], [1, 'rgba(80,150,255,0)']]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(720, 178, 28, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // intake / exhaust emission
    if (e.omega > 0.4) {
      this.intakeClock += dt * (2 + e.omega * 2.5);
      while (this.intakeClock > 1) {
        this.intakeClock -= 1;
        this.intake.push({
          x: 565 + Math.random() * 10,
          y: 145 + Math.random() * 26,
          life: 0.45,
          max: 0.45,
        });
      }
      this.exhaustClock += dt * (3 + e.omega * 8);
      const rate = e.exhaustPulse > 0.02 ? 8 : 2;
      while (this.exhaustClock > rate) {
        this.exhaustClock -= rate;
        this.exhaust.push({
          x: STACK.x + (Math.random() - 0.5) * 22,
          y: STACK.y - 2,
          vx: 12 + Math.random() * 26,
          vy: -18 - Math.random() * 34,
          size: 7 + Math.random() * 9,
          life: 0.9 + Math.random() * 0.7,
          max: 1.6,
          hot: 70 + Math.random() * 20,
        });
      }
    }

    // update particles
    for (const list of [this.exhaust, this.intake, this.sparks, this.splashes, this.embers]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) { list.splice(i, 1); continue; }
        if (p.vx !== undefined) p.x += p.vx * dt;
        if (p.vy !== undefined) p.y += p.vy * dt;
        if (list === this.exhaust) { p.vy -= 8 * dt; p.size += 13 * dt; p.hot *= 0.995; }
        if (list === this.sparks) { p.vy += 360 * dt; }
        if (list === this.splashes) { p.vy += 420 * dt; }
      }
    }

    // sparks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.sparks) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `rgba(255,${170 + 60 * a},80,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // exhaust heat shimmer
    if (e.wallC > 85) {
      ctx.save();
      ctx.globalAlpha = clamp((e.wallC - 85) / 40, 0, 0.3);
      ctx.strokeStyle = 'rgba(255,130,50,0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const x = 990 + i * 50;
        for (let y = 200; y < 330; y += 8) {
          const xx = x + Math.sin(y * 0.08 + this.time * 8 + i) * 5;
          if (y === 200) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  drawLabels(ctx, e, opts) {
    const labels = [
      [742, 62, 855, 30, 'DOHC · 4 VALVE'],
      [850, 470, 960, 430, 'Ø84 BORE'],
      [1110, 642, 1188, 590, 'DYNO BRAKE'],
      [476, 220, 430, 290, 'THROTTLE BODY'],
      [1268, 140, 1330, 170, 'EXHAUST'],
      [720, 850, 720, 890, 'SC-1 · 449 cc SINGLE'],
    ];
    ctx.save();
    ctx.strokeStyle = 'rgba(190,205,215,0.28)';
    ctx.fillStyle = 'rgba(180,198,210,0.55)';
    ctx.lineWidth = 1;
    ctx.font = '600 10px "Arial Narrow", sans-serif';
    ctx.letterSpacing = '1.5px';
    for (const [x, y, tx, ty, text] of labels) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
      ctx.fillText(text, tx + (tx > x ? 5 : -5 - text.length * 6.2), ty + 4);
    }
    ctx.restore();

    // live readout stencil on the crankcase
    ctx.save();
    ctx.fillStyle = 'rgba(80,220,180,0.55)';
    ctx.font = '700 12px "Courier New", monospace';
    const rpm = Math.round((e.omega * 60) / TAU);
    ctx.fillText(String(rpm).padStart(4, '0') + ' RPM', 580, 334);
    ctx.fillStyle = 'rgba(80,220,180,0.25)';
    ctx.font = '600 9px "Courier New", monospace';
    ctx.fillText('CRANK / ' + (Math.round(((e.theta / TAU) * 360) % 720)) + '°', 580, 350);
    ctx.restore();

    // Additive glow pulses around the head when hot
    if (e.wallC > 95) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp((e.wallC - 95) / 40, 0, 0.16);
      const g = radial(ctx, 720, 250, 30, 260, [[0, 'rgba(255,100,30,0.5)'], [1, 'rgba(255,0,0,0)']]);
      ctx.fillStyle = g;
      ctx.fillRect(400, 100, 640, 460);
      ctx.restore();
    }
  }

  drawVignette(ctx) {
    const g = radial(ctx, W / 2, H / 2, Math.min(W, H) * 0.32, Math.max(W, H) * 0.7, [
      [0, 'rgba(0,0,0,0)'],
      [0.72, 'rgba(0,0,0,0.22)'],
      [1, 'rgba(0,0,0,0.68)'],
    ]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // film grain
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(this.noise, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // scanline
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#9ecce0';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.restore();
  }
}
