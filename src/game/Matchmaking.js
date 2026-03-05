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
    return { p1: this.queue.shift(), p2: this.queue.shift() };
  }

  size()     { return this.queue.length; }
  position(socketId) { return this.queue.findIndex(p => p.socketId === socketId) + 1; }
}

module.exports = { Matchmaking };
