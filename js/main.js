/** Wiring: the loop, the controls, the presets and the compassion sweep. */
import { Model, P, CAP } from './model.js';
import { EP, runElection } from './election.js';
import { View } from './view.js';
import { initRules } from './rules.js';
import { Config } from './config.js';
import { dbg, initDebugPanel } from './debug.js';

const ELECTION_EVERY = 6;

const PRESETS = {
  compassionate: { compassion: 0.78, lambda: 0.25, theta: 0.6, surcharge: 0.35, influenceK: 0.12 },
  ruthless:      { compassion: 0.10, lambda: 0.25, theta: 0.6, surcharge: 0.35, influenceK: 0.12 },
  purge:         { compassion: 0.04, lambda: 0.25, theta: 0.28, surcharge: 1.4, influenceK: 0.25 },
};

const config = new Config('compassion');
const model = new Model();
const view = new View();
const debugPanel = initDebugPanel();
initRules();

view.onResize = () => {
  view.drawNetwork(model);
  if (result) { view.drawHistogram(result, control); view.drawScatter(result); }
  view.drawSweep(sweepPoints, P.compassion.v);
};

const speedInput = document.getElementById('p-speed');
const speedLabel = document.getElementById('v-speed');
speedInput.oninput = () => { speedLabel.textContent = `${speedInput.value}\u00d7`; };
speedInput.oninput();

const drawInput = document.getElementById('p-draw');
const drawLabel = document.getElementById('v-draw');
drawInput.oninput = () => {
  const n = Number(drawInput.value);
  drawLabel.textContent = n === 1 ? 'every frame' : `${n} frames`;
};
drawInput.oninput();

const rate = { steps: 0, frames: 0, since: performance.now(), stepsPerSec: 0, fps: 0 };

let paused = false;
let sweepJob = null;
let sweepPoints = [];
let result = null;
let control = null;
let sinceVote = 0;
let electionSeed = 1;

buildControls(document.getElementById('g-model'), P, k => k !== 'compassion' && k !== 'drag');
buildControls(document.getElementById('g-election'), EP, () => true);
bindHero();
restore();
hold();

document.getElementById('btn-vote').onclick = hold;
document.getElementById('btn-pause').onclick = e => {
  paused = !paused;
  e.target.textContent = paused ? 'Resume' : 'Pause';
  e.target.classList.toggle('on', paused);
};
document.getElementById('btn-reset').onclick = () => { model.reset(); sweepPoints = []; hold(); };
document.getElementById('btn-debug').onclick = () => debugPanel.toggle();
document.getElementById('btn-sweep').onclick = startSweep;
document.getElementById('opt-control').onchange = hold;
for (const b of document.querySelectorAll('[data-preset]')) {
  b.onclick = () => applyPreset(b.dataset.preset);
}

/** One slider per parameter, so a rule and its control cannot disagree. */
function buildControls(host, params, keep) {
  for (const key in params) {
    if (!keep(key)) continue;
    const p = params[key];
    const ctl = document.createElement('div');
    ctl.className = 'ctl';
    ctl.innerHTML = `<label for="x-${key}"><span>${p.label}</span><span id="xv-${key}"></span></label>` +
      `<input type="range" id="x-${key}" min="${p.min}" max="${p.max}" step="${p.step}">`;
    host.appendChild(ctl);
    const input = ctl.querySelector('input');
    input.value = p.v;
    setLabel(key, p.v);
    input.oninput = () => {
      p.v = Number(input.value);
      setLabel(key, p.v);
      persist();
    };
  }
}

function setLabel(key, v) {
  const el = document.getElementById(`xv-${key}`);
  if (el) el.textContent = fmt(v);
}

function bindHero() {
  const input = document.getElementById('p-compassion');
  const p = P.compassion;
  input.min = p.min; input.max = p.max; input.step = p.step; input.value = p.v;
  input.oninput = () => {
    p.v = Number(input.value);
    model.applyCompassion();
    syncHero();
    persist();
  };
  syncHero();
}

function syncHero() {
  document.getElementById('p-compassion').value = P.compassion.v;
  document.getElementById('v-compassion').textContent = P.compassion.v.toFixed(2);
  document.getElementById('m-compassion').style.width = `${P.compassion.v * 100}%`;
}

function applyPreset(name) {
  for (const [k, v] of Object.entries(PRESETS[name])) P[k].v = v;
  model.applyCompassion();
  syncHero();
  for (const key in P) {
    const input = document.getElementById(`x-${key}`);
    if (input) { input.value = P[key].v; setLabel(key, P[key].v); }
  }
  persist();
  hold();
  dbg.info(`preset ${name}`);
}

function hold() {
  electionSeed++;
  result = runElection(model, { loyalty: true, seed: electionSeed });
  control = document.getElementById('opt-control').checked
    ? runElection(model, { loyalty: false, seed: electionSeed })
    : null;
  sinceVote = 0;
  view.drawHistogram(result, control);
  view.drawScatter(result);
  view.drawSweep(sweepPoints, P.compassion.v);
  document.getElementById('ro-hist').textContent =
    `incumbent ${(result.mainShare * 100).toFixed(1)}% · bloc vote ${(result.blocShare * 100).toFixed(1)}%`;
  renderStats();
}

function renderStats() {
  const s = model.stats();
  document.getElementById('stats').innerHTML = [
    ['Stations', result ? result.stations : 0],
    ['Incumbent by preference', `${(100 * s.main / Math.max(1, s.live)).toFixed(0)}%`],
    ['Incumbent reported', result ? `${(result.mainShare * 100).toFixed(1)}%` : '—'],
    ['Bloc vote', result ? `${(result.blocShare * 100).toFixed(1)}%` : '—'],
    ['Captured cells', result ? `${(100 * result.captured / Math.max(1, result.stations)).toFixed(0)}%` : '—'],
    ['Largest cell', s.eMax.toFixed(0)],
    ['Destroyed', s.destroyed],
    ['Divided', s.divided],
    ['Sim steps / s', rate.stepsPerSec],
    ['Frames drawn / s', Math.round(rate.fps / Number(drawInput.value))],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><span>${v}</span></div>`).join('');
}

/** Step compassion down from 1, letting the model settle at each stop before voting. */
function startSweep() {
  if (sweepJob) { sweepJob = null; document.getElementById('btn-sweep').classList.remove('on'); return; }
  sweepPoints = [];
  sweepJob = { c: 1.0, settle: 0, restore: P.compassion.v };
  document.getElementById('btn-sweep').classList.add('on');
  dbg.info('sweep started');
}

function advanceSweep() {
  const job = sweepJob;
  if (job.settle === 0) {
    P.compassion.v = job.c;
    model.applyCompassion();
    syncHero();
  }
  const chunk = Math.max(10, Number(speedInput.value) * 3);
  for (let k = 0; k < chunk; k++) model.step();
  job.settle += chunk;
  if (job.settle < 150) return;

  const r = runElection(model, { loyalty: true, seed: 99 });
  sweepPoints.push({ c: job.c, admin: r.blocShare });
  sweepPoints.sort((a, b) => a.c - b.c);
  view.drawSweep(sweepPoints, P.compassion.v);
  document.getElementById('ro-sweep').textContent = `c=${job.c.toFixed(2)} · ${(r.blocShare * 100).toFixed(1)}%`;

  job.settle = 0;
  job.c = Math.round((job.c - 0.05) * 100) / 100;
  if (job.c < -0.001) {
    P.compassion.v = job.restore;
    model.applyCompassion();
    syncHero();
    sweepJob = null;
    document.getElementById('btn-sweep').classList.remove('on');
    dbg.info('sweep done', { points: sweepPoints.length });
    hold();
  }
}

function persist() {
  const out = { model: {}, election: {} };
  for (const k in P) out.model[k] = P[k].v;
  for (const k in EP) out.election[k] = EP[k].v;
  config.save(out);
}

function restore() {
  const saved = config.load();
  if (!saved) return;
  for (const k in saved.model ?? {}) if (P[k]) P[k].v = saved.model[k];
  for (const k in saved.election ?? {}) if (EP[k]) EP[k].v = saved.election[k];
  model.applyCompassion();
  syncHero();
  for (const [params, prefix] of [[P, 'x-'], [EP, 'x-']]) {
    for (const k in params) {
      const input = document.getElementById(prefix + k);
      if (input) { input.value = params[k].v; setLabel(k, params[k].v); }
    }
  }
}

function fmt(v) {
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
}

let last = performance.now(), frameNo = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);

  frameNo++;
  const drawEvery = Number(drawInput.value);
  const drawing = frameNo % drawEvery === 0;

  if (sweepJob) { advanceSweep(); if (drawing) view.drawNetwork(model); return; }
  if (paused) return;

  const steps = Number(speedInput.value);
  for (let k = 0; k < steps; k++) model.step();

  rate.steps += steps;
  rate.frames++;
  if (now - rate.since >= 1000) {
    const secs = (now - rate.since) / 1000;
    rate.stepsPerSec = Math.round(rate.steps / secs);
    rate.fps = Math.round(rate.frames / secs);
    rate.steps = 0; rate.frames = 0; rate.since = now;
  }

  if (drawing) view.drawNetwork(model);

  if (drawing) renderStats();

  sinceVote += dt;
  if (sinceVote >= ELECTION_EVERY) hold();
}
requestAnimationFrame(frame);

dbg.setMeta({ capacity: CAP });
dbg.info('ready');
