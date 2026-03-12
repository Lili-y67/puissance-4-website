/**
 * presence.js — Socket de présence léger
 * Inclus sur toutes les pages (sauf game.html)
 */
(function() {
  const token     = localStorage.getItem('token');
  const playerRaw = localStorage.getItem('player') || sessionStorage.getItem('player');
  if (!token || !playerRaw) return;

  let playerId;
  try { playerId = JSON.parse(playerRaw).id; } catch(e) { return; }
  if (!playerId) return;

  function initSocket() {
    const socket = window.io('/', {
      transports: ['polling'],   // Railway ne supporte pas websocket natif
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 20,
    });

    socket.on('connect', () => {
      socket.emit('identify', { playerId, token });
    });

    socket.on('identified', () => {
      // Serveur a bien enregistré le socket → re-charger le statut affiché
      if (typeof window._reloadStatus === 'function') {
        setTimeout(window._reloadStatus, 100);
      }
    });

    // Heartbeat toutes les 25s
    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit('presence_ping');
    }, 25000);

    socket.on('disconnect', () => clearInterval(heartbeat));
    window._presenceSocket = socket;
  }

  // S'assurer que socket.io est chargé avant d'init
  if (window.io) {
    initSocket();
  } else {
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = initSocket;
    document.head.appendChild(s);
  }
})();
