/* SINGLE CYLINDER — physically based 4-stroke engine model.
 * Slider-crank kinematics, single-zone cylinder gas, orifice valve flow,
 * plenum manifold, Wiebe heat release, Woschni-style wall loss and a
 * Livengood-Wu style knock tendency. SI units throughout, degrees at the UI.
 */

const PI = Math.PI;
const TAU = PI * 2;
const CYCLE = TAU * 2; // 720 crank degrees

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothLift(deg, open, close, maxLift) {
  // deg is 0..720, window may wrap (close > 720)
  let d = deg;
  if (d < open) d += 720;
  if (d < open || d > close) return 0;
  const u = (d - open) / (close - open);
  return maxLift * Math.sin(PI * u) ** 2;
}

function orificeFlow(pUp, pDn, tUp, area, cd = 0.68) {
  if (area <= 0 || pUp <= 0) return 0;
  const ratio = clamp(pDn / pUp, 0, 1);
  const g = 1.4;
  let term;
  if (ratio > 0.528) {
    term = Math.sqrt(Math.max(0, ratio ** (2 / g) - ratio ** ((g + 1) / g)));
  } else {
    term = Math.sqrt(Math.max(0, 0.528 ** (2 / g) - 0.528 ** ((g + 1) / g)));
  }
  // kg/s. The 0.684 factor folds the gamma constants in.
  return cd * area * (pUp / Math.sqrt(287 * tUp)) * 0.6845 * term * 3.4;
}

export class Engine {
  constructor() {
    // --- hard parts (approximately a 449 cc single) ---
    this.bore = 0.084;
    this.stroke = 0.080;
    this.rod = 0.140;
    this.crankR = this.stroke / 2;
    this.pistonArea = (PI / 4) * this.bore ** 2;
    this.Vd = this.pistonArea * this.stroke;
    this.compression = 10.5;
    this.Vc = this.Vd / (this.compression - 1);
    this.inertia = 0.085; // crank + flywheel + dyno coupling, kg m^2

    this.pAmb = 101325;
    this.tAmb = 295;
    this.tCoolant = 363; // 90 C
    this.afr = 14.7;
    this.fuelLhv = 44e6;
    this.plenumV = 0.0024;

    // valve geometry
    this.valveDia = 0.034;
    this.maxLift = 0.0105;
    this.ivo = 710; // 10 BTDC
    this.ivc = 940; // 40 ABDC (wraps)
    this.evo = 500; // 40 BBDC
    this.evc = 730; // 10 ATDC

    // inputs (set every frame)
    this.throttle = 0.12;
    this.advance = 12;
    this.load = 0;
    this.starter = false;

    // garage upgrades (0 or 1). Kept across resets.
    this.mods = { port: 0, radiator: 0, ecu: 0, forged: 0 };

    this.reset();
  }

  reset({ cold = true, health = 100 } = {}) {
    this.theta = 0.55; // a little past intake TDC, not an unstable equilibrium
    this.omega = 0;
    this.mass = 0.00012;
    this.temp = 300;
    this.fuel = 0;
    this.pm = this.pAmb; // manifold
    this.pe = this.pAmb + 400; // exhaust backpressure
    this.wallC = cold ? 22 : 88;
    this.oilC = cold ? 20 : 90;
    this.health = health;

    this.pressure = 101325;
    this.volume = this.volumeAt(0);
    this.dVdTheta = 0;
    this.pistonPin = 0;
    this.intakeLift = 0;
    this.exhaustLift = 0;

    this.sparkFired = false;
    this.burning = false;
    this.burnStart = 0;
    this.burnDuration = 52;
    this.burned = 0;
    this.availableFuel = 0;
    this.cycleFuel = 0;
    this.lastCycle = -1;

    this.knock = 0; // instantaneous intensity 0..1
    this.knockMeter = 0; // decaying UI meter 0..1
    this.knockTarget = 0;
    this.knockLimit = 34;
    this.knockEvents = 0;
    this.overRev = 0;
    this.stalled = true;
    this.running = false;
    this.cranking = false;
    this.firing = 0;

    this.tInd = 0;
    this.tFric = 0;
    this.tLoad = 0;
    this.tStarter = 0;
    this.tNet = 0;
    this.powerKW = 0;
    this.torque = 0;
    this.torqueAvg = 0;
    this.peakPower = 0;
    this.peakTorque = 0;
    this.peakRpm = 0;
    this.totalCycles = 0;
    this.cycleIndex = 0;
    this.exhaustPulse = 0;
    this.intakePulse = 0;
    this.sparkPulse = 0;
    this.combustion = 0; // 0..1 visual
    this.detonation = 0;
    this.lastEvent = '';
    this.eventTimer = 0;
    this.stepCount = 0;
    this.time = 0;
  }

  volumeAt(theta) {
    const { crankR: a, rod: l, pistonArea: ap, Vc } = this;
    // pin distance below TDC
    const s = a + l - (a * Math.cos(theta) + Math.sqrt(l * l - (a * Math.sin(theta)) ** 2));
    return Vc + ap * s;
  }

  geometryAt(theta) {
    const { crankR: a, rod: l } = this;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const root = Math.sqrt(l * l - (a * sin) ** 2);
    const pin = a * cos + root; // distance above crank centre
    const s = a + l - pin;
    const dPin = -a * sin - (a * a * sin * cos) / root;
    return { pin, s, dV: -this.pistonArea * dPin };
  }

  /* One physics tick. dt is real seconds. */
  step(dt) {
    const omegaAbs = Math.abs(this.omega);
    // Resolve crank angle finely enough for combustion, capped for cost.
    const hMax = omegaAbs > 8 ? Math.min(0.0012, 0.030 / omegaAbs) : 0.0012;
    let remaining = Math.min(dt, 0.09);
    let guard = 0;
    while (remaining > 1e-7 && guard < 900) {
      const h = Math.min(remaining, hMax);
      this.integrate(h);
      remaining -= h;
      guard++;
    }
    if (guard >= 900) this.omega *= 0.995;
  }

  integrate(dt) {
    this.time += dt;
    this.stepCount++;
    const phase = ((this.theta / CYCLE) * 720) % 720;
    const prevPhase = (((this.theta - this.omega * dt) / CYCLE) * 720) % 720;
    const geo = this.geometryAt(this.theta);
    const V = this.volumeAt(this.theta);
    this.pistonPin = geo.pin;
    this.volume = V;
    this.dVdTheta = geo.dV;

    // ---------------- valves ----------------
    let iv = smoothLift(phase, this.ivo, this.ivc, this.maxLift);
    let ev = smoothLift(phase, this.evo, this.evc, this.maxLift);
    if (iv < 0.00005) iv = 0;
    if (ev < 0.00005) ev = 0;
    this.intakeLift = iv;
    this.exhaustLift = ev;

    // ---------------- gas pressure ----------------
    const R = 287;
    const cv = 718;
    const cp = 1005;
    const tCyl = clamp(this.temp, 240, 3600);
    let p = clamp((this.mass * R * tCyl) / Math.max(V, 1e-7), 1500, 2.4e7);

    // ---------------- manifold / throttle ----------------
    const areaThrottle = 0.5e-6 + 4.1e-4 * Math.pow(clamp(this.throttle, 0, 1), 2.2);
    let mdotThrottle = 0;
    if (this.pm < this.pAmb) mdotThrottle = orificeFlow(this.pAmb, this.pm, this.tAmb, areaThrottle);
    else mdotThrottle = -orificeFlow(this.pm, this.pAmb, tCyl, areaThrottle);
    // small idle air bleed so a closed plate still supports combustion
    const idleBleed = orificeFlow(this.pAmb, this.pm, this.tAmb, 3.5e-6);
    mdotThrottle += idleBleed;

    // intake charge. The valve curtain is large compared with the cylinder,
    // so cap each explicit step to a fraction of the mass needed to equalise.
    let dmIn = 0;
    let dmOut = 0;
    let intakeFlow = 0;
    if (iv > 0) {
      const area = PI * this.valveDia * iv * 0.86 * (1 + 0.18 * (this.mods?.port || 0));
      const mdot = orificeFlow(this.pm, p, this.tAmb, area);
      const equil = ((this.pm - p) * V) / (R * ((tCyl + this.tAmb) * 0.5));
      if (mdot > 0) {
        dmIn = Math.min(mdot * dt, Math.max(0, equil) * 0.32);
        intakeFlow = dmIn / dt;
      } else {
        const rev = orificeFlow(p, this.pm, this.temp, area);
        dmOut = Math.min(rev * dt, Math.max(0, -equil) * 0.32);
        intakeFlow = -dmOut / dt;
        dmIn = -dmOut;
      }
    }

    let dmEx = 0;
    let exhaustFlow = 0;
    if (ev > 0) {
      const area = PI * this.valveDia * ev * 0.86;
      const mdot = orificeFlow(p, this.pe, this.temp, area);
      const equil = ((p - this.pe) * V) / (R * tCyl);
      if (mdot > 0) {
        dmEx = Math.min(mdot * dt, Math.max(0, equil) * 0.32);
        exhaustFlow = dmEx / dt;
      } else {
        const rev = orificeFlow(this.pe, p, 850, area);
        dmEx = -Math.min(rev * dt, Math.max(0, -equil) * 0.32);
      }
    }

    // plenum mass balance (small volume -> clamp for stability)
    const plenumMassRate = mdotThrottle - intakeFlow;
    this.pm += (plenumMassRate * R * this.tAmb * dt) / this.plenumV;
    this.pm = clamp(this.pm, 6000, this.pAmb * 1.03);
    if (this.pm > this.pAmb) this.pm = this.pAmb;
    this.lastThrottleFlow = mdotThrottle;
    this.lastIntakeFlow = intakeFlow;
    this.lastExhaustFlow = exhaustFlow;
    this.meterThrottle = (this.meterThrottle || 0) + mdotThrottle * dt;
    this.meterIntake = (this.meterIntake || 0) + intakeFlow * dt;
    this.meterExhaust = (this.meterExhaust || 0) + exhaustFlow * dt;
    // exhaust backpressure rises with flow, slight resonance
    this.pe = clamp(this.pAmb + 380 + Math.abs(exhaustFlow) * 2600, this.pAmb, this.pAmb + 9000);

    // ---------------- mass & energy exchange ----------------
    let dU = 0;
    if (dmIn > 0) {
      this.mass += dmIn;
      this.fuel += dmIn / this.afr;
      dU += cp * this.tAmb * dmIn;
      this.intakePulse = Math.min(1, this.intakePulse + dmIn * 2400);
    } else if (dmIn < 0) {
      const f = this.mass > 1e-9 ? Math.min(1, -dmIn / this.mass) : 0;
      this.mass = Math.max(0, this.mass + dmIn);
      this.fuel *= 1 - f;
      dU += cp * tCyl * dmIn;
    }
    if (dmEx > 0) {
      const f = this.mass > 1e-9 ? Math.min(1, dmEx / this.mass) : 0;
      this.mass = Math.max(0, this.mass - dmEx);
      this.fuel *= 1 - f;
      dU -= cp * tCyl * dmEx;
      this.exhaustPulse = Math.min(1, this.exhaustPulse + dmEx * 1700);
    } else if (dmEx < 0) {
      this.mass += -dmEx;
      dU += cp * 900 * -dmEx;
    }

    // ---------------- ignition & combustion ----------------
    const sparkAngle = (360 - this.advance + 720) % 720;
    let sparkNow = false;
    if (!this.sparkFired && this.fuel > 1e-9) {
      let crossed = false;
      if (phase >= prevPhase) crossed = sparkAngle > prevPhase && sparkAngle <= phase;
      else crossed = sparkAngle > prevPhase || sparkAngle <= phase;
      // at very low cranking speed allow a small timing nudge
      if (crossed || (this.omega < 15 && Math.abs(phase - sparkAngle) < 1.2)) {
        sparkNow = true;
      }
    }
    if (sparkNow) {
      this.sparkFired = true;
      this.sparkPulse = 1;
      this.burning = true;
      this.burnStart = phase;
      this.burned = 0;
      this.availableFuel = Math.max(0, this.fuel);
      this.cycleFuel = this.availableFuel;
      this.knock = 0;
    }

    let qComb = 0;
    if (this.burning && this.availableFuel > 0) {
      let elapsed = phase - this.burnStart;
      if (elapsed < -360) elapsed += 720;
      if (elapsed < 0) elapsed = 0;
      const u = clamp(elapsed / this.burnDuration, 0, 1);
      const xb = u >= 1 ? 1 : 1 - Math.exp(-6.9 * Math.pow(u, 2.1));
      const dx = Math.max(0, xb - this.burned);
      if (dx > 0) {
        // cold combustion is incomplete and late; mixture strength matters
        const warm = clamp((this.wallC - 24) / 70, 0, 1);
        const strength = clamp((this.availableFuel / Math.max(this.mass, 1e-9)) * this.afr, 0, 1.1);
        const eff = (0.58 + 0.33 * warm) * clamp(strength, 0.25, 1);
        const dQ = this.availableFuel * dx * this.fuelLhv * eff;
        qComb += dQ;
        this.burned += dx;
        this.fuel = Math.max(0, this.fuel - this.availableFuel * dx);
        this.combustion = Math.min(1, this.combustion + dx * 2.4);
      }
      if (u >= 1) {
        this.burning = false;
        if (this.burned < 0.6) this.lastEvent = 'MISFIRE';
      }
    }

    // heat release raises internal energy
    dU += qComb;

    // wall heat transfer, Woschni-ish (calibrated for a small single)
    const area = 0.022 + this.pistonArea;
    const hConv = 130 + 0.00009 * p;
    const dQwall = hConv * area * (tCyl - (this.wallC + 273.15)) * dt;
    dU -= dQwall;

    // first law: dU = dQ - p dV  (volume work)
    dU -= p * geo.dV * this.omega * dt;
    this.temp += dU / Math.max(this.mass * cv, 1e-7);
    this.temp = clamp(this.temp, 250, 3400);

    // wall / coolant thermal inertia
    const qIntoWall = dQwall;
    const qCool = 420 * (this.wallC - (this.tCoolant - 273.15)) * (1 + 0.75 * (this.mods?.radiator || 0));
    this.wallC += ((qIntoWall - qCool) / 6000) * dt;
    this.wallC = clamp(this.wallC, 15, 190);
    this.oilC += ((this.wallC - this.oilC) * 0.12 - 0.015 * (this.oilC - 45)) * dt * 0.25;

    this.pressure = clamp((Math.max(this.mass, 1e-7) * R * this.temp) / Math.max(V, 1e-7), 1500, 2.6e7);

    // ---------------- knock ----------------
    const loadFrac = clamp((this.pm - 28000) / 72000, 0, 1);
    const heatFrac = clamp((this.wallC - 80) / 55, 0, 1.4);
    this.knockLimit = 35 - 13 * loadFrac - 5 * heatFrac - 2.4 * clamp(this.omega / 700, 0, 1) + 3.5 * (this.mods?.ecu || 0);
    let knockTarget = 0;
    if (this.burning && this.availableFuel > 0 && qComb > 0) {
      const over = this.advance - this.knockLimit;
      if (over > 0) {
        const peak = clamp(p / 4.2e6, 0.15, 1.25);
        knockTarget = clamp(over / 11, 0, 1) * peak;
      }
    }
    this.knockTarget = Math.max(knockTarget, this.knockTarget * Math.exp(-dt * 1.6));
    this.knockMeter += (this.knockTarget - this.knockMeter) * Math.min(1, dt * 6);
    this.knock = this.knockMeter;
    if (this.knockTarget > 0.25) {
      this.knockEvents++;
      this.detonation = Math.min(1, this.knockTarget + 0.35);
      this.lastEvent = 'DETONATION';
    }

    // ---------------- torque ----------------
    this.tInd = (p - this.pAmb) * geo.dV * (1 - 0.12 * this.knockMeter);
    const w = this.omega;
    const rpmNow = (w * 60) / TAU;
    this.tFric = 1.35 + 0.0055 * w + 0.0000068 * w * w;
    if (rpmNow > 6900) this.tFric += (rpmNow - 6900) * 0.02;
    if (w < 0.35) this.tFric *= 1.9;
    this.tLoad = (this.load / 100) * (1.2 + 0.062 * w) * 1.15;
    this.tStarter = 0;
    if (this.starter && w < 72) {
      this.tStarter = 52 * clamp(1 - w / 78, 0, 1);
      this.cranking = true;
    } else this.cranking = false;

    let net = this.tInd - this.tFric - this.tLoad + this.tStarter;
    if (this.loading) net -= this.loading;
    this.tNet = net;
    this.omega += (net / this.inertia) * dt;
    if (this.omega < 0) this.omega = 0;
    if (this.omega < 0.4 && this.tStarter <= 0.1 && net < 0.5) this.omega = 0;

    this.theta += this.omega * dt;
    if (this.theta >= CYCLE) {
      this.theta -= CYCLE;
      this.cycleIndex++;
      this.sparkFired = false;
      this.burning = false;
      this.burned = 0;
      this.availableFuel = Math.max(0, this.fuel);
      this.cycleFuel = this.availableFuel;
      this.totalCycles++;
      this.knock = 0;
      if (this.availableFuel > 0 && this.omega > 2) {
        this.burnDuration = lerp(76, 56, clamp(this.omega / 550, 0, 1));
      }
    }

    // measured output (averaged over a few cycles for a readable gauge)
    const instTorque = Math.max(0, this.tInd - this.tFric);
    const alpha = 1 - Math.exp(-dt / 0.55);
    this.torqueAvg = (this.torqueAvg ?? 0) + (instTorque - (this.torqueAvg ?? 0)) * alpha;
    this.torque = this.torqueAvg;
    this.powerKW = (this.torqueAvg * this.omega) / 1000;
    const rpm = (this.omega * 60) / TAU;
    if (rpm > 400) {
      this.peakRpm = Math.max(this.peakRpm, rpm);
      this.peakTorque = Math.max(this.peakTorque, this.torqueAvg);
      this.peakPower = Math.max(this.peakPower, this.powerKW * 1.34102);
      this.running = true;
    }
    if (rpm < 120) this.running = false;

    // ---------------- damage ----------------
    this.detonation = Math.max(0, this.detonation - dt * 5);
    this.combustion = Math.max(0, this.combustion - dt * 5);
    this.sparkPulse = Math.max(0, this.sparkPulse - dt * 22);
    this.exhaustPulse *= Math.exp(-dt * 9);
    this.intakePulse *= Math.exp(-dt * 9);
    this.eventTimer = Math.max(0, this.eventTimer - dt);

    const dmgScale = 1 - 0.55 * (this.mods?.forged || 0);
    if (rpm > 7250) {
      this.overRev = Math.min(1, this.overRev + dt * 2);
      this.health -= ((rpm - 7250) / 800) * 1.9 * dt * dmgScale;
    } else {
      this.overRev = Math.max(0, this.overRev - dt * 3);
    }
    if (this.wallC > 116) this.health -= (this.wallC - 116) * 0.12 * dt * dmgScale;
    if (this.knock > 0.22) this.health -= (this.knock - 0.2) * 5.5 * dt * dmgScale;
    this.health = clamp(this.health, 0, 100);

    if (this.health <= 0) {
      this.omega = 0;
      this.stalled = true;
      this.running = false;
      this.lastEvent = 'SEIZED';
    }
    if (this.omega < 0.4 && !this.starter) this.stalled = true;
    if (this.omega > 8) this.stalled = false;
  }
}

function cam(phase) {
  // combustion lives around TDC; bell curve in crank degrees
  let d = phase - 360;
  if (d > 180) d -= 720;
  if (d < -180) d += 720;
  return Math.exp(-(d * d) / (2 * 38 * 38));
}

export { clamp, lerp };
