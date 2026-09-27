/**
 * Canvas rendering. Colours come from the stylesheet, so the palette has one home.
 *
 * The diverging alignment scale is the validated blue/red pair with a grey midpoint;
 * nodes are bucketed by alignment and each bucket drawn as one path, which keeps the
 * whole network to a couple of dozen fill calls.
 */
import { CAP, WORLD_W, WORLD_H, radius, clamp } from './model.js';
import { BINS } from './election.js';

const BUCKETS = 21;

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

export class View {
  constructor() {
    this.main = hex(css('--main'));
    this.opp = hex(css('--opp'));
    this.mid = hex(css('--mid'));
    this.sweepColor = css('--sweep');
    this.textMuted = css('--muted');
    this.gridColor = css('--grid');
    this.edge = css('--edge');

    /** Alignment -1..+1 through a grey midpoint: a diverging scale never has a hue in the middle. */
    this.ramp = Array.from({ length: BUCKETS }, (_, k) => {
      const t = k / (BUCKETS - 1) * 2 - 1;
      return t < 0 ? mix(this.mid, this.opp, -t) : mix(this.mid, this.main, t);
    });

    this.canvases = {};
    for (const id of ['net', 'hist', 'scatter', 'sweep']) {
      const el = document.getElementById(id);
      this.canvases[id] = { el, ctx: el.getContext('2d', { alpha: false }) };
    }
    this.onResize = null;
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.onResize?.(); });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const k in this.canvases) {
      const { el } = this.canvases[k];
      const r = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      this.canvases[k].w = r.width;
      this.canvases[k].h = r.height;
      this.canvases[k].ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  clear(key) {
    const { ctx, w, h } = this.canvases[key];
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, w, h);
    return this.canvases[key];
  }

  drawNetwork(model) {
    const { ctx, w, h } = this.clear('net');
    const s = Math.min(w / WORLD_W, h / WORLD_H);
    const ox = (w - WORLD_W * s) / 2, oy = (h - WORLD_H * s) / 2;
    const { x, y, e, a, alive } = model;

    ctx.lineWidth = 1;
    ctx.strokeStyle = this.edge;
    ctx.beginPath();
    const heads = new Path2D();
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const p = model.parentOf(i);
      if (p < 0) continue;
      const giver = e[i] < e[p] ? i : p;
      const taker = giver === i ? p : i;
      const gx = ox + x[giver] * s, gy = oy + y[giver] * s;
      const tx = ox + x[taker] * s, ty = oy + y[taker] * s;
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + (tx - gx) * 0.62, gy + (ty - gy) * 0.62);
      heads.rect(tx - 1, ty - 1, 2, 2);
    }
    ctx.stroke();
    ctx.fillStyle = this.edge;
    ctx.fill(heads);

    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    for (let i = 0; i < CAP; i++) {
      if (!alive[i]) continue;
      const k = Math.round((clamp(a[i], -1, 1) + 1) / 2 * (BUCKETS - 1));
      const r = Math.max(0.7, radius(e[i]) * s);
      const cx = ox + x[i] * s, cy = oy + y[i] * s;
      paths[k].moveTo(cx + r, cy);
      paths[k].arc(cx, cy, r, 0, Math.PI * 2);
    }
    for (let k = 0; k < BUCKETS; k++) {
      ctx.fillStyle = this.ramp[k];
      ctx.fill(paths[k]);
    }
  }

  /** Votes over turnout, one filled curve per party, with the counterfactual as an outline. */
  drawHistogram(result, control) {
    const { ctx, w, h } = this.clear('hist');
    const pad = { l: 34, r: 10, t: 26, b: 22 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    let max = 1e-9;
    for (let b = 0; b < BINS; b++) max = Math.max(max, result.main[b], result.opp[b]);
    if (control) for (let b = 0; b < BINS; b++) max = Math.max(max, control.main[b], control.opp[b]);

    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.25) {
      const px = Math.round(pad.l + t * iw) + 0.5;
      ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ih);
    }
    ctx.stroke();

    const curve = (arr, fill, stroke, dashed) => {
      ctx.beginPath();
      for (let b = 0; b < BINS; b++) {
        const px = pad.l + (b + 0.5) / BINS * iw;
        const py = pad.t + ih - (arr[b] / max) * ih;
        b === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      if (fill) {
        ctx.lineTo(pad.l + iw, pad.t + ih);
        ctx.lineTo(pad.l, pad.t + ih);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    curve(result.opp, 'rgba(57,135,229,.22)', css('--opp'), false);
    curve(result.main, 'rgba(230,103,103,.22)', css('--main'), false);
    if (control) curve(control.main, null, css('--main'), true);

    ctx.fillStyle = this.textMuted;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    for (let t = 0; t <= 1.0001; t += 0.25) {
      ctx.fillText(`${Math.round(t * 100)}%`, pad.l + t * iw, h - 7);
    }
    ctx.textAlign = 'left';
    ctx.fillText('turnout →', pad.l, pad.t - 12);
    ctx.save();
    ctx.translate(11, pad.t + ih / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('votes', 0, 0);
    ctx.restore();

    this.legend(ctx, pad.l + iw - 150, pad.t - 14, [
      [css('--main'), 'mainstream'],
      [css('--opp'), 'opposition'],
    ]);
  }

  drawScatter(result) {
    const { ctx, w, h } = this.clear('scatter');
    const pad = { l: 28, r: 10, t: 26, b: 22 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

    ctx.strokeStyle = this.gridColor;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, iw, ih);

    ctx.fillStyle = 'rgba(230,103,103,.5)';
    for (let k = 0; k < result.points; k++) {
      const tx = result.scatter[2 * k], sy = result.scatter[2 * k + 1];
      ctx.fillRect(pad.l + tx * iw - 0.75, pad.t + ih - sy * ih - 0.75, 1.5, 1.5);
    }

    ctx.fillStyle = this.textMuted;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('turnout →', pad.l, h - 7);
    ctx.save();
    ctx.translate(10, pad.t + ih / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('mainstream share', 0, 0);
    ctx.restore();
  }

  /** Administrative share against compassion: the claim the page exists to make. */
  drawSweep(points, live) {
    const { ctx, w, h } = this.clear('sweep');
    const pad = { l: 32, r: 12, t: 26, b: 22 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

    ctx.strokeStyle = this.gridColor;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, iw, ih);

    ctx.fillStyle = this.textMuted;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('compassion →', pad.l + iw / 2, h - 7);

    if (points.length === 0) {
      ctx.fillText('press Sweep compassion', pad.l + iw / 2, pad.t + ih / 2);
      return;
    }

    const px = c => pad.l + c * iw;
    const py = v => pad.t + ih - clamp(v / 0.5, 0, 1) * ih;

    ctx.beginPath();
    points.forEach((p, k) => (k === 0 ? ctx.moveTo(px(p.c), py(p.admin)) : ctx.lineTo(px(p.c), py(p.admin))));
    ctx.strokeStyle = this.sweepColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.fillStyle = this.sweepColor;
    ctx.beginPath();
    ctx.arc(px(last.c), py(last.admin), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = last.c > 0.5 ? 'right' : 'left';
    ctx.fillText('administrative share', px(last.c) + (last.c > 0.5 ? -8 : 8), py(last.admin) - 6);

    if (live) {
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(live), pad.t);
      ctx.lineTo(px(live), pad.t + ih);
      ctx.stroke();
    }
  }

  legend(ctx, x, y, items) {
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    let cx = x;
    for (const [color, label] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(cx, y - 4, 7, 7);
      ctx.fillStyle = this.textMuted;
      ctx.fillText(label, cx + 11, y + 2);
      cx += 18 + ctx.measureText(label).width;
    }
  }
}
