(function () {
  const STORAGE_KEY = 'p4_theme';
  const root = document.documentElement;

  function getSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch (error) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {}

    const btn = document.getElementById('p4-theme-toggle');
    if (btn) {
      btn.textContent = next === 'light' ? 'Clair' : 'Sombre';
      btn.setAttribute('aria-label', next === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair');
    }
  }

  function mountButton() {
    if (document.getElementById('p4-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'p4-theme-toggle';
    btn.type = 'button';
    btn.addEventListener('click', () => applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
    document.body.appendChild(btn);
    applyTheme(root.dataset.theme || getSavedTheme());
  }

  applyTheme(root.dataset.theme || getSavedTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton);
  } else {
    mountButton();
  }
})();
