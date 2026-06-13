(function () {
  const skins = {
    classic: { key: 'classic', name: 'Classique', colors: ['#1565c0', '#0d47a1', '#42a5f5'] },
    arcade: { key: 'arcade', name: 'Arcade 84', colors: ['#07150f', '#15ff79', '#063d2a'] },
    neon: { key: 'neon', name: 'Neon Pulse', colors: ['#19002f', '#ff2bd6', '#00f7ff'] },
    sunset: { key: 'sunset', name: 'Solar Flare', colors: ['#4a1208', '#ff5a1f', '#ffd60a'] },
    ice: { key: 'ice', name: 'Cryo', colors: ['#092c4c', '#4dd9ff', '#e8fbff'] },
    obsidian: { key: 'obsidian', name: 'Obsidienne', colors: ['#09080d', '#292431', '#a855f7'] },
  };
  const keys = Object.keys(skins);

  function hashSeed(seed) {
    let hash = 2166136261;
    for (const char of String(seed || 'p4-board')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normalize(key) {
    return skins[key] ? key : 'classic';
  }

  function pick(seed) {
    return keys[hashSeed(seed) % keys.length];
  }

  function equipped() {
    try {
      return normalize(localStorage.getItem('p4_board_theme') || 'classic');
    } catch {
      return 'classic';
    }
  }

  function applyVariables(target, skin) {
    if (!target?.style) return;
    target.style.setProperty('--board-theme', skin.name);
    target.style.setProperty('--board-a', skin.colors[0]);
    target.style.setProperty('--board-b', skin.colors[1]);
    target.style.setProperty('--board-c', skin.colors[2]);
    target.style.setProperty('--board-a-soft', `color-mix(in srgb, ${skin.colors[0]} 32%, transparent)`);
    target.style.setProperty('--board-b-soft', `color-mix(in srgb, ${skin.colors[1]} 30%, transparent)`);
    target.style.setProperty('--board-c-soft', `color-mix(in srgb, ${skin.colors[2]} 18%, transparent)`);
  }

  function applyElement(element, key) {
    if (!element) return 'classic';
    const normalized = normalize(key);
    keys.forEach(entry => element.classList.remove(`board-skin-${entry}`));
    element.classList.add(`board-skin-${normalized}`);
    element.dataset.boardSkin = normalized;
    applyVariables(element, skins[normalized]);
    return normalized;
  }

  function applyRoot(key) {
    const normalized = normalize(key);
    document.documentElement.dataset.boardSkin = normalized;
    applyVariables(document.documentElement, skins[normalized]);
    return normalized;
  }

  window.P4BoardSkins = Object.freeze({
    skins,
    keys,
    pick,
    equipped,
    applyElement,
    applyRoot,
  });
})();
