/**
 * Matchmaking.js — FIFO queue
 */
class Matchmaking {
  constructor() { this.queue = []; }

  join(socketId, player) {
    if (this.queue.find(p => p.socketId === socketId)) return false;
    this.queue.push({ socketId, ...player, joinedAt: Date.now() });
    return true;
  }

  leave(socketId) {
    const i = this.queue.findIndex(p => p.socketId === socketId);
    if (i === -1) return false;
    this.queue.splice(i, 1);
    return true;
  }

  isInQueue(socketId) { return this.queue.some(p => p.socketId === socketId); }

  tryMatch() {
    if (this.queue.length < 2) return null;
    // Chercher deux joueurs avec des IDs différents (anti self-match)
    for (let i = 0; i < this.queue.length; i++) {
      for (let j = i + 1; j < this.queue.length; j++) {
        if (this.queue[i].id !== this.queue[j].id && String(this.queue[i].variant || 'classic') === String(this.queue[j].variant || 'classic')) {
          const p1 = this.queue.splice(j, 1)[0];
          const p2 = this.queue.splice(i, 1)[0];
          return { p1: p2, p2: p1 };
        }
      }
    }
    return null; // Que des doublons en queue
  }

  size()     { return this.queue.length; }
  position(socketId) {
    const player = this.queue.find(p => p.socketId === socketId);
    if (!player) return 0;
    const variant = String(player.variant || 'classic');
    return this.queue.filter(p => String(p.variant || 'classic') === variant).findIndex(p => p.socketId === socketId) + 1;
  }
}

module.exports = { Matchmaking };
