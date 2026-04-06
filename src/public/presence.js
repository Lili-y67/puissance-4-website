/**
 * presence.js - presence socket leger + alerte systeme globale
 * Inclus sur toutes les pages (sauf game.html)
 */
(function () {
  const token = localStorage.getItem('token');
  const playerRaw = localStorage.getItem('player') || sessionStorage.getItem('player');

  function ensureSystemBanner() {
    let el = document.getElementById('global-system-status');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'global-system-status';
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:99999',
      'max-width:min(360px,calc(100vw - 24px))',
      'padding:14px 16px',
      'border-radius:16px',
      'background:linear-gradient(180deg,rgba(42,20,8,.96),rgba(26,11,6,.96))',
      'border:1px solid rgba(255,159,10,.28)',
      'box-shadow:0 16px 40px rgba(0,0,0,.42),0 0 20px rgba(255,159,10,.12)',
      'color:#fff4de',
      'font-family:Barlow,Segoe UI,Arial,sans-serif'
    ].join(';');
    document.body.appendChild(el);
    if (!document.getElementById('global-system-status-style')) {
      const style = document.createElement('style');
      style.id = 'global-system-status-style';
      style.textContent = '@keyframes codexSystemPulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(255,159,10,.45)}50%{opacity:.7;box-shadow:0 0 0 8px rgba(255,159,10,0)}}';
      document.head.appendChild(style);
    }
    return el;
  }

  async function refreshSystemStatus() {
    try {
      const res = await fetch('/api/system-status', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const el = ensureSystemBanner();
      if (!data.restarting) {
        el.style.display = 'none';
        return;
      }
      const message = data.message || 'Attention : redemarrage serveur en cours. Les parties et stats en cours peuvent etre interrompues.';
      el.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="width:12px;height:12px;border-radius:50%;background:#ff9f0a;box-shadow:0 0 0 0 rgba(255,159,10,.45);animation:codexSystemPulse 1.2s ease-in-out infinite;margin-top:4px;flex-shrink:0;"></div>
          <div>
            <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffb84d;">Attention</div>
            <div style="font-size:13px;line-height:1.45;color:#fff4de;margin-top:4px;">${message}</div>
          </div>
        </div>`;
      el.style.display = 'block';
    } catch (e) {}
  }

  refreshSystemStatus();
  setInterval(refreshSystemStatus, 10000);

  if (!token || !playerRaw) return;

  let playerId;
  try {
    playerId = JSON.parse(playerRaw).id;
  } catch (e) {
    return;
  }
  if (!playerId) return;

  function initSocket() {
    const socket = window.io('/', {
      transports: ['polling'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 20,
    });

    socket.on('connect', () => {
      socket.emit('identify', { playerId, token });
    });

    socket.on('identified', () => {
      if (typeof window._reloadStatus === 'function') {
        setTimeout(window._reloadStatus, 100);
      }
    });

    socket.on('system_status_update', refreshSystemStatus);

    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit('presence_ping');
    }, 25000);

    socket.on('disconnect', () => clearInterval(heartbeat));
    window._presenceSocket = socket;
  }

  if (window.io) {
    initSocket();
  } else {
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = initSocket;
    document.head.appendChild(s);
  }
})();
