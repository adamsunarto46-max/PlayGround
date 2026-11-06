/* SINGLE CYLINDER — dyno-cell campaign controller. */

import { Engine } from './engine.js';
import { SceneRenderer } from './render/scene.js';
import { EngineAudio } from './audio.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const $ = (id) => document.getElementById(id);
const rpmOf = (e) => (e.omega * 60) / TAU;

const SAVE_KEY = 'single-cylinder-career.v1';
const DEFAULT_SAVE = {
  v: 1,
  cash: 400,
  unlocked: 0,
  medals: {},
  bestTime: {},
  upgrades: {},
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SAVE),
      ...parsed,
      medals: parsed.medals || {},
      bestTime: parsed.bestTime || {},
      upgrades: parsed.upgrades || {},
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

let save = loadSave();

/* ------------------------------------------------------------------ */
/* Stage definitions                                                   */
/* ------------------------------------------------------------------ */

const rpmCond = (min, max) => ({
  label: `RPM ${min}–${max}`,
  test: (e) => rpmOf(e) >= min && rpmOf(e) <= max,
});
const loadCond = (min, max) => ({
  label: `LOAD ${min}–${max}%`,
  test: (e) => e.load >= min && e.load <= max,
});
const torqueCond = (min) => ({
  label: `TORQUE ≥ ${min} Nm`,
  test: (e) => e.torque >= min,
});
const powerCond = (min) => ({
  label: `POWER ≥ ${min} kW`,
  test: (e) => e.powerKW >= min,
});
const advanceCond = (min) => ({
  label: `TIMING ≥ ${min}°`,
  test: (e) => e.advance >= min,
});
const knockCond = (maxPct) => ({
  label: `KNOCK ≤ ${maxPct}%`,
  test: (e) => e.knock * 100 <= maxPct,
});
const coolantCond = (min) => ({
  label: `COOLANT ≥ ${min}°C`,
  test: (e) => e.wallC >= min,
});
const healthCond = (min) => ({
  label: `HEALTH ≥ ${min}%`,
  test: (e) => e.health >= min,
});

const STAGES = [
  {
    id: 'first',
    name: 'FIRST BREATH',
    brief: 'Cold-start the mule and settle it into a stable idle.',
    setup: { throttle: 0, advance: 12, load: 0 },
    conds: [rpmCond(850, 1300)],
    hold: 4,
    timeLimit: 40,
    par: 14,
    reward: 900,
    coach: 'auto-crank engaged — feather the throttle to hold 850–1300 rpm',
    tip: 'A closed throttle settles just under 1000 rpm. A few percent is all it takes.',
  },
  {
    id: 'load',
    name: 'LOAD BANK',
    brief: 'Pull the engine against the dyno brake and hold the midrange.',
    setup: { throttle: 18, advance: 12, load: 25 },
    conds: [rpmCond(2600, 3600), loadCond(20, 30)],
    hold: 8,
    timeLimit: 60,
    par: 25,
    reward: 1300,
    coach: 'raise throttle to pull against the 25% brake',
    tip: 'At 25% load the engine needs roughly 25–33% throttle to sit near 3000 rpm.',
  },
  {
    id: 'torque',
    name: 'TORQUE PLATEAU',
    brief: 'Open the throttle wide and find the engine\'s torque plateau.',
    setup: { throttle: 55, advance: 14, load: 35 },
    conds: [torqueCond(24), rpmCond(3600, 4700)],
    hold: 8,
    timeLimit: 65,
    par: 27,
    reward: 1700,
    coach: 'open the throttle — the brake is already loaded',
    tip: 'Full throttle at 35% load lands just under 4000 rpm with about 27 Nm.',
  },
  {
    id: 'timing',
    name: 'TIMING TRAP',
    brief: 'Make power at the top end without crossing into detonation.',
    setup: { throttle: 75, advance: 12, load: 10 },
    conds: [rpmCond(6500, 7100), powerCond(17), advanceCond(19), knockCond(15)],
    hold: 8,
    timeLimit: 70,
    par: 28,
    reward: 1900,
    coach: 'add advance until timing passes 19° — keep knock under 15%',
    tip: 'Around 20–21° is the sweet spot on 98 RON. Past 22° the knock meter climbs fast.',
  },
  {
    id: 'heat',
    name: 'HEAT SOAK',
    brief: 'Bring the coolant up to temperature under sustained load.',
    setup: { throttle: 50, advance: 12, load: 40 },
    conds: [rpmCond(3700, 4400), loadCond(35, 45), coolantCond(80)],
    hold: 8,
    timeLimit: 100,
    par: 55,
    reward: 2300,
    coach: 'hold part throttle — let the coolant climb to 80°C',
    tip: 'There is no shortcut to temperature. Keep load near 40% and let the block soak.',
  },
  {
    id: 'redline',
    name: 'REDLINE SHIFT',
    brief: 'Take the single into the red zone and keep it there.',
    setup: { throttle: 85, advance: 14, load: 10 },
    conds: [rpmCond(6700, 7080), healthCond(60)],
    hold: 8,
    timeLimit: 60,
    par: 26,
    reward: 2800,
    coach: 'full throttle into the 6700–7080 rpm band',
    tip: 'The limiter is soft. Above 7250 rpm the health bar starts to fall.',
  },
];

const UPGRADES = [
  { key: 'port', name: 'PORT & POLISH', price: 1600, desc: '+18% intake flow. Stronger top-end breathing.' },
  { key: 'radiator', name: 'ALLOY RADIATOR', price: 1400, desc: '+75% coolant heat rejection. Longer dyno runs.' },
  { key: 'ecu', name: 'RACE ECU', price: 1800, desc: '+3.5° of detonation margin. Run more advance safely.' },
  { key: 'forged', name: 'FORGED INTERNALS', price: 2200, desc: '−55% damage from knock, heat and over-rev.' },
];

const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const sceneCanvas = $('scene');
const tachCanvas = $('tach');
const tachCtx = tachCanvas.getContext('2d');
const renderer = new SceneRenderer(sceneCanvas);
const audio = new EngineAudio();
const engine = new Engine();
applyModsToEngine();
window.__sc = { renderer, engine, audio };

const demo = new Engine();
demo.throttle = 0.06;
demo.advance = 12;
demo.starter = true;
let demoCaught = false;
let demoT = 0;

let phase = 'title';
let garageReturn = 'title';
let garageSelected = 0;
let starterHeld = false;
let starterKey = false;
const keys = new Set();
let lastFrame = performance.now();
let toastTimer = 0;
let knockWas = 0;
let heatWarned = false;
let stallWarned = false;

const game = {
  stageIndex: 0,
  stage: STAGES[0],
  time: 0,
  hold: 0,
  started: false,
  hasCaught: false,
  autoCrank: 0,
  stalledFor: 0,
  paused: false,
  result: null,
  peakKW: 0,
  peakTorque: 0,
  peakRpm: 0,
  control: { throttle: 0, advance: 12, load: 0 },
  condEls: [],
};

const sliders = {
  throttle: $('throttle'),
  advance: $('advance'),
  load: $('load'),
};

/* ------------------------------------------------------------------ */
/* Save / upgrades                                                     */
/* ------------------------------------------------------------------ */
function applyModsToEngine() {
  engine.mods = {
    port: save.upgrades.port ? 1 : 0,
    radiator: save.upgrades.radiator ? 1 : 0,
    ecu: save.upgrades.ecu ? 1 : 0,
    forged: save.upgrades.forged ? 1 : 0,
  };
}

function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
}

function completedCount() {
  return STAGES.reduce((n, s) => n + (save.medals[s.id] ? 1 : 0), 0);
}

function firstUnfinished() {
  const i = STAGES.findIndex((s) => !save.medals[s.id]);
  return i >= 0 ? i : 0;
}

function updateTitleSave() {
  const n = completedCount();
  const parts = Object.keys(save.upgrades).filter((k) => save.upgrades[k]).length;
  $('titleSave').textContent = n === 0
    ? 'New career · six tests · stock SC-1'
    : `${n}/6 tests cleared · $${save.cash.toLocaleString()} · ${parts} part${parts === 1 ? '' : 's'} fitted`;
}

/* ------------------------------------------------------------------ */
/* HUD helpers                                                         */
/* ------------------------------------------------------------------ */
function syncSlider(el) {
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty('--pct', pct + '%');
}

function setControl(name, value) {
  const v = clamp(Math.round(value), Number(sliders[name].min), Number(sliders[name].max));
  sliders[name].value = String(v);
  game.control[name] = v;
  syncSlider(sliders[name]);
  const out = { throttle: $('throttleVal'), advance: $('advanceVal'), load: $('loadVal') }[name];
  out.textContent = name === 'advance' ? `${v}°` : `${v}%`;
}

for (const name of Object.keys(sliders)) {
  sliders[name].addEventListener('input', (e) => {
    game.control[name] = Number(e.target.value);
    syncSlider(e.target);
    const out = { throttle: $('throttleVal'), advance: $('advanceVal'), load: $('loadVal') }[name];
    out.textContent = name === 'advance' ? `${e.target.value}°` : `${e.target.value}%`;
  });
  syncSlider(sliders[name]);
}

function setStarter(held) {
  starterHeld = held;
  $('starterBtn').classList.toggle('active', held);
}

$('starterBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  $('starterBtn').setPointerCapture?.(e.pointerId);
  setStarter(true);
  audio.start();
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  $('starterBtn').addEventListener(ev, () => setStarter(false));
}

$('soundBtn').addEventListener('click', () => {
  audio.start();
  audio.setMuted(!audio.muted);
  $('soundBtn').classList.toggle('muted', audio.muted);
  $('soundBtn').textContent = audio.muted ? 'MUTE' : 'SND';
});

function showToast(text, kind = 'bad', duration = 1.35) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast show' + (kind === 'good' ? ' good' : '');
  toastTimer = duration;
}

function setCoach(text) {
  $('coachText').textContent = text;
  $('coach').classList.remove('hide');
}

function hideCoach() {
  $('coach').classList.add('hide');
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Stage card                                                          */
/* ------------------------------------------------------------------ */
function renderStageCard(stage) {
  $('testNo').textContent = `TEST ${String(game.stageIndex + 1).padStart(2, '0')}`;
  $('testName').textContent = stage.name;
  $('testBrief').textContent = stage.brief;
  const list = $('conditionList');
  list.innerHTML = '';
  game.condEls = stage.conds.map((c) => {
    const el = document.createElement('span');
    el.className = 'cond';
    el.textContent = c.label;
    list.appendChild(el);
    return el;
  });
  $('progressLabel').textContent = `0.0 / ${stage.hold.toFixed(1)} s`;
  $('progressFill').style.width = '0%';
  $('testStatus').textContent = 'LIVE';
  $('testStatus').className = 'live';
}

function renderStageTrack() {
  const track = $('stageTrack');
  track.innerHTML = '';
  STAGES.forEach((s, i) => {
    const done = Boolean(save.medals[s.id]);
    const unlocked = i <= save.unlocked;
    const d = document.createElement('div');
    d.className = 'stage-dot' + (done ? ' done' : i === game.stageIndex && phase !== 'title' ? ' current' : '') + (unlocked ? '' : ' locked');
    d.textContent = done ? '✓' : String(i + 1).padStart(2, '0');
    d.title = unlocked ? s.name : 'LOCKED';
    track.appendChild(d);
  });
}

/* ------------------------------------------------------------------ */
/* Game flow                                                           */
/* ------------------------------------------------------------------ */
function startStage(index, fromUser = true) {
  const i = clamp(index, 0, STAGES.length - 1);
  game.stageIndex = i;
  game.stage = STAGES[i];
  game.time = 0;
  game.hold = 0;
  game.started = false;
  game.hasCaught = false;
  game.autoCrank = 3.2;
  game.stalledFor = 0;
  game.paused = false;
  game.result = null;
  game.peakKW = 0;
  game.peakTorque = 0;
  game.peakRpm = 0;
  knockWas = 0;
  heatWarned = false;
  stallWarned = false;
  starterHeld = false;
  starterKey = false;
  setStarter(false);
  keys.clear();

  engine.reset({ cold: true, health: 100 });
  applyModsToEngine();
  setControl('throttle', game.stage.setup.throttle);
  setControl('advance', game.stage.setup.advance);
  setControl('load', game.stage.setup.load);

  // Pre-roll the cold-start so the cell is already alive when the player
  // gets the controls. The test clock starts after this.
  engine.throttle = game.control.throttle / 100;
  engine.advance = game.control.advance;
  engine.load = game.control.load;
  let caught = false;
  for (let i = 0; i < 108; i++) {
    engine.starter = !caught && rpmOf(engine) < 820;
    engine.step(1 / 60);
    if (!caught && rpmOf(engine) > 800) caught = true;
  }
  engine.starter = false;
  game.hasCaught = caught;
  game.started = caught;
  game.autoCrank = caught ? 0 : 3.2;

  hideCoach();
  renderStageCard(game.stage);
  renderStageTrack();
  $('resultScreen').classList.add('hidden');
  $('garageScreen').classList.add('hidden');
  $('titleScreen').classList.add('hidden');
  phase = 'running';

  setCoach(game.stage.coach);
  $('deckState').textContent = 'CRANKING';
  $('deckState').className = 'deck-state warn';
  if (fromUser) audio.start();
}

function goTitle() {
  phase = 'title';
  game.paused = false;
  $('resultScreen').classList.add('hidden');
  $('garageScreen').classList.add('hidden');
  $('titleScreen').classList.remove('hidden');
  hideCoach();
  updateTitleSave();
  renderStageTrack();
}

function finishStage(success, reason = '') {
  if (phase !== 'running') return;
  phase = 'result';
  game.paused = true;
  hideCoach();
  audio.silence?.();

  const stage = game.stage;
  const time = game.time;
  const health = engine.health;
  let medal = 'fail';
  if (success) {
    if (health >= 85 && time <= stage.par) medal = 'gold';
    else if (health >= 60 && time <= stage.par * 1.65) medal = 'silver';
    else medal = 'bronze';
  }

  const prev = save.medals[stage.id];
  const first = !prev;
  let reward = 0;
  if (success) {
    const mult = medal === 'gold' ? 1.25 : medal === 'silver' ? 1.12 : 1;
    reward = Math.round(stage.reward * mult * (first ? 1 : 0.15));
    save.cash += reward;
    if (!prev || MEDAL_RANK[medal] > MEDAL_RANK[prev]) save.medals[stage.id] = medal;
    if (!save.bestTime[stage.id] || time < save.bestTime[stage.id]) save.bestTime[stage.id] = time;
    save.unlocked = Math.max(save.unlocked, Math.min(STAGES.length, game.stageIndex + 1));
    persist();
  }

  game.result = { success, medal, reward, time, health, reason, first };

  const kicker = success ? (first ? 'TEST COMPLETE · NEW RECORD' : 'TEST COMPLETE · REPLAY') : 'TEST ABORTED';
  $('resultKicker').textContent = kicker;
  $('resultTitle').textContent = stage.name;

  const medalEl = $('resultMedal');
  const medalNames = { gold: 'GOLD PASS', silver: 'SILVER PASS', bronze: 'BRONZE PASS', fail: 'FAILED' };
  medalEl.textContent = medalNames[medal];
  medalEl.className = 'medal ' + medal;

  let line = '';
  if (!success) {
    line = reason === 'SEIZED'
      ? 'The mule seized. The teardown crew is already rolling it away. Try again with less abuse.'
      : 'The test clock ran out before the target was held. Read the gauges, adjust, retry.';
  } else if (medal === 'gold') {
    line = 'Clean pass. Held the window and kept the engine healthy. This is how a record looks.';
  } else if (medal === 'silver') {
    line = 'Passed with margin. A little more precision would turn this into gold.';
  } else {
    line = 'Passed, but the mule took a beating getting there. Check the health bar next time.';
  }
  $('resultLine').textContent = line;

  const stats = [
    ['TIME', formatTime(time), 'min:sec'],
    ['PEAK POWER', game.peakKW.toFixed(1), 'kW'],
    ['PEAK TORQUE', game.peakTorque.toFixed(1), 'Nm'],
    ['HEALTH', Math.round(health).toString(), '%'],
  ];
  $('resultStats').innerHTML = stats.map(([k, v, u]) =>
    `<div class="result-stat"><span>${k}</span><b>${v}</b><small>${u}</small></div>`).join('');

  $('resultCash').textContent = success ? `+$${reward.toLocaleString()}` : '$0';
  $('nextBtn').classList.toggle('hidden', !success);
  $('retryBtn').classList.remove('hidden');
  $('retryBtn').textContent = success ? 'REPLAY TEST' : 'RETRY TEST';
  $('nextBtn').textContent = success
    ? (game.stageIndex + 1 >= STAGES.length ? 'VIEW GARAGE' : 'NEXT TEST')
    : 'NEXT TEST';

  $('resultScreen').classList.remove('hidden');
  renderStageTrack();
  renderStageCard(stage);
  $('progressFill').style.width = success ? '100%' : '0%';
  updateTitleSave();
}

/* ------------------------------------------------------------------ */
/* Garage                                                              */
/* ------------------------------------------------------------------ */
function openGarage(returnTo) {
  garageReturn = returnTo;
  garageSelected = clamp(garageSelected, 0, Math.min(save.unlocked, STAGES.length - 1));
  if (returnTo === 'play') game.paused = true;
  $('titleScreen').classList.add('hidden');
  $('resultScreen').classList.add('hidden');
  $('garageScreen').classList.remove('hidden');
  renderGarage();
}

function closeGarage() {
  $('garageScreen').classList.add('hidden');
  if (garageReturn === 'play' && phase === 'running') {
    game.paused = false;
  } else if (garageReturn === 'result' && phase === 'result') {
    $('resultScreen').classList.remove('hidden');
  } else {
    goTitle();
  }
}

function setGarageHint(msg, kind = '') {
  const el = $('garageHint');
  el.textContent = msg;
  el.style.color = kind === 'bad' ? 'var(--red)' : kind === 'good' ? 'var(--green)' : 'var(--muted)';
}

function renderGarage() {
  $('garageCash').textContent = save.cash.toLocaleString();
  const list = $('stageList');
  list.innerHTML = '';
  STAGES.forEach((s, i) => {
    const unlocked = i <= save.unlocked;
    const medal = save.medals[s.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-item' + (i === garageSelected ? ' selected' : '') + (unlocked ? '' : ' locked');
    b.disabled = !unlocked;
    const badge = medal ? medal.toUpperCase() : unlocked ? 'OPEN' : 'LOCKED';
    b.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="info"><b>${s.name}</b><span>${unlocked ? s.brief : 'Clear the previous test to unlock.'}</span></span>
      <span class="badge ${medal || ''}">${badge}</span>`;
    b.addEventListener('click', () => {
      garageSelected = i;
      setGarageHint(s.tip);
      renderGarage();
    });
    list.appendChild(b);
  });

  const shop = $('shopList');
  shop.innerHTML = '';
  for (const up of UPGRADES) {
    const owned = Boolean(save.upgrades[up.key]);
    const el = document.createElement('div');
    el.className = 'shop-item' + (owned ? ' owned' : '');
    el.innerHTML = `<div class="shop-info"><b>${up.name}</b><span>${up.desc}</span></div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = owned ? 'FITTED' : `$${up.price.toLocaleString()}`;
    btn.disabled = owned || save.cash < up.price;
    btn.addEventListener('click', () => {
      if (owned) return;
      if (save.cash < up.price) {
        setGarageHint('Not enough career credit for that part.', 'bad');
        return;
      }
      save.cash -= up.price;
      save.upgrades[up.key] = 1;
      persist();
      applyModsToEngine();
      renderGarage();
      setGarageHint(`${up.name} fitted. It is already on the mule.`, 'good');
      updateTitleSave();
    });
    el.appendChild(btn);
    shop.appendChild(el);
  }

  const selected = STAGES[garageSelected];
  $('launchBtn').textContent = `LOAD TEST ${String(garageSelected + 1).padStart(2, '0')} · ${selected.name}`;
  $('launchBtn').disabled = garageSelected > save.unlocked;
  $('garageHint').textContent = selected.tip;
  $('garageHint').style.color = 'var(--muted)';
  updateTitleSave();
}

$('garageCloseBtn').addEventListener('click', closeGarage);
$('garageTopBtn').addEventListener('click', () => {
  if (phase === 'running') openGarage('play');
  else if (phase === 'result') openGarage('result');
  else openGarage('title');
});
$('titleGarageBtn').addEventListener('click', () => openGarage('title'));
$('resultGarageBtn').addEventListener('click', () => openGarage('result'));
$('launchBtn').addEventListener('click', () => {
  if (garageSelected > save.unlocked) return;
  startStage(garageSelected);
});

$('startBtn').addEventListener('click', () => {
  audio.start();
  startStage(firstUnfinished());
});

$('nextBtn').addEventListener('click', () => {
  if (!game.result?.success) return;
  if (game.stageIndex + 1 >= STAGES.length) {
    openGarage('result');
  } else {
    startStage(game.stageIndex + 1);
  }
});

$('retryBtn').addEventListener('click', () => {
  startStage(game.stageIndex);
});

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat && e.code !== 'Space') {
    // held keys are sampled every frame; no need for repeats
  }
  if (e.code === 'Space') {
    starterKey = true;
    $('starterBtn').classList.add('active');
    audio.start();
  }
  if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    keys.add(e.code);
  }
  if (e.code === 'Escape') {
    if (!$('garageScreen').classList.contains('hidden')) closeGarage();
    else if (phase === 'running') openGarage('play');
    else if (phase === 'result') openGarage('result');
    else if (phase === 'title') openGarage('title');
  }
  if (e.code === 'KeyM') $('soundBtn').click();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    starterKey = false;
    $('starterBtn').classList.remove('active');
  }
  keys.delete(e.code);
});
window.addEventListener('blur', () => {
  starterKey = false;
  starterHeld = false;
  keys.clear();
  $('starterBtn').classList.remove('active');
});

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */
function updateDemo(dt) {
  demoT += dt;
  if (!demoCaught) {
    demo.starter = true;
    demo.step(dt);
    if (rpmOf(demo) > 900) {
      demoCaught = true;
      demo.starter = false;
    }
  } else {
    const blip = Math.max(0, Math.sin(demoT * 0.42)) ** 12;
    demo.throttle = 0.055 + blip * 0.12;
    demo.load = 0;
    demo.step(dt);
  }
  if (rpmOf(demo) < 350) {
    demoCaught = false;
    demo.starter = true;
  }
}

function updateGame(dt) {
  // analog keyboard trims
  let dThr = 0;
  let dAdv = 0;
  let dLoad = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dThr += 46;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dThr -= 46;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dAdv -= 16;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dAdv += 16;
  if (keys.has('KeyQ')) dLoad -= 38;
  if (keys.has('KeyE')) dLoad += 38;
  if (dThr) setControl('throttle', game.control.throttle + dThr * dt);
  if (dAdv) setControl('advance', game.control.advance + dAdv * dt);
  if (dLoad) setControl('load', game.control.load + dLoad * dt);

  game.time += dt;

  engine.throttle = game.control.throttle / 100;
  engine.advance = game.control.advance;
  engine.load = game.control.load;

  // automatic starter until first catch, then hand control back
  if (!game.hasCaught) {
    game.autoCrank -= dt;
    engine.starter = game.autoCrank > 0 || starterHeld || starterKey;
  } else {
    engine.starter = starterHeld || starterKey;
  }

  engine.step(dt);
  const rpm = rpmOf(engine);
  if (rpm > game.peakRpm) game.peakRpm = rpm;
  if (engine.powerKW > game.peakKW) game.peakKW = engine.powerKW;
  if (engine.torque > game.peakTorque) game.peakTorque = engine.torque;

  if (!game.hasCaught && rpm > 780) {
    game.hasCaught = true;
    game.started = true;
    game.autoCrank = 0;
    setCoach(game.stage.coach);
  }
  if (!game.started && rpm > 780) game.started = true;

  // stall awareness
  if (game.started && rpm < 260 && !engine.starter) {
    game.stalledFor += dt;
  } else {
    game.stalledFor = 0;
  }
  if (game.stalledFor > 2.5 && !stallWarned) {
    stallWarned = true;
    showToast('STALLED', 'bad', 1.2);
    setCoach('engine stalled — hold ignition to re-crank');
  }
  if (rpm > 700) stallWarned = false;

  // event toasts
  if (engine.knock > 0.22 && knockWas <= 0.22) showToast('DETONATION', 'bad', 1.05);
  knockWas = engine.knock;
  if (engine.wallC > 108 && !heatWarned) {
    heatWarned = true;
    showToast('COOLANT CRITICAL', 'bad', 1.3);
  }
  if (engine.wallC < 104) heatWarned = false;
  if (engine.lastEvent === 'MISFIRE' && engine.eventTimer <= 0) {
    // engine raises this once per cycle; don't spam the toast
  }

  // conditions and hold
  let ok = game.started;
  game.stage.conds.forEach((c, i) => {
    const pass = c.test(engine);
    if (!pass) ok = false;
    game.condEls[i]?.classList.toggle('ok', pass);
  });

  if (ok) game.hold += dt;
  else game.hold = Math.max(0, game.hold - dt * 1.4);

  const prog = clamp(game.hold / game.stage.hold, 0, 1);
  $('progressFill').style.width = (prog * 100).toFixed(1) + '%';
  $('progressLabel').textContent = `${game.hold.toFixed(1)} / ${game.stage.hold.toFixed(1)} s`;

  const status = $('testStatus');
  if (ok) {
    status.textContent = 'HOLDING';
    status.className = 'live';
  } else {
    status.textContent = 'LIVE';
    status.className = 'live' + (engine.knock > 0.22 || engine.wallC > 108 ? ' warn' : '');
  }

  if (game.hold >= game.stage.hold) {
    finishStage(true);
    return;
  }
  if (engine.health <= 0.2) {
    finishStage(false, 'SEIZED');
    return;
  }
  if (game.time >= game.stage.timeLimit) {
    finishStage(false, 'TIME');
    return;
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
function updateHUD(e, dt) {
  const rpm = Math.max(0, rpmOf(e));
  $('rpmValue').textContent = Math.round(rpm).toLocaleString('en-US');
  const torque = Math.max(0, e.torque || 0);
  const power = Math.max(0, e.powerKW || 0);
  const coolant = e.wallC || 20;
  const oil = e.oilC || 20;
  const map = (e.pm || 101325) / 1000;
  const knock = clamp((e.knock || 0) * 100, 0, 100);

  $('valTorque').textContent = torque.toFixed(1);
  $('valPower').textContent = power.toFixed(1);
  $('valCoolant').textContent = Math.round(coolant);
  $('valOil').textContent = Math.round(oil);
  $('valMap').textContent = Math.round(map);
  $('valKnock').textContent = Math.round(knock);

  $('barTorque').style.width = clamp(torque / 32, 0, 1) * 100 + '%';
  $('barPower').style.width = clamp(power / 21, 0, 1) * 100 + '%';
  $('barCoolant').style.width = clamp((coolant - 15) / 100, 0, 1) * 100 + '%';
  $('barOil').style.width = clamp((oil - 15) / 105, 0, 1) * 100 + '%';
  $('barMap').style.width = clamp((map - 15) / 90, 0, 1) * 100 + '%';
  $('barKnock').style.width = knock + '%';

  const health = clamp(e.health ?? 100, 0, 100);
  $('healthValue').textContent = Math.round(health) + '%';
  $('healthFill').style.width = health + '%';
  $('healthFill').className = health < 35 ? 'low' : health < 70 ? 'mid' : '';

  $('warnStall').classList.toggle('on', rpm < 380 && phase === 'running');
  $('warnKnock').classList.toggle('on', knock > 15);
  $('warnKnock').classList.toggle('red', knock > 40);
  $('warnHeat').classList.toggle('on', coolant > 108);
  $('warnHeat').classList.toggle('red', coolant > 116);
  $('warnRev').classList.toggle('on', rpm > 6900);

  $('cycleCount').textContent = (e.totalCycles || 0) + ' CYCLES';
  $('sessionTime').textContent = phase === 'running' ? formatTime(game.time) : '00:00';
  $('sessionPeak').textContent = game.peakKW.toFixed(1);
  $('sessionTorque').textContent = game.peakTorque.toFixed(1);
  $('sessionCycles').textContent = String(e.totalCycles || 0);
  $('sceneClock').textContent = phase === 'running' ? `T+ ${formatTime(game.time)}` : 'T+ 00:00';

  if (phase === 'running') {
    const ds = $('deckState');
    if (e.health <= 0.2) {
      ds.textContent = 'SEIZED'; ds.className = 'deck-state bad';
    } else if (game.started && rpm < 260) {
      ds.textContent = 'STALLED'; ds.className = 'deck-state bad';
    } else if (!game.started) {
      ds.textContent = 'CRANKING'; ds.className = 'deck-state warn';
    } else if (knock > 22) {
      ds.textContent = 'DETONATION'; ds.className = 'deck-state bad';
    } else if (coolant > 108) {
      ds.textContent = 'OVERHEAT'; ds.className = 'deck-state warn';
    } else if (rpm > 6900) {
      ds.textContent = 'REDLINE'; ds.className = 'deck-state warn';
    } else {
      ds.textContent = 'RUNNING'; ds.className = 'deck-state';
    }
  } else if (phase === 'result') {
    $('deckState').textContent = game.result?.success ? 'TEST PASSED' : 'TEST ABORTED';
    $('deckState').className = 'deck-state ' + (game.result?.success ? '' : 'bad');
  }

  // coach auto-hide after 9 seconds of operation
  if (phase === 'running' && game.time > 9 && game.started) hideCoach();
}

/* ------------------------------------------------------------------ */
/* Tachometer                                                          */
/* ------------------------------------------------------------------ */
let tachStatic = null;
let tachStaticDpr = 0;

function buildTachStatic(dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(560 * dpr);
  c.height = Math.round(310 * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = 280;
  const cy = 255;
  const r = 192;
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const toAngle = (v) => a0 + (v / 8000) * (a1 - a0);

  // bezel
  const bez = ctx.createRadialGradient(cx - 40, cy - 70, 20, cx, cy, 220);
  bez.addColorStop(0, 'rgba(40,54,64,0.8)');
  bez.addColorStop(0.72, 'rgba(12,18,23,0.9)');
  bez.addColorStop(1, 'rgba(5,8,10,0.95)');
  ctx.fillStyle = bez;
  ctx.beginPath();
  ctx.arc(cx, cy, 214, Math.PI, Math.PI * 2);
  ctx.lineTo(cx + 214, cy);
  ctx.arc(cx, cy, 214, 0, Math.PI);
  ctx.fill();

  // arc bed and redline
  ctx.strokeStyle = 'rgba(130,160,180,0.13)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,90,69,0.35)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, toAngle(7000), a1);
  ctx.stroke();

  // ticks / numerals
  for (let i = 0; i <= 32; i++) {
    const v = i * 250;
    const a = toAngle(v);
    const major = i % 4 === 0;
    const inner = r - (major ? 22 : 10);
    ctx.strokeStyle = major
      ? v >= 7000 ? 'rgba(255,90,69,0.9)' : 'rgba(215,228,236,0.75)'
      : 'rgba(150,175,190,0.35)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.stroke();
    if (major) {
      const lr = r - 45;
      ctx.fillStyle = v >= 7000 ? 'rgba(255,120,100,0.85)' : 'rgba(190,208,220,0.68)';
      ctx.font = '600 13px "SFMono-Regular", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v / 1000), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
    }
  }
  ctx.fillStyle = 'rgba(140,165,180,0.35)';
  ctx.font = '700 8px "SFMono-Regular", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('RPM ×1000', cx, cy - 58);
  ctx.fillStyle = 'rgba(120,145,160,0.28)';
  ctx.font = '600 7px "SFMono-Regular", monospace';
  ctx.fillText('SC-1 DYNO MULE', cx, cy - 45);
  ctx.textAlign = 'left';
  return c;
}

function drawTach(e) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (!tachStatic || tachStaticDpr !== dpr) {
    tachStatic = buildTachStatic(dpr);
    tachStaticDpr = dpr;
  }
  if (tachCanvas.width !== tachStatic.width || tachCanvas.height !== tachStatic.height) {
    tachCanvas.width = tachStatic.width;
    tachCanvas.height = tachStatic.height;
  }
  const ctx = tachCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tachCanvas.width, tachCanvas.height);
  ctx.drawImage(tachStatic, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = 280;
  const cy = 255;
  const r = 192;
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const rpm = clamp(rpmOf(e), 0, 8000);
  const toAngle = (v) => a0 + (v / 8000) * (a1 - a0);

  // target band for the active test
  if (phase === 'running') {
    const rc = game.stage.conds.find((c) => c.label.startsWith('RPM'));
    if (rc) {
      const m = rc.label.match(/(\d+)[^\d]+(\d+)/);
      if (m) {
        ctx.strokeStyle = 'rgba(107,219,155,0.55)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(cx, cy, r, toAngle(Number(m[1])), toAngle(Number(m[2])));
        ctx.stroke();
      }
    }
  }

  // active arc: layered strokes instead of a costly shadow blur
  if (rpm > 30) {
    const grad = ctx.createLinearGradient(0, 0, 560, 0);
    grad.addColorStop(0, '#63d2e8');
    grad.addColorStop(0.68, '#f0b451');
    grad.addColorStop(1, '#ff5a45');
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, toAngle(rpm));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, toAngle(rpm));
    ctx.stroke();
  }

  // needle
  const na = toAngle(rpm);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(na);
  const ng = ctx.createLinearGradient(0, 0, r - 18, 0);
  ng.addColorStop(0, '#ffd6b0');
  ng.addColorStop(0.55, '#ff9b4a');
  ng.addColorStop(1, '#ff5a3c');
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(r - 16, -1.4);
  ctx.lineTo(r - 16, 1.4);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // hub
  const hub = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 22);
  hub.addColorStop(0, '#eef4f8');
  hub.addColorStop(0.4, '#8c99a2');
  hub.addColorStop(1, '#232a30');
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.2);
  lastFrame = now;

  if (phase === 'running') {
    if (!game.paused) updateGame(dt);
    updateHUD(engine, dt);
    drawTach(engine);
    audio.update(engine, game.control.throttle, game.control.load, dt);
    if (game.paused) audio.update({ omega: 0, knock: 0 }, 0, 0, dt);
    renderer.render(engine, dt, { title: false });
  } else if (phase === 'result') {
    updateHUD(engine, dt);
    drawTach(engine);
    renderer.render(engine, dt * 0.2, { title: false });
  } else {
    updateDemo(dt);
    updateHUD(demo, dt);
    drawTach(demo);
    renderer.render(demo, dt, { title: true });
  }

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
updateTitleSave();
renderStageTrack();
renderStageCard(STAGES[0]);
window.__sc = { ...window.__sc, drawTach, updateHUD, game, startStage, finishStage, openGarage, save };
$('resultScreen').classList.add('hidden');
$('garageScreen').classList.add('hidden');
$('titleScreen').classList.remove('hidden');
$('garageHint').textContent = STAGES[0].tip;
garageSelected = Math.min(save.unlocked, STAGES.length - 1);
requestAnimationFrame(frame);
