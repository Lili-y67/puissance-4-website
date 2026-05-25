/**
 * presence.js - presence socket leger + alerte systeme globale
 * Inclus sur toutes les pages publiques.
 */
(function () {
  const visitorStorageKey = 'p4_visitor_id';

  function getStoredAuth() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('duel_guest_token') || '';
    const playerRaw = getStoredPlayerRaw();
    let player = null;
    try {
      player = playerRaw ? JSON.parse(playerRaw) : null;
    } catch (e) {
      player = null;
    }
    return {
      token,
      player,
      playerId: Number(player?.id || 0) || null,
    };
  }

  function getStoredPlayerRaw() {
    return localStorage.getItem('player')
      || sessionStorage.getItem('duel_guest_player')
      || sessionStorage.getItem('player')
      || '';
  }

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
      'left:50%',
      'top:16px',
      'transform:translateX(-50%)',
      'z-index:99999',
      'width:min(760px,calc(100vw - 24px))',
      'padding:14px 16px',
      'border-radius:18px',
      'backdrop-filter:blur(18px)',
      'color:#fff',
      'font-family:Barlow,Segoe UI,Arial,sans-serif'
    ].join(';');
    document.body.appendChild(el);
    if (!document.getElementById('global-system-status-style')) {
      const style = document.createElement('style');
      style.id = 'global-system-status-style';
      style.textContent = `
        @keyframes codexSystemPulse{0%,100%{box-shadow:0 18px 48px rgba(0,0,0,.42),0 0 0 0 var(--p4-alert-halo)}50%{box-shadow:0 18px 48px rgba(0,0,0,.42),0 0 0 10px rgba(255,255,255,0)}}
        @keyframes codexSystemGlow{0%,100%{filter:saturate(1);box-shadow:0 18px 48px rgba(0,0,0,.42),0 0 24px var(--p4-alert-halo)}50%{filter:saturate(1.25);box-shadow:0 18px 58px rgba(0,0,0,.52),0 0 46px var(--p4-alert-halo)}}
        @keyframes codexSystemShake{0%,100%{transform:translateX(-50%)}20%{transform:translateX(calc(-50% - 5px))}40%{transform:translateX(calc(-50% + 5px))}60%{transform:translateX(calc(-50% - 3px))}80%{transform:translateX(calc(-50% + 3px))}}
        @keyframes codexSystemSlide{0%{transform:translate(-50%,-22px);opacity:0}100%{transform:translate(-50%,0);opacity:1}}
        @media (max-width:640px){#global-system-status{top:10px!important;border-radius:14px!important;padding:12px!important}}
      `;
      document.head.appendChild(style);
    }
    return el;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function safeAlertColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ff9f0a';
  }

  function hexToRgba(hex, alpha) {
    const color = safeAlertColor(hex).slice(1);
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function safeAlertAnimation(value) {
    const animation = String(value || '').trim().toLowerCase();
    return ['pulse', 'glow', 'shake', 'slide', 'none'].includes(animation) ? animation : 'pulse';
  }

  function systemAlertAnimationCss(animation) {
    if (animation === 'none') return 'none';
    const map = {
      pulse: 'codexSystemPulse 1.5s ease-in-out infinite',
      glow: 'codexSystemGlow 1.8s ease-in-out infinite',
      shake: 'codexSystemShake .46s ease-in-out infinite',
      slide: 'codexSystemSlide .38s cubic-bezier(.2,.8,.2,1) both',
    };
    return map[animation] || map.pulse;
  }

  function renderSystemStatus(data = {}) {
    const el = ensureSystemBanner();
    if (!data.restarting) {
      el.style.display = 'none';
      return;
    }
    const color = safeAlertColor(data.color);
    const halo = hexToRgba(color, .34);
    const animation = safeAlertAnimation(data.animation);
    const emoji = escapeHtml(data.emoji || '⚠️');
    const message = escapeHtml(data.message || 'Attention : redemarrage serveur en cours. Les parties et stats en cours peuvent etre interrompues.');
    el.style.setProperty('--p4-alert-halo', halo);
    el.style.background = `linear-gradient(135deg,${hexToRgba(color, .24)},rgba(12,10,24,.96) 58%,${hexToRgba(color, .14)})`;
    el.style.border = `1px solid ${hexToRgba(color, .38)}`;
    el.style.boxShadow = `0 18px 48px rgba(0,0,0,.42),0 0 30px ${hexToRgba(color, .16)}`;
    el.style.animation = systemAlertAnimationCss(animation);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:${hexToRgba(color, .18)};border:1px solid ${hexToRgba(color, .42)};box-shadow:inset 0 0 18px ${hexToRgba(color, .12)};font-size:22px;flex-shrink:0;">${emoji}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-family:Barlow Condensed,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:${color};">Alerte serveur</div>
          <div style="font-size:13px;line-height:1.45;color:rgba(255,255,255,.88);margin-top:2px;word-break:break-word;">${message}</div>
        </div>
      </div>`;
    el.style.display = 'block';
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
      renderSystemStatus(data);
    } catch (e) {}
  }

  refreshSystemStatus();
  setInterval(refreshSystemStatus, 30000);

  const visitorId = getVisitorId();

  function initSocket() {
    const socket = window._p4SharedSocket || window.io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 20,
    });

    function identifyFromStorage() {
      const auth = getStoredAuth();
      if (auth.token && auth.playerId) {
        socket.emit('identify', { playerId: auth.playerId, token: auth.token });
      } else {
        socket.emit('visitor_presence', { visitorId });
      }
    }

    socket.on('connect', () => {
      identifyFromStorage();
    });
    if (socket.connected) identifyFromStorage();

    socket.on('presence_counts', (counts = {}) => {
      try {
        window.dispatchEvent(new CustomEvent('p4:presence-counts', { detail: counts }));
      } catch (e) {}
    });

    socket.on('identified', () => {
      if (typeof window._reloadStatus === 'function') {
        setTimeout(window._reloadStatus, 100);
      }
    });

    socket.on('match_found', (data) => {
      try {
        sessionStorage.setItem('match', JSON.stringify(data));
        sessionStorage.setItem('player', getStoredPlayerRaw());
      } catch (e) {}
      window.location.href = '/game';
    });

    socket.on('system_status_update', renderSystemStatus);

    socket.on('profile_changed', ({ reason } = {}) => {
      const message = `Votre profil a change.${reason ? `\nMotif : ${reason}` : ''}\nActualise la page pour appliquer les changements.`;
      try {
        window.dispatchEvent(new CustomEvent('p4:profile-changed', { detail: { reason } }));
      } catch (e) {}
      window.alert(message);
    });

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
      const auth = getStoredAuth();
      if (auth.token && auth.playerId) {
        socket.emit('presence_ping');
      } else {
        socket.emit('visitor_presence', { visitorId });
      }
    }, 30000);

    socket.on('disconnect', () => clearInterval(heartbeat));
    window._presenceSocket = socket;
    window.refreshPresenceIdentity = function () {
      if (!window._presenceSocket?.connected) return;
      identifyFromStorage();
    };
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
