/**
 * Shpilka — cells joined by sticks, competing for energy on a plane.
 *
 * The rules come from Kudinov's Kosmiki (https://habr.com/ru/articles/153169/): a
 * force-based graph with inertia, cells that repel in proportion to energy, sticks that
 * resist that repulsion, energy moving along every stick from the smaller cell to the
 * larger, and absorption limited to victims holding at least 61.8% of the attacker's
 * energy, which is what forces branched structures instead of one giant eating dust.
 *
 * Kosmiki has no lattice: every cell acts on every cell. The grid here is only a
 * broad-phase index and it imposes a cutoff radius the original does not have — a real
 * divergence, taken because the browser will not carry 10^8 pair tests a frame.
 */
import { Grid } from './spatial.js';

export const WORLD_W = 380;
export const WORLD_H = 240;
export const CAP = 1600;

/** Golden-ratio floor on absorption, from the Kosmiki rules. */
const PHI_INV = 0.618;

/** Every tunable the model reads. `rules.js` renders the panel from this object. */
export const P = {
  compassion:  { v: 0.10, min: 0,    max: 1,    step: 0.01,  label: 'Compassion' },
  cSpread:     { v: 0.10, min: 0,    max: 0.4,  step: 0.01,  label: 'Compassion spread' },
  drain:       { v: 0.35, min: 0,    max: 3,    step: 0.01,  label: 'Drain along sticks' },
  divide:      { v: 45,   min: 3,    max: 60,   step: 0.5,   label: 'Division threshold' },
  starve:      { v: 0.08, min: 0.01, max: 2,    step: 0.01,  label: 'Starvation floor' },
  influx:      { v: 260,  min: 10,   max: 2000, step: 10,    label: 'Total energy per second' },
  repel:       { v: 220,  min: 0,    max: 900,  step: 5,     label: 'Cell repulsion' },
  stick:       { v: 5.2,  min: 0,    max: 20,   step: 0.1,   label: 'Stick stiffness' },
  drag:        { v: 3.4,  min: 0.5,  max: 10,   step: 0.1,   label: 'Drag' },
  hunt:        { v: 90,   min: 0,    max: 400,  step: 5,     label: 'Hunt / flee force' },
  influenceR:  { v: 30,   min: 10,   max: 70,   step: 1,     label: 'Enforcement radius' },
  influenceK:  { v: 0.12, min: 0,    max: 1,    step: 0.005, label: 'Enforcement strength' },
  influenceC:  { v: 0.002, min: 0,    max: 0.4,  step: 0.005, label: 'Enforcement cost' },
  theta:       { v: 0.30, min: 0.02, max: 1,    step: 0.01,  label: 'Destruction threshold' },
  absorbFloor: { v: PHI_INV, min: 0.05, max: 1, step: 0.01, label: 'Absorption floor' },
  surcharge:   { v: 0.35, min: 0,    max: 2,    step: 0.05,  label: 'Destruction surcharge' },
  lambda:      { v: 0.25, min: 0,    max: 3,    step: 0.01,  label: 'Neglect drift' },
  povRef:      { v: 0.5,  min: 0.2,  max: 12,   step: 0.1,   label: 'Neglect reference' },
  recruitR:    { v: 22,   min: 6,    max: 60,   step: 1,     label: 'Recruitment radius' },
  recruitMin:  { v: 0.35, min: 0.05, max: 12,   step: 0.05,  label: 'Recruitment minimum' },
  fanout:      { v: 3.0,  min: 1,    max: 12,   step: 0.5,   label: 'Children per unit size' },
  recruitGap:  { v: 0.45, min: 0.05, max: 1,    step: 0.05,  label: 'Recruitment tolerance' },
  noise:       { v: 0.06, min: 0,    max: 0.3,  step: 0.005, label: 'Alignment noise' },
  mutate:      { v: 0.03, min: 0,    max: 0.3,  step: 0.005, label: 'Division mutation' },
  erosion:     { v: 0,    min: 0,    max: 1,    step: 1,     label: 'Compassion erosion' },
};

/** One line per rule; `text` reads live values out of `P`, so the panel cannot go stale. */
export const RULES = [
  { name: 'Cells and sticks', keys: ['repel', 'stick', 'drag'],
    text: () => 'A node is a cell with energy, inertia and one alignment number, 0 for opposition and 1 for mainstream. Cells repel in proportion to their energy; a stick between two of them resists that repulsion with the smaller of the two energies. Nothing sits on a lattice — position is an outcome.' },
  { name: 'Energy runs uphill', keys: ['drain', 'compassion'],
    text: () => 'Every stick moves a fixed quantum of energy per second between its two cells, and the compassion of the larger one sets the direction: below 0.5 it takes from the smaller, above 0.5 it gives. Extraction and redistribution are the same rule with the sign reversed. This is the whole concentration mechanism: tribute flows toward whoever already has more.' },
  { name: 'Compassion', keys: ['compassion', 'cSpread'],
    text: () => 'Which way a cell sends energy across its sticks. Below 0.5 it takes from whoever has less and the distribution goes heavy-tailed; above 0.5 it gives, and holdings level out. This one parameter decides whether the election grows a tail.' },
  { name: 'The center is emergent', keys: [],
    text: () => 'No node is designated. The head of a structure is whichever cell holds the most energy, and it changes hands when another overtakes it.' },
  { name: 'Recruitment', keys: ['recruitR', 'recruitMin', 'recruitGap', 'fanout'],
    text: () => 'A cell attaches the nearest unattached poorer cell of roughly its own views, up to a fanout that grows with its size. Absorbing in Kosmiki joins the victim on rather than deleting it, and this is the only thing that creates a stick.' },
  { name: 'Division', keys: ['divide', 'mutate'],
    text: () => 'Past the threshold a cell splits. The child keeps the parent’s views with a small mutation, the energy is halved between them, and the two start joined by a stick. Structures grow rather than being placed.' },
  { name: 'Income and starvation', keys: ['influx', 'starve'],
    text: () => 'A fixed total income each second is split equally between every living cell, and a cell that falls below the floor dies. Nothing caps the population: each new cell lowers what all the others receive, so numbers settle where income meets losses.' },
  { name: 'Enforcement', keys: ['influenceR', 'influenceK', 'influenceC'],
    text: () => 'A cell spends energy to pull the alignment of every neighbour in its radius toward its own, with force rising with its energy and with <code>1 - c</code>: a compassionate cell persuades weakly, a ruthless one coerces. What a cell registers as pressure is that force divided by its own energy: domination is force measured against the ability to resist it, so the same push lands hard on a destitute neighbour and glances off a rich one.' },
  { name: 'Neglect breeds opposition', keys: ['lambda', 'povRef', 'noise'],
    text: () => 'A cell near the starvation floor drifts toward opposition. Because energy runs uphill, the periphery is always the poorest, so it defects without anyone deciding it should. The opposition is a product of the structure, not an input to it.' },
  { name: 'Destruction', keys: ['theta', 'surcharge', 'absorbFloor'],
    text: () => `A cell destroys a near opponent when the alignment gap exceeds <code>theta / (1 - c)</code>, when it holds more energy, and when the victim holds at least the absorption floor of the attacker's energy — you cannot eat something far beneath you, which is why hierarchies have to grow intermediate layers. The attacker pays the victim's full energy plus the surcharge.` },
  { name: 'Hunting', keys: ['hunt'],
    text: () => 'A cell accelerates toward opponents it could destroy and away from opponents that could destroy it. Fronts and territories come out of this, not out of any map.' },
  { name: 'Repression is not free', keys: ['surcharge', 'influenceC'],
    text: () => 'Destroying costs more than the victim held, and that energy is then not available for enforcement. Nothing forces the trade-off; it falls out of the two costs.' },
  { name: 'Compassion erosion', keys: ['erosion'],
    text: () => 'Off by default. With it on, a cell that is attacked loses compassion, so violence lowers the threshold for more violence. Compassion then becomes an outcome and can no longer be swept as a cause.' },
];

export class Model {
  constructor() { this.reset(); }

  reset() {
    this.x = new Float32Array(CAP);
    this.y = new Float32Array(CAP);
    this.vx = new Float32Array(CAP);
    this.vy = new Float32Array(CAP);
    this.e = new Float32Array(CAP);
    this.a = new Float32Array(CAP);
    this.cOff = new Float32Array(CAP);
    this.c = new Float32Array(CAP);
    this.parent = new Int32Array(CAP);
    this.pgen = new Int32Array(CAP);
    this.gen = new Int32Array(CAP);
    this.voters = new Float32Array(CAP);
    this.enf = new Float32Array(CAP);
    this.alive = new Uint8Array(CAP);
    this.dA = new Float32Array(CAP);
    this.kids = new Int32Array(CAP);
    this.flow = new Float32Array(CAP);

    this.free = new Int32Array(CAP);
    this.freeTop = 0;
    this.rng = mulberry32(0x5bd1e995);
    this.time = 0;
    this.destroyed = 0;
    this.divided = 0;
    this.live = 0;

    this.parent.fill(-1);
    for (let i = CAP - 1; i >= 0; i--) this.free[this.freeTop++] = i;

    for (let s = 0; s < 240; s++) {
      const i = this.spawn(this.rng() * WORLD_W, this.rng() * WORLD_H, 1.0);
      if (i >= 0) this.a[i] = 0.5 + (this.rng() - 0.5) * 0.2;
    }
    const seedMain = this.spawn(WORLD_W * 0.33, WORLD_H * 0.5, 40);
    const seedOpp = this.spawn(WORLD_W * 0.70, WORLD_H * 0.5, 18);
    this.a[seedMain] = 1;
    this.a[seedOpp] = 0;

    this.applyCompassion();
    this.grid = new Grid(WORLD_W, WORLD_H, Math.max(P.influenceR.v, 24), CAP);
  }

  spawn(x, y, energy) {
    if (this.freeTop === 0) return -1;
    const i = this.free[--this.freeTop];
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = 0; this.vy[i] = 0;
    this.e[i] = energy;
    this.a[i] = 0.5;
    this.cOff[i] = gauss(this.rng) * P.cSpread.v;
    this.c[i] = clamp(P.compassion.v + this.cOff[i], 0.01, 0.985);
    this.parent[i] = -1;
    this.gen[i]++;
    this.voters[i] = Math.exp(6.0 + gauss(this.rng) * 0.8);
    this.enf[i] = 0;
    this.alive[i] = 1;
    this.live++;
    return i;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.parent[i] = -1;
    this.free[this.freeTop++] = i;
    this.live--;
  }

  /** Parent index, or -1 once the stick has gone: the slot died, or died and was reused. */
  parentOf(i) {
    const p = this.parent[i];
    if (p < 0) return -1;
    if (!this.alive[p] || this.gen[p] !== this.pgen[i]) { this.parent[i] = -1; return -1; }
    return p;
  }

  link(child, par) {
    this.parent[child] = par;
    this.pgen[child] = this.gen[par];
  }

  applyCompassion() {
    const m = P.compassion.v;
    for (let i = 0; i < CAP; i++) {
      if (this.alive[i]) this.c[i] = clamp(m + this.cOff[i], 0.01, 0.985);
    }
  }

  step(dt) {
    this.time += dt;
    const cell = Math.max(P.influenceR.v, 24);
    if (this.grid.cell !== cell) this.grid = new Grid(WORLD_W, WORLD_H, cell, CAP);
    this.grid.rebuild(this.x, this.y, this.alive, CAP);

    this.forcePass(dt);
    this.drainPass(dt);
    this.influencePass(dt);
    this.alignPass(dt);
    this.recruitPass();
    this.destroyPass();
    this.dividePass();
    this.incomePass(dt);
  }

  /** Repulsion, stick tension, hunting and drag, integrated with inertia. */
  forcePass(dt) {
    const { x, y, vx, vy, e, a, parent, alive } = this;
    const R = P.influenceR.v, R2 = R * R;
    const krep = P.repel.v, kstick = P.stick.v, khunt = P.hunt.v;

    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i], ei = e[i], ai = a[i];
      let fx = 0, fy = 0;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j]) return;
        const dx = x[j] - xi, dy = y[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2 || d2 < 1e-6) return;
        const d = Math.sqrt(d2);
        const ux = dx / d, uy = dy / d;
        const rep = krep * (ei + e[j]) / (d2 + 4);
        fx -= rep * ux; fy -= rep * uy;
        if (Math.abs(ai - a[j]) > P.theta.v) {
          const dir = this.canAbsorb(i, j) ? 1 : this.canAbsorb(j, i) ? -1 : 0;
          if (dir !== 0) { fx += khunt * dir * ux / d; fy += khunt * dir * uy / d; }
        }
      });
      const p = this.parentOf(i);
      if (p >= 0) {
        const dx = x[p] - xi, dy = y[p] - yi;
        const d = Math.hypot(dx, dy) || 1e-3;
        const rest = radius(ei) + radius(e[p]) + 2;
        const k = kstick * Math.min(ei, e[p]);
        const f = k * (d - rest) / d;
        fx += f * dx; fy += f * dy;
      }
      const m = Math.max(0.4, ei);
      vx[i] = (vx[i] + fx / m * dt) * Math.max(0, 1 - P.drag.v * dt);
      vy[i] = (vy[i] + fy / m * dt) * Math.max(0, 1 - P.drag.v * dt);
      let nx = xi + vx[i] * dt, ny = yi + vy[i] * dt;
      if (nx < 2) { nx = 2; vx[i] = -vx[i] * 0.4; }
      if (nx > WORLD_W - 2) { nx = WORLD_W - 2; vx[i] = -vx[i] * 0.4; }
      if (ny < 2) { ny = 2; vy[i] = -vy[i] * 0.4; }
      if (ny > WORLD_H - 2) { ny = WORLD_H - 2; vy[i] = -vy[i] * 0.4; }
      x[i] = nx; y[i] = ny;
    }
  }

  /** Each stick moves energy from the smaller cell to the larger, held back by compassion. */
  drainPass(dt) {
    const { e, c, parent, alive, flow } = this;
    flow.fill(0);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p < 0) continue;
      const lo = e[i] < e[p] ? i : p;
      const hi = lo === i ? p : i;
      const rate = P.drain.v * (1 - 2 * c[hi]) * dt;
      const amount = rate > 0 ? Math.min(e[lo], rate) : -Math.min(e[hi], -rate);
      flow[lo] -= amount;
      flow[hi] += amount;
    }
    for (let i = 0; i < CAP; i++) {
      if (alive[i]) e[i] = Math.max(0, e[i] + flow[i]);
    }
  }

  influencePass(dt) {
    const { x, y, a, e, c, enf, alive, dA } = this;
    dA.fill(0);
    const R = P.influenceR.v, R2 = R * R, k = P.influenceK.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      enf[i] *= Math.max(0, 1 - 0.6 * dt);
    }
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const infl = (1 - c[i]) * e[i];
      if (infl < 0.05) continue;
      const xi = x[i], yi = y[i], ai = a[i];
      let spent = 0;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j]) return;
        const dx = x[j] - xi, dy = y[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) return;
        const w = 1 - d2 / R2;
        dA[j] += k * infl * w * (ai - a[j]) * dt;
        if (ai > 0.5) enf[j] += infl * w * dt / (1 + e[j]);
        spent += w;
      });
      e[i] = Math.max(0, e[i] - P.influenceC.v * infl * spent * dt);
    }
  }

  alignPass(dt) {
    const { a, e, alive, dA, rng } = this;
    const lam = P.lambda.v, nz = P.noise.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      let v = a[i] + dA[i] + gauss(rng) * nz * dt;
      const poverty = 1 - e[i] / P.povRef.v;
      if (poverty > 0) v -= lam * poverty * dt;
      a[i] = clamp(v, 0, 1);
    }
  }

  canAbsorb(i, j) {
    return this.e[i] > this.e[j] && this.e[j] >= P.absorbFloor.v * this.e[i];
  }

  /**
   * Absorption in Kosmiki attaches the victim rather than deleting it, and that is the only
   * thing that creates a stick: with no recruitment nothing ever drains and no structure forms.
   */
  recruitPass() {
    const { x, y, a, e, alive, kids } = this;
    const R = P.recruitR.v, R2 = R * R;
    kids.fill(0);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p >= 0) kids[p]++;
    }
    for (let i = 0; i < CAP; i++) {
      if (!alive[i] || e[i] < P.recruitMin.v) continue;
      if (kids[i] >= 1 + P.fanout.v * Math.sqrt(e[i])) continue;
      const xi = x[i], yi = y[i], ai = a[i], ceiling = e[i] * 0.9;
      let best = -1, bestD = R2;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j] || e[j] > ceiling) return;
        if (this.parentOf(j) >= 0) return;
        if (Math.abs(ai - a[j]) > P.recruitGap.v) return;
        const dx = x[j] - xi, dy = y[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = j; }
      });
      if (best >= 0) { this.link(best, i); kids[i]++; }
    }
  }

  destroyPass() {
    const { x, y, a, e, c, alive } = this;
    const R = P.influenceR.v * 0.55, R2 = R * R;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const gap = P.theta.v / (1 - c[i]);
      if (gap > 1) continue;
      const xi = x[i], yi = y[i], ai = a[i], ei = e[i];
      let victim = -1;
      this.grid.forEachNear(xi, yi, j => {
        if (victim >= 0 || j === i || !alive[j]) return;
        if (Math.abs(ai - a[j]) < gap) return;
        if (!this.canAbsorb(i, j)) return;
        const dx = x[j] - xi, dy = y[j] - yi;
        if (dx * dx + dy * dy > R2) return;
        victim = j;
      });
      if (victim < 0) continue;
      const cost = e[victim] * (1 + P.surcharge.v);
      if (ei <= cost) continue;
      e[i] = ei - cost;
      if (P.erosion.v) this.cOff[victim] = Math.max(-0.5, this.cOff[victim] - 0.06);
      this.kill(victim);
      this.destroyed++;
    }
  }

  dividePass() {
    const { e, a, x, y, parent, alive, rng } = this;
    const thr = P.divide.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i] || e[i] < thr) continue;
      const half = e[i] / 2;
      const ang = rng() * Math.PI * 2;
      const r = radius(half) + 3;
      const j = this.spawn(
        clamp(x[i] + Math.cos(ang) * r, 2, WORLD_W - 2),
        clamp(y[i] + Math.sin(ang) * r, 2, WORLD_H - 2),
        half);
      if (j < 0) break;
      e[i] = half;
      a[j] = clamp(a[i] + gauss(rng) * P.mutate.v, 0, 1);
      this.link(j, i);
      this.divided++;
    }
  }

  /**
   * A fixed total income is split equally between the living, so each new cell lowers what
   * every cell receives. The population has no ceiling; it settles where income meets losses.
   */
  incomePass(dt) {
    const { e, alive, rng } = this;
    const share = this.live > 0 ? P.influx.v * dt / this.live : 0;
    const floor = P.starve.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      e[i] += share;
      if (e[i] < floor) this.kill(i);
    }
    while (this.live < 2) {
      const i = this.spawn(rng() * WORLD_W, rng() * WORLD_H, 1.0);
      if (i < 0) break;
      this.a[i] = 0.5 + (rng() - 0.5) * 0.2;
    }
  }

  stats() {
    let main = 0, opp = 0, eSum = 0, cSum = 0, eMax = 0, head = -1;
    for (let i = 0; i < CAP; i++) {
      if (!this.alive[i]) continue;
      eSum += this.e[i];
      cSum += this.c[i];
      if (this.a[i] > 0.5) main++; else opp++;
      if (this.e[i] > eMax) { eMax = this.e[i]; head = i; }
    }
    return {
      live: this.live, main, opp, eSum, eMax, head,
      compassion: cSum / Math.max(1, this.live),
      destroyed: this.destroyed, divided: this.divided,
    };
  }
}

export function radius(energy) { return 0.9 + Math.sqrt(Math.max(0, energy)) * 0.9; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let spare = null;
export function gauss(rng) {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s;
  do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m;
  return u * m;
}
