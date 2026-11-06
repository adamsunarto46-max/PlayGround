/* Tiny procedural engine soundtrack: firing frequency, exhaust noise, knock ticks. */

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.knockCooldown = 0;
  }

  start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // exhaust noise loop
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 180;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    // firing harmonic stack
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 12;
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscB.frequency.value = 24;
    this.oscB.detune.value = 7;
    this.oscFilter = ctx.createBiquadFilter();
    this.oscFilter.type = 'lowpass';
    this.oscFilter.frequency.value = 420;
    this.oscFilter.Q.value = 1.2;
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;
    this.oscA.connect(this.oscFilter);
    this.oscB.connect(this.oscFilter);
    this.oscFilter.connect(this.oscGain).connect(this.master);
    this.oscA.start();
    this.oscB.start();

    // intake honk
    this.intakeOsc = ctx.createOscillator();
    this.intakeOsc.type = 'triangle';
    this.intakeOsc.frequency.value = 30;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 260;
    this.intakeFilter.Q.value = 2.5;
    this.intakeOsc.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    this.intakeOsc.start();

    this.started = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  silence() {
    if (!this.started || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.oscGain?.gain.setTargetAtTime(0, now, 0.04);
    this.noiseGain?.gain.setTargetAtTime(0, now, 0.04);
    this.intakeGain?.gain.setTargetAtTime(0, now, 0.04);
  }

  update(engine, throttle, load, dt = 1 / 60) {
    if (!this.started || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const rpm = (engine.omega * 60) / (Math.PI * 2);
    const running = rpm > 120;
    const firing = Math.max(3, rpm / 120);
    const loadF = Math.min(1, load / 100);
    const thr = Math.min(1, throttle / 100);

    const amp = running ? 0.028 + thr * 0.045 + loadF * 0.05 : 0.002;
    this.oscGain.gain.setTargetAtTime(amp, now, 0.06);
    this.noiseGain.gain.setTargetAtTime(running ? 0.012 + thr * 0.04 + loadF * 0.05 : 0.001, now, 0.08);
    this.intakeGain.gain.setTargetAtTime(running ? 0.008 + thr * 0.035 : 0, now, 0.08);

    this.oscA.frequency.setTargetAtTime(firing, now, 0.035);
    this.oscB.frequency.setTargetAtTime(firing * 2.01, now, 0.035);
    this.oscFilter.frequency.setTargetAtTime(260 + rpm * 0.14 + thr * 600, now, 0.08);
    this.noiseFilter.frequency.setTargetAtTime(120 + rpm * 0.055 + loadF * 160, now, 0.1);
    this.intakeOsc.frequency.setTargetAtTime(firing * 1.5, now, 0.05);
    this.intakeFilter.frequency.setTargetAtTime(190 + rpm * 0.09 + thr * 450, now, 0.08);

    // knock ticks
    this.knockCooldown -= dt;
    if (engine.knock > 0.22 && this.knockCooldown <= 0) {
      this.knockCooldown = 0.18 + Math.random() * 0.2;
      this.tick(0.05 + engine.knock * 0.10);
    }
  }

  tick(level) {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted) return;
    const ctx = this.ctx;
    const dur = 0.035;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
