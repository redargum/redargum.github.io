/**
 * An honest election, and the two curves Shpilkin's method compares.
 *
 * Nobody falsifies anything here. Every vote is cast willingly and counted as cast. The tail
 * comes from loyalty instead: a cell inside a structure votes the way its head does, the more
 * so the further the head towers over it, and it turns out to vote because the structure gets
 * it to the polls. A cell answering to nobody votes its own preference at ordinary turnout.
 * A landscape of big hierarchies therefore delivers near-unanimous blocks at high turnout,
 * while free cells produce a normal core — which is the whole of the Shpilkin picture.
 *
 * Baseline turnout noise is drawn from a seeded generator, so re-running with loyalty off
 * changes only the loyalty term and the two results are comparable station by station.
 */
import { CAP, clamp, mulberry32, gauss } from './model.js';

export const BINS = 50;

export const EP = {
  baseTurnout: { v: 0.42, min: 0.1,  max: 0.9,  step: 0.01,  label: 'Baseline turnout' },
  turnoutSd:   { v: 0.10, min: 0.01, max: 0.3,  step: 0.005, label: 'Turnout spread' },
  temp:        { v: 0.16, min: 0.02, max: 0.8,  step: 0.01,  label: 'Preference sharpness' },
  loyalty:     { v: 0.95, min: 0,    max: 1,    step: 0.01,  label: 'Loyalty to the head' },
  mobilise:    { v: 0.50, min: 0,    max: 1,    step: 0.01,  label: 'Turnout the structure adds' },
};

export const ELECTION_RULES = [
  { name: 'Nobody cheats', keys: [],
    text: () => 'Every vote is cast willingly and counted as cast. There is no stuffing, no inflation and no quota. Whatever shape the returns take, the mechanism producing it is social, not criminal.' },
  { name: 'Capture', keys: ['loyalty'],
    text: () => 'A cell votes the way the head of its structure does, in proportion to how far that head towers over it — <code>e_head / (e_head + e_self)</code>. Someone answering to nobody votes their own preference. Loyalty scales the whole effect, and at zero everyone votes for themselves.' },
  { name: 'Mobilization', keys: ['baseTurnout', 'turnoutSd', 'mobilise'],
    text: () => 'A captured cell is likelier to vote at all, because the structure gets it to the polls. Turnout and unanimity therefore rise together, which is why the anomaly appears along the turnout axis rather than anywhere else.' },
  { name: 'Preference', keys: ['temp'],
    text: () => 'Left alone, a cell votes a logistic of how far its own alignment sits above the midpoint. Sharpness sets how decisively a mild preference becomes a vote.' },
];

/**
 * @returns {{main:Float64Array, opp:Float64Array, scatter:Float32Array, points:number,
 *   totalVotes:number, mainShare:number, blocShare:number, stations:number, captured:number}}
 */
export function runElection(model, { loyalty = true, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const main = new Float64Array(BINS);
  const opp = new Float64Array(BINS);
  const scatter = new Float32Array(2 * 4000);
  let points = 0, totalMain = 0, totalVotes = 0, stations = 0, captured = 0;

  const { baseTurnout, turnoutSd, temp, mobilise } = EP;
  const loyaltyK = loyalty ? EP.loyalty.v : 0;
  const stride = Math.max(1, (model.live / 4000) | 0);
  let seen = 0;

  for (let i = 0; i < CAP; i++) {
    if (!model.alive[i]) continue;
    stations++;

    const head = model.headOf(i);
    const grip = head === i ? 0
      : loyaltyK * model.e[head] / (model.e[head] + model.e[i] + 1e-9);
    if (grip > 0.5) captured++;

    const own = 1 / (1 + Math.exp(-(model.a[i] - 0.5) / temp.v));
    const headSide = head === i ? own : (model.a[head] > 0.5 ? 1 : 0);
    const share = clamp((1 - grip) * own + grip * headSide, 0, 1);

    const turnout = clamp(baseTurnout.v + gauss(rng) * turnoutSd.v + mobilise.v * grip, 0.03, 0.995);
    const votes = model.voters[i] * turnout;
    const bin = Math.min(BINS - 1, (turnout * BINS) | 0);
    main[bin] += votes * share;
    opp[bin] += votes * (1 - share);
    totalMain += votes * share;
    totalVotes += votes;

    if (seen++ % stride === 0 && points < 4000) {
      scatter[2 * points] = turnout;
      scatter[2 * points + 1] = share;
      points++;
    }
  }

  return {
    main, opp, scatter, points, stations, totalVotes, captured,
    mainShare: totalVotes > 0 ? totalMain / totalVotes : 0,
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
