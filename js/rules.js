/**
 * The rules panel, rendered from the same parameter objects the model reads so the text
 * cannot describe a model other than the one running.
 */
import { P, RULES } from './model.js';
import { EP, ELECTION_RULES } from './election.js';

export function initRules() {
  const overlay = document.getElementById('rules');
  const list = document.getElementById('rules-list');

  document.getElementById('btn-rules').onclick = open;
  document.getElementById('rules-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  function open() { render(); overlay.classList.add('open'); }
  function close() { overlay.classList.remove('open'); }

  function render() {
    list.innerHTML = [
      section('Model', RULES, P),
      section('Election', ELECTION_RULES, EP),
    ].join('');
  }

  function section(title, rules, params) {
    return `<div class="rule"><div class="rule-name" style="color:var(--accent)">${title}</div><div></div></div>` +
      rules.map(r => {
        const vals = r.keys
          .filter(k => params[k])
          .map(k => `${params[k].label} ${fmt(params[k].v)}`)
          .join(' · ');
        return `<div class="rule"><div class="rule-name">${r.name}</div>` +
          `<div><div class="rule-text">${r.text()}</div>` +
          (vals ? `<div class="rule-vals">${vals}</div>` : '') + '</div></div>';
      }).join('');
  }

  function fmt(v) {
    if (v === 0 || v === 1) return String(v);
    return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  }

  return { open };
}
