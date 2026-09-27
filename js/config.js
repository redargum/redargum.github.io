/** Config — stored in localStorage under a per-sketch key. */
export class Config {
  constructor(key) {
    this.key = key;
  }

  load() {
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : null;
  }

  save(cfg) {
    localStorage.setItem(this.key, JSON.stringify(cfg));
  }

  clear() {
    localStorage.removeItem(this.key);
  }
}
