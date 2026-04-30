import type * as Party from 'partykit/server';
import type { ClientMessage, ServerMessage, Peer, PlayerState } from './types';
import { PROTOCOL_VERSION } from './types';

const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 4096;
const RATE_LIMIT_PER_SEC = 30;

type Connection = Party.Connection<{ name?: string; lastState?: PlayerState }>;

export default class Room implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };

  peers = new Map<string, Peer>();

  rates = new Map<string, { windowStart: number; count: number }>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Connection, _ctx: Party.ConnectionContext): void | Promise<void> {
    if (this.peers.size >= MAX_PLAYERS) {
      conn.send(JSON.stringify({ type: 'reject', reason: 'room-full' } satisfies ServerMessage));
      conn.close();
      return;
    }

    const playerId = conn.id;
    const joinedAt = Date.now();
    this.peers.set(playerId, { playerId, joinedAt });

    const welcome: ServerMessage = {
      type: 'welcome',
      playerId,
      peers: [...this.peers.values()].filter(p => p.playerId !== playerId),
      protocolVersion: PROTOCOL_VERSION,
      joinedAt,
    };
    conn.send(JSON.stringify(welcome));

    const joined: ServerMessage = { type: 'player-joined', playerId, joinedAt };
    this.room.broadcast(JSON.stringify(joined), [playerId]);
  }

  onMessage(rawMessage: string, sender: Connection): void | Promise<void> {
    // Compare UTF-8 *byte* length, not JS string `.length` (which counts
    // UTF-16 code units). Multibyte characters like emoji or accented
    // letters can otherwise slip through a string-length check.
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      sender.send(JSON.stringify({ type: 'reject', reason: 'message-too-large' } satisfies ServerMessage));
      return;
    }

    if (!this.rateLimitOk(sender.id)) {
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      sender.send(JSON.stringify({ type: 'reject', reason: 'bad-json' } satisfies ServerMessage));
      return;
    }

    switch (msg.type) {
      case 'state': {
        if (!isValidState(msg.state)) {
          sender.send(JSON.stringify({ type: 'reject', reason: 'bad-state' } satisfies ServerMessage));
          return;
        }
        // Stamp once, persist what we broadcast — otherwise late joiners
        // get the client-supplied `ts` from `peers` while everyone else
        // sees the server-stamped version.
        const stampedState = { ...msg.state, ts: Date.now() };
        const peer = this.peers.get(sender.id);
        if (peer) peer.state = stampedState;

        const out: ServerMessage = {
          type: 'state',
          playerId: sender.id,
          state: stampedState,
        };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      case 'name': {
        const name = String(msg.name ?? '').slice(0, 32);
        const peer = this.peers.get(sender.id);
        if (peer) peer.name = name;
        const out: ServerMessage = { type: 'player-joined', playerId: sender.id, name };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      case 'custom': {
        const subtype = typeof msg.subtype === 'string' ? msg.subtype.slice(0, 64) : '';
        if (!subtype) {
          sender.send(JSON.stringify({ type: 'reject', reason: 'bad-custom' } satisfies ServerMessage));
          return;
        }
        const out: ServerMessage = {
          type: 'custom',
          subtype,
          fromPlayerId: sender.id,
          payload: msg.payload,
        };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      default:
        sender.send(JSON.stringify({ type: 'reject', reason: 'unknown-type' } satisfies ServerMessage));
    }
  }

  onClose(conn: Connection): void | Promise<void> {
    if (!this.peers.has(conn.id)) return;
    this.peers.delete(conn.id);
    this.rates.delete(conn.id);
    const left: ServerMessage = { type: 'player-left', playerId: conn.id };
    this.room.broadcast(JSON.stringify(left));
  }

  onError(conn: Connection, err: Error): void | Promise<void> {
    console.error('connection error', conn.id, err);
  }

  private rateLimitOk(playerId: string): boolean {
    const now = Date.now();
    const window = this.rates.get(playerId);
    if (!window || now - window.windowStart > 1000) {
      this.rates.set(playerId, { windowStart: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= RATE_LIMIT_PER_SEC;
  }
}

function isValidState(s: unknown): s is PlayerState {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.x === 'number' && Number.isFinite(o.x) &&
    typeof o.y === 'number' && Number.isFinite(o.y) &&
    typeof o.score === 'number' && Number.isFinite(o.score) &&
    typeof o.alive === 'boolean'
  );
}

Room satisfies Party.Worker;
