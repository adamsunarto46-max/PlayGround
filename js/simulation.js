/* ============================================================
   APEX // DYNO — engine simulation model
   A compact, deterministic slider-crank / thermodynamic model.
   ============================================================ */

export const PRESETS = {
  i4: {
    id: 'i4',
    name: 'High-Revving I4',
    spec: 'INLINE-4 · 2.0L · 9000 RPM REDLINE',
    layout: 'inline',
    cylinders: 4,
    pairs: 4,
    bore: 86,
    stroke: 86,
    displacement: 2.0,
    redline: 9000,
    limiter: 9400,
    maxRpm: 10500,
    idle: 900,
    heroRpm: 6800,
    throttle: 78,
    load: 84,
    compression: 12.5,
    timing: 29,
    afr: 12.8,
    injection: 64,
    turbo: 0,
    springRate: 8350,
    bankAngle: 0,
    exhaustTone: 0.58,
    intakeTone: 0.6,
    valvetrain: 0.44,
    tone: 'bright',
    firingOrder: '1 – 3 – 4 – 2',
    throws: [0, 540, 180, 360],
    configLabel: '4-STROKE · NA',
    note: '2.0L · INLINE-4'
  },
  v6: {
    id: 'v6',
    name: 'Twin-Turbo V6',
    spec: 'V6 · 3.0L TWIN-TURBO · 7600 RPM REDLINE',
    layout: 'vee',
    cylinders: 6,
    pairs: 3,
    bore: 86,
    stroke: 86,
    displacement: 3.0,
    redline: 7600,
    limiter: 7950,
    maxRpm: 8500,
    idle: 780,
    heroRpm: 5200,
    throttle: 72,
    load: 82,
    compression: 9.6,
    timing: 21,
    afr: 11.9,
    injection: 48,
    turbo: 0.65,
    springRate: 7050,
    bankAngle: 13,
    exhaustTone: 0.76,
    intakeTone: 0.52,
    valvetrain: 0.4,
    tone: 'turbo',
    firingOrder: '1 – 4 – 3 – 6 – 2 – 5',
    throws: [0, 240, 480],
    configLabel: '4-STROKE · TWIN-TURBO',
    note: '3.0L · V6 TT'
  },
  v8: {
    id: 'v8',
    name: 'Deep V8',
    spec: 'V8 · 6.1L CROSS-PLANE · 6800 RPM REDLINE',
    layout: 'vee',
    cylinders: 8,
    pairs: 4,
    bore: 103,
    stroke: 92,
    displacement: 6.1,
    redline: 6800,
    limiter: 7100,
    maxRpm: 7600,
    idle: 650,
    heroRpm: 4400,
    throttle: 68,
    load: 78,
    compression: 10.9,
    timing: 24,
    afr: 12.2,
    injection: 55,
    turbo: 0.04,
    springRate: 6350,
    bankAngle: 11,
    exhaustTone: 0.93,
    intakeTone: 0.36,
    valvetrain: 0.52,
    tone: 'deep',
    firingOrder: '1 – 8 – 4 – 3 – 6 – 5 – 7 – 2',
    throws: [0, 90, 180, 270],
    configLabel: '4-STROKE · CROSS-PLANE',
    note: '6.1L · V8'
  }
};

const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function liftPulse(cycle, start, duration) {
  let c = cycle;
  if (c < start) c += 720;
  const d = c - start;
  if (d < 0 || d > duration) return 0;
  // smooth open / close with a slightly broadened nose
  const x = d / duration;
  return Math.sin(Math.PI * x) ** 0.72;
}

export function phaseForCycle(cycle) {
  if (cycle < 180) return 'intake';
  if (cycle < 360) return 'compression';
  if (cycle < 540) return 'power';
  return 'exhaust';
}

export class EngineSim {
  constructor(presetId = 'i4') {
    this.time = 0;
    this.crankAngle = 0;
    this.rpm = 850;
    this.targetRpm = 850;
    this.running = true;
    this.fuelCut = false;
    this.limiterActive = false;
    this.knock = 0;
    this.particlesOn = { intake: true, combustion: true, exhaust: true, thermal: true };

    this.turbulence = 0.68;
    this.density = 0.72;
    this.volume = 0.7;
    this.muted = false;

    this.peakPressure = 0;
    this.avgPressure = 0;
    this.torque = 0;
    this.powerHp = 0;
    this.frictionHp = 0;
    this.indicatedHp = 0;
    this.bmep = 0;
    this.volEff = 0;
    this.thermal = 0;
    this.oilTemp = 0;
    this.pistonSlap = 0;
    this.valveFloat = 0;
    this.detonation = 0;
    this.chargeVelocity = 0;
    this.exhaustTemp = 0;
    this.lambda = 1;
    this.warnings = [];
    this.phase = 'intake';
    this.cylinders = [];

    this.setPreset(presetId, true);
  }

  setPreset(id, initial = false) {
    const preset = PRESETS[id] || PRESETS.i4;
    this.presetId = preset.id;
    this.preset = preset;
    this.targetRpm = preset.heroRpm;
    this.rpm = initial ? preset.heroRpm : lerp(this.rpm, preset.heroRpm, 0.4);
    this.throttle = preset.throttle;
    this.load = preset.load;
    this.compression = preset.compression;
    this.timing = preset.timing;
    this.afr = preset.afr;
    this.injection = preset.injection;
    this.exhaustTone = preset.exhaustTone;
    this.intakeTone = preset.intakeTone;
    this.turbulence = preset.id === 'v8' ? 0.74 : 0.68;
    this.density = 0.72;
    this.buildCylinders();
    this.updateDerived(0, true);
  }

  buildCylinders() {
    const p = this.preset;
    const list = [];
    if (p.layout === 'vee') {
      for (let pair = 0; pair < p.pairs; pair++) {
        const throwPhase = p.throws[pair % p.throws.length];
        for (let side = 0; side < 2; side++) {
          list.push({
            index: list.length,
            number: list.length + 1,
            pair,
            bank: side === 0 ? -1 : 1,
            bankAngle: side === 0 ? -p.bankAngle : p.bankAngle,
            throwPhase,
            cycleOffset: throwPhase + (side === 1 ? 360 : 0),
            pressure: 1,
            intakeLift: 0,
            exhaustLift: 0,
            spark: 0,
            combustion: 0,
            phase: 'intake',
            cycle: 0,
            theta: 0,
            float: 0
          });
        }
      }
    } else {
      for (let i = 0; i < p.cylinders; i++) {
        const throwPhase = p.throws[i % p.throws.length];
        list.push({
          index: i,
          number: i + 1,
          pair: i,
          bank: 0,
          bankAngle: 0,
          throwPhase,
          cycleOffset: throwPhase,
          pressure: 1,
          intakeLift: 0,
          exhaustLift: 0,
          spark: 0,
          combustion: 0,
          phase: 'intake',
          cycle: 0,
          theta: 0,
          float: 0
        });
      }
    }
    this.cylinders = list;
  }

  setValue(key, value) {
    if (key === 'rpm') {
      this.targetRpm = value;
      return;
    }
    this[key] = value;
  }

  toggleRunning() {
    this.running = !this.running;
    if (this.running && this.rpm < 80) this.rpm = 180;
    if (!this.running) {
      this.fuelCut = false;
      this.limiterActive = false;
    }
    return this.running;
  }

  pressureAt(cycle, index) {
    const CR = this.compression;
    const loadF = this.load / 100;
    const thrF = this.throttle / 100;
    const boost = 1 + this.preset.turbo * loadF * 0.85;
    const map = 0.26 + 0.74 * thrF * boost;
    const vol = 1 + (CR - 1) * (1 - Math.cos(cycle * DEG)) / 2;
    let p;

    if (cycle < 180) {
      // intake stroke — light pumping loss near BDC
      p = map * (0.93 + 0.07 * Math.cos(cycle * DEG));
    } else if (cycle < 360) {
      // compression
      p = map * Math.pow(CR / vol, 1.34);
    } else if (cycle < 540) {
      // combustion + expansion
      const comp = map * Math.pow(CR / vol, 1.34);
      const optimal = 25 - Math.min(8, this.rpm / 1400);
      const sparkCenter = 360 + 9 - (this.timing - 25) * 0.45;
      const width = 24 + this.injection * 0.035 + (this.rpm / this.preset.redline) * 5;
      const afrFactor = clamp(1.1 - Math.abs(this.afr - 12.7) / 9, 0.45, 1.08);
      const timingFactor = Math.exp(-Math.pow((this.timing - optimal) / 17, 2));
      const amp = (26 + 44 * loadF + 16 * thrF) * afrFactor * (0.65 + 0.35 * timingFactor) * boost;
      const comb = this.running ? amp * Math.exp(-Math.pow((cycle - sparkCenter) / width, 2)) : 0;
      p = comp + comb;
    } else {
      // exhaust stroke — header backpressure pulse
      p = 1.06 + 0.32 * loadF * Math.exp(-Math.pow((cycle - 575) / 45, 2)) + 0.1 * Math.sin(cycle * DEG * 2);
    }

    const pulse = 1 + (this.injection / 100) * 0.055 * Math.sin(cycle * 0.23 + index * 2.1);
    if (this.fuelCut && cycle > 350 && cycle < 525) p *= 0.32;
    return Math.max(0.18, p * pulse);
  }

  updateDerived(dt, initial = false) {
    const p = this.preset;
    const redline = p.redline;
    const rpmN = this.rpm / redline;
    const loadF = this.load / 100;
    const thrF = this.throttle / 100;

    // Valve float grows as spring control is lost near the limiter.
    this.valveFloat = this.running
      ? smoothstep(p.springRate * 0.93, redline * 1.045, this.rpm)
      : 0;

    // Piston slap: worst at high speed and low load.
    this.pistonSlap = this.running
      ? clamp(Math.pow(clamp(rpmN, 0, 1.2), 2.05) * (0.5 + (1 - loadF) * 0.62), 0, 1)
      : 0;

    // Detonation risk model.
    const crRisk = clamp((this.compression - 9.5) / 5, 0, 1);
    const timingRisk = clamp((this.timing - 22) / 22, 0, 1);
    const leanRisk = clamp((this.afr - 13.8) / 4, 0, 1);
    const heatRisk = clamp((rpmN - 0.45) / 0.55, 0, 1);
    this.detonation = this.running
      ? clamp(crRisk * 0.42 + timingRisk * 0.34 + leanRisk * 0.3 + loadF * 0.28 + heatRisk * 0.14 - 0.46, 0, 1)
      : 0;

    const afrF = clamp(1.12 - Math.abs(this.afr - 12.7) / 10, 0.4, 1.05);
    const optimal = 25 - Math.min(8, this.rpm / 1400);
    const timingF = Math.exp(-Math.pow((this.timing - optimal) / 20, 2));
    const boost = 1 + p.turbo * loadF * 0.9;
    this.bmep = (3.6 + 9.2 * loadF * afrF * timingF) * boost *
      (1 - this.valveFloat * 0.3) * (1 - this.detonation * 0.25);

    const dispM3 = Math.PI / 4 * Math.pow(p.bore / 1000, 2) * (p.stroke / 1000) * p.cylinders;
    this.torque = (this.bmep * 1e5 * dispM3) / (4 * Math.PI);
    const powerKw = this.torque * this.rpm * 2 * Math.PI / 60 / 1000;
    this.powerHp = Math.max(0, powerKw * 1.34102);
    this.frictionHp = 1.1 + Math.pow(this.rpm / 1000, 1.55) * 0.82 + loadF * 2.4;
    this.indicatedHp = this.powerHp + this.frictionHp;
    if (!this.running) {
      this.bmep = 0;
      this.torque = 0;
      this.powerHp = 0;
      this.indicatedHp = 0;
    }

    this.volEff = clamp(86 + this.throttle * 0.12 - rpmN * 9 + p.turbo * 26 - this.valveFloat * 12, 35, 118);
    this.thermal = clamp(0.16 + rpmN * 0.34 + loadF * 0.3 + p.turbo * 0.12 + this.detonation * 0.15, 0, 1);
    this.oilTemp = 88 + this.thermal * 43;
    this.chargeVelocity = (0.9 + thrF * 3.4 + clamp(rpmN, 0, 1.2) * 4.2) * (1 + p.turbo * 0.35);
    this.exhaustTemp = 480 + loadF * 260 + clamp(rpmN, 0, 1.2) * 340 + p.turbo * 120;
    this.lambda = this.afr / 14.7;

    // Build active warning flags.
    const warnings = [];
    if (this.limiterActive) warnings.push({ label: 'REV LIMITER', danger: true });
    if (this.valveFloat > 0.18) warnings.push({ label: 'VALVE FLOAT', danger: this.valveFloat > 0.55 });
    if (this.detonation > 0.45) warnings.push({ label: 'DETONATION', danger: this.detonation > 0.7 });
    if (this.afr > 15.2) warnings.push({ label: 'LEAN MIXTURE', danger: this.afr > 16.2 });
    if (this.thermal > 0.8) warnings.push({ label: 'THERMAL LIMIT', danger: this.thermal > 0.92 });
    if (this.pistonSlap > 0.78) warnings.push({ label: 'PISTON SLAP', danger: this.pistonSlap > 0.9 });
    if (this.compression > 13.6) warnings.push({ label: 'HIGH CR', danger: false });
    this.warnings = warnings.slice(0, 4);

    if (initial) {
      this.peakPressure = 48;
      this.avgPressure = 3.2;
    }
  }

  update(dt) {
    dt = clamp(dt, 0, 0.05);
    this.time += dt;
    const p = this.preset;

    // Engine speed follows the requested target with a simple inertia model.
    if (this.running) {
      let target = this.targetRpm;
      if (target > p.redline) target = p.redline;
      const response = target > this.rpm ? 2.8 : 1.55;
      this.rpm += (target - this.rpm) * Math.min(1, dt * response);
      if (this.rpm < 250 && this.targetRpm > 500) this.rpm += dt * 220;
    } else {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 0.9);
      if (this.rpm < 2) this.rpm = 0;
    }
    this.rpm = clamp(this.rpm, 0, p.maxRpm);

    this.limiterActive = this.running && this.targetRpm > p.redline * 0.995 && this.rpm > p.redline * 0.965;
    this.fuelCut = this.limiterActive && Math.sin(this.time * 112) > 0.05;

    // Crank rotation (720° = one full four-stroke cycle).
    this.crankAngle = (this.crankAngle + this.rpm * 6 * dt) % 720;

    const floatBase = this.valveFloat;
    let pressureSum = 0;
    let peak = 0;

    for (const cyl of this.cylinders) {
      const theta = (this.crankAngle + cyl.throwPhase) % 720;
      const cycle = (this.crankAngle + cyl.cycleOffset) % 720;
      cyl.theta = theta;
      cyl.cycle = cycle;
      cyl.phase = phaseForCycle(cycle);

      // Valve events (with overlap around TDC).
      const intakeCam = liftPulse(cycle, 705, 220);
      const exhaustCam = liftPulse(cycle, 520, 225);
      const bounce = Math.sin(this.time * 118 + cyl.index * 1.9) * floatBase * 0.22;
      cyl.float = floatBase;
      cyl.intakeLift = clamp(intakeCam * (1 - floatBase * 0.58) + bounce, 0, 1.15);
      cyl.exhaustLift = clamp(exhaustCam * (1 - floatBase * 0.58) - bounce * 0.6, 0, 1.15);

      const pressure = this.pressureAt(cycle, cyl.index);
      cyl.pressure = pressure;
      pressureSum += pressure;
      if (pressure > peak) peak = pressure;

      // Spark flash window.
      const sparkAngle = (360 - this.timing + 720) % 720;
      const sparkDist = (cycle - sparkAngle + 720) % 720;
      cyl.spark = this.running && !this.fuelCut && sparkDist < 11
        ? Math.max(0, 1 - sparkDist / 11)
        : 0;

      const combustionRaw = this.running && !this.fuelCut
        ? clamp((pressure - 22) / 62, 0, 1) * (cycle > 335 && cycle < 520 ? 1 : 0)
        : 0;
      cyl.combustion = Math.max(cyl.spark * 0.75, combustionRaw);
    }

    this.avgPressure = pressureSum / Math.max(1, this.cylinders.length);
    this.peakPressure = Math.max(peak, this.peakPressure * Math.exp(-dt * 1.1));
    this.phase = this.cylinders.length ? this.cylinders[0].phase : 'intake';

    // Knock events feed the audio engine.
    if (this.detonation > 0.35 && this.running) {
      if (Math.random() < this.detonation * dt * 9) this.knock = 1;
    }
    this.knock = Math.max(0, this.knock - dt * 4.5);

    this.updateDerived(dt);
  }

  get displacement() {
    const p = this.preset;
    return Math.PI / 4 * Math.pow(p.bore / 1000, 2) * (p.stroke / 1000) * p.cylinders * 1000;
  }

  get firingFrequency() {
    return this.rpm / 60 * (this.preset.cylinders / 2);
  }
}
