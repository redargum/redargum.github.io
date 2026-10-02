/**
 * The simulation, with no reference to the page: the torus grid, the cells and sticks that
 * live on it, and the election read off them. Nothing here touches the DOM, so it runs under
 * node as readily as in the browser.
 *
 * This variant carries no persuasion through space. Nobody broadcasts and neighbours do not
 * talk. What a cell holds comes along the stick above it, from being neglected by whoever
 * holds that stick, or from answering to nobody at all, so the returns are the shape of the
 * hierarchy and nothing else.
 */

// ============================================================================
// Uniform grid over a torus
// ============================================================================

/**
 * Uniform grid over a fixed world rectangle, rebuilt each step by counting sort.
 *
 * Ported from the neighbour lookup in Kudinov's Kosmiki, which takes it from the
 * CUDA SDK particles sample: bucket by cell, then visit the 3x3 block around a query.
 */
class Grid {
  constructor(width, height, cell, capacity) {
    this.w = width;
    this.h = height;
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.counts = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  cellIndex(x, y) {
    let cx = (x / this.cell) | 0;
    let cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  rebuild(xs, ys, alive, count) {
    const { counts, items, cellOf } = this;
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      if (!alive[i]) { cellOf[i] = -1; continue; }
      const c = this.cellIndex(xs[i], ys[i]);
      cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
    const cursor = this._cursor ??= new Int32Array(counts.length);
    cursor.set(counts);
    for (let i = 0; i < count; i++) {
      const c = cellOf[i];
      if (c >= 0) items[cursor[c]++] = i;
    }
  }

  /**
   * Call fn(j) for every live node in the 3x3 cell block around (x, y), wrapping at the
   * edges: the field is a torus, so the block around a border cell continues on the far side.
   */
  forEachNear(x, y, fn) {
    const cx = Math.min(this.cols - 1, Math.max(0, (x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / this.cell) | 0));
    const { counts, items, cols, rows } = this;
    for (let oy = -1; oy <= 1; oy++) {
      const gy = (cy + oy + rows) % rows;
      const base = gy * cols;
      for (let ox = -1; ox <= 1; ox++) {
        const gx = (cx + ox + cols) % cols;
        const c = base + gx;
        for (let k = counts[c]; k < counts[c + 1]; k++) fn(items[k]);
      }
    }
  }
}

// ============================================================================
// The model: cells, sticks, energy, alignment
// ============================================================================

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

export const WORLD_W = 380;
export const WORLD_H = 240;
export const CAP = 1600;

const HALF_W = WORLD_W / 2, HALF_H = WORLD_H / 2;

/** Plastic number: the 2-D generalisation of the golden ratio, for even deterministic cover. */
const PLASTIC = 1.32471795724474602596;
const A1 = 1 / PLASTIC, A2 = 1 / (PLASTIC * PLASTIC);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Shortest separation on a torus: never reach across the field when the seam is nearer. */
export function dx(a, b) { const d = b - a; return d > HALF_W ? d - WORLD_W : d < -HALF_W ? d + WORLD_W : d; }
export function dy(a, b) { const d = b - a; return d > HALF_H ? d - WORLD_H : d < -HALF_H ? d + WORLD_H : d; }
function wrapX(v) { return v < 0 ? v + WORLD_W : v >= WORLD_W ? v - WORLD_W : v; }
function wrapY(v) { return v < 0 ? v + WORLD_H : v >= WORLD_H ? v - WORLD_H : v; }

/** Golden-ratio floor on absorption, from the Kosmiki rules. */
const PHI_INV = 0.618;

/** Every tunable the model reads. `rules.js` renders the panel from this object. */
export const P = {
  compassion:  { v: 0.50, min: 0,    max: 1,    step: 0.01,  label: 'Compassion',
    tip: 'Share of each stick\u2019s tribute withheld: at 0 sticks carry everything, at 1 nothing moves.' },
  drain:       { v: 0.05, min: 0, max: 1, step: 0.01, label: 'Share the stick carries',
    tip: 'Share of its energy a cell sends up its stick each step, before compassion: e * drain * (1 - compassion).' },
  divide:      { v: 5.0, min: 1.5, max: 30, step: 0.1, label: 'Division threshold (x mean)',
    tip: 'A cell splits in two once its energy reaches this multiple of the mean.' },
  span:        { v: 5,   min: 1,   max: 20, step: 1,   label: 'Span of control',
    tip: 'A cell splitting with more followers than this hands every other follower to the new cell.' },
  starve:      { v: 0.06, min: 0.01, max: 3, step: 0.01, label: 'Starvation floor',
    tip: 'A cell whose energy falls below this dies.' },
  land:        { v: 0.30, min: 0.005, max: 1,   step: 0.005, label: 'Energy per square',
    tip: 'Income per grid square per step, split equally between the cells standing in it.' },
  upkeep:      { v: 0.018, min: 0.001, max: 0.1, step: 0.001, label: 'Upkeep',
    tip: 'Cost per step: upkeep * e ^ metabolic.' },
  metabolic:   { v: 0.75, min: 0.5,  max: 1,    step: 0.01,  label: 'Metabolic exponent',
    tip: 'Exponent of upkeep. Below 1, a large cell pays less per unit of energy.' },
  repel:       { v: 0.25, min: 0, max: 2, step: 0.01, label: 'Cell repulsion',
    tip: 'Repulsion between two cells: repel * (e1 + e2) / (d^2 + 4).' },
  stick:       { v: 0.006, min: 0, max: 0.05, step: 0.0005, label: 'Stick stiffness',
    tip: 'Spring stiffness of a stick, scaled by the smaller of the two energies.' },
  drag:        { v: 0.11, min: 0.01, max: 0.6, step: 0.01, label: 'Drag',
    tip: 'Share of velocity lost each step.' },
  hunt:        { v: 0.10, min: 0, max: 1, step: 0.01, label: 'Hunt / flee force',
    tip: 'Pull toward opponents a cell can absorb, and push away from those that can absorb it.' },
  reach:       { v: 30,   min: 10,   max: 70,   step: 1,     label: 'Interaction radius',
    tip: 'Radius of repulsion and hunting. Destruction reaches 0.55 of it.' },
  theta:       { v: 0.30, min: 0.02, max: 1,    step: 0.01,  label: 'Destruction threshold',
    tip: 'Alignment gap that makes two cells opponents. Destruction needs a gap above theta / (1 - compassion).' },
  absorbFloor: { v: PHI_INV, min: 0.05, max: 1, step: 0.01, label: 'Absorption floor',
    tip: 'A victim must hold at least this share of the attacker\u2019s energy.' },
  surcharge:   { v: 0.35, min: 0,    max: 2,    step: 0.05,  label: 'Destruction surcharge',
    tip: 'Destroying a cell costs its energy * (1 + surcharge); each casualty of a conquest costs the victor this much.' },
  conform:     { v: 0.030, min: 0, max: 1,    step: 0.005,  label: 'Conformity',
    tip: 'How far colour moves per unit of energy change: m = min(1, conform * |delta e| / mean energy).' },
  recruitR:    { v: 36,   min: 6,    max: 60,   step: 1,     label: 'Recruitment radius',
    tip: 'Distance within which a cell can recruit a free cell.' },
  recruitMin:  { v: 0.40, min: 0.05, max: 6, step: 0.05, label: 'Recruitment minimum (x mean)',
    tip: 'Least energy, as a multiple of the mean, a cell needs to recruit.' },
  fanout:      { v: 3.0,  min: 1,    max: 12,   step: 0.5,   label: 'Children per unit size',
    tip: 'Followers a cell may hold: 1 + fanout * sqrt(e).' },
  campaign:    { v: 0.02, min: 0,    max: 0.5,  step: 0.005, label: 'Campaign force',
    tip: 'Pull on every member of a structure toward the rival it advances on, or away from the one it flees.' },
  warchest:    { v: 1.25, min: 1,    max: 4,    step: 0.05,  label: 'Strength before advancing',
    tip: 'Strength ratio over a rival structure needed to advance on it; a rival this much stronger makes it withdraw.' },
  casualties:  { v: 0.30, min: 0,    max: 1,    step: 0.05,  label: 'Casualties taking a rival',
    tip: 'Share of members killed when a structure is taken across the divide.' },
  surveyEvery: { v: 20,   min: 5,    max: 120,  step: 5,     label: 'Steps between surveys',
    tip: 'Steps between recounting structures and choosing campaign targets.' },
  breakFree:   { v: 2.50, min: 1,    max: 4,    step: 0.05,  label: 'Break-free ratio',
    tip: 'A cell holding more than this multiple of its patron\u2019s energy cuts the stick.' },
  recruitGap:  { v: 0.45, min: 0.05, max: 1,    step: 0.05,  label: 'Recruitment tolerance',
    tip: 'Largest alignment difference at which a cell recruits another.' },
};

/** One line per rule; `text` reads live values out of `P`, so the panel cannot go stale. */
export const RULES = [
  { name: 'A field without edges', keys: [],
    text: () => 'The field is a torus: leave one side and you arrive at the other, and two cells are always as far apart as the shorter way round. Nothing piles up against a wall and no position is privileged.' },
  { name: 'Cells and sticks', keys: ['repel', 'stick', 'drag'],
    text: () => 'A node is a cell with energy, inertia and one alignment number, 0 for the challenger and 1 for the incumbent. Cells repel in proportion to their energy; a stick between two of them resists that repulsion with the smaller of the two energies. Nothing sits on a lattice — position is an outcome.' },
  { name: 'Tribute', keys: ['drain', 'compassion'],
    text: () => 'Every stick carries a share of what the child holds up to its parent. The parameter is what the stick would carry, compassion is how much of that is withheld, so at 0 the child keeps nothing and at 1 nothing moves at all.' },
  { name: 'Compassion', keys: ['compassion'],
    text: () => 'One number for the whole field, not a trait cells carry. Which way a cell sends energy across its sticks. Below 0.5 it takes from whoever has less and the distribution goes heavy-tailed; above 0.5 it gives, and holdings level out. This one parameter decides whether the election grows a tail.' },
  { name: 'The center is emergent', keys: [],
    text: () => 'No node is designated. The head of a structure is whichever cell holds the most energy, and it changes hands when another overtakes it.' },
  { name: 'Breaking free', keys: ['breakFree'],
    text: () => 'A cell that grows past this multiple of its parent\u2019s size cuts the stick and stands on its own. No hierarchy can grow without limit: whoever the cascade makes strong stops being anyone\u2019s subordinate.' },
  { name: 'Recruitment', keys: ['recruitR', 'recruitMin', 'recruitGap', 'fanout'],
    text: () => 'A cell attaches the nearest unattached poorer cell of roughly its own views, up to a fanout that grows with its size. Absorbing in Kosmiki joins the victim on rather than deleting it, and this is the only thing that creates a stick.' },
  { name: 'Division', keys: ['divide'],
    text: () => 'Past a multiple of the mean cell size a cell splits. The child keeps the parent’s views exactly, the energy is halved between them, and the two start joined by a stick. Structures grow rather than being placed.' },
  { name: 'Span of control', keys: ['span'],
    text: () => 'A cell that splits while holding more followers than the span hands every other one to the new cell, which then stands beside it under the same patron rather than beneath it. Nobody manages a crowd directly: a structure grows middle layers instead of a hub ringed by followers, and it grows taller only when its head splits.' },
  { name: 'Land, upkeep and starvation', keys: ['land', 'upkeep', 'metabolic', 'starve'],
    text: () => 'Every square of the field yields the same income, split between whoever is standing in it, so a cell alone on its square takes all of it and ten crowded together take a tenth each. Ground is therefore worth holding and worth spreading over, and a structure that packs itself into one corner starves. Each cell then pays upkeep on what it holds, and one that cannot hold the floor dies. The floor is a plain amount: tied to the mean it made a few rich isolated cells raise the bar that killed every crowded one, and tied to what a solitary cell sustains it moved faster than the income it was meant to track. Upkeep rises more slowly than size, as real metabolism does, so being large is cheaper per unit held \u2014 the economy of scale that lets a drained-from hierarchy run away from the cells feeding it.' },
  { name: 'Loyalty follows fortune', keys: ['conform'],
    text: () => 'A cell\u2019s colour is its loyalty to a party, and it moves only with the cell\u2019s fortune: by <code>m = min(1, conform * |delta e| / mean)</code> of the way to a target, where <code>delta e</code> is how much its energy changed over the last step. A cell under a boss that gained moves toward the boss\u2019s party, one that lost moves toward the other. A head that gained hardens toward the party it leans to; a head that lost, a head at exactly 0.5 and a cell with neither boss nor followers keep their colour. A cell that crosses to the other side of its boss cuts the stick.' },
  { name: 'Destruction', keys: ['theta', 'surcharge', 'absorbFloor'],
    text: () => `A cell destroys a near opponent when the alignment gap exceeds <code>theta / (1 - c)</code>, when it holds more energy, and when the victim holds at least the absorption floor of the attacker's energy — you cannot eat something far beneath you, which is why hierarchies have to grow intermediate layers. The attacker pays the victim's full energy plus the surcharge.` },
  { name: 'Campaigns', keys: ['campaign', 'warchest', 'surveyEvery'],
    text: () => 'Structures march on each other, whichever side they are on, because a faction of your own colour is worth taking too. One worth enough more than a rival advances on it, one worth less withdraws, and every member feels the same pull, so a faction moves as a body. Without it the towers settle out of each other\u2019s reach and the map freezes with nobody able to touch anybody.' },
  { name: 'Taking a faction', keys: ['casualties'],
    text: () => 'Reaching a rival head with a heavier cell takes the whole structure under it: the head is re-parented and its members come with it. Within one side that is all that happens, and a faction changes hands intact. Across the divide a share of the members do not survive it, and the victor pays for each.' },
  { name: 'Hunting', keys: ['hunt'],
    text: () => 'A cell accelerates toward opponents it could destroy and away from opponents that could destroy it. Fronts and territories come out of this, not out of any map.' },
  { name: 'Repression is not free', keys: ['surcharge'],
    text: () => 'Destroying costs more than the victim held. With nothing to spend energy on but growing, a faction that purges heavily divides less and stays smaller than one that does not, and nothing in the rules forces that trade: it falls out of the cost.' },
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
    this.parent = new Int32Array(CAP);
    this.pgen = new Int32Array(CAP);
    this.gen = new Int32Array(CAP);
    this.alive = new Uint8Array(CAP);
    this.kids = new Int32Array(CAP);
    this.flow = new Float32Array(CAP);
    this.head = new Int32Array(CAP).fill(-1);
    this.strength = new Float32Array(CAP);
    this.members = new Int32Array(CAP);
    this.target = new Int32Array(CAP).fill(-1);
    this.lastE = new Float32Array(CAP);
    this.surveyDue = 0;

    this.free = new Int32Array(CAP);
    this.freeTop = 0;
    this.seq = 0;
    this.meanE = 1;
    this.time = 0;
    this.destroyed = 0;
    this.conquered = 0;
    this.divided = 0;
    this.live = 0;

    this.parent.fill(-1);
    for (let i = CAP - 1; i >= 0; i--) this.free[this.freeTop++] = i;

    for (let s = 0; s < 240; s++) {
      const [px, py] = this.nextSite();
      const i = this.spawn(px, py, 1.0);
      // A colour of exactly 0.5 has no party, and a structure under it would never move.
      if (i >= 0) this.a[i] = 0.5 + (s % 2 ? 0.01 : -0.01);
    }
    for (const [fx, align, n] of [[0.33, 1, 70], [0.70, 0, 70]]) {
      const cx = WORLD_W * fx, cy = WORLD_H * 0.5;
      const head = this.spawn(cx, cy, 8);
      this.a[head] = align;
      for (let k = 0; k < n; k++) {
        const ang = k * GOLDEN_ANGLE, r = Math.sqrt((k + 0.5) / n) * WORLD_W * 0.14;
        const i = this.spawn(wrapX(cx + Math.cos(ang) * r), wrapY(cy + Math.sin(ang) * r), 1.5);
        if (i < 0) break;
        this.a[i] = align;
        this.link(i, head);
      }
    }

    this.grid = new Grid(WORLD_W, WORLD_H, Math.max(P.reach.v, 24), CAP);
  }

  /**
   * The next site in an R2 low-discrepancy sequence. Irregular and evenly spread without
   * being random: the same run twice gives the same field, and any variation the returns
   * show has to have been produced by the model rather than drawn from a distribution.
   */
  nextSite() {
    const n = ++this.seq;
    return [((0.5 + A1 * n) % 1) * WORLD_W, ((0.5 + A2 * n) % 1) * WORLD_H];
  }

  spawn(x, y, energy) {
    if (this.freeTop === 0) return -1;
    const i = this.free[--this.freeTop];
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = 0; this.vy[i] = 0;
    this.e[i] = energy;
    this.a[i] = 0.5;
    this.lastE[i] = energy;
    this.parent[i] = -1;
    this.gen[i]++;
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

  step() {
    this.time += 1;
    const cell = Math.max(P.reach.v, 24);
    if (this.grid.cell !== cell) this.grid = new Grid(WORLD_W, WORLD_H, cell, CAP);
    this.grid.rebuild(this.x, this.y, this.alive, CAP);

    this.survey();
    this.forcePass();
    this.campaignPass();
    this.breakFreePass();
    this.drainPass();
    this.alignPass();
    this.recruitPass();
    this.destroyPass();
    this.dividePass();
    this.incomePass();
  }

  /** Repulsion, stick tension, hunting and drag, integrated with inertia. */
  forcePass() {
    const { x, y, vx, vy, e, a, parent, alive } = this;
    const R = P.reach.v, R2 = R * R;
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

  /**
   * Who belongs to whom and how much each structure is worth, refreshed every few steps
   * because walking to the root for every cell is too costly to repeat every one.
   */
  survey() {
    if (--this.surveyDue > 0) return;
    this.surveyDue = P.surveyEvery.v | 0;
    const { head, strength, members, target, alive, e, a } = this;
    strength.fill(0);
    members.fill(0);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) { head[i] = -1; continue; }
      const h = this.headOf(i);
      head[i] = h;
      strength[h] += e[i];
      members[h]++;
    }
    // Each structure picks the nearest rival it outweighs, and notes the nearest that outweighs it.
    target.fill(-1);
    for (let h = 0; h < CAP; h++) {
      if (!alive[h] || head[h] !== h || strength[h] <= 0) continue;
      let prey = -1, preyD = Infinity, threat = -1, threatD = Infinity;
      for (let r = 0; r < CAP; r++) {
        if (r === h || !alive[r] || head[r] !== r || strength[r] <= 0) continue;
        const d = dx(this.x[h], this.x[r]) ** 2 + dy(this.y[h], this.y[r]) ** 2;
        if (strength[h] > strength[r] * P.warchest.v) {
          if (d < preyD) { preyD = d; prey = r; }
        } else if (strength[r] > strength[h] * P.warchest.v) {
          if (d < threatD) { threatD = d; threat = r; }
        }
      }
      target[h] = prey >= 0 ? prey : (threat >= 0 ? ~threat : -1);
    }
  }

  /**
   * Structures march on each other. A tower strong enough to take a rival advances on it and
   * one too weak withdraws, and every member feels it, so the structure moves as a body rather
   * than as cells that happen to be adjacent. Without this the towers never come within the
   * range at which any of the short-range rules can fire, and the map freezes.
   */
  campaignPass() {
    const { x, y, vx, vy, e, alive, head, target } = this;
    const k = P.campaign.v;
    if (k === 0) return;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const h = head[i];
      if (h < 0) continue;
      const t = target[h];
      if (t === -1) continue;
      const foe = t >= 0 ? t : ~t;
      const sign = t >= 0 ? 1 : -1;
      if (!alive[foe]) continue;
      const ddx = dx(x[i], x[foe]), ddy = dy(y[i], y[foe]);
      const d = Math.hypot(ddx, ddy) || 1e-3;
      const m = Math.max(0.4, e[i]);
      vx[i] += sign * k * ddx / d / m;
      vy[i] += sign * k * ddy / d / m;
    }
  }

  /**
   * Taking a faction of your own side costs it nothing: the head changes hands and the body
   * carries on. Taking one across the divide is a war, and a share of its members do not
   * survive it.
   */
  sack(head, victor) {
    const share = P.casualties.v;
    if (share <= 0) return;
    let toll = 0;
    for (let i = 0; i < CAP; i++) {
      if (!this.alive[i] || this.head[i] !== head || i === head) continue;
      if (((i * 2654435761) >>> 0) / 4294967296 >= share) continue;
      this.kill(i);
      toll++;
    }
    this.e[victor] = Math.max(0, this.e[victor] - toll * P.surcharge.v);
    this.destroyed += toll;
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
    const { e, alive, flow, kids } = this;
    flow.fill(0);
    kids.fill(0);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p >= 0) kids[p]++;
    }
    const f = P.drain.v * (1 - clamp(P.compassion.v, 0, 1));
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = this.parentOf(i);
      if (p < 0) continue;
      const amount = e[i] * f;
      flow[i] -= amount;
      flow[p] += amount;
    }
    for (let i = 0; i < CAP; i++) {
      if (alive[i]) e[i] = Math.max(0, e[i] + flow[i]);
    }
  }
  /** Colour moves with fortune: toward the boss's party after a gain, away from it after a loss. */
  alignPass() {
    const { a, e, alive, kids, lastE } = this;
    const k = P.conform.v / Math.max(1e-6, this.meanE);
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const delta = e[i] - lastE[i];
      lastE[i] = e[i];
      const m = Math.min(1, k * Math.abs(delta));
      const boss = this.parentOf(i);
      if (boss >= 0) {
        if (a[boss] === 0.5) continue;
        const party = a[boss] > 0.5 ? 1 : 0;
        a[i] += m * ((delta >= 0 ? party : 1 - party) - a[i]);
        if ((a[i] > 0.5 ? 1 : 0) !== party) this.parent[i] = -1;
      } else if (kids[i] > 0 && delta >= 0 && a[i] !== 0.5) {
        a[i] += m * ((a[i] > 0.5 ? 1 : 0) - a[i]);
      }
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
      // A parentless cell is a root, and the recruiter may already be somewhere in its tree:
      // linking them then closes a loop that no later pass can walk out of.
      if (best >= 0 && this.headOf(i) !== best) { this.link(best, i); kids[i]++; }
    }
  }

  destroyPass() {
    const ROUGHNESS = 1 - clamp(P.compassion.v, 0.01, 0.985);

    const { x, y, a, e, c, alive } = this;
    const R = P.reach.v * 0.55, R2 = R * R;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const gap = P.theta.v / ROUGHNESS;
      if (gap > 1) continue;
      const xi = x[i], yi = y[i], ai = a[i], ei = e[i];
      let victim = -1;
      this.grid.forEachNear(xi, yi, j => {
        if (victim >= 0 || j === i || !alive[j]) return;
        if (!this.canAbsorb(i, j)) return;
        const ddx = dx(xi, x[j]), ddy = dy(yi, y[j]);
        if (ddx * ddx + ddy * ddy > R2) return;
        victim = j;
      });
      if (victim < 0) continue;
      const hostile = Math.abs(ai - a[victim]) > gap;
      if (this.head[victim] === victim && this.headOf(i) !== victim) {
        this.link(victim, i);
        this.conquered++;
        if (hostile) this.sack(victim, i);
        continue;
      }
      if (!hostile) continue;
      const cost = e[victim] * (1 + P.surcharge.v);
      if (ei <= cost) continue;
      e[i] = ei - cost;
      this.kill(victim);
      this.destroyed++;
    }
  }

  dividePass() {
    const { e, a, x, y, parent, alive } = this;
    const thr = P.divide.v * this.meanE;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i] || e[i] < thr) continue;
      const half = e[i] / 2;
      const ang = this.seq++ * GOLDEN_ANGLE;
      const r = radius(half) + 3;
      const j = this.spawn(wrapX(x[i] + Math.cos(ang) * r), wrapY(y[i] + Math.sin(ang) * r), half);
      if (j < 0) break;
      e[i] = half;
      a[j] = a[i];
      // An overfull cell splits like a B-tree node: the new cell takes half its followers and stands beside it.
      let up = i;
      if (this.kids[i] > P.span.v) {
        for (let k = 0, n = 0; k < CAP; k++) if (alive[k] && k !== j && this.parentOf(k) === i && n++ % 2) this.link(k, j);
        if (this.parentOf(i) >= 0) up = this.parentOf(i);
      }
      this.link(j, up);
      this.divided++;
    }
  }

  /**
   * A fixed total income is split equally between the living, so each new cell lowers what
   * every cell receives. The population has no ceiling; it settles where income meets losses.
   */
  incomePass() {
    const { e, alive } = this;
    const rate = P.upkeep.v, exp = P.metabolic.v;
    const floor = P.starve.v;
    const { counts, cellOf } = this.grid;
    const income = P.land.v;
    let sum = 0;
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const c = cellOf[i];
      const crowd = c >= 0 ? counts[c + 1] - counts[c] : 1;
      e[i] += income / Math.max(1, crowd) - Math.min(e[i], rate * Math.pow(e[i], exp));
      if (e[i] < floor) this.kill(i); else sum += e[i];
    }
    this.meanE = this.live > 0 ? sum / this.live : 1;
    while (this.live < 2) {
      const [px, py] = this.nextSite();
      const i = this.spawn(px, py, 1.0);
      if (i < 0) break;
      this.a[i] = 0.5;
    }
  }

  /** The head of i's structure: follow the sticks up until nobody is above. */
  headOf(i) {
    let cur = i;
    for (let hop = 0; hop <= CAP; hop++) {
      const p = this.parentOf(cur);
      if (p < 0) return cur;
      cur = p;
    }
    // More hops than there are cells means a loop; cut it here rather than walk it forever
    this.parent[cur] = -1;
    return cur;
  }

  stats() {
    let red = 0, blue = 0, eSum = 0, eMax = 0, head = -1;
    for (let i = 0; i < CAP; i++) {
      if (!this.alive[i]) continue;
      eSum += this.e[i];
      if (this.a[i] > 0.5) red++; else blue++;
      if (this.e[i] > eMax) { eMax = this.e[i]; head = i; }
    }
    // Levels between each attached cell and its head, memoised so a chain is walked once.
    const depth = new Int32Array(CAP).fill(-1), patrons = new Uint8Array(CAP);
    let levels = 0, attached = 0;
    for (let i = 0; i < CAP; i++) {
      if (!this.alive[i]) continue;
      const path = [];
      let cur = i;
      while (depth[cur] < 0) {
        const p = this.parentOf(cur);
        if (p < 0 || path.length > CAP) { depth[cur] = 0; break; }
        path.push(cur);
        cur = p;
      }
      for (let k = path.length - 1, d = depth[cur]; k >= 0; k--) depth[path[k]] = ++d;
      const p = this.parentOf(i);
      if (p >= 0) { patrons[p] = 1; levels += depth[i]; attached++; }
    }
    let patronCount = 0;
    for (let i = 0; i < CAP; i++) patronCount += patrons[i];
    return {
      live: this.live, red, blue, eSum, eMax, head,
      depth: attached > 0 ? levels / attached : 0,
      span: patronCount > 0 ? attached / patronCount : 0,
      compassion: P.compassion.v,
      destroyed: this.destroyed, divided: this.divided, conquered: this.conquered,
    };
  }
}
export function radius(energy) { return 0.9 + Math.sqrt(Math.max(0, energy)) * 0.9; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }



// ============================================================================
// The election: honest, decided by loyalty
// ============================================================================

/**
 * An honest election, and the two curves Shpilkin's method compares.
 *
 * Nobody falsifies anything here. Every vote is cast willingly and counted as cast. A cell
 * votes its colour, which is its loyalty to a party, and casts votes in proportion to its
 * energy, so the starving barely count. Whatever tail the returns grow comes from how the
 * structures moved their members' loyalty and who they bring to the polls.
 *
 * Neither colour is the incumbent by definition. Whichever side is ahead when the votes are
 * counted holds that standing, and the other is the challenger whose curve supplies the
 * baseline; a challenger that overtakes the incumbent takes the title with the majority.
 *
 * Nothing here is drawn from a distribution. Every quantity follows from the state of the
 * field, so any shape the returns take was produced by the model rather than put in by hand.
 */

export const BINS = 50;

export const EP = {
  temp:        { v: 0.16, min: 0.02, max: 0.8,  step: 0.01,  label: 'Preference sharpness',
    tip: 'How decisively a mild preference becomes a vote: own = 1 / (1 + exp(-(a - 0.5) / temp)).' },
  parityFall:  { v: 0.30, min: 0.05, max: 1,    step: 0.01,  label: 'How slowly turnout falls',
    tip: 'Turnout of an attached cell: min(1, e / e_parent) ^ parityFall. Lower means turnout falls more slowly.' },
};

export const ELECTION_RULES = [
  { name: 'Nobody cheats', keys: [],
    text: () => 'Every vote is cast willingly and counted as cast. There is no stuffing, no inflation and no quota. Whatever shape the returns take, the mechanism producing it is social, not criminal.' },
  { name: 'The vote is the colour', keys: [],
    text: () => 'A cell votes its own colour and nothing else: no head tells it how to vote. A structure changes the result only by having moved its members\u2019 loyalty and by who it brings to the polls.' },
  { name: 'Who turns out', keys: ['parityFall'],
    text: () => 'A cell answering to nobody votes on conviction alone, <code>|2a - 1|</code>: certain at either pole, not at all in the middle. A cell answering to someone votes on how far it stands from them, <code>min(1, e / e_parent) ^ parityFall</code>: fully at parity, and falling away the further its patron towers over it, gently rather than in proportion. Being dominated puts you off going, it does not march you out. A cell casts <code>turnout * e</code> votes, so the starving barely count.' },
  { name: 'Preference', keys: ['temp'],
    text: () => 'A cell votes a logistic of how far its own alignment sits above the midpoint. Sharpness sets how decisively a mild preference becomes a vote.' },
];

/**
 * @returns {{main:Float64Array, opp:Float64Array, scatter:Float32Array, points:number,
 *   totalVotes:number, mainShare:number, blocShare:number, stations:number,
 *   incumbentIsRed:boolean, redShare:number, turnout:number}}
 */
export function runElection(model) {
  const red = new Float64Array(BINS);
  const blue = new Float64Array(BINS);
  const scatter = new Float32Array(2 * 4000);
  let points = 0, redVotes = 0, totalVotes = 0, electorate = 0, stations = 0;

  const { temp, parityFall } = EP;
  const stride = Math.max(1, (model.live / 4000) | 0);
  let seen = 0;

  for (let i = 0; i < CAP; i++) {
    if (!model.alive[i]) continue;
    stations++;

    const share = 1 / (1 + Math.exp(-(model.a[i] - 0.5) / temp.v));

    // Answering to nobody, only conviction brings you out. Answering to someone, what brings
    // you out is standing near enough to them to matter: parity votes, domination does not.
    const parent = model.parentOf(i);
    const turnout = parent < 0
      ? Math.abs(model.a[i] - 0.5) * 2
      : Math.pow(Math.min(1, model.e[i] / Math.max(1e-9, model.e[parent])), parityFall.v);
    const votes = turnout * model.e[i];
    electorate += model.e[i];
    const bin = Math.min(BINS - 1, (turnout * BINS) | 0);
    red[bin] += votes * share;
    blue[bin] += votes * (1 - share);
    redVotes += votes * share;
    totalVotes += votes;

    if (seen++ % stride === 0 && points < 4000) {
      scatter[2 * points] = turnout;
      scatter[2 * points + 1] = share;
      points++;
    }
  }

  // Incumbency is a standing, not a colour: whichever side is ahead holds it, and the other
  // supplies the baseline Shpilkin's method compares against.
  const redLeads = redVotes * 2 >= totalVotes;
  const main = redLeads ? red : blue;
  const opp = redLeads ? blue : red;
  const incumbentVotes = redLeads ? redVotes : totalVotes - redVotes;
  if (!redLeads) for (let k = 0; k < points; k++) scatter[2 * k + 1] = 1 - scatter[2 * k + 1];

  return {
    main, opp, scatter, points, stations, totalVotes,
    incumbentIsRed: redLeads,
    redShare: totalVotes > 0 ? redVotes / totalVotes : 0,
    turnout: electorate > 0 ? totalVotes / electorate : 0,
    mainShare: totalVotes > 0 ? incumbentVotes / totalVotes : 0,
    blocShare: blocVote(main, opp, totalVotes),
  };
}

/**
 * Shpilkin's estimate, reading as it was meant to: the challenger curve is the shape a
 * contest of free voters would have, scaled to the incumbent curve on the low-turnout flank
 * where the structures do not reach. Whatever the incumbent curve carries above that is vote
 * delivered by hierarchy rather than by preference.
 */
export function blocVote(main, opp, totalVotes) {
  if (totalVotes <= 0) return 0;
  let mode = 0;
  for (let b = 1; b < BINS; b++) if (opp[b] > opp[mode]) mode = b;
  let sm = 0, so = 0;
  for (let b = 0; b <= mode; b++) { sm += main[b]; so += opp[b]; }
  if (so <= 0) return 0;
  const k = sm / so;
  let excess = 0;
  for (let b = 0; b < BINS; b++) excess += Math.max(0, main[b] - k * opp[b]);
  return excess / totalVotes;
}
