(function () {
  const STORAGE_KEY = 'p4_theme';
  const root = document.documentElement;
  const saved = localStorage.getItem(STORAGE_KEY);
  const initial = saved === 'light' ? 'light' : 'dark';

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    const btn = document.getElementById('p4-theme-toggle');
    if (btn) {
      btn.textContent = next === 'light' ? '☀️ Clair' : '🌙 Sombre';
      btn.setAttribute('aria-label', next === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair');
    }
  }

  function injectStyles() {
    if (document.getElementById('p4-theme-style')) return;
    const style = document.createElement('style');
    style.id = 'p4-theme-style';
    style.textContent = `
      :root[data-theme="light"] {
        --bg: #f4f0ff;
        --surface: rgba(255,255,255,.86);
        --surface2: rgba(244,246,255,.92);
        --card: rgba(255,255,255,.88);
        --border: rgba(38,31,62,.14);
        --text: #171423;
        --muted: rgba(23,20,35,.58);
      }
      :root[data-theme="light"] body {
        color: var(--text) !important;
        background:
          radial-gradient(circle at 16% 12%, rgba(255,45,85,.14), transparent 30%),
          radial-gradient(circle at 82% 14%, rgba(133,235,255,.20), transparent 28%),
          linear-gradient(rgba(38,31,62,.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(38,31,62,.08) 1px, transparent 1px),
          var(--bg) !important;
        background-size: auto, auto, 48px 48px, 48px 48px !important;
      }
      :root[data-theme="light"] .panel,
      :root[data-theme="light"] .card,
      :root[data-theme="light"] .profile-card,
      :root[data-theme="light"] .game-card,
      :root[data-theme="light"] .spec-card,
      :root[data-theme="light"] .analysis-card,
      :root[data-theme="light"] .elo-history-card,
      :root[data-theme="light"] .section-card,
      :root[data-theme="light"] .shop-card,
      :root[data-theme="light"] .admin-card {
        background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(246,244,255,.80)) !important;
        border-color: rgba(38,31,62,.14) !important;
        box-shadow: 0 22px 70px rgba(52,43,88,.14) !important;
      }
      :root[data-theme="light"] input,
      :root[data-theme="light"] select,
      :root[data-theme="light"] textarea {
        background: rgba(255,255,255,.74) !important;
        color: var(--text) !important;
        border-color: rgba(38,31,62,.16) !important;
      }
      #p4-theme-toggle {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 99998;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 999px;
        background: rgba(12,12,28,.72);
        color: #f1f1f7;
        backdrop-filter: blur(12px);
        padding: 10px 13px;
        font: 900 12px "Barlow Condensed", sans-serif;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 12px 30px rgba(0,0,0,.22);
      }
      :root[data-theme="light"] #p4-theme-toggle {
        background: rgba(255,255,255,.86);
        color: #171423;
        border-color: rgba(38,31,62,.14);
      }
    `;
    document.head.appendChild(style);
  }

  function mountButton() {
    if (document.getElementById('p4-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'p4-theme-toggle';
    btn.type = 'button';
    btn.addEventListener('click', () => applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
    document.body.appendChild(btn);
    applyTheme(root.dataset.theme || initial);
  }

  applyTheme(initial);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyles();
      mountButton();
    });
  } else {
    injectStyles();
    mountButton();
  }
})();
