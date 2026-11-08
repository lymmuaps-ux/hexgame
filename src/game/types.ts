export const RESOURCES = ['timber', 'clay', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type TileType = Resource | 'desert';
export type ResMap = Record<Resource, number>;

export const RES_INFO: Record<Resource, { label: string; icon: string; color: string }> = {
  timber: { label: 'Timber', icon: '🌲', color: '#2f7d32' },
  clay: { label: 'Clay', icon: '🧱', color: '#c0602a' },
  wool: { label: 'Wool', icon: '🐑', color: '#9ccc65' },
  grain: { label: 'Grain', icon: '🌾', color: '#f2c335' },
  ore: { label: 'Ore', icon: '⛰️', color: '#8a8f99' },
};

export type DevCard = 'guard' | 'roadworks' | 'harvest' | 'embargo' | 'monument';

export const DEV_INFO: Record<DevCard, { label: string; icon: string; text: string }> = {
  guard: { label: 'Knight', icon: '🛡️', text: 'Move the Raider and steal 1 card. Counts toward Largest Army.' },
  roadworks: { label: 'Roadworks', icon: '🛤️', text: 'Build 2 roads for free.' },
  harvest: { label: 'Harvest', icon: '🧺', text: 'Take any 2 resources from the bank.' },
  embargo: { label: 'Embargo', icon: '⚖️', text: 'Name a resource. Every opponent gives you all of theirs.' },
  monument: { label: 'Monument', icon: '🏛️', text: '+1 victory point (kept hidden).' },
};

export const COSTS = {
  road: { timber: 1, clay: 1 },
  settlement: { timber: 1, clay: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
} satisfies Record<string, Partial<ResMap>>;

export type PortType = Resource | 'any';

export interface Hex {
  id: number;
  q: number;
  r: number;
  type: TileType;
  number: number | null;
}

export interface Port {
  edge: number;
  type: PortType;
}

export interface Player {
  name: string;
  color: string;
  hand: ResMap;
  dev: DevCard[];
  /** cards bought this turn (cannot be played yet) */
  newDev: DevCard[];
  guards: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  connected: boolean;
}

export interface Building {
  owner: number;
  kind: 'settlement' | 'city';
}

export type Stage =
  | 'roll'
  | 'discard'
  | 'moveRaider'
  | 'steal'
  | 'actions'
  | 'roadworks';

export interface TradeOffer {
  id: number;
  from: number;
  give: Partial<ResMap>;
  get: Partial<ResMap>;
  declined: number[];
  /** counter-offers: `give` is what the countering player gives, `get` what they want */
  counters?: { p: number; give: Partial<ResMap>; get: Partial<ResMap> }[];
}

export interface ProductionItem {
  p: number;
  hex: number;
  r: Resource;
  n: number;
}

/** Visual events produced by the latest action, so every screen can animate them. */
export type FxEvent =
  | { t: 'steal'; from: number; to: number }
  | { t: 'award'; award: 'road' | 'guard'; from: number | null; to: number | null }
  | { t: 'trade'; a: number; b: number; give: Partial<ResMap>; get: Partial<ResMap> }
  | { t: 'bank'; p: number; give: Resource; n: number; get: Resource }
  | { t: 'discard'; p: number; n: number }
  | { t: 'buyDev'; p: number }
  | { t: 'playDev'; p: number; card: DevCard };

export interface GameState {
  phase: 'setup' | 'main' | 'ended';
  players: Player[];
  current: number;
  setupOrder: number[];
  setupIndex: number;
  setupNeed: 'settlement' | 'road';
  lastSetupVertex: number | null;
  stage: Stage;
  /** where to go once the raider is resolved */
  afterRaider: 'roll' | 'actions';
  pendingDiscards: Record<number, number>;
  stealFrom: number[];
  roadworksLeft: number;
  dice: [number, number] | null;
  /** increments on every roll so viewers can animate it */
  rollId?: number;
  /** who made the latest roll */
  rolledBy?: number;
  /** the latest batch of resources handed out (by a roll or a setup settlement), for animation */
  production?: { id: number; items: ProductionItem[] };
  fx?: { id: number; list: FxEvent[] };
  /** in-game chat (added by the host outside the rules) */
  chat?: { id: number; p: number; text: string; name?: string }[];
  /** names of people currently watching */
  spectators?: string[];
  hexes: Hex[];
  ports: Port[];
  raider: number;
  buildings: Record<number, Building>;
  roads: Record<number, number>;
  devDeck: DevCard[];
  devPlayedThisTurn: boolean;
  longestRoad: { owner: number | null; length: number };
  strongestGuard: { owner: number | null; size: number };
  trade: TradeOffer | null;
  tradeSeq: number;
  bank: ResMap;
  log: string[];
  winner: number | null;
  turnNumber: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'discard'; cards: Partial<ResMap> }
  | { type: 'moveRaider'; hex: number }
  | { type: 'steal'; target: number }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'buyDev' }
  | { type: 'playDev'; card: DevCard; res?: Resource[] }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: Partial<ResMap>; get: Partial<ResMap> }
  | { type: 'acceptTrade'; id: number }
  | { type: 'declineTrade'; id: number }
  | { type: 'counterTrade'; id: number; give: Partial<ResMap>; get: Partial<ResMap> }
  | { type: 'acceptCounter'; id: number; p: number }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export const emptyRes = (): ResMap => ({ timber: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
export const totalRes = (r: Partial<ResMap>) => RESOURCES.reduce((s, k) => s + (r[k] ?? 0), 0);

export const PLAYER_COLORS = ['#e53935', '#1e88e5', '#f5f5f5', '#fb8c00'];
export const MAX_PLAYERS = 4;
export const WIN_POINTS = 10;
