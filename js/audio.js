/* ============================================================
   APEX // DYNO — procedural Web Audio engine
   No samples. Every sound is synthesized from the live model.
   ============================================================ */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class AudioEngine {
  constructor(sim) {
    this.sim = sim;
    this.ctx = null;
    this.started = false;
    this.starting = false;
    this.analyser = null;
    this.master = null;
    this.compressor = null;
    this.streamDest = null;
    this.nodes = {};
    this.volume = 0.7;
    this.muted = false;
    this.noiseBuffer = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.recording = false;
    this.recordStartedAt = 0;
    this.lastKnock = 0;
    this.fftSize = 2048;
  }

  async start() {
    if (this.started) return true;
    if (this.starting) return this.startPromise;
    this.starting = true;
    this.startPromise = (async () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('Web Audio API is not available');
        this.ctx = new Ctx({ latencyHint: 'interactive' });
        this.buildGraph();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this.started = true;
        this.update(this.sim, 0.016);
        return true;
      } catch (error) {
        console.warn('Audio engine failed to start:', error);
        this.started = false;
        return false;
      } finally {
        this.starting = false;
      }
    })();
    return this.startPromise;
  }

  makeNoiseBuffer(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.18 + white * 0.82;
      data[i] = last;
    }
    return buffer;
  }

  buildGraph() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.28;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -92;
    this.analyser.maxDecibels = -12;

    this.master.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.streamDest = ctx.createMediaStreamDestination();
    this.compressor.connect(this.streamDest);

    this.noiseBuffer = this.makeNoiseBuffer(2.5);

    // ---------- Engine core bus ----------
    const toneBus = ctx.createGain();
    toneBus.gain.value = 0.9;

    const saturator = ctx.createWaveShaper();
    saturator.curve = this.makeSaturationCurve(1.6);
    saturator.oversample = '2x';

    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 1400;
    toneFilter.Q.value = 1.15;

    toneBus.connect(saturator);
    saturator.connect(toneFilter);
    toneFilter.connect(this.master);

    // Rich firing-order wave.
    const harmonics = 28;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      imag[n] = (1 / n) * (n % 2 === 0 ? 0.42 : 0.95) * (n < 10 ? 1 : 0.45);
    }
    const engineWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    const oscTone = ctx.createOscillator();
    oscTone.setPeriodicWave(engineWave);
    oscTone.frequency.value = 60;
    const oscToneGain = ctx.createGain();
    oscToneGain.gain.value = 0.17;
    oscTone.connect(oscToneGain).connect(toneBus);

    const oscDetune = ctx.createOscillator();
    oscDetune.type = 'sawtooth';
    oscDetune.frequency.value = 60.6;
    oscDetune.detune.value = 6;
    const oscDetuneGain = ctx.createGain();
    oscDetuneGain.gain.value = 0.065;
    oscDetune.connect(oscDetuneGain).connect(toneBus);

    const oscSub = ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = 30;
    const oscSubGain = ctx.createGain();
    oscSubGain.gain.value = 0.2;
    oscSub.connect(oscSubGain).connect(toneBus);

    const oscHalf = ctx.createOscillator();
    oscHalf.type = 'triangle';
    oscHalf.frequency.value = 30;
    const oscHalfGain = ctx.createGain();
    oscHalfGain.gain.value = 0.055;
    oscHalf.connect(oscHalfGain).connect(toneBus);

    // ---------- Exhaust ----------
    const exhaustNoise = ctx.createBufferSource();
    exhaustNoise.buffer = this.noiseBuffer;
    exhaustNoise.loop = true;
    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = 'lowpass';
    exhaustFilter.frequency.value = 520;
    exhaustFilter.Q.value = 0.85;
    const exhaustGain = ctx.createGain();
    exhaustGain.gain.value = 0.07;
    exhaustNoise.connect(exhaustFilter).connect(exhaustGain).connect(this.master);

    const exhaustLfo = ctx.createOscillator();
    exhaustLfo.type = 'sine';
    exhaustLfo.frequency.value = 30;
    const exhaustLfoDepth = ctx.createGain();
    exhaustLfoDepth.gain.value = 0.05;
    exhaustLfo.connect(exhaustLfoDepth).connect(exhaustGain.gain);

    const exhaustSub = ctx.createOscillator();
    exhaustSub.type = 'sine';
    exhaustSub.frequency.value = 32;
    const exhaustSubGain = ctx.createGain();
    exhaustSubGain.gain.value = 0.07;
    exhaustSub.connect(exhaustSubGain).connect(this.master);

    // ---------- Intake ----------
    const intakeNoise = ctx.createBufferSource();
    intakeNoise.buffer = this.noiseBuffer;
    intakeNoise.loop = true;
    intakeNoise.playbackRate.value = 1.17;
    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 1800;
    intakeFilter.Q.value = 0.7;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0.018;
    intakeNoise.connect(intakeFilter).connect(intakeGain).connect(this.master);

    const intakeWhistle = ctx.createOscillator();
    intakeWhistle.type = 'sine';
    intakeWhistle.frequency.value = 1800;
    const intakeWhistleGain = ctx.createGain();
    intakeWhistleGain.gain.value = 0.008;
    intakeWhistle.connect(intakeWhistleGain).connect(this.master);

    // ---------- Valve train ----------
    const valveNoise = ctx.createBufferSource();
    valveNoise.buffer = this.noiseBuffer;
    valveNoise.loop = true;
    valveNoise.playbackRate.value = 1.42;
    const valveFilter = ctx.createBiquadFilter();
    valveFilter.type = 'highpass';
    valveFilter.frequency.value = 2900;
    valveFilter.Q.value = 0.9;
    const valveGain = ctx.createGain();
    valveGain.gain.value = 0.012;
    valveNoise.connect(valveFilter).connect(valveGain).connect(this.master);

    const valveLfo = ctx.createOscillator();
    valveLfo.type = 'square';
    valveLfo.frequency.value = 7;
    const valveLfoDepth = ctx.createGain();
    valveLfoDepth.gain.value = 0.009;
    valveLfo.connect(valveLfoDepth).connect(valveGain.gain);

    // ---------- Mechanical friction ----------
    const frictionNoise = ctx.createBufferSource();
    frictionNoise.buffer = this.noiseBuffer;
    frictionNoise.loop = true;
    frictionNoise.playbackRate.value = 0.8;
    const frictionFilter = ctx.createBiquadFilter();
    frictionFilter.type = 'lowpass';
    frictionFilter.frequency.value = 210;
    const frictionGain = ctx.createGain();
    frictionGain.gain.value = 0.03;
    frictionNoise.connect(frictionFilter).connect(frictionGain).connect(this.master);

    const frictionHum = ctx.createOscillator();
    frictionHum.type = 'sawtooth';
    frictionHum.frequency.value = 120;
    const frictionHumFilter = ctx.createBiquadFilter();
    frictionHumFilter.type = 'lowpass';
    frictionHumFilter.frequency.value = 340;
    const frictionHumGain = ctx.createGain();
    frictionHumGain.gain.value = 0.012;
    frictionHum.connect(frictionHumFilter).connect(frictionHumGain).connect(this.master);

    // ---------- Turbo whistle ----------
    const turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = 5200;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboGain).connect(this.master);

    const turboAir = ctx.createBufferSource();
    turboAir.buffer = this.noiseBuffer;
    turboAir.loop = true;
    turboAir.playbackRate.value = 1.65;
    const turboAirFilter = ctx.createBiquadFilter();
    turboAirFilter.type = 'bandpass';
    turboAirFilter.frequency.value = 4200;
    turboAirFilter.Q.value = 1.6;
    const turboAirGain = ctx.createGain();
    turboAirGain.gain.value = 0;
    turboAir.connect(turboAirFilter).connect(turboAirGain).connect(this.master);

    // ---------- Start all sources ----------
    const sources = [oscTone, oscDetune, oscSub, oscHalf, exhaustNoise, exhaustLfo, exhaustSub,
      intakeNoise, intakeWhistle, valveNoise, valveLfo, frictionNoise, frictionHum, turboOsc, turboAir];
    for (const src of sources) src.start(t);

    this.nodes = {
      toneBus, saturator, toneFilter, oscTone, oscToneGain, oscDetune, oscDetuneGain,
      oscSub, oscSubGain, oscHalf, oscHalfGain,
      exhaustNoise, exhaustFilter, exhaustGain, exhaustLfo, exhaustLfoDepth, exhaustSub, exhaustSubGain,
      intakeNoise, intakeFilter, intakeGain, intakeWhistle, intakeWhistleGain,
      valveNoise, valveFilter, valveGain, valveLfo, valveLfoDepth,
      frictionNoise, frictionFilter, frictionGain, frictionHum, frictionHumGain,
      turboOsc, turboGain, turboAir, turboAirGain
    };
  }

  makeSaturationCurve(amount = 1.5) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) {
      const target = this.muted ? 0 : this.volume;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  update(sim, dt) {
    if (!this.started || !this.ctx) return;
    const n = this.nodes;
    const t = this.ctx.currentTime;
    const redline = sim.preset.redline;
    const rpm = Math.max(0, sim.rpm);
    const rpmN = clamp(rpm / redline, 0, 1.3);
    const load = sim.load / 100;
    const throttle = sim.throttle / 100;
    const running = sim.running;
    const activity = running ? 1 : 0.04;

    const fFire = clamp(sim.firingFrequency, 8, 700);
    const fSub = Math.max(18, fFire / 2);
    const camFreq = Math.max(2.5, rpm / 120);
    const jitter = 1 + Math.sin(sim.time * 7.3) * 0.0015;

    // Core engine tone.
    n.oscTone.frequency.setTargetAtTime(fFire * jitter, t, 0.025);
    n.oscDetune.frequency.setTargetAtTime(fFire * 1.007 * jitter, t, 0.03);
    n.oscSub.frequency.setTargetAtTime(fSub, t, 0.03);
    n.oscHalf.frequency.setTargetAtTime(Math.max(14, fSub * 0.5), t, 0.04);

    const toneGain = (0.1 + load * 0.16 + throttle * 0.05 + sim.avgPressure * 0.002) * activity;
    n.oscToneGain.gain.setTargetAtTime(toneGain, t, 0.06);
    n.oscDetuneGain.gain.setTargetAtTime(toneGain * 0.36, t, 0.07);
    n.oscSubGain.gain.setTargetAtTime((0.08 + load * 0.12) * activity, t, 0.08);
    n.oscHalfGain.gain.setTargetAtTime((0.025 + load * 0.035) * activity, t, 0.08);

    const cut = 210 + rpm * 0.23 + throttle * 880 + load * 560;
    n.toneFilter.frequency.setTargetAtTime(cut, t, 0.05);
    n.toneFilter.Q.setTargetAtTime(1.1 + load * 0.8, t, 0.1);

    // Exhaust pulses.
    const exhaustBase = (0.025 + load * 0.15 + throttle * 0.035) * activity;
    n.exhaustGain.gain.setTargetAtTime(exhaustBase, t, 0.07);
    n.exhaustFilter.frequency.setTargetAtTime(150 + rpm * 0.13 + load * 500, t, 0.07);
    n.exhaustLfo.frequency.setTargetAtTime(fFire, t, 0.03);
    n.exhaustLfoDepth.gain.setTargetAtTime((0.035 + load * 0.1) * activity * (0.45 + (sim.exhaustTone ?? sim.preset.exhaustTone)), t, 0.08);
    n.exhaustSub.frequency.setTargetAtTime(fSub * 0.82, t, 0.05);
    n.exhaustSubGain.gain.setTargetAtTime((0.03 + load * 0.06) * activity * (sim.preset.tone === 'deep' ? 1.5 : 1), t, 0.09);

    // Intake suction.
    const intake = (0.006 + throttle * 0.05 + rpmN * 0.012) * (0.5 + (sim.intakeTone ?? sim.preset.intakeTone)) * activity;
    n.intakeGain.gain.setTargetAtTime(intake, t, 0.08);
    n.intakeFilter.frequency.setTargetAtTime(750 + rpm * 0.33 + throttle * 900, t, 0.08);
    n.intakeWhistle.frequency.setTargetAtTime(1100 + rpm * 0.42 + throttle * 380, t, 0.09);
    n.intakeWhistleGain.gain.setTargetAtTime((0.0015 + throttle * 0.011 + rpmN * 0.003) * activity, t, 0.1);

    // Valve train clatter.
    const valve = (0.004 + rpmN * 0.026) * (0.5 + sim.preset.valvetrain) * activity;
    n.valveGain.gain.setTargetAtTime(valve, t, 0.06);
    n.valveLfo.frequency.setTargetAtTime(camFreq, t, 0.05);
    n.valveLfoDepth.gain.setTargetAtTime(valve * 0.8, t, 0.08);
    n.valveFilter.frequency.setTargetAtTime(2500 + rpm * 0.16, t, 0.08);

    // Friction + hum.
    n.frictionGain.gain.setTargetAtTime((0.008 + rpmN * 0.018 + load * 0.006) * activity, t, 0.1);
    n.frictionFilter.frequency.setTargetAtTime(160 + rpm * 0.02, t, 0.1);
    n.frictionHum.frequency.setTargetAtTime(Math.max(20, rpm / 60 * 2), t, 0.06);
    n.frictionHumGain.gain.setTargetAtTime((0.004 + rpmN * 0.01) * activity, t, 0.1);

    // Turbocharger (preset dependent).
    const turboAmount = sim.preset.turbo || 0;
    const turbo = turboAmount * throttle * (0.012 + rpmN * 0.035) * activity;
    n.turboGain.gain.setTargetAtTime(turbo, t, 0.12);
    n.turboAirGain.gain.setTargetAtTime(turbo * 0.7, t, 0.12);
    n.turboOsc.frequency.setTargetAtTime(3600 + rpm * 0.62 + throttle * 1100, t, 0.1);
    n.turboAirFilter.frequency.setTargetAtTime(2800 + rpm * 0.45, t, 0.1);

    // Fuel cut / limiter chop.
    if (sim.limiterActive && sim.fuelCut) {
      n.toneBus.gain.setTargetAtTime(0.18, t, 0.008);
      n.exhaustGain.gain.setTargetAtTime(exhaustBase * 0.2, t, 0.008);
    } else {
      n.toneBus.gain.setTargetAtTime(0.9, t, 0.02);
    }

    // Detonation knock.
    if (sim.knock > 0.85 && t - this.lastKnock > 0.07) {
      this.lastKnock = t;
      this.playKnock(clamp(sim.detonation, 0.3, 1));
    }
  }

  playKnock(strength = 0.6) {
    if (!this.started || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1450 + Math.random() * 900;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.8, 0.12);
  }

  startRecording() {
    if (!this.started) return false;
    if (this.recording) return true;
    if (!window.MediaRecorder) return false;
    const options = { mimeType: 'audio/webm' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'audio/webm;codecs=opus';
    }
    try {
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.streamDest.stream, options);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) this.chunks.push(event.data);
      };
      this.mediaRecorder.start(250);
      this.recording = true;
      this.recordStartedAt = performance.now();
      return true;
    } catch (error) {
      console.warn('Recording failed:', error);
      this.recording = false;
      return false;
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || !this.recording) {
        resolve(null);
        return;
      }
      const recorder = this.mediaRecorder;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.chunks = [];
        this.recording = false;
        this.mediaRecorder = null;
        resolve(blob);
      };
      try {
        recorder.stop();
      } catch {
        this.recording = false;
        resolve(null);
      }
    });
  }

  get recordingTime() {
    return this.recording ? (performance.now() - this.recordStartedAt) / 1000 : 0;
  }
}
