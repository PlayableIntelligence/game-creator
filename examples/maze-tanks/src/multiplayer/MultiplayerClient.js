import PartySocket from 'partysocket';

export class MultiplayerClient {
  constructor() {
    this.socket = null;
    this.handlers = {
      message: () => {},
      open: () => {},
      close: () => {},
      error: () => {},
    };
  }

  connect({ host, room }) {
    if (this.socket) this.disconnect();
    try {
      this.socket = new PartySocket({ host, room });
      this.socket.addEventListener('open', () => this.handlers.open());
      this.socket.addEventListener('close', (e) => this.handlers.close(e));
      this.socket.addEventListener('error', (e) => this.handlers.error(e));
      this.socket.addEventListener('message', (e) => {
        let parsed = null;
        try { parsed = JSON.parse(e.data); } catch { return; }
        this.handlers.message(parsed);
      });
    } catch (err) {
      console.warn('[MultiplayerClient] connect failed', err);
      this.handlers.error(err);
    }
  }

  send(message) {
    if (!this.isConnected()) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.warn('[MultiplayerClient] send failed', err);
      return false;
    }
  }

  onMessage(cb) { this.handlers.message = cb; }
  onOpen(cb) { this.handlers.open = cb; }
  onClose(cb) { this.handlers.close = cb; }
  onError(cb) { this.handlers.error = cb; }

  isConnected() {
    return this.socket?.readyState === 1;
  }

  disconnect() {
    if (!this.socket) return;
    try { this.socket.close(); } catch { /* ignore */ }
    this.socket = null;
  }
}
