/**
 * Compassion — cells joined by sticks, competing for energy on a plane.
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

const HALF_W = WORLD_W / 2, HALF_H = WORLD_H / 2;

/** Shortest separation on a torus: never reach across the field when the seam is nearer. */
export function dx(a, b) { const d = b - a; return d > HALF_W ? d - WORLD_W : d < -HALF_W ? d + WORLD_W : d; }
export function dy(a, b) { const d = b - a; return d > HALF_H ? d - WORLD_H : d < -HALF_H ? d + WORLD_H : d; }
function wrapX(v) { return v < 0 ? v + WORLD_W : v >= WORLD_W ? v - WORLD_W : v; }
function wrapY(v) { return v < 0 ? v + WORLD_H : v >= WORLD_H ? v - WORLD_H : v; }

/** Golden-ratio floor on absorption, from the Kosmiki rules. */
const PHI_INV = 0.618;

/** Every tunable the model reads. `rules.js` renders the panel from this object. */
export const P = {
  compassion:  { v: 0.10, min: 0,    max: 1,    step: 0.01,  label: 'Compassion' },
  cSpread:     { v: 0.10, min: 0,    max: 0.4,  step: 0.01,  label: 'Compassion spread' },
  drain:       { v: 0.020, min: 0, max: 0.2, step: 0.001, label: 'Drain per stick' },
  divide:      { v: 5.0, min: 1.5, max: 30, step: 0.1, label: 'Division threshold (x mean)' },
  starve:      { v: 0.15, min: 0.01, max: 1, step: 0.01, label: 'Starvation floor (x mean)' },
  influx:      { v: 9.0, min: 0.5, max: 60, step: 0.5, label: 'Total energy per step' },
  upkeep:      { v: 0.018, min: 0.001, max: 0.1, step: 0.001, label: 'Upkeep' },
  metabolic:   { v: 0.75, min: 0.5,  max: 1,    step: 0.01,  label: 'Metabolic exponent' },
  repel:       { v: 0.25, min: 0, max: 2, step: 0.01, label: 'Cell repulsion' },
  stick:       { v: 0.006, min: 0, max: 0.05, step: 0.0005, label: 'Stick stiffness' },
  drag:        { v: 0.11, min: 0.01, max: 0.6, step: 0.01, label: 'Drag' },
  hunt:        { v: 0.10, min: 0, max: 1, step: 0.01, label: 'Hunt / flee force' },
  influenceR:  { v: 30,   min: 10,   max: 70,   step: 1,     label: 'Enforcement radius' },
  influenceK:  { v: 0.040, min: 0, max: 0.3, step: 0.001, label: 'Media strength' },
  influenceC:  { v: 0.0001, min: 0, max: 0.01, step: 0.0001, label: 'Media cost' },
  theta:       { v: 0.30, min: 0.02, max: 1,    step: 0.01,  label: 'Destruction threshold' },
  absorbFloor: { v: PHI_INV, min: 0.05, max: 1, step: 0.01, label: 'Absorption floor' },
  surcharge:   { v: 0.35, min: 0,    max: 2,    step: 0.05,  label: 'Destruction surcharge' },
  lambda:      { v: 0.004, min: 0, max: 0.05, step: 0.0005, label: 'Neglect drift' },
  povRef:      { v: 0.90, min: 0.1, max: 8, step: 0.1, label: 'Neglect reference (x mean)' },
  recruitR:    { v: 22,   min: 6,    max: 60,   step: 1,     label: 'Recruitment radius' },
  recruitMin:  { v: 0.40, min: 0.05, max: 6, step: 0.05, label: 'Recruitment minimum (x mean)' },
  fanout:      { v: 3.0,  min: 1,    max: 12,   step: 0.5,   label: 'Children per unit size' },
  breakFree:   { v: 1.20, min: 1,    max: 4,    step: 0.05,  label: 'Break-free ratio' },
  tolerance:   { v: 0.35, min: 0.02, max: 1,    step: 0.01,  label: 'Confidence bound' },
  backfire:    { v: 0.55, min: 0,    max: 2,    step: 0.05,  label: 'Backfire' },
  mediaTop:    { v: 14,   min: 0,    max: 60,   step: 1,     label: 'Broadcasters' },
  mediaR:      { v: 130,  min: 20,   max: 400,  step: 5,     label: 'Broadcast reach' },
  mediaK:      { v: 0.022,min: 0,    max: 0.2,  step: 0.001, label: 'Broadcast strength' },
  recruitGap:  { v: 0.45, min: 0.05, max: 1,    step: 0.05,  label: 'Recruitment tolerance' },
  mutate:      { v: 0.03, min: 0,    max: 0.3,  step: 0.005, label: 'Division mutation' },
  erosion:     { v: 0,    min: 0,    max: 1,    step: 1,     label: 'Compassion erosion' },
};

/** One line per rule; `text` reads live values out of `P`, so the panel cannot go stale. */
export const RULES = [
  { name: 'A field without edges', keys: [],
    text: () => 'The field is a torus: leave one side and you arrive at the other, and two cells are always as far apart as the shorter way round. Nothing piles up against a wall and no position is privileged.' },
  { name: 'Cells and sticks', keys: ['repel', 'stick', 'drag'],
    text: () => 'A node is a cell with energy, inertia and one alignment number, 0 for the challenger and 1 for the incumbent. Cells repel in proportion to their energy; a stick between two of them resists that repulsion with the smaller of the two energies. Nothing sits on a lattice — position is an outcome.' },
  { name: 'Energy runs uphill', keys: ['drain', 'compassion'],
    text: () => 'Every stick moves a fixed quantum of energy per second between its two cells, and the compassion of the larger one sets the direction: below 0.5 it takes from the smaller, above 0.5 it gives. Extraction and redistribution are the same rule with the sign reversed. This is the whole concentration mechanism: tribute flows toward whoever already has more.' },
  { name: 'Compassion', keys: ['compassion', 'cSpread'],
    text: () => 'Which way a cell sends energy across its sticks. Below 0.5 it takes from whoever has less and the distribution goes heavy-tailed; above 0.5 it gives, and holdings level out. This one parameter decides whether the election grows a tail.' },
  { name: 'The center is emergent', keys: [],
    text: () => 'No node is designated. The head of a structure is whichever cell holds the most energy, and it changes hands when another overtakes it.' },
  { name: 'Breaking free', keys: ['breakFree'],
    text: () => 'A cell that grows past this multiple of its parent\u2019s size cuts the stick and stands on its own. No hierarchy can grow without limit: whoever the cascade makes strong stops being anyone\u2019s subordinate.' },
  { name: 'Recruitment', keys: ['recruitR', 'recruitMin', 'recruitGap', 'fanout'],
    text: () => 'A cell attaches the nearest unattached poorer cell of roughly its own views, up to a fanout that grows with its size. Absorbing in Kosmiki joins the victim on rather than deleting it, and this is the only thing that creates a stick.' },
  { name: 'Division', keys: ['divide', 'mutate'],
    text: () => 'Past a multiple of the mean cell size a cell splits. The child keeps the parent’s views with a small mutation, the energy is halved between them, and the two start joined by a stick. Structures grow rather than being placed.' },
  { name: 'Income, upkeep and starvation', keys: ['influx', 'upkeep', 'metabolic', 'starve'],
    text: () => 'A fixed total income each second is split equally between every living cell, every cell pays upkeep on what it holds, and one that falls below the floor dies. Upkeep rises more slowly than size, as real metabolism does, so being large is cheaper per unit held \u2014 the economy of scale that lets a drained-from hierarchy run away from the cells feeding it.' },
  { name: 'Bounded confidence', keys: ['tolerance', 'backfire'],
    text: () => 'A cell is moved toward a view within the bound of its own and pushed away from one beyond it. This is what makes the field polarize: every other force here averages, and averaging can only converge, so without a repelled range every opinion collapses into one.' },
  { name: 'Mass media', keys: ['mediaTop', 'mediaR', 'mediaK'],
    text: () => 'The largest cells broadcast their alignment across a radius far beyond their own neighbourhood. Few transmitters with wide reach is what separates propaganda from conformity, and it is what makes holding the apparatus worth having: the pull is toward the broadcaster, not toward the local average.' },
  { name: 'Word of mouth', keys: ['influenceR', 'influenceK', 'influenceC'],
    text: () => 'A cell spends energy to pull the alignment of every neighbour in its radius toward its own, with force rising with its energy and with <code>1 - c</code>: a compassionate cell persuades weakly, a ruthless one coerces. What a cell registers as pressure is that force divided by its own energy: domination is force measured against the ability to resist it, so the same push lands hard on a destitute neighbour and glances off a rich one.' },
  { name: 'Neglect breeds dissent', keys: ['lambda', 'povRef'],
    text: () => 'A cell near the starvation floor turns against the side its own patron belongs to. Because energy runs uphill the periphery is always the poorest, so it defects without anyone deciding it should \u2014 and because it defects from whoever rules it rather than toward a fixed side, neither side is a trap the other can never escape.' },
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
    this.alive = new Uint8Array(CAP);
    this.dA = new Float32Array(CAP);
    this.kids = new Int32Array(CAP);
    this.flow = new Float32Array(CAP);
    this.top = new Int32Array(64);

    this.free = new Int32Array(CAP);
    this.freeTop = 0;
    this.rng = mulberry32(0x5bd1e995);
    this.meanE = 1;
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
    for (const [fx, align, n] of [[0.33, 1, 70], [0.70, 0, 70]]) {
      const cx = WORLD_W * fx, cy = WORLD_H * 0.5;
      const head = this.spawn(cx, cy, 8);
      this.a[head] = align;
      for (let k = 0; k < n; k++) {
        const ang = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * WORLD_W * 0.14;
        const i = this.spawn(wrapX(cx + Math.cos(ang) * r), wrapY(cy + Math.sin(ang) * r), 1.5);
        if (i < 0) break;
        this.a[i] = clamp(align + (align > 0.5 ? -1 : 1) * this.rng() * 0.25, 0, 1);
        this.link(i, head);
      }
    }

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

  step() {
    this.time += 1;
    const cell = Math.max(P.influenceR.v, 24);
    if (this.grid.cell !== cell) this.grid = new Grid(WORLD_W, WORLD_H, cell, CAP);
    this.grid.rebuild(this.x, this.y, this.alive, CAP);

    this.forcePass();
    this.breakFreePass();
    this.drainPass();
    this.influencePass();
    this.broadcastPass();
    this.alignPass();
    this.recruitPass();
    this.destroyPass();
    this.dividePass();
    this.incomePass();
  }

  /** Repulsion, stick tension, hunting and drag, integrated with inertia. */
  forcePass() {
    const { x, y, vx, vy, e, a, parent, alive } = this;
    const R = P.influenceR.v, R2 = R * R;
    const krep = P.repel.v, kstick = P.stick.v, khunt = P.hunt.v;

    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i], ei = e[i], ai = a[i];
      let fx = 0, fy = 0;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j]) return;
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > R2 || d2 < 1e-6) return;
        const d = Math.sqrt(d2);
        const ux = ddx / d, uy = ddy / d;
        const rep = krep * (ei + e[j]) / (d2 + 4);
        fx -= rep * ux; fy -= rep * uy;
        if (Math.abs(ai - a[j]) > P.theta.v) {
          const dir = this.canAbsorb(i, j) ? 1 : this.canAbsorb(j, i) ? -1 : 0;
          if (dir !== 0) { fx += khunt * dir * ux / d; fy += khunt * dir * uy / d; }
        }
      });
      const p = this.parentOf(i);
      if (p >= 0) {
        const ddx = dx(xi, x[p]), ddy = dy(yi, y[p]);
        const d = Math.hypot(ddx, ddy) || 1e-3;
        const rest = radius(ei) + radius(e[p]) + 2;
        const k = kstick * Math.min(ei, e[p]);
        const f = k * (d - rest) / d;
        fx += f * ddx; fy += f * ddy;
      }
      const m = Math.max(0.4, ei);
      vx[i] = (vx[i] + fx / m) * (1 - P.drag.v);
      vy[i] = (vy[i] + fy / m) * (1 - P.drag.v);
      x[i] = wrapX(xi + vx[i]); y[i] = wrapY(yi + vy[i]);
    }
  }

  /** A child that outgrows its parent past the ratio cuts the stick and stands on its own. */
  breakFreePass() {
    const { e, alive } = this;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p >= 0 && e[i] > P.breakFree.v * e[p]) this.parent[i] = -1;
    }
  }

  /** Each stick moves energy from the smaller cell to the larger, held back by compassion. */
  drainPass() {
    const { e, c, parent, alive, flow } = this;
    flow.fill(0);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p < 0) continue;
      const lo = e[i] < e[p] ? i : p;
      const hi = lo === i ? p : i;
      const rate = P.drain.v * (1 - 2 * c[hi]);
      const amount = rate > 0 ? Math.min(e[lo], rate) : -Math.min(e[hi], -rate);
      flow[lo] -= amount;
      flow[hi] += amount;
    }
    for (let i = 0; i < CAP; i++) {
      if (alive[i]) e[i] = Math.max(0, e[i] + flow[i]);
    }
  }

  influencePass() {
    const { x, y, a, e, c, alive, dA } = this;
    dA.fill(0);
    const R = P.influenceR.v, R2 = R * R, k = P.influenceK.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const infl = (1 - c[i]) * e[i];
      if (infl < 0.05) continue;
      const xi = x[i], yi = y[i], ai = a[i];
      let spent = 0;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j]) return;
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > R2) return;
        const w = 1 - d2 / R2;
        dA[j] += k * infl * w * persuade(ai, a[j]);
        spent += w;
      });
      e[i] = Math.max(0, e[i] - P.influenceC.v * infl * spent);
    }
  }

  /**
   * Mass media: the largest cells project alignment far beyond their own neighbourhood, while
   * the local term reaches only as far as a cell can see. Few transmitters with wide reach is
   * what makes this propaganda rather than conformity, and it is why holding the apparatus is
   * worth anything — the pull is toward the broadcaster, not toward the local average.
   */
  broadcastPass() {
    const { x, y, a, e, c, alive, dA, top } = this;
    const k = Math.min(P.mediaTop.v | 0, top.length);
    if (k === 0) return;

    let n = 0;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      if (n < k) {
        top[n++] = i;
        if (n === k) sortTop(top, e, n);
      } else if (e[i] > e[top[k - 1]]) {
        top[k - 1] = i;
        sortTop(top, e, k);
      }
    }
    if (n === 0) return;

    const R = P.mediaR.v, R2 = R * R, strength = P.mediaK.v, mean = Math.max(1e-6, this.meanE);
    for (let t = 0; t < n; t++) {
      const i = top[t];
      if (!alive[i]) continue;
      const reach = (1 - c[i]) * (e[i] / mean);
      if (reach < 0.05) continue;
      const xi = x[i], yi = y[i], ai = a[i];
      for (let j = 0; j < CAP; j++) {
        if (!alive[j] || j === i) continue;
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > R2) continue;
        const w = 1 - d2 / R2;
        dA[j] += strength * reach * w * persuade(ai, a[j]);
      }
    }
  }

  alignPass() {
    const { a, e, alive, dA } = this;
    const lam = P.lambda.v;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      let v = a[i] + dA[i];
      const poverty = 1 - e[i] / (P.povRef.v * this.meanE);
      if (poverty > 0) {
        const patron = this.parentOf(i);
        if (patron >= 0) v += lam * poverty * (a[patron] > 0.5 ? -1 : 1);
      }
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
      if (!alive[i] || e[i] < P.recruitMin.v * this.meanE) continue;
      if (kids[i] >= 1 + P.fanout.v * Math.sqrt(e[i])) continue;
      const xi = x[i], yi = y[i], ai = a[i], ceiling = e[i] * 0.9;
      let best = -1, bestD = R2;
      this.grid.forEachNear(xi, yi, j => {
        if (j === i || !alive[j] || e[j] > ceiling) return;
        if (this.parentOf(j) >= 0) return;
        if (Math.abs(ai - a[j]) > P.recruitGap.v) return;
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        const d2 = ddx * ddx + ddy * ddy;
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
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        if (ddx * ddx + ddy * ddy > R2) return;
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
    const thr = P.divide.v * this.meanE;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i] || e[i] < thr) continue;
      const half = e[i] / 2;
      const ang = rng() * Math.PI * 2;
      const r = radius(half) + 3;
      const j = this.spawn(wrapX(x[i] + Math.cos(ang) * r), wrapY(y[i] + Math.sin(ang) * r), half);
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
  incomePass() {
    const { e, alive, rng } = this;
    const share = this.live > 0 ? P.influx.v / this.live : 0;
    const rate = P.upkeep.v, exp = P.metabolic.v;
    const floor = P.starve.v * this.meanE;
    let sum = 0;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      e[i] += share - Math.min(e[i], rate * Math.pow(e[i], exp));
      if (e[i] < floor) this.kill(i); else sum += e[i];
    }
    this.meanE = this.live > 0 ? sum / this.live : 1;
    while (this.live < 2) {
      const i = this.spawn(rng() * WORLD_W, rng() * WORLD_H, 1.0);
      if (i < 0) break;
      this.a[i] = 0.5 + (rng() - 0.5) * 0.2;
    }
  }

  /** The head of i's structure: follow the sticks up until nobody is above. */
  headOf(i) {
    let cur = i;
    for (let hop = 0; hop < 64; hop++) {
      const p = this.parentOf(cur);
      if (p < 0) return cur;
      cur = p;
    }
    return cur;
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

function sortTop(top, e, n) {
  for (let a = 1; a < n; a++) {
    const v = top[a], ev = e[v];
    let b = a - 1;
    while (b >= 0 && e[top[b]] < ev) { top[b + 1] = top[b]; b--; }
    top[b + 1] = v;
  }
}

/**
 * Bounded confidence: a cell is moved toward a view close enough to its own and pushed away
 * from one too far off. Every force here used to be an averaging force, and averaging can
 * only ever converge — without a repelled range the whole field collapses onto one opinion.
 */
function persuade(from, to) {
  const gap = from - to;
  const t = P.tolerance.v;
  if (Math.abs(gap) <= t) return gap;
  return -Math.sign(gap) * P.backfire.v * (Math.abs(gap) - t);
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
