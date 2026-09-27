/**
 * Uniform grid over a fixed world rectangle, rebuilt each step by counting sort.
 *
 * Ported from the neighbour lookup in Kudinov's Kosmiki, which takes it from the
 * CUDA SDK particles sample: bucket by cell, then visit the 3x3 block around a query.
 */
export class Grid {
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

  /** Call fn(j) for every live node in the 3x3 cell block around (x, y). */
  forEachNear(x, y, fn) {
    const cx = Math.min(this.cols - 1, Math.max(0, (x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / this.cell) | 0));
    const { counts, items } = this;
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(this.rows - 1, cy + 1); gy++) {
      const base = gy * this.cols;
      const lo = counts[base + Math.max(0, cx - 1)];
      const hi = counts[base + Math.min(this.cols - 1, cx + 1) + 1];
      for (let k = lo; k < hi; k++) fn(items[k]);
    }
  }
}
