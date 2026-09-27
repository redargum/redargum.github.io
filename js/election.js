/**
 * Polling stations read off the model, and the two curves Shpilkin's method compares.
 *
 * Every election draws its baseline noise from a seeded generator, so re-running with
 * enforcement switched off changes only the enforcement term and the two results are
 * comparable station by station.
 */
import { CAP, clamp, mulberry32, gauss } from './model.js';

export const BINS = 100;

export const EP = {
  baseTurnout: { v: 0.44, min: 0.1,  max: 0.9,  step: 0.01,  label: 'Baseline turnout' },
  turnoutSd:   { v: 0.09, min: 0.01, max: 0.3,  step: 0.005, label: 'Turnout spread' },
  temp:        { v: 0.38, min: 0.05, max: 1.5,  step: 0.01,  label: 'Preference sharpness' },
  beta:        { v: 0.45, min: 0,    max: 1,    step: 0.01,  label: 'Mobilization by enforcement' },
  beta2:       { v: 0.80, min: 0,    max: 1,    step: 0.01,  label: 'Inflation by enforcement' },
  enfRef:      { v: 6.0,  min: 0.2,  max: 60,   step: 0.2,   label: 'Enforcement reference' },
  roundFrom:   { v: 0.45, min: 0,    max: 1,    step: 0.01,  label: 'Quota threshold' },
};

export const ELECTION_RULES = [
  { name: 'Turnout', keys: ['baseTurnout', 'turnoutSd', 'beta'],
    text: () => 'Each station draws a turnout around the baseline, raised by the enforcement it received. Stations under pressure are mobilized as well as inflated, which is why the anomaly shows up along the turnout axis at all.' },
  { name: 'Reported share', keys: ['temp', 'beta2'],
    text: () => 'The honest share is a logistic of the station’s own alignment. Enforcement pushes it the rest of the way toward 1, so the reported result parts company with the preference underneath it.' },
  { name: 'Enforcement reference', keys: ['enfRef'],
    text: () => 'Received enforcement is divided by this fixed amount and capped at 1, so the pressure term is an absolute fraction. It has to be fixed rather than a percentile of the population: scaling against the population would cancel the very change in pressure the sweep is there to show.' },
  { name: 'Quotas', keys: ['roundFrom'],
    text: () => 'Off by default. Above the threshold a station is working to a target, so its share snaps to the nearest 5%. This is what produces the comb of spikes at 70, 75 and 80% in real returns; it is left off so the tail cannot be blamed on the rounding.' },
];

/**
 * @returns {{main:Float64Array, opp:Float64Array, scatter:Float32Array, points:number,
 *   totalVotes:number, mainShare:number, adminShare:number, stations:number}}
 */
export function runElection(model, { enforcement = true, quotas = false, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const ref = EP.enfRef.v;
  const main = new Float64Array(BINS);
  const opp = new Float64Array(BINS);
  const scatter = new Float32Array(2 * 4000);
  let points = 0, totalMain = 0, totalVotes = 0, stations = 0;

  const { baseTurnout, turnoutSd, temp, beta, beta2, roundFrom } = EP;
  const stride = Math.max(1, (model.live / 4000) | 0);
  let seen = 0;

  for (let i = 0; i < CAP; i++) {
    if (!model.alive[i]) continue;
    stations++;
    const u = enforcement ? clamp(model.enf[i] / ref, 0, 1) : 0;
    const turnout = clamp(baseTurnout.v + gauss(rng) * turnoutSd.v + beta.v * u, 0.03, 0.995);
    const honest = 1 / (1 + Math.exp(-model.a[i] / temp.v));
    let share = clamp(honest + beta2.v * u * (1 - honest), 0, 1);
    if (quotas && u > roundFrom.v) share = Math.round(share * 20) / 20;

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
    main, opp, scatter, points, stations, totalVotes,
    mainShare: totalVotes > 0 ? totalMain / totalVotes : 0,
    adminShare: administrativeShare(main, opp, totalVotes),
  };
}

/**
 * Shpilkin's estimate: the opposition curve is taken as the shape a clean election would
 * have, scaled to the mainstream curve on the low-turnout flank where inflation has not
 * reached, and whatever the mainstream curve carries above that is counted as administrative.
 */
export function administrativeShare(main, opp, totalVotes) {
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
