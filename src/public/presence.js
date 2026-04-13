/**
 * presence.js - presence socket leger + alerte systeme globale
 * Inclus sur toutes les pages (sauf game.html)
 */
(function () {
  const token = localStorage.getItem('token');
  const playerRaw = localStorage.getItem('player') || sessionStorage.getItem('player');
  const visitorStorageKey = 'p4_visitor_id';

  function getVisitorId() {
    try {
      let value = localStorage.getItem(visitorStorageKey);
      if (value) return value;
      value = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(visitorStorageKey, value);
      return value;
    } catch (e) {
      return `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

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

  function ensureDuelToast() {
    let el = document.getElementById('global-duel-toast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'global-duel-toast';
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'right:16px',
      'bottom:96px',
      'z-index:99998',
      'width:min(360px,calc(100vw - 24px))',
      'padding:16px',
      'border-radius:18px',
      'background:linear-gradient(180deg,rgba(23,16,42,.96),rgba(10,8,22,.96))',
      'border:1px solid rgba(255,45,85,.22)',
      'box-shadow:0 18px 44px rgba(0,0,0,.42),0 0 24px rgba(255,45,85,.14)',
      'color:#f7f3ff',
      'font-family:Barlow,Segoe UI,Arial,sans-serif'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function renderDuelToast(content) {
    const el = ensureDuelToast();
    if (!content) {
      el.style.display = 'none';
      return;
    }
    el.innerHTML = content;
    el.style.display = 'block';
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

  let playerId;
  try {
    playerId = playerRaw ? JSON.parse(playerRaw).id : null;
  } catch (e) {
    playerId = null;
  }
  const visitorId = getVisitorId();

  function initSocket() {
    const socket = window.io('/', {
      transports: ['polling'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 20,
    });

    socket.on('connect', () => {
      if (token && playerId) {
        socket.emit('identify', { playerId, token });
      } else {
        socket.emit('visitor_presence', { visitorId });
      }
    });

    socket.on('identified', () => {
      if (typeof window._reloadStatus === 'function') {
        setTimeout(window._reloadStatus, 100);
      }
    });

    socket.on('match_found', (data) => {
      try {
        sessionStorage.setItem('match', JSON.stringify(data));
        sessionStorage.setItem('player', localStorage.getItem('player') || sessionStorage.getItem('player') || '');
      } catch (e) {}
      window.location.href = '/game';
    });

    socket.on('system_status_update', refreshSystemStatus);

    socket.on('duel_invite', ({ id, sender } = {}) => {
      if (!id || !sender) return;
      const avatar = sender.avatar
        ? `<img src="${sender.avatar}" alt="" style="width:52px;height:52px;border-radius:16px;object-fit:cover;border:2px solid ${sender.color || '#ff2d55'};background:rgba(255,255,255,.04)">`
        : `<div style="width:52px;height:52px;border-radius:16px;display:grid;place-items:center;font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:26px;font-weight:800;color:${sender.color || '#ff2d55'};border:2px solid ${sender.color || '#ff2d55'};background:rgba(255,255,255,.04)">${String(sender.pseudo || '?').charAt(0).toUpperCase()}</div>`;
      renderDuelToast(`
        <div style="display:flex;align-items:flex-start;gap:12px;">
          ${avatar}
          <div style="min-width:0;flex:1;">
            <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:19px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ff7b95;">Duel reçu</div>
            <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:4px;"><strong>${sender.pseudo}</strong> te défie maintenant. ELO actuel: <strong>${Number(sender.elo || 0)}</strong>.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button type="button" onclick="window.acceptDuelInvite('${id}')" style="padding:10px 14px;border:none;border-radius:12px;background:#ff2d55;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;cursor:pointer;">Accepter</button>
              <button type="button" onclick="window.declineDuelInvite('${id}')" style="padding:10px 14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.04);color:#eeeef5;font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;cursor:pointer;">Refuser</button>
            </div>
          </div>
        </div>
      `);
    });

    socket.on('duel_invite_sent', ({ target } = {}) => {
      if (!target) return;
      renderDuelToast(`
        <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#85EBFF;">Duel envoyé</div>
        <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:6px;">La notification a bien été envoyée à <strong>${target.pseudo}</strong>. On attend sa réponse.</div>
      `);
      setTimeout(() => renderDuelToast(null), 4500);
    });

    socket.on('duel_invite_accepted', ({ target } = {}) => {
      renderDuelToast(`
        <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#4EF08A;">Duel accepté</div>
        <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:6px;">${target?.pseudo ? `<strong>${target.pseudo}</strong> ` : ''}rejoint l’arène. Préparation de la partie...</div>
      `);
    });

    socket.on('duel_invite_declined', () => {
      renderDuelToast(`
        <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffd84d;">Duel terminé</div>
        <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:6px;">Le duel a été refusé ou annulé.</div>
      `);
      setTimeout(() => renderDuelToast(null), 4200);
    });

    socket.on('duel_invite_expired', () => {
      renderDuelToast(`
        <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffd84d;">Duel expiré</div>
        <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:6px;">Le duel n’est plus disponible.</div>
      `);
      setTimeout(() => renderDuelToast(null), 4200);
    });

    socket.on('duel_invite_error', ({ message } = {}) => {
      renderDuelToast(`
        <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ff7b95;">Duel impossible</div>
        <div style="font-size:13px;line-height:1.5;color:rgba(247,243,255,.82);margin-top:6px;">${message || 'Le duel ne peut pas démarrer.'}</div>
      `);
      setTimeout(() => renderDuelToast(null), 4500);
    });

    const heartbeat = setInterval(() => {
      if (!socket.connected) return;
      if (token && playerId) {
        socket.emit('presence_ping');
      } else {
        socket.emit('visitor_presence', { visitorId });
      }
    }, 25000);

    socket.on('disconnect', () => clearInterval(heartbeat));
    window._presenceSocket = socket;
    window.acceptDuelInvite = function (challengeId) {
      if (window._presenceSocket?.connected) window._presenceSocket.emit('duel_accept', { challengeId });
    };
    window.declineDuelInvite = function (challengeId) {
      if (window._presenceSocket?.connected) window._presenceSocket.emit('duel_decline', { challengeId });
      renderDuelToast(null);
    };
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
