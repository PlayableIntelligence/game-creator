export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { type: 'state'; state: PlayerState }
  | { type: 'move'; payload: unknown }
  | { type: 'name'; name: string }
  | { type: 'custom'; subtype: string; payload: unknown };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; peers: Peer[]; protocolVersion: number; joinedAt: number }
  | { type: 'player-joined'; playerId: string; name?: string; joinedAt?: number }
  | { type: 'player-left'; playerId: string }
  | { type: 'state'; playerId: string; state: PlayerState }
  | { type: 'turn'; playerId: string; resultingState: unknown; turn: number }
  | { type: 'custom'; subtype: string; fromPlayerId: string; payload: unknown }
  | { type: 'reject'; reason: string };

export type PlayerState = {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  rotation?: number;
  score: number;
  alive: boolean;
  ts: number;
};

export type Peer = {
  playerId: string;
  name?: string;
  state?: PlayerState;
  joinedAt?: number;
};
