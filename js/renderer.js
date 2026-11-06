/* ============================================================
   APEX // DYNO — canvas cross-section renderer
   ============================================================ */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function rr(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function metallic(ctx, x0, y0, x1, y1, light = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, `rgba(${112 * light}, ${150 * light}, ${178 * light}, .95)`);
  g.addColorStop(0.22, `rgba(${220 * light}, ${238 * light}, ${248 * light}, .98)`);
  g.addColorStop(0.5, `rgba(${128 * light}, ${162 * light}, ${188 * light}, .95)`);
  g.addColorStop(0.78, `rgba(${208 * light}, ${228 * light}, ${242 * light}, .96)`);
  g.addColorStop(1, `rgba(${72 * light}, ${104 * light}, ${130 * light}, .95)`);
  return g;
}

export class EngineRenderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.sim = sim;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.last = performance.now();
    this.dust = [];
    this.fps = 60;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    for (let i = 0; i < 54; i++) {
      this.dust.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.012,
        vy: -0.003 - Math.random() * 0.014,
        r: 0.5 + Math.random() * 1.5,
        a: 0.08 + Math.random() * 0.24,
        p: Math.random() * TAU
      });
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  computeGeometry() {
    const sim = this.sim;
    const p = sim.preset;
    const w = this.w;
    const h = this.h;
    const isVee = p.layout === 'vee';
    const units = isVee ? p.pairs : p.cylinders;
    const marginX = Math.max(18, w * 0.034);
    const usableW = w - marginX * 2;
    const spacing = usableW / units;
    const crankY = h * (h < 440 ? 0.72 : 0.735);
    let strokePx = Math.min(spacing * 0.86, h * (isVee ? 0.2 : 0.265));
    let r = strokePx / 2;
    let rod = strokePx * 1.85;
    let pistonH = strokePx * 0.52;
    let clearance = Math.max(4, strokePx * 0.045);
    let deckAbs = crankY - (r + rod + pistonH / 2 + clearance);
    if (deckAbs < h * 0.125) {
      const overflow = h * 0.125 - deckAbs;
      strokePx = Math.max(22, strokePx - overflow * 0.62);
      r = strokePx / 2;
      rod = strokePx * 1.85;
      pistonH = strokePx * 0.52;
      clearance = Math.max(4, strokePx * 0.045);
      deckAbs = crankY - (r + rod + pistonH / 2 + clearance);
    }
    const r2 = r;
    const rod2 = rod;
    const pistonH2 = pistonH;
    const clearance2 = clearance;
    const deckY = deckAbs - crankY;

    const bore = Math.min(strokePx * (isVee ? 0.6 : 0.9), spacing * (isVee ? 0.45 : 0.68));
    const headH = clamp(bore * 0.78, 48, 84);
    const headW = Math.min(bore * 1.58, spacing * (isVee ? 0.6 : 0.92));
    const bottomY = -(rod2 - r2) + pistonH2 / 2 + Math.max(14, strokePx * 0.14);
    const blockX0 = Math.max(6, marginX - spacing * 0.32);
    const blockX1 = Math.min(w - 6, w - marginX + spacing * 0.32);
    const blockTop = deckAbs - headH - 24;
    const blockBottom = Math.min(h - 6, crankY + Math.max(46, h * 0.095));
    const camAngle = (sim.crankAngle * 0.5) % 360;
    const verticalDeck = Math.max(40, crankY - deckAbs);
    const fitBank = Math.atan2(Math.max(10, (spacing * 0.94 - bore) / 2), verticalDeck) / DEG;
    const bankAngle = isVee ? Math.min(p.bankAngle, fitBank * 0.95) : 0;

    const geos = sim.cylinders.map((cyl) => {
      const pair = isVee ? cyl.pair : cyl.index;
      const cx = marginX + spacing * (pair + 0.5);
      const theta = cyl.theta * DEG;
      const worldPin = { x: r2 * Math.sin(theta), y: -r2 * Math.cos(theta) };
      const bank = (cyl.bank < 0 ? -bankAngle : cyl.bank > 0 ? bankAngle : 0) * DEG;
      // Give the far bank a small vertical offset and reduced opacity so
      // overlapping V banks read as depth instead of a collision.
      const lift = isVee
        ? (cyl.bank < 0 ? -Math.max(10, h * 0.017) : Math.max(2, h * 0.004))
        : 0;
      const depth = isVee && cyl.bank < 0 ? 0.7 : 1;
      const cos = Math.cos(-bank);
      const sin = Math.sin(-bank);
      const pinRel = { x: worldPin.x, y: worldPin.y - lift };
      const localPin = {
        x: pinRel.x * cos - pinRel.y * sin,
        y: pinRel.x * sin + pinRel.y * cos
      };
      const s = -localPin.y + Math.sqrt(Math.max(1, rod2 * rod2 - localPin.x * localPin.x));
      const pinY = -s;
      const pistonTop = pinY - pistonH2 / 2;
      const pistonBottom = pinY + pistonH2 / 2;
      const chamberH = Math.max(3, pistonTop - deckY);
      const exhaustDir = isVee ? (cyl.bank < 0 ? -1 : 1) : 1;
      return {
        cyl,
        cx,
        crankY,
        bank,
        lift,
        depth,
        localPin,
        rodPin: localPin,
        pinY,
        pistonTop,
        pistonBottom,
        chamberH,
        worldPin: { x: cx + worldPin.x, y: crankY + worldPin.y },
        theta: cyl.theta,
        r: r2,
        rod: rod2,
        bore,
        pistonH: pistonH2,
        deckY,
        clearance: clearance2,
        headH,
        headW,
        headTop: deckY - headH,
        camY: deckY - headH * 0.47,
        camAngle: (camAngle + (cyl.cycleOffset || 0) * 0.5) * DEG,
        bottomY,
        exhaustDir,
        intakeDir: -exhaustDir,
        spacing,
        isVee
      };
    });

    return {
      geos,
      w, h, marginX, spacing, crankY, strokePx, r: r2, rod: rod2, pistonH: pistonH2,
      bore, headH, headW, deckY, bottomY, blockX0, blockX1, blockTop, blockBottom,
      isVee, units, camAngle
    };
  }

  ensureFx(cyl) {
    if (!cyl._fx) {
      cyl._fx = {
        intake: [],
        exhaust: [],
        burn: [],
        accI: 0,
        accE: 0,
        accB: 0,
        seed: Math.random() * 100
      };
    }
    return cyl._fx;
  }

  updateFx(geo, dt) {
    const sim = this.sim;
    const fx = this.ensureFx(geo.cyl);
    const running = sim.running && sim.rpm > 8;
    const dens = sim.density;
    const turb = sim.turbulence;
    const chamberMid = (geo.deckY + geo.pistonTop) / 2;

    // Spawn intake charge.
    if (sim.particlesOn.intake && running && geo.cyl.intakeLift > 0.03) {
      fx.accI += dt * (8 + dens * 62) * (0.25 + sim.throttle / 100) * geo.cyl.intakeLift;
      const max = 10 + Math.round(dens * 10);
      while (fx.accI >= 1) {
        fx.accI -= 1;
        if (fx.intake.length < max) {
          const side = geo.intakeDir;
          fx.intake.push({
            x: side * (geo.headW * 0.9 + Math.random() * 8),
            y: geo.deckY - geo.headH * 0.34 + (Math.random() - 0.5) * 7,
            px: 0, py: 0, vx: -side * (50 + Math.random() * 40), vy: 12 + Math.random() * 22,
            age: 0, life: 0.85 + Math.random() * 0.55,
            size: 1.1 + Math.random() * 1.7,
            state: 'runner',
            side,
            swirl: (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 5),
            tint: Math.random()
          });
        }
      }
    }

    // Spawn exhaust gas.
    if (sim.particlesOn.exhaust && running && geo.cyl.exhaustLift > 0.03) {
      fx.accE += dt * (7 + dens * 56) * (0.3 + sim.load / 100) * geo.cyl.exhaustLift;
      const max = 9 + Math.round(dens * 10);
      while (fx.accE >= 1) {
        fx.accE -= 1;
        if (fx.exhaust.length < max) {
          fx.exhaust.push({
            x: (Math.random() - 0.5) * geo.bore * 0.45,
            y: geo.deckY + 6 + Math.random() * Math.max(3, geo.chamberH * 0.7),
            px: 0, py: 0,
            vx: geo.exhaustDir * (18 + Math.random() * 26),
            vy: -12 - Math.random() * 24,
            age: 0, life: 0.75 + Math.random() * 0.6,
            size: 1.2 + Math.random() * 2,
            state: 'chamber',
            side: geo.exhaustDir,
            swirl: 0,
            tint: Math.random()
          });
        }
      }
    }

    // Spawn combustion flame.
    if (sim.particlesOn.combustion && geo.cyl.combustion > 0.12) {
      fx.accB += dt * (20 + dens * 120) * geo.cyl.combustion;
      const max = 12 + Math.round(dens * 14);
      while (fx.accB >= 1) {
        fx.accB -= 1;
        if (fx.burn.length < max) {
          fx.burn.push({
            x: (Math.random() - 0.5) * geo.bore * 0.38,
            y: geo.deckY + 3 + Math.random() * Math.max(4, geo.chamberH * 0.55),
            px: 0, py: 0,
            vx: (Math.random() - 0.5) * 90,
            vy: 12 + Math.random() * 70,
            age: 0, life: 0.3 + Math.random() * 0.42,
            size: 1.4 + Math.random() * 2.6,
            state: 'burn',
            side: 0,
            swirl: (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 8),
            tint: Math.random()
          });
        }
      }
    }

    const updateList = (list, kind) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const q = list[i];
        q.age += dt;
        q.px = q.x;
        q.py = q.y;
        if (kind === 'intake') {
          const seatX = geo.intakeDir * geo.bore * 0.27;
          if (q.state === 'runner') {
            const dx = seatX - q.x;
            const dy = geo.deckY - q.y;
            const dist = Math.hypot(dx, dy) || 1;
            q.vx += (dx / dist) * 300 * dt;
            q.vy += (dy / dist) * 300 * dt;
            q.vx *= 1 - 2.4 * dt;
            q.vy *= 1 - 2.4 * dt;
            if (dist < 8 || q.age > 0.42) {
              q.state = 'chamber';
              q.x = seatX * 0.85;
              q.y = geo.deckY + 4;
              q.vx = geo.intakeDir * -10;
              q.vy = 44;
              q.age = Math.min(q.age, 0.2);
            }
          } else {
            const dx = q.x - 0;
            const dy = q.y - chamberMid;
            q.vx += -dy * q.swirl * dt;
            q.vy += dx * q.swirl * dt;
            q.vx += (Math.random() - 0.5) * 90 * turb * dt;
            q.vy += (Math.random() - 0.5) * 90 * turb * dt;
            q.vx *= 1 - 1.7 * dt;
            q.vy *= 1 - 1.7 * dt;
            const xMax = geo.bore * 0.46;
            const yTop = geo.deckY + 2;
            const yBot = geo.pistonTop - 2;
            if (q.x > xMax) { q.x = xMax; q.vx *= -0.4; }
            if (q.x < -xMax) { q.x = -xMax; q.vx *= -0.4; }
            if (q.y < yTop) { q.y = yTop; q.vy *= -0.4; }
            if (q.y > yBot) { q.y = yBot; q.vy *= -0.4; }
          }
        } else if (kind === 'exhaust') {
          const seatX = geo.exhaustDir * geo.bore * 0.27;
          const portX = geo.exhaustDir * (geo.headW * 0.72);
          const portY = geo.deckY - geo.headH * 0.34;
          if (q.state === 'chamber') {
            const dx = seatX - q.x;
            const dy = geo.deckY - q.y;
            const dist = Math.hypot(dx, dy) || 1;
            q.vx += (dx / dist) * 360 * dt;
            q.vy += (dy / dist) * 360 * dt;
            q.vx *= 1 - 2.3 * dt;
            q.vy *= 1 - 2.3 * dt;
            if (dist < 9) {
              q.state = 'port';
              q.x = seatX;
              q.y = geo.deckY - 3;
              q.vx = geo.exhaustDir * 90;
              q.vy = -18;
            }
          } else if (q.state === 'port') {
            const dx = portX - q.x;
            const dy = portY - q.y;
            const dist = Math.hypot(dx, dy) || 1;
            q.vx += (dx / dist) * 300 * dt;
            q.vy += (dy / dist) * 300 * dt;
            q.vx *= 1 - 2.6 * dt;
            q.vy *= 1 - 2.6 * dt;
            if (dist < 10) q.state = 'out';
          } else {
            q.vx += geo.exhaustDir * 80 * dt;
            q.vy -= 24 * dt;
            q.vx *= 1 - 1.1 * dt;
            q.vy *= 1 - 1.1 * dt;
          }
          q.vx += (Math.random() - 0.5) * 100 * turb * dt;
          q.vy += (Math.random() - 0.5) * 100 * turb * dt;
        } else {
          const dx = q.x - 0;
          const dy = q.y - chamberMid;
          q.vx += -dy * q.swirl * dt;
          q.vy += dx * q.swirl * dt;
          q.vx += (Math.random() - 0.5) * 140 * turb * dt;
          q.vy += (Math.random() - 0.5) * 140 * turb * dt;
          q.vx *= 1 - 2.1 * dt;
          q.vy *= 1 - 2.1 * dt;
          const xMax = geo.bore * 0.47;
          const yTop = geo.deckY + 1;
          const yBot = geo.pistonTop - 1;
          if (q.x > xMax) { q.x = xMax; q.vx *= -0.35; }
          if (q.x < -xMax) { q.x = -xMax; q.vx *= -0.35; }
          if (q.y < yTop) { q.y = yTop; q.vy *= -0.35; }
          if (q.y > yBot) { q.y = yBot; q.vy *= -0.35; }
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.age > q.life) list.splice(i, 1);
      }
    };

    updateList(fx.intake, 'intake');
    updateList(fx.exhaust, 'exhaust');
    updateList(fx.burn, 'burn');
  }

  draw(now) {
    const ctx = this.ctx;
    if (!this.w || !this.h) this.resize();
    if (!this.w || !this.h) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = clamp(dt, 0.001, 0.05);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.6) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    const geo = this.computeGeometry();
    const order = geo.isVee
      ? [...geo.geos].sort((a, b) => a.bank - b.bank)
      : geo.geos;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBackground(geo, dt);
    this.drawBlock(geo);
    for (const g of order) this.drawCylinderBody(g);
    this.drawCrankshaft(geo);
    for (const g of order) this.drawRod(g);
    for (const g of order) this.drawPiston(g);
    for (const g of order) this.drawHead(g);
    for (const g of order) {
      this.updateFx(g, dt);
      this.drawChamberGlow(g);
    }
    for (const g of order) this.drawPorts(g);
    for (const g of order) this.drawFx(g);
    for (const g of order) this.drawLabels(g);
    this.drawForeground(geo);
  }

  drawBackground(geo, dt) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    const base = ctx.createRadialGradient(w * 0.5, h * 0.38, 10, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
    base.addColorStop(0, 'rgba(12, 52, 94, .22)');
    base.addColorStop(0.45, 'rgba(6, 24, 47, .08)');
    base.addColorStop(1, 'rgba(2, 7, 16, 0)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Fine blueprint grid.
    ctx.save();
    ctx.strokeStyle = 'rgba(90, 160, 220, .05)';
    ctx.lineWidth = 1;
    const step = 38;
    const offX = (this.sim.time * 2) % step;
    for (let x = -step + offX; x < w + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Concentric targeting rings behind the engine.
    ctx.save();
    ctx.translate(w * 0.5, h * 0.44);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 90 + i * 72, 0, TAU);
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.035 - i * 0.006})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // Ambient dust.
    ctx.save();
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < -0.03) { d.y = 1.03; d.x = Math.random(); }
      if (d.x < -0.03) d.x = 1.03;
      if (d.x > 1.03) d.x = -0.03;
      const x = d.x * w;
      const y = d.y * h;
      const tw = 0.6 + 0.4 * Math.sin(this.sim.time * 1.7 + d.p);
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, TAU);
      ctx.fillStyle = `rgba(125, 211, 252, ${d.a * tw})`;
      ctx.fill();
    }
    ctx.restore();

    // Crankcase glow line.
    const glow = ctx.createLinearGradient(0, geo.crankY, w, geo.crankY);
    glow.addColorStop(0, 'rgba(56, 189, 248, 0)');
    glow.addColorStop(0.5, 'rgba(56, 189, 248, .18)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.strokeStyle = glow;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, geo.crankY);
    ctx.lineTo(w, geo.crankY);
    ctx.stroke();
  }

  drawBlock(geo) {
    const ctx = this.ctx;
    const { blockX0, blockX1, blockTop, blockBottom, crankY, isVee } = geo;
    const w = blockX1 - blockX0;
    const h = blockBottom - blockTop;

    // Outer housing shadow (cheap offset, no blur).
    ctx.save();
    rr(ctx, blockX0, blockTop + 10, w, h, 18);
    ctx.fillStyle = 'rgba(0, 0, 0, .34)';
    ctx.fill();
    ctx.restore();

    rr(ctx, blockX0, blockTop, w, h, 18);
    const bodyGrad = ctx.createLinearGradient(blockX0, blockTop, blockX1, blockBottom);
    bodyGrad.addColorStop(0, 'rgba(15, 37, 63, .78)');
    bodyGrad.addColorStop(0.28, 'rgba(8, 24, 45, .82)');
    bodyGrad.addColorStop(0.72, 'rgba(6, 18, 35, .9)');
    bodyGrad.addColorStop(1, 'rgba(3, 10, 22, .94)');
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Top and bottom rims.
    ctx.save();
    rr(ctx, blockX0, blockTop, w, h, 18);
    ctx.strokeStyle = 'rgba(96, 165, 250, .2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(125, 211, 252, .08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(blockX0 + 14, blockTop + 1.5);
    ctx.lineTo(blockX1 - 14, blockTop + 1.5);
    ctx.stroke();
    ctx.restore();

    // Block ribs / seams.
    ctx.save();
    for (let i = 0; i <= geo.units; i++) {
      const x = geo.marginX + geo.spacing * i;
      ctx.beginPath();
      ctx.moveTo(x, blockTop + 14);
      ctx.lineTo(x, blockBottom - 10);
      ctx.strokeStyle = 'rgba(104, 174, 235, .06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // horizontal machining lines
    for (let y = blockTop + 26; y < blockBottom - 16; y += 22) {
      ctx.beginPath();
      ctx.moveTo(blockX0 + 10, y);
      ctx.lineTo(blockX1 - 10, y);
      ctx.strokeStyle = 'rgba(104, 174, 235, .028)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // Crankcase aperture.
    ctx.save();
    const caseTop = crankY - geo.strokePx * 0.58;
    const caseH = blockBottom - caseTop - 14;
    rr(ctx, blockX0 + 16, caseTop, w - 32, caseH, 12);
    const caseGrad = ctx.createLinearGradient(0, caseTop, 0, blockBottom);
    caseGrad.addColorStop(0, 'rgba(2, 8, 18, .82)');
    caseGrad.addColorStop(0.55, 'rgba(4, 14, 28, .9)');
    caseGrad.addColorStop(1, 'rgba(8, 22, 40, .85)');
    ctx.fillStyle = caseGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, .1)';
    ctx.stroke();
    ctx.restore();

    // Oil pan glow.
    const panTop = blockBottom - 22;
    ctx.save();
    rr(ctx, blockX0 + 34, panTop, w - 68, 18, 8);
    const oil = ctx.createLinearGradient(0, panTop, 0, panTop + 18);
    oil.addColorStop(0, 'rgba(251, 146, 60, .03)');
    oil.addColorStop(0.5, 'rgba(251, 191, 36, .1)');
    oil.addColorStop(1, 'rgba(251, 146, 60, .02)');
    ctx.fillStyle = oil;
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, .1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Bolts along the top and bottom rails.
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const x = blockX0 + 22 + (w - 44) * (i / 8);
      this.drawBolt(x, blockTop + 9, 2.6);
      this.drawBolt(x, blockBottom - 8, 2.6);
    }
    ctx.restore();

    // Embossed block marking.
    ctx.save();
    ctx.font = '600 7px "DejaVu Sans Mono", monospace';
    ctx.fillStyle = 'rgba(125, 211, 252, .18)';
    ctx.textAlign = 'center';
    ctx.fillText('APEX // DYNO', this.w / 2, blockBottom - 11);
    ctx.restore();

    // V-valley highlight.
    if (isVee) {
      ctx.save();
      const grad = ctx.createLinearGradient(0, blockTop, 0, crankY);
      grad.addColorStop(0, 'rgba(56, 189, 248, .05)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(blockX0 + 30, blockTop + 4);
      ctx.lineTo(this.w / 2, crankY - 30);
      ctx.lineTo(blockX1 - 30, blockTop + 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawBolt(x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(125, 155, 180, .35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(210, 235, 250, .25)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y);
    ctx.lineTo(x + r * 0.6, y);
    ctx.strokeStyle = 'rgba(2, 8, 18, .5)';
    ctx.stroke();
  }

  drawCylinderBody(g) {
    const ctx = this.ctx;
    const { bore, deckY, bottomY, headW } = g;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    // Outer water jacket / liner.
    rr(ctx, -bore / 2 - 7, deckY - 2, bore + 14, bottomY - deckY + 4, 7);
    const jacket = ctx.createLinearGradient(-bore / 2 - 7, 0, bore / 2 + 7, 0);
    jacket.addColorStop(0, 'rgba(11, 32, 57, .82)');
    jacket.addColorStop(0.5, 'rgba(17, 44, 75, .55)');
    jacket.addColorStop(1, 'rgba(8, 24, 44, .82)');
    ctx.fillStyle = jacket;
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, .18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cooling fins.
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 211, 252, .09)';
    ctx.lineWidth = 1;
    for (let y = deckY + 28; y < bottomY - 8; y += 13) {
      ctx.beginPath();
      ctx.moveTo(-bore / 2 - 15, y);
      ctx.lineTo(-bore / 2 - 8, y);
      ctx.moveTo(bore / 2 + 8, y);
      ctx.lineTo(bore / 2 + 15, y);
      ctx.stroke();
    }
    ctx.restore();

    // Inner bore.
    rr(ctx, -bore / 2, deckY, bore, bottomY - deckY, 5);
    const boreGrad = ctx.createLinearGradient(-bore / 2, 0, bore / 2, 0);
    boreGrad.addColorStop(0, 'rgba(1, 6, 14, .98)');
    boreGrad.addColorStop(0.16, 'rgba(5, 17, 32, .98)');
    boreGrad.addColorStop(0.5, 'rgba(2, 9, 19, .96)');
    boreGrad.addColorStop(0.84, 'rgba(5, 17, 32, .98)');
    boreGrad.addColorStop(1, 'rgba(1, 6, 14, .98)');
    ctx.fillStyle = boreGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 211, 252, .2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cylinder wall highlight.
    ctx.beginPath();
    ctx.moveTo(-bore / 2 + 2, deckY + 3);
    ctx.lineTo(-bore / 2 + 2, bottomY - 3);
    ctx.strokeStyle = 'rgba(125, 211, 252, .08)';
    ctx.stroke();

    // Head deck plate.
    rr(ctx, -headW / 2, deckY - 4, headW, 8, 3);
    ctx.fillStyle = metallic(ctx, -headW / 2, 0, headW / 2, 0, 0.72);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 220, 245, .25)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  drawCrankshaft(geo) {
    const ctx = this.ctx;
    const { crankY, blockX0, blockX1 } = geo;
    const x0 = blockX0 + 18;
    const x1 = blockX1 - 18;

    // Main shaft.
    ctx.save();
    const shaft = ctx.createLinearGradient(0, crankY - 8, 0, crankY + 8);
    shaft.addColorStop(0, 'rgba(170, 200, 220, .85)');
    shaft.addColorStop(0.28, 'rgba(232, 246, 255, .96)');
    shaft.addColorStop(0.55, 'rgba(104, 134, 158, .9)');
    shaft.addColorStop(1, 'rgba(48, 72, 96, .9)');
    rr(ctx, x0, crankY - 6, x1 - x0, 12, 6);
    ctx.fillStyle = shaft;
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 230, 250, .24)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // Main journals + throws.
    const seen = new Set();
    for (const g of geo.geos) {
      const key = geo.isVee ? g.cyl.pair : g.cyl.index;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.save();
      ctx.translate(g.cx, crankY);
      ctx.rotate(g.theta * DEG);

      // Counterweight — rounded web mass opposite the pin.
      ctx.beginPath();
      ctx.moveTo(-g.r * 0.14, 0);
      ctx.lineTo(-g.r * 0.38, g.r * 0.34);
      ctx.quadraticCurveTo(-g.r * 0.52, g.r * 0.72, 0, g.r * 0.72);
      ctx.quadraticCurveTo(g.r * 0.52, g.r * 0.72, g.r * 0.38, g.r * 0.34);
      ctx.lineTo(g.r * 0.14, 0);
      ctx.closePath();
      const cw = ctx.createLinearGradient(-g.r * 0.5, 0, g.r * 0.5, g.r * 0.72);
      cw.addColorStop(0, 'rgba(36, 56, 76, .98)');
      cw.addColorStop(0.42, 'rgba(82, 108, 130, .96)');
      cw.addColorStop(0.7, 'rgba(142, 170, 190, .92)');
      cw.addColorStop(1, 'rgba(28, 46, 66, .98)');
      ctx.fillStyle = cw;
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 210, 240, .26)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Machined lightening hole.
      ctx.beginPath();
      ctx.arc(0, g.r * 0.46, g.r * 0.11, 0, TAU);
      ctx.fillStyle = 'rgba(6, 18, 32, .7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(210, 238, 250, .18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // Machined highlight.
      ctx.beginPath();
      ctx.moveTo(-g.r * 0.28, g.r * 0.36);
      ctx.quadraticCurveTo(0, g.r * 0.58, g.r * 0.28, g.r * 0.36);
      ctx.strokeStyle = 'rgba(225, 248, 255, .16)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Web from center to pin.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -g.r);
      ctx.strokeStyle = 'rgba(142, 176, 198, .9)';
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230, 245, 255, .35)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Main journal.
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, TAU);
      ctx.fillStyle = metallic(ctx, -10, -10, 10, 10, 0.92);
      ctx.fill();
      ctx.strokeStyle = 'rgba(210, 240, 255, .35)';
      ctx.stroke();

      // Crank pin.
      const pinY = -g.r;
      const pinGlow = ctx.createRadialGradient(0, pinY, 1, 0, pinY, 15);
      pinGlow.addColorStop(0, 'rgba(125, 211, 252, .5)');
      pinGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = pinGlow;
      ctx.beginPath();
      ctx.arc(0, pinY, 15, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, pinY, 8, 0, TAU);
      ctx.fillStyle = metallic(ctx, -8, pinY - 8, 8, pinY + 8, 0.9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220, 245, 255, .45)';
      ctx.stroke();

      ctx.restore();
    }

    // End caps.
    ctx.save();
    for (const x of [x0, x1]) {
      ctx.beginPath();
      ctx.arc(x, crankY, 9, 0, TAU);
      ctx.fillStyle = metallic(ctx, x - 9, crankY - 9, x + 9, crankY + 9, 0.7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190, 225, 245, .3)';
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRod(g) {
    const ctx = this.ctx;
    const px = g.rodPin.x;
    const py = g.rodPin.y;
    const sx = 0;
    const sy = g.pinY;
    const dx = sx - px;
    const dy = sy - py;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const wBig = Math.max(5, g.bore * 0.075);
    const wSmall = Math.max(3.4, g.bore * 0.048);

    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    // Rod shadow.
    ctx.beginPath();
    ctx.moveTo(px + nx * wBig, py + ny * wBig);
    ctx.lineTo(sx + nx * wSmall, sy + ny * wSmall);
    ctx.lineTo(sx - nx * wSmall, sy - ny * wSmall);
    ctx.lineTo(px - nx * wBig, py - ny * wBig);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, .45)';
    ctx.fill();

    // Rod body.
    ctx.beginPath();
    ctx.moveTo(px + nx * wBig, py + ny * wBig);
    ctx.lineTo(sx + nx * wSmall, sy + ny * wSmall);
    ctx.lineTo(sx - nx * wSmall, sy - ny * wSmall);
    ctx.lineTo(px - nx * wBig, py - ny * wBig);
    ctx.closePath();
    const rodGrad = ctx.createLinearGradient(px, py, sx, sy);
    rodGrad.addColorStop(0, 'rgba(74, 98, 120, .98)');
    rodGrad.addColorStop(0.25, 'rgba(188, 214, 232, .98)');
    rodGrad.addColorStop(0.5, 'rgba(118, 146, 168, .98)');
    rodGrad.addColorStop(0.76, 'rgba(214, 235, 248, .98)');
    rodGrad.addColorStop(1, 'rgba(82, 108, 130, .98)');
    ctx.fillStyle = rodGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .22)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // I-beam center line.
    ctx.beginPath();
    ctx.moveTo(px + nx * 1.2, py + ny * 1.2);
    ctx.lineTo(sx + nx * 0.7, sy + ny * 0.7);
    ctx.strokeStyle = 'rgba(20, 38, 56, .55)';
    ctx.lineWidth = Math.max(1.2, g.bore * 0.018);
    ctx.stroke();

    // Big end.
    ctx.beginPath();
    ctx.arc(px, py, wBig + 2.4, 0, TAU);
    ctx.fillStyle = metallic(ctx, px - wBig, py - wBig, px + wBig, py + wBig, 0.78);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210, 240, 255, .3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, wBig * 0.45, 0, TAU);
    ctx.fillStyle = 'rgba(3, 11, 22, .85)';
    ctx.fill();

    // Small end.
    ctx.beginPath();
    ctx.arc(sx, sy, wSmall + 1.6, 0, TAU);
    ctx.fillStyle = metallic(ctx, sx - wSmall, sy - wSmall, sx + wSmall, sy + wSmall, 0.85);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, wSmall * 0.48, 0, TAU);
    ctx.fillStyle = 'rgba(3, 11, 22, .85)';
    ctx.fill();

    ctx.restore();
  }

  drawPiston(g) {
    const ctx = this.ctx;
    const slap = this.sim.pistonSlap;
    const jitter = Math.sin(this.sim.time * 92 + g.cyl.index * 2.2) * slap * 1.6;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);
    ctx.translate(jitter, g.pinY);

    const bw = g.bore - 3;
    const bh = g.pistonH;
    const left = -bw / 2;
    const top = -bh / 2;

    // Piston shadow (cheap offset).
    rr(ctx, left + 2, top + 3, bw, bh, 3.5);
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    ctx.fill();

    // Piston body.
    rr(ctx, left, top, bw, bh, 3.5);
    const grad = ctx.createLinearGradient(left, 0, left + bw, 0);
    grad.addColorStop(0, '#3a5068');
    grad.addColorStop(0.16, '#a9c2d4');
    grad.addColorStop(0.34, '#eef9ff');
    grad.addColorStop(0.52, '#a5bfd2');
    grad.addColorStop(0.7, '#d8eaf6');
    grad.addColorStop(0.86, '#7d99ae');
    grad.addColorStop(1, '#2d435a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(225, 246, 255, .5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Crown highlight / heat tint.
    const heat = g.cyl.combustion;
    ctx.beginPath();
    ctx.moveTo(left + 2, top + 2.5);
    ctx.lineTo(left + bw - 2, top + 2.5);
    ctx.strokeStyle = heat > 0.04
      ? `rgba(255, 190, 96, ${0.5 + heat * 0.5})`
      : 'rgba(210, 240, 255, .55)';
    ctx.lineWidth = heat > 0.04 ? 1.8 : 1;
    ctx.stroke();
    if (heat > 0.04) {
      ctx.strokeStyle = `rgba(255, 200, 120, ${heat * 0.8})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(left + 2, top + 1.6);
      ctx.lineTo(left + bw - 2, top + 1.6);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 248, 220, ${heat * 0.7})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Rings.
    for (let i = 0; i < 3; i++) {
      const y = top + 4 + i * 3.2;
      ctx.beginPath();
      ctx.moveTo(left + 2, y);
      ctx.lineTo(left + bw - 2, y);
      ctx.strokeStyle = 'rgba(14, 30, 46, .62)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(left + 2, y + 0.7);
      ctx.lineTo(left + bw - 2, y + 0.7);
      ctx.strokeStyle = 'rgba(235, 248, 255, .22)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // Skirt reliefs.
    ctx.beginPath();
    rr(ctx, left + 3, top + bh * 0.58, bw * 0.2, bh * 0.34, 2);
    ctx.fillStyle = 'rgba(9, 24, 40, .5)';
    ctx.fill();
    ctx.beginPath();
    rr(ctx, left + bw - 3 - bw * 0.2, top + bh * 0.58, bw * 0.2, bh * 0.34, 2);
    ctx.fillStyle = 'rgba(9, 24, 40, .5)';
    ctx.fill();

    // Wrist pin.
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2.2, bh * 0.13), 0, TAU);
    ctx.fillStyle = metallic(ctx, -bh * 0.13, -bh * 0.13, bh * 0.13, bh * 0.13, 0.7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 42, 62, .8)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, bh * 0.055), 0, TAU);
    ctx.fillStyle = 'rgba(2, 8, 16, .85)';
    ctx.fill();

    ctx.restore();
  }

  drawHead(g) {
    const ctx = this.ctx;
    const { headW, headH, headTop, deckY, bore } = g;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    // Head shell.
    rr(ctx, -headW / 2, headTop, headW, headH, 7);
    const shell = ctx.createLinearGradient(-headW / 2, headTop, headW / 2, deckY);
    shell.addColorStop(0, 'rgba(30, 63, 98, .98)');
    shell.addColorStop(0.35, 'rgba(17, 43, 73, .98)');
    shell.addColorStop(0.7, 'rgba(24, 55, 89, .97)');
    shell.addColorStop(1, 'rgba(9, 26, 47, .98)');
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 211, 252, .3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Head top highlight.
    ctx.beginPath();
    ctx.moveTo(-headW / 2 + 7, headTop + 1.6);
    ctx.lineTo(headW / 2 - 7, headTop + 1.6);
    ctx.strokeStyle = 'rgba(190, 230, 255, .32)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cam cover rail.
    rr(ctx, -headW / 2 + 4, headTop + 3, headW - 8, 7, 3);
    const cover = ctx.createLinearGradient(0, headTop + 3, 0, headTop + 10);
    cover.addColorStop(0, 'rgba(112, 146, 172, .92)');
    cover.addColorStop(0.4, 'rgba(204, 228, 242, .95)');
    cover.addColorStop(1, 'rgba(54, 82, 108, .92)');
    ctx.fillStyle = cover;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .3)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Cutaway window.
    const winX = -headW / 2 + 7;
    const winY = headTop + 11;
    const winW = headW - 14;
    const winH = headH - 19;
    rr(ctx, winX, winY, winW, winH, 4);
    const win = ctx.createLinearGradient(0, winY, 0, winY + winH);
    win.addColorStop(0, 'rgba(4, 14, 28, .92)');
    win.addColorStop(0.5, 'rgba(9, 27, 49, .86)');
    win.addColorStop(1, 'rgba(2, 8, 18, .94)');
    ctx.fillStyle = win;
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, .2)';
    ctx.stroke();

    // Camshafts.
    const camR = Math.max(4.4, bore * 0.072);
    this.drawCam(-bore * 0.26, g.camY, camR, g.camAngle, '#a8e2ff');
    this.drawCam(bore * 0.26, g.camY, camR, g.camAngle + Math.PI, '#ffd9a8');

    // Cam bearing caps.
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 211, 252, .22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-headW / 2 + 12, g.camY - camR - 4);
    ctx.lineTo(headW / 2 - 12, g.camY - camR - 4);
    ctx.stroke();
    ctx.restore();

    // Valve seats.
    const seat = bore * 0.28;
    const seatGlow = (x, color) => {
      ctx.beginPath();
      ctx.ellipse(x, deckY, Math.max(5, bore * 0.085), Math.max(1.8, bore * 0.03), 0, 0, TAU);
      ctx.fillStyle = color;
      ctx.fill();
    };
    seatGlow(-seat, 'rgba(56, 189, 248, .24)');
    seatGlow(seat, 'rgba(251, 146, 60, .24)');

    // Valves.
    const maxLift = Math.max(6, bore * 0.14);
    this.drawValve(-seat, deckY, -0.2, g.cyl.intakeLift * maxLift, headH, true);
    this.drawValve(seat, deckY, 0.2, g.cyl.exhaustLift * maxLift, headH, false);

    // Springs.
    this.drawSpring(-seat + 1, deckY - headH * 0.16, deckY - headH * 0.56, 5.2, 5, g.cyl.intakeLift);
    this.drawSpring(seat - 1, deckY - headH * 0.16, deckY - headH * 0.56, 5.2, 5, g.cyl.exhaustLift);

    // Spark plug.
    this.drawSparkPlug(g);

    // Head bolts.
    for (const [x, y] of [[-headW / 2 + 5, headTop + 5], [headW / 2 - 5, headTop + 5], [-headW / 2 + 5, deckY - 5], [headW / 2 - 5, deckY - 5]]) {
      this.drawBolt(x, y, 1.8);
    }

    ctx.restore();
  }

  drawCam(x, y, r, angle, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Lobe.
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.72, r * 0.66, r * 1.25, 0, 0, TAU);
    const lobe = ctx.createLinearGradient(-r, -r, r, r);
    lobe.addColorStop(0, 'rgba(58, 88, 112, .98)');
    lobe.addColorStop(0.45, color);
    lobe.addColorStop(1, 'rgba(42, 68, 92, .98)');
    ctx.fillStyle = lobe;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .3)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // Base circle.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = metallic(ctx, -r, -r, r, r, 0.78);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .25)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, TAU);
    ctx.fillStyle = 'rgba(4, 14, 27, .8)';
    ctx.fill();
    ctx.restore();
  }

  drawValve(x, y, angle, lift, headH, intake) {
    const ctx = this.ctx;
    const stemLen = headH * 0.64;
    ctx.save();
    ctx.translate(x, y + lift);
    ctx.rotate(angle);

    // Valve head.
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(5.5, headH * 0.12), Math.max(1.8, headH * 0.04), 0, 0, TAU);
    const vg = ctx.createLinearGradient(-8, -3, 8, 3);
    vg.addColorStop(0, 'rgba(66, 92, 116, .98)');
    vg.addColorStop(0.45, 'rgba(235, 248, 255, .98)');
    vg.addColorStop(1, 'rgba(64, 88, 110, .98)');
    ctx.fillStyle = vg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 248, 255, .4)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Stem.
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -stemLen);
    ctx.strokeStyle = intake ? 'rgba(125, 211, 252, .8)' : 'rgba(251, 191, 146, .8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240, 250, 255, .35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Retainer and follower.
    ctx.beginPath();
    ctx.moveTo(-3.8, -stemLen + 2);
    ctx.lineTo(3.8, -stemLen + 2);
    ctx.strokeStyle = 'rgba(190, 220, 240, .65)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -stemLen, 2.6, 0, TAU);
    ctx.fillStyle = metallic(ctx, -3, -stemLen - 3, 3, -stemLen + 3, 0.82);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .3)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.restore();
  }

  drawSpring(x, yTop, yBottom, width, coils, lift) {
    const ctx = this.ctx;
    const bottom = yBottom + lift * 3.5;
    ctx.save();
    ctx.beginPath();
    const steps = coils * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = yTop + (bottom - yTop) * t;
      const px = x + (i % 2 === 0 ? -width : width) * (i === 0 || i === steps ? 0.3 : 1);
      if (i === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.strokeStyle = 'rgba(150, 185, 208, .45)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  }

  drawSparkPlug(g) {
    const ctx = this.ctx;
    const { deckY, headH } = g;
    const top = deckY - headH * 0.6;
    const bottom = deckY + 2;
    ctx.save();
    // Ceramic insulator.
    rr(ctx, -4, top, 8, Math.max(5, (bottom - top) * 0.38), 2);
    const ceramic = ctx.createLinearGradient(-4, 0, 4, 0);
    ceramic.addColorStop(0, 'rgba(182, 208, 224, .95)');
    ceramic.addColorStop(0.45, 'rgba(246, 253, 255, .98)');
    ceramic.addColorStop(1, 'rgba(158, 186, 204, .95)');
    ctx.fillStyle = ceramic;
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 250, 255, .35)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Metal body.
    rr(ctx, -3.5, top + Math.max(5, (bottom - top) * 0.38), 7, Math.max(4, (bottom - top) * 0.62) - 4, 1.5);
    const body = ctx.createLinearGradient(-3.5, 0, 3.5, 0);
    body.addColorStop(0, 'rgba(70, 94, 116, .95)');
    body.addColorStop(0.5, 'rgba(220, 238, 248, .98)');
    body.addColorStop(1, 'rgba(62, 84, 104, .95)');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, .28)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Threads.
    for (let y = deckY - 11; y < deckY; y += 2.4) {
      ctx.beginPath();
      ctx.moveTo(-3.5, y);
      ctx.lineTo(3.5, y);
      ctx.strokeStyle = 'rgba(20, 42, 62, .45)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    // Electrode.
    ctx.beginPath();
    ctx.moveTo(0, deckY);
    ctx.lineTo(0, deckY + 6);
    ctx.strokeStyle = 'rgba(220, 240, 255, .75)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Spark.
    if (g.cyl.spark > 0.01) {
      const s = g.cyl.spark;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, deckY + 5, 1, 0, deckY + 5, 22 * s + 6);
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * s})`);
      glow.addColorStop(0.28, `rgba(190, 240, 255, ${0.7 * s})`);
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, deckY + 5, 22 * s + 6, 0, TAU);
      ctx.fill();
      // Arc.
      ctx.strokeStyle = `rgba(230, 250, 255, ${0.85 * s})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, deckY + 4);
      const n = 4;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        ctx.lineTo(Math.sin(this.sim.time * 60 + i * 7) * 7 * t, deckY + 4 + t * 15);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawChamberGlow(g) {
    const ctx = this.ctx;
    const { deckY, pistonTop, bore, chamberH } = g;
    const heat = g.cyl.combustion;
    const intake = g.cyl.intakeLift;
    const exhaust = g.cyl.exhaustLift;
    const sim = this.sim;
    if (!sim.particlesOn.thermal && !sim.particlesOn.intake && !sim.particlesOn.exhaust && heat < 0.02) return;

    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    // Clip to chamber.
    ctx.beginPath();
    rr(ctx, -bore / 2 + 1, deckY + 1, bore - 2, Math.max(2, chamberH - 2), 3);
    ctx.clip();

    if (heat > 0.015 && sim.particlesOn.thermal) {
      const flicker = 0.78 + 0.22 * Math.sin(sim.time * 43 + g.cyl.index * 2.4);
      const cx = 0;
      const cy = deckY + Math.min(chamberH * 0.38, 16);
      const rad = Math.max(bore * 0.7, chamberH * 1.4);
      const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, rad);
      glow.addColorStop(0, `rgba(255, 248, 210, ${0.7 * heat * flicker})`);
      glow.addColorStop(0.18, `rgba(255, 196, 92, ${0.52 * heat * flicker})`);
      glow.addColorStop(0.5, `rgba(251, 146, 60, ${0.24 * heat * flicker})`);
      glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-bore / 2, deckY, bore, Math.max(3, chamberH));
      // Flame core.
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, bore * 0.12 * heat), 0, TAU);
      ctx.fillStyle = `rgba(255, 255, 235, ${0.6 * heat})`;
      ctx.fill();
    }

    if (intake > 0.04 && sim.particlesOn.intake) {
      const side = g.intakeDir;
      const ix = side * bore * 0.22;
      const glow = ctx.createRadialGradient(ix, deckY + 5, 1, ix, deckY + 5, bore * 0.62);
      glow.addColorStop(0, `rgba(125, 211, 252, ${0.28 * intake})`);
      glow.addColorStop(0.55, `rgba(56, 189, 248, ${0.11 * intake})`);
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-bore / 2, deckY, bore, Math.max(4, chamberH));
    }

    if (exhaust > 0.04 && sim.particlesOn.exhaust) {
      const side = g.exhaustDir;
      const ex = side * bore * 0.22;
      const glow = ctx.createRadialGradient(ex, deckY + 5, 1, ex, deckY + 5, bore * 0.5);
      glow.addColorStop(0, `rgba(251, 146, 60, ${0.3 * exhaust})`);
      glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-bore / 2, deckY, bore, Math.max(4, chamberH));
    }

    ctx.restore();
  }

  drawPorts(g) {
    const ctx = this.ctx;
    const { headW, headH, deckY, bore } = g;
    const sim = this.sim;
    // The far bank is a recessed cutaway layer; keep its port stubs out of
    // the way so the near bank reads cleanly.
    if (g.isVee && g.cyl.bank < 0) return;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    const y = deckY - headH * 0.34;
    const intakeX = g.intakeDir * (headW / 2);
    const exhaustX = g.exhaustDir * (headW / 2);
    const len = Math.max(10, headW * (g.isVee ? 0.13 : 0.2));

    // Intake runner.
    this.drawPortTube(intakeX, y, g.intakeDir, len, 'intake', g.cyl.intakeLift, sim.particlesOn.intake, !g.isVee);
    // Exhaust header stub.
    this.drawPortTube(exhaustX, y, g.exhaustDir, len, 'exhaust', g.cyl.exhaustLift, sim.particlesOn.exhaust, true);

    ctx.restore();
  }

  drawPortTube(x, y, dir, len, kind, flow, enabled, showLabel = true) {
    const ctx = this.ctx;
    const h = 11;
    const x0 = dir > 0 ? x : x - len;
    const grad = ctx.createLinearGradient(x0, 0, x0 + len, 0);
    if (kind === 'intake') {
      grad.addColorStop(0, 'rgba(18, 49, 80, .95)');
      grad.addColorStop(0.5, 'rgba(20, 74, 118, .95)');
      grad.addColorStop(1, 'rgba(10, 35, 62, .95)');
    } else {
      grad.addColorStop(0, 'rgba(66, 30, 22, .95)');
      grad.addColorStop(0.5, 'rgba(105, 45, 28, .95)');
      grad.addColorStop(1, 'rgba(48, 22, 18, .95)');
    }
    ctx.save();
    rr(ctx, x0, y - h / 2, len, h, 5);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = kind === 'intake' ? 'rgba(56, 189, 248, .24)' : 'rgba(251, 146, 60, .26)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Lip.
    ctx.beginPath();
    ctx.moveTo(x + dir * 1, y - h / 2 - 2);
    ctx.lineTo(x + dir * 1, y + h / 2 + 2);
    ctx.strokeStyle = kind === 'intake' ? 'rgba(125, 211, 252, .4)' : 'rgba(253, 186, 116, .4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Flow glow.
    if (enabled && flow > 0.04) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(x + dir * len * 0.4, y, 1, x + dir * len * 0.4, y, len * 0.9);
      if (kind === 'intake') {
        glow.addColorStop(0, `rgba(56, 189, 248, ${0.3 * flow})`);
        glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      } else {
        glow.addColorStop(0, `rgba(251, 146, 60, ${0.4 * flow})`);
        glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
      }
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + dir * len * 0.4, y, len * 0.9, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // Port label.
    if (showLabel) {
      ctx.font = '600 5.5px "DejaVu Sans Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = kind === 'intake' ? 'rgba(125, 211, 252, .5)' : 'rgba(253, 186, 116, .5)';
      ctx.fillText(kind === 'intake' ? 'IN' : 'EX', x + dir * len * 0.5, y + 0.4);
    }
    ctx.restore();
  }

  drawFx(g) {
    const ctx = this.ctx;
    const fx = this.ensureFx(g.cyl);
    const sim = this.sim;
    if (!fx.intake.length && !fx.exhaust.length && !fx.burn.length) return;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);
    ctx.globalCompositeOperation = 'lighter';

    const drawParticle = (p, kind) => {
      const t = clamp(p.age / p.life, 0, 1);
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.12));
      const alpha = fade * (kind === 'burn' ? 0.82 : 0.7);
      if (alpha <= 0.01) return;
      let color;
      if (kind === 'intake') color = p.tint > 0.55 ? '125, 211, 252' : '56, 189, 248';
      else if (kind === 'exhaust') color = p.tint > 0.55 ? '251, 146, 60' : '239, 68, 68';
      else color = p.tint > 0.55 ? '255, 236, 170' : '251, 146, 60';

      // Trail.
      const dx = p.x - p.px;
      const dy = p.y - p.py;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) {
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = `rgba(${color}, ${alpha * 0.5})`;
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      // Outer glow.
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.4, 0, TAU);
      ctx.fillStyle = `rgba(${color}, ${alpha * 0.13})`;
      ctx.fill();
      // Core.
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fillStyle = `rgba(${color}, ${alpha})`;
      ctx.fill();
    };

    for (const p of fx.intake) drawParticle(p, 'intake');
    for (const p of fx.exhaust) drawParticle(p, 'exhaust');
    for (const p of fx.burn) drawParticle(p, 'burn');
    ctx.restore();
  }

  drawLabels(g) {
    const ctx = this.ctx;
    const { bottomY, bore, deckY, headW, headH } = g;
    ctx.save();
    ctx.globalAlpha = g.depth;
    ctx.translate(g.cx, g.crankY + g.lift);
    ctx.rotate(g.bank);

    // Cylinder index.
    ctx.font = '600 7px "DejaVu Sans Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(125, 211, 252, .42)';
    ctx.fillText(`CYL ${String(g.cyl.number).padStart(2, '0')}`, 0, bottomY - 5);

    // Pressure tick beside the liner.
    const pressure = clamp(g.cyl.pressure / 100, 0, 1);
    const px = bore / 2 + 17;
    const py = bottomY - 10;
    const ph = Math.max(16, deckY * -0.18);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - ph);
    ctx.strokeStyle = 'rgba(104, 174, 235, .12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - ph * pressure);
    ctx.strokeStyle = pressure > 0.55 ? 'rgba(251, 146, 60, .7)' : 'rgba(56, 189, 248, .65)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Spark indicator LED on the head.
    const ledX = headW / 2 - 6;
    const ledY = deckY - headH + 5;
    ctx.beginPath();
    ctx.arc(ledX, ledY, 1.8, 0, TAU);
    ctx.fillStyle = g.cyl.spark > 0.02
      ? `rgba(255, 255, 255, ${0.5 + g.cyl.spark * 0.5})`
      : 'rgba(56, 189, 248, .18)';
    ctx.fill();

    ctx.restore();
  }

  drawForeground(geo) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    // Bottom scale ticks.
    ctx.save();
    ctx.strokeStyle = 'rgba(104, 174, 235, .12)';
    ctx.lineWidth = 1;
    const y = h - 12;
    for (let x = 18; x < w - 18; x += 18) {
      const tall = Math.round((x - 18) / 18) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + (tall ? 5 : 2.5));
      ctx.stroke();
    }
    ctx.restore();

    // Corner status text.
    ctx.save();
    ctx.font = '600 6px "DejaVu Sans Mono", monospace';
    ctx.fillStyle = 'rgba(104, 174, 235, .32)';
    ctx.textAlign = 'left';
    ctx.fillText('SOLVER // 60 HZ', 16, h - 20);
    ctx.textAlign = 'right';
    ctx.fillText(`${this.sim.preset.firingOrder}`, w - 16, h - 20);
    ctx.restore();

    // Speed vignette pulse at limiter.
    if (this.sim.limiterActive) {
      const a = 0.08 + 0.06 * Math.sin(this.sim.time * 42);
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
      v.addColorStop(0, 'rgba(244, 63, 94, 0)');
      v.addColorStop(1, `rgba(244, 63, 94, ${a})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
