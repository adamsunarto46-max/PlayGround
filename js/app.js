/* ============================================================
   APEX // DYNO — application controller
   ============================================================ */

import { EngineSim, PRESETS, clamp } from './simulation.js';
import { EngineRenderer } from './renderer.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

const sim = new EngineSim('i4');
const renderer = new EngineRenderer($('engineCanvas'), sim);
const audio = new AudioEngine(sim);
audio.volume = sim.volume;

let cylBarEls = [];
let lastWarningKey = '';
let toastTimer = 0;
let lastAudioUpdate = 0;
let lastHudUpdate = 0;
let lastVizUpdate = 0;
let lastFrame = performance.now();

// ------------------------------------------------------------
// Control mapping
// ------------------------------------------------------------
const controls = {
  rpm: {
    input: 'rpmInput', out: 'rpmOut',
    get: () => sim.targetRpm, set: (v) => { sim.targetRpm = v; },
    fmt: (v) => `${Math.round(v)}`
  },
  throttle: {
    input: 'throttleInput', out: 'throttleOut',
    get: () => sim.throttle, set: (v) => { sim.throttle = v; },
    fmt: (v) => `${Math.round(v)}%`
  },
  load: {
    input: 'loadInput', out: 'loadOut',
    get: () => sim.load, set: (v) => { sim.load = v; },
    fmt: (v) => `${Math.round(v)}%`
  },
  compression: {
    input: 'compressionInput', out: 'compressionOut',
    get: () => sim.compression, set: (v) => { sim.compression = v; },
    fmt: (v) => `${v.toFixed(1)}:1`
  },
  timing: {
    input: 'timingInput', out: 'timingOut',
    get: () => sim.timing, set: (v) => { sim.timing = v; },
    fmt: (v) => `${v.toFixed(1)}° BTDC`
  },
  afr: {
    input: 'afrInput', out: 'afrOut',
    get: () => sim.afr, set: (v) => { sim.afr = v; },
    fmt: (v) => `${v.toFixed(1)}:1`
  },
  injection: {
    input: 'injectionInput', out: 'injectionOut',
    get: () => sim.injection, set: (v) => { sim.injection = v; },
    fmt: (v) => `${Math.round(v)}%`
  },
  turbulence: {
    input: 'turbulenceInput', out: 'turbulenceOut',
    get: () => sim.turbulence * 100, set: (v) => { sim.turbulence = v / 100; },
    fmt: (v) => `${Math.round(v)}%`
  },
  density: {
    input: 'densityInput', out: 'densityOut',
    get: () => sim.density * 100, set: (v) => { sim.density = v / 100; },
    fmt: (v) => `${Math.round(v)}%`
  },
  exhaustTone: {
    input: 'exhaustToneInput', out: 'exhaustToneOut',
    get: () => sim.exhaustTone * 100, set: (v) => { sim.exhaustTone = v / 100; },
    fmt: (v) => `${Math.round(v)}%`
  },
  intakeTone: {
    input: 'intakeToneInput', out: 'intakeToneOut',
    get: () => sim.intakeTone * 100, set: (v) => { sim.intakeTone = v / 100; },
    fmt: (v) => `${Math.round(v)}%`
  },
  volume: {
    input: 'volumeInput', out: 'volumeOut',
    get: () => sim.volume * 100,
    set: (v) => {
      sim.volume = v / 100;
      audio.volume = sim.volume;
      if (audio.started) {
        if (v > 0 && audio.muted) audio.setMuted(false);
        audio.setVolume(sim.volume);
      }
    },
    fmt: (v) => `${Math.round(v)}%`
  }
};

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value);
  const pct = clamp((value - min) / (max - min) * 100, 0, 100);
  input.style.setProperty('--fill', `${pct}%`);
}

function syncControls() {
  for (const cfg of Object.values(controls)) {
    const input = $(cfg.input);
    if (!input) continue;
    input.value = cfg.get();
    const out = $(cfg.out);
    if (out) out.textContent = cfg.fmt(Number(input.value));
    updateRangeFill(input);
  }
}

for (const [key, cfg] of Object.entries(controls)) {
  const input = $(cfg.input);
  if (!input) continue;
  input.addEventListener('input', () => {
    const value = Number(input.value);
    cfg.set(value);
    const out = $(cfg.out);
    if (out) out.textContent = cfg.fmt(value);
    updateRangeFill(input);
    if (key === 'volume') syncAudioUI();
  });
}

// ------------------------------------------------------------
// Presets and engine identity
// ------------------------------------------------------------
function syncPresetUI() {
  const p = sim.preset;
  $('engineName').textContent = p.name;
  $('engineSpec').textContent = p.spec;
  $('presetNote').textContent = p.note;
  $('vpLayout').textContent = p.layout === 'vee' ? `V${p.cylinders}` : `INLINE-${p.cylinders}`;
  $('vpConfig').textContent = p.configLabel;
  $('redlineLabel').textContent = `REDLINE ${p.redline}`;
  const redlinePct = clamp((p.redline - 500) / (10500 - 500) * 100, 0, 100);
  $('rpmRedlineMark').style.left = `${redlinePct}%`;
  $('tachRedline').style.left = `${redlinePct}%`;
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === p.id);
  });
  buildCylinderBars();
  syncControls();
  syncAudioUI();
}

function buildCylinderBars() {
  const container = $('cylBars');
  if (!container) return;
  container.innerHTML = '';
  cylBarEls = sim.cylinders.map((cyl) => {
    const wrap = document.createElement('div');
    wrap.className = 'cyl-bar';
    const bar = document.createElement('i');
    bar.style.height = '4px';
    const label = document.createElement('span');
    label.textContent = `${cyl.number}`;
    wrap.append(bar, label);
    container.append(wrap);
    return { bar, label };
  });
}

function applyPreset(id, quiet = false) {
  sim.setPreset(id, true);
  syncPresetUI();
  updateHUD(true);
  if (!quiet) toast(`PRESET LOADED — ${sim.preset.name.toUpperCase()}`);
}

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

$('resetBtn').addEventListener('click', () => {
  applyPreset(sim.presetId, true);
  toast('PRESET RESET — NOMINAL CALIBRATION');
});

// ------------------------------------------------------------
// Collapsible panels
// ------------------------------------------------------------
document.querySelectorAll('[data-collapse]').forEach((head) => {
  head.addEventListener('click', () => {
    const panel = head.closest('.panel');
    const collapsed = panel.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
});

// ------------------------------------------------------------
// Fluid switches
// ------------------------------------------------------------
document.querySelectorAll('.flow-switch').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.flow;
    sim.particlesOn[key] = !sim.particlesOn[key];
    btn.classList.toggle('active', sim.particlesOn[key]);
    btn.setAttribute('aria-pressed', String(sim.particlesOn[key]));
  });
});

// ------------------------------------------------------------
// Ignition
// ------------------------------------------------------------
function toggleIgnition() {
  const on = sim.toggleRunning();
  $('ignitionBtn').classList.toggle('off', !on);
  $('ignitionBtn').setAttribute('aria-pressed', String(on));
  $('ignitionLabel').textContent = on ? 'IGNITION ON' : 'IGNITION OFF';
  $('livePill').classList.toggle('off', !on);
  $('liveText').textContent = on ? 'SIM LIVE' : 'IGNITION OFF';
  toast(on ? 'IGNITION ON — ENGINE RUNNING' : 'IGNITION OFF — ENGINE SPINNING DOWN');
}
$('ignitionBtn').addEventListener('click', toggleIgnition);

// ------------------------------------------------------------
// Audio
// ------------------------------------------------------------
async function ensureAudio() {
  if (audio.started) return true;
  const ok = await audio.start();
  if (ok) {
    audio.setVolume(sim.volume);
    syncAudioUI();
    toast('PROCEDURAL AUDIO ONLINE — WEB AUDIO SYNTHESIS');
  } else {
    toast('AUDIO UNAVAILABLE — WEB AUDIO BLOCKED');
  }
  return ok;
}

function syncAudioUI() {
  const on = audio.started && !audio.muted;
  const btn = $('audioToggle');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  $('audioLabel').textContent = on ? 'AUDIO ON' : (audio.started ? 'MUTED' : 'AUDIO OFF');
  $('audioState').classList.toggle('live', on);
  $('audioStateText').textContent = on ? 'LIVE SIGNAL' : (audio.started ? 'MUTED' : 'SIGNAL PREVIEW');
  $('muteBtn').classList.toggle('muted', !on);
  $('muteBtn').setAttribute('aria-pressed', String(!on));
  $('audioMeta').textContent = audio.started
    ? `${(audio.ctx.sampleRate / 1000).toFixed(0)} kHz`
    : 'STANDBY';
  $('audioHint').classList.toggle('hidden', audio.started);
}

async function onAudioToggle() {
  if (!audio.started) {
    const ok = await ensureAudio();
    if (ok) audio.setMuted(false);
  } else {
    audio.setMuted(!audio.muted);
    toast(audio.muted ? 'AUDIO MUTED' : 'AUDIO RESTORED');
  }
  syncAudioUI();
}

$('audioToggle').addEventListener('click', onAudioToggle);
$('muteBtn').addEventListener('click', async () => {
  if (!audio.started) {
    const ok = await ensureAudio();
    if (ok) audio.setMuted(false);
  } else {
    audio.setMuted(!audio.muted);
    toast(audio.muted ? 'AUDIO MUTED' : 'AUDIO RESTORED');
  }
  syncAudioUI();
});

let firstGesture = true;
function enableAudioFromGesture(event) {
  if (!firstGesture) return;
  const target = event?.target;
  if (target?.closest?.('#audioToggle, #muteBtn, #recordBtn')) return;
  firstGesture = false;
  if (!audio.started) ensureAudio();
}
window.addEventListener('pointerdown', enableAudioFromGesture, { once: true });
window.addEventListener('keydown', enableAudioFromGesture, { once: true });

// ------------------------------------------------------------
// Recording
// ------------------------------------------------------------
function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `apex-dyno-${sim.presetId}-${stamp}.webm`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}

function syncRecordUI() {
  const btn = $('recordBtn');
  btn.classList.toggle('recording', audio.recording);
  $('recordLabel').textContent = audio.recording ? 'STOP & EXPORT' : 'RECORD AUDIO';
  if (!audio.recording) $('recordTime').textContent = '00:00';
}

async function toggleRecording() {
  if (audio.recording) {
    const blob = await audio.stopRecording();
    syncRecordUI();
    if (blob) {
      downloadBlob(blob);
      toast('RECORDING EXPORTED — WEBM / OPUS AUDIO');
    } else {
      toast('RECORDING FAILED — NO AUDIO DATA');
    }
    return;
  }
  const ok = await ensureAudio();
  if (!ok) return;
  if (!audio.startRecording()) {
    toast('RECORDING UNSUPPORTED IN THIS BROWSER');
    return;
  }
  syncRecordUI();
  toast('RECORDING STARTED — AUDIO ONLY');
}
$('recordBtn').addEventListener('click', toggleRecording);

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------
function toast(message, duration = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ------------------------------------------------------------
// HUD
// ------------------------------------------------------------
function setHealth(name, value, warnAt, dangerAt) {
  const pct = clamp(value * 100, 0, 100);
  const val = $(`${name}Val`);
  const bar = $(`${name}Bar`);
  if (val) val.textContent = `${Math.round(pct)}%`;
  if (bar) {
    bar.style.width = `${pct}%`;
    const row = bar.closest('.health-row');
    if (row) {
      row.classList.toggle('warn', value > warnAt && value <= dangerAt);
      row.classList.toggle('danger', value > dangerAt);
    }
  }
}

function renderWarnings() {
  const key = sim.warnings.map((w) => `${w.label}:${w.danger ? 1 : 0}`).join('|');
  if (key === lastWarningKey) return;
  lastWarningKey = key;
  const list = $('warningList');
  const count = $('warningCount');
  if (count) count.textContent = String(sim.warnings.length);
  if (!list) return;
  if (!sim.warnings.length) {
    list.innerHTML = '<span class="warning-empty">All systems nominal</span>';
    return;
  }
  list.innerHTML = sim.warnings
    .map((w) => `<span class="warn-chip${w.danger ? ' danger' : ''}">${w.label}</span>`)
    .join('');
}

const warningMessages = {
  'REV LIMITER': 'REV LIMITER — FUEL CUT ACTIVE',
  'VALVE FLOAT': 'VALVE FLOAT — SPRING CONTROL LOST',
  'DETONATION': 'DETONATION — RETARD TIMING / RICHEN MIXTURE',
  'LEAN MIXTURE': 'LEAN MIXTURE — INCREASE FUEL',
  'THERMAL LIMIT': 'THERMAL LIMIT — REDUCE LOAD',
  'PISTON SLAP': 'PISTON SLAP — REDUCE ENGINE SPEED',
  'HIGH CR': 'HIGH COMPRESSION — CHECK FUEL OCTANE'
};

function updateHUD(force = false) {
  const p = sim.preset;
  const rpm = Math.round(sim.rpm);
  $('rpmBig').textContent = `${rpm}`;
  $('rpmValue').textContent = `${rpm}`;
  const fill = clamp(sim.rpm / p.maxRpm * 100, 0, 100);
  $('tachFill').style.width = `${fill}%`;
  $('rpmFill').style.width = `${fill}%`;

  $('powerOut').textContent = `${Math.round(sim.powerHp)}`;
  $('torqueOut').textContent = `${Math.round(sim.torque)}`;
  $('bmepOut').textContent = sim.bmep.toFixed(1);

  $('peakPressure').textContent = `${Math.round(sim.peakPressure)}`;
  $('volEff').textContent = `${Math.round(sim.volEff)}`;
  $('frictionLoss').textContent = sim.frictionHp.toFixed(1);
  $('oilTemp').textContent = `${Math.round(sim.oilTemp)}`;

  setHealth('valveFloat', sim.valveFloat, 0.5, 0.76);
  setHealth('pistonSlap', sim.pistonSlap, 0.55, 0.8);
  setHealth('thermal', sim.thermal, 0.62, 0.84);
  setHealth('detonation', sim.detonation, 0.35, 0.65);

  $('chargeVelocity').textContent = sim.chargeVelocity.toFixed(1);
  $('vpPhase').textContent = sim.phase.toUpperCase();
  $('vpCrank').textContent = `CRANK ${String(Math.round(sim.crankAngle)).padStart(3, '0')}°`;
  $('vpAf').textContent = `AFR ${sim.afr.toFixed(1)}`;
  $('cycleMeta').textContent = `CYCLE ${String(Math.round(sim.crankAngle)).padStart(3, '0')}°`;

  document.querySelectorAll('.phase-seg').forEach((seg) => {
    seg.classList.toggle('active', seg.dataset.phase === sim.phase);
  });

  renderWarnings();

  const danger = sim.warnings.find((w) => w.danger);
  const warn = danger || sim.warnings[0];
  const warningEl = $('viewportWarning');
  if (warn) {
    warningEl.textContent = warningMessages[warn.label] || warn.label;
    warningEl.classList.add('show');
  } else {
    warningEl.classList.remove('show');
  }

  const healthText = $('healthText');
  const healthDot = healthText?.parentElement?.querySelector('.dot');
  if (danger) {
    healthText.textContent = 'CRITICAL';
    healthDot.className = 'dot bad';
  } else if (warn) {
    healthText.textContent = 'CAUTION';
    healthDot.className = 'dot warn';
  } else {
    healthText.textContent = 'NOMINAL';
    healthDot.className = 'dot ok';
  }

  for (let i = 0; i < cylBarEls.length; i++) {
    const cyl = sim.cylinders[i];
    if (!cyl) continue;
    const ratio = clamp(cyl.pressure / 120, 0.01, 1);
    cylBarEls[i].bar.style.height = `${4 + ratio * 30}px`;
    cylBarEls[i].bar.style.background = ratio > 0.62
      ? 'linear-gradient(180deg, #fbbf24, #f97316)'
      : 'linear-gradient(180deg, #7dd3fc, #0ea5e9)';
    cylBarEls[i].bar.style.boxShadow = ratio > 0.62
      ? '0 0 7px rgba(251, 146, 60, .4)'
      : '0 0 6px rgba(56, 189, 248, .28)';
  }

  $('fpsOut').textContent = `${renderer.fps}`;
  $('livePill').classList.toggle('off', !sim.running);
  $('liveText').textContent = sim.running ? 'SIM LIVE' : 'IGNITION OFF';

  if (audio.recording) $('recordTime').textContent = formatTime(audio.recordingTime);
  if (force) lastHudUpdate = 0;
}

// ------------------------------------------------------------
// Visualizers
// ------------------------------------------------------------
const scopeCanvas = $('scopeCanvas');
const spectrumCanvas = $('spectrumCanvas');
const scopeSmooth = new Float32Array(64);
const specSmooth = new Float32Array(64);
const specPeaks = new Float32Array(64);
let timeData = null;
let freqData = null;

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function previewWave(x, i) {
  const f = clamp(sim.firingFrequency, 10, 520);
  const phase = sim.time * (1.2 + f * 0.024);
  const amp = (0.22 + sim.load / 100 * 0.68) * (sim.running ? 1 : 0.12);
  const a = Math.sin(x * TAU * 3 + phase * 3) * 0.44;
  const b = Math.sin(x * TAU * 6 + phase * 4.3 + 1.2) * 0.17;
  const c = Math.sin(x * TAU * 9 - phase * 2.6 + 2.1) * 0.075;
  const pulse = Math.pow(Math.max(0, Math.sin(x * TAU * 3 + phase * 3)), 10) * 0.2;
  return (a + b + c + pulse) * amp;
}

function previewSpectrum(freq) {
  const f = clamp(sim.firingFrequency, 10, 520);
  const load = sim.load / 100;
  const throttle = sim.throttle / 100;
  let m = 0.018;
  for (let n = 1; n <= 8; n++) {
    const width = f * 0.2 + 10;
    m += Math.exp(-Math.pow((freq - f * n) / width, 2)) * (1 / n) * (0.55 + load * 0.85);
  }
  m += Math.exp(-freq / 110) * 0.24 * (0.35 + load);
  m += Math.exp(-Math.pow((freq - 2800) / 2400, 2)) * throttle * 0.06;
  m += Math.exp(-Math.pow((freq - 6800) / 3200, 2)) * 0.035;
  return clamp(m, 0, 1);
}

function drawVisualizers() {
  const live = audio.started && audio.analyser;
  const analyser = audio.analyser;
  if (live) {
    if (!timeData || timeData.length !== analyser.fftSize) timeData = new Uint8Array(analyser.fftSize);
    if (!freqData || freqData.length !== analyser.frequencyBinCount) freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);
  }

  const scope = fitCanvas(scopeCanvas);
  if (scope) {
    const { ctx, w, h } = scope;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(3, 13, 27, .7)');
    bg.addColorStop(1, 'rgba(2, 8, 18, .85)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(56, 189, 248, .09)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (w * i) / 4;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let i = 1; i < 3; i++) {
      const y = (h * i) / 3;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(56, 189, 248, .18)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    const n = 220;
    const points = [];
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      let v;
      if (live) {
        const idx = Math.floor(x * (timeData.length - 1));
        v = (timeData[idx] - 128) / 128;
      } else {
        v = previewWave(x, i);
      }
      scopeSmooth[i % 64] = scopeSmooth[i % 64] * 0.35 + v * 0.65;
      points.push({ x: x * w, y: h / 2 - v * h * 0.42 });
    }

    // Fill under wave.
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(56, 189, 248, .16)');
    fill.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, h / 2);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(points[points.length - 1].x, h / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(56, 189, 248, .85)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = 'rgba(125, 211, 252, .92)';
    ctx.lineWidth = 1.15;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    // Scanning playhead.
    const headX = ((sim.time * 0.16) % 1) * w;
    const grad = ctx.createLinearGradient(headX - 14, 0, headX, 0);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
    grad.addColorStop(1, 'rgba(125, 211, 252, .22)');
    ctx.fillStyle = grad;
    ctx.fillRect(headX - 14, 0, 14, h);

    if (!live) {
      ctx.font = '600 5.5px "DejaVu Sans Mono", monospace';
      ctx.fillStyle = 'rgba(125, 211, 252, .38)';
      ctx.fillText('PREVIEW', 5, h - 5);
    }
  }

  const spec = fitCanvas(spectrumCanvas);
  if (spec) {
    const { ctx, w, h } = spec;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(3, 13, 27, .7)');
    bg.addColorStop(1, 'rgba(2, 8, 18, .85)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(56, 189, 248, .08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const fMin = 30;
    const fMax = 12000;
    const bars = 64;
    const gap = 1;
    const barW = Math.max(1, w / bars - gap);
    const nyquist = live ? audio.ctx.sampleRate / 2 : 24000;
    const binHz = live ? nyquist / freqData.length : 0;

    for (let i = 0; i < bars; i++) {
      const x0 = i / bars;
      const x1 = (i + 1) / bars;
      const fLo = fMin * Math.pow(fMax / fMin, x0);
      const fHi = fMin * Math.pow(fMax / fMin, x1);
      let m;
      if (live) {
        const b0 = clamp(Math.floor(fLo / binHz), 0, freqData.length - 1);
        const b1 = clamp(Math.ceil(fHi / binHz), b0, freqData.length - 1);
        let peak = 0;
        for (let b = b0; b <= b1; b++) peak = Math.max(peak, freqData[b] / 255);
        m = peak;
      } else {
        m = previewSpectrum((fLo + fHi) / 2);
      }
      specSmooth[i] = Math.max(m, specSmooth[i] * 0.82);
      specPeaks[i] = Math.max(specSmooth[i], specPeaks[i] - 0.012);
      const v = specSmooth[i];
      const bh = Math.max(1, v * (h - 9));
      const x = i * (w / bars);
      const y = h - 6 - bh;
      const grad = ctx.createLinearGradient(0, h - 6, 0, y);
      grad.addColorStop(0, `rgba(34, 211, 238, ${0.4 + v * 0.55})`);
      grad.addColorStop(0.55, `rgba(56, 189, 248, ${0.5 + v * 0.5})`);
      grad.addColorStop(1, v > 0.72 ? 'rgba(251, 146, 60, .95)' : 'rgba(99, 102, 241, .9)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, bh);
      // Peak cap.
      const peakY = h - 6 - Math.max(1, specPeaks[i] * (h - 9));
      ctx.fillStyle = specPeaks[i] > 0.72 ? 'rgba(253, 186, 116, .9)' : 'rgba(165, 243, 252, .8)';
      ctx.fillRect(x, peakY, barW, 1);
    }

    ctx.font = '600 5px "DejaVu Sans Mono", monospace';
    ctx.fillStyle = 'rgba(104, 174, 235, .4)';
    ctx.textAlign = 'left';
    ctx.fillText('20', 2, h - 1);
    ctx.fillText('200', w * 0.33, h - 1);
    ctx.fillText('2k', w * 0.66, h - 1);
    ctx.textAlign = 'right';
    ctx.fillText('10k', w - 2, h - 1);

    if (!live) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(125, 211, 252, .38)';
      ctx.fillText('PREVIEW', w - 4, 8);
    }
  }

  $('scopeMeta').textContent = live ? (audio.muted ? 'MUTED' : 'LIVE') : 'PREVIEW';
  $('fftMeta').textContent = live ? '2048 PT' : '2048 PT';
}

// ------------------------------------------------------------
// Keyboard
// ------------------------------------------------------------
window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
  const key = event.key.toLowerCase();
  if (event.code === 'Space') {
    event.preventDefault();
    toggleIgnition();
  } else if (key === 'm') {
    $('muteBtn').click();
  } else if (key === 'r') {
    $('recordBtn').click();
  } else if (key === '1') {
    applyPreset('i4');
  } else if (key === '2') {
    applyPreset('v6');
  } else if (key === '3') {
    applyPreset('v8');
  }
});

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------
function frame(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  dt = clamp(dt || 0.016, 0.001, 0.05);

  sim.update(dt);

  if (audio.started && now - lastAudioUpdate > 32) {
    audio.update(sim, (now - lastAudioUpdate) / 1000);
    lastAudioUpdate = now;
  }

  renderer.draw(now);

  if (now - lastHudUpdate > 90) {
    updateHUD();
    lastHudUpdate = now;
  }
  if (now - lastVizUpdate > 32) {
    drawVisualizers();
    lastVizUpdate = now;
  }

  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastFrame = performance.now();
});

// Initial paint.
syncPresetUI();
updateHUD(true);
drawVisualizers();
requestAnimationFrame(frame);

// Expose for diagnostics / external checks.
window.__APEX__ = { sim, renderer, audio, presets: PRESETS };
