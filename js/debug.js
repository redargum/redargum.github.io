/**
 * Client-side debug logger and panel.
 *
 *   import { dbg, initDebugPanel } from './debug.js';
 *   dbg.info('election', { admin: 0.12 });
 *
 * Toggle: Ctrl+Shift+D, or the DBG button.
 */

const MAX_ENTRIES = 300;

class DebugLogger {
  constructor() {
    this._entries = [];
    this._meta = {};
    this._listeners = [];

    window.addEventListener('error', e => {
      this.error(`Uncaught: ${e.message}`, { file: e.filename, line: e.lineno });
    });
    window.addEventListener('unhandledrejection', e => {
      this.error(`Unhandled rejection: ${e.reason?.message ?? e.reason}`);
    });

    const origError = console.error.bind(console);
    console.error = (...a) => { this._push('error', '[console] ' + a.join(' ')); origError(...a); };
  }

  info(msg, data) { this._push('info', msg, data); }
  warn(msg, data) { this._push('warn', msg, data); }
  error(msg, data) { this._push('error', msg, data); }

  setMeta(meta) { this._meta = meta; }
  clear() { this._entries = []; this._notify(); }
  getEntries() { return this._entries; }
  onChange(fn) { this._listeners.push(fn); }

  report() {
    return [
      '=== Shpilka debug report ===',
      `Time: ${new Date().toISOString()}`,
      ...Object.entries(this._meta).map(([k, v]) => `${k}: ${v}`),
      '',
      ...this._entries.map(e => `[${e.time}] ${e.level.padEnd(5)} ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`),
    ].join('\n');
  }

  _push(level, msg, data) {
    this._entries.unshift({ level, msg, data: data ?? null, time: new Date().toTimeString().slice(0, 8) });
    if (this._entries.length > MAX_ENTRIES) this._entries.pop();
    this._notify();
  }

  _notify() { this._listeners.forEach(fn => fn()); }
}

export const dbg = new DebugLogger();

export function initDebugPanel() {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.innerHTML = `
    <div id="debug-header">
      <span id="debug-title">Debug</span>
      <button id="debug-copy">Copy</button>
      <button id="debug-clear">Clear</button>
      <button id="debug-close">✕</button>
    </div>
    <div id="debug-log"></div>`;
  document.body.appendChild(panel);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') toggle();
  });
  document.getElementById('debug-close').onclick = () => panel.classList.remove('open');
  document.getElementById('debug-clear').onclick = () => dbg.clear();
  document.getElementById('debug-copy').onclick = () => navigator.clipboard.writeText(dbg.report());

  dbg.onChange(render);

  function render() {
    if (!panel.classList.contains('open')) return;
    const e = dbg.getEntries();
    document.getElementById('debug-log').innerHTML = e.length === 0
      ? '<div class="dl-empty">No entries.</div>'
      : e.map(x => `<div class="dl-entry dl-${x.level}"><span class="dl-time">${x.time}</span>` +
          `<span class="dl-level">${x.level}</span><span class="dl-msg">${esc(x.msg)}` +
          `${x.data ? ' ' + esc(JSON.stringify(x.data)) : ''}</span></div>`).join('');
  }

  function toggle() { panel.classList.toggle('open'); render(); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  return { toggle };
}
