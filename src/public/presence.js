/**
 * presence.js — Socket de présence léger
 * À inclure sur toutes les pages (sauf game.html qui gère son propre socket)
 * Ouvre un socket minimal, envoie identify, garde la connexion vivante.
 */
(function() {
  const token    = localStorage.getItem('token');
  const playerRaw = localStorage.getItem('player') || sessionStorage.getItem('player');
  if (!token || !playerRaw) return; // pas connecté

  let playerId;
  try { playerId = JSON.parse(playerRaw).id; } catch(e) { return; }
  if (!playerId) return;

  // Charger socket.io dynamiquement si pas encore présent
  function initSocket() {
    const socket = window.io('/', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      socket.emit('identify', { playerId, token });
    });

    // Heartbeat toutes les 25s pour maintenir la connexion
    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit('presence_ping');
    }, 25000);

    socket.on('disconnect', () => clearInterval(heartbeat));

    // Exposer pour debug éventuel
    window._presenceSocket = socket;
  }

  if (window.io) {
    initSocket();
  } else {
    // socket.io.js pas encore chargé — attendre
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = initSocket;
    document.head.appendChild(script);
  }
})();
