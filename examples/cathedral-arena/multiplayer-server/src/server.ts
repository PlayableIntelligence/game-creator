import type * as Party from 'partykit/server';

/**
 * Cathedral Arena multiplayer server.
 *
 * Pattern follows skills/add-multiplayer/partykit-server.md but stripped
 * to two message types: `state` (position/yaw/HP/alive) and `attack` (cone
 * hit broadcast). Last-write-wins authority — clients send their truth,
 * server stamps + relays. Suitable for soft-PvP demos; not adversarial-
 * cheat-resistant.
 */

const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 2048;
const RATE_LIMIT_PER_SEC = 60;
const PROTOCOL_VERSION = 1;

interface PlayerState {
  x: number; y: number; z: number;
  yaw: number;
  hp: number;
  alive: boolean;
  ts: number;
}

interface Peer {
  playerId: string;
  joinedAt: number;
  state?: PlayerState;
}

type ClientMessage =
  | { type: 'state'; state: Partial<PlayerState> }
  | { type: 'attack'; attack: AttackEvent };

interface AttackEvent {
  origin: { x: number; y: number; z: number };
  facing: { x: number; z: number };
  reach: number;
  hits: string[];
  damage: number;
  ts?: number;
}

type ServerMessage =
  | { type: 'welcome'; playerId: string; peers: Peer[]; protocolVersion: number; joinedAt: number }
  | { type: 'player-joined'; playerId: string; state?: PlayerState }
  | { type: 'player-left'; playerId: string }
  | { type: 'state'; playerId: string; state: PlayerState }
  | { type: 'attack'; playerId: string; attack: AttackEvent }
  | { type: 'reject'; reason: string };

type Connection = Party.Connection<{ name?: string }>;

export default class CathedralArenaRoom implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };

  peers = new Map<string, Peer>();
  rates = new Map<string, { windowStart: number; count: number }>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Connection): void {
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
      peers: [...this.peers.values()].filter((p) => p.playerId !== playerId),
      protocolVersion: PROTOCOL_VERSION,
      joinedAt,
    };
    conn.send(JSON.stringify(welcome));

    const joined: ServerMessage = { type: 'player-joined', playerId };
    this.room.broadcast(JSON.stringify(joined), [playerId]);
  }

  onClose(conn: Connection): void {
    if (!this.peers.has(conn.id)) return;
    this.peers.delete(conn.id);
    this.rates.delete(conn.id);
    const left: ServerMessage = { type: 'player-left', playerId: conn.id };
    this.room.broadcast(JSON.stringify(left));
  }

  onMessage(rawMessage: string, sender: Connection): void {
    // UTF-8 byte length, not JS string `.length` — multibyte chars (emoji
    // in names, etc.) inflate byte count vs char count.
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      sender.send(JSON.stringify({ type: 'reject', reason: 'message-too-large' } satisfies ServerMessage));
      return;
    }

    if (!this.rateLimitOk(sender.id)) return;  // drop silently

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawMessage) as ClientMessage;
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
        // Stamp once, persist what we broadcast — late joiners (who pull
        // peer.state from the welcome) see the same `ts` as everyone else.
        const stampedState: PlayerState = {
          x: msg.state.x ?? 0,
          y: msg.state.y ?? 0,
          z: msg.state.z ?? 0,
          yaw: msg.state.yaw ?? 0,
          hp: clamp(msg.state.hp ?? 100, 0, 100),
          alive: msg.state.alive ?? true,
          ts: Date.now(),
        };
        const peer = this.peers.get(sender.id);
        if (peer) peer.state = stampedState;
        const out: ServerMessage = { type: 'state', playerId: sender.id, state: stampedState };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      case 'attack': {
        if (!isValidAttack(msg.attack)) {
          sender.send(JSON.stringify({ type: 'reject', reason: 'bad-attack' } satisfies ServerMessage));
          return;
        }
        const stamped: AttackEvent = { ...msg.attack, ts: Date.now() };
        const out: ServerMessage = { type: 'attack', playerId: sender.id, attack: stamped };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
    }
  }

  rateLimitOk(id: string): boolean {
    const now = Date.now();
    const cur = this.rates.get(id);
    if (!cur || now - cur.windowStart >= 1000) {
      this.rates.set(id, { windowStart: now, count: 1 });
      return true;
    }
    cur.count += 1;
    return cur.count <= RATE_LIMIT_PER_SEC;
  }
}

// ---- helpers --------------------------------------------------------------

function isValidState(s: unknown): s is Partial<PlayerState> {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Partial<PlayerState>;
  for (const k of ['x', 'y', 'z', 'yaw'] as const) {
    if (k in o && !Number.isFinite(o[k])) return false;
  }
  if ('hp' in o && !Number.isFinite(o.hp)) return false;
  if ('alive' in o && typeof o.alive !== 'boolean') return false;
  return true;
}

function isValidAttack(a: unknown): a is AttackEvent {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as AttackEvent;
  if (!o.origin || !o.facing) return false;
  if (!Number.isFinite(o.origin.x) || !Number.isFinite(o.origin.y) || !Number.isFinite(o.origin.z)) return false;
  if (!Number.isFinite(o.facing.x) || !Number.isFinite(o.facing.z)) return false;
  if (!Number.isFinite(o.reach) || !Number.isFinite(o.damage)) return false;
  if (!Array.isArray(o.hits)) return false;
  if (o.hits.length > MAX_PLAYERS) return false;
  for (const id of o.hits) if (typeof id !== 'string') return false;
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
