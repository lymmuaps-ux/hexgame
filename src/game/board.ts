import { Hex, Port, PortType, RESOURCES, TileType } from './types';

/** Distance between hex center and a corner, in world units. */
export const HEX_SIZE = 1;
const SQRT3 = Math.sqrt(3);

export interface Vertex {
  id: number;
  x: number;
  z: number;
  hexes: number[];
  edges: number[];
  neighbors: number[];
}
export interface Edge {
  id: number;
  a: number;
  b: number;
  hexes: number[];
  x: number;
  z: number;
  angle: number;
}

export interface Geometry {
  hexCoords: { q: number; r: number; x: number; z: number }[];
  vertices: Vertex[];
  edges: Edge[];
  /** vertex ids of the 6 corners of each hex */
  hexVertices: number[][];
  coastEdges: number[];
}

/** Axial coordinates of a radius-2 hexagonal island (19 tiles), deterministic order. */
function islandCoords() {
  const out: { q: number; r: number }[] = [];
  for (let r = -2; r <= 2; r++)
    for (let q = -2; q <= 2; q++) if (Math.abs(q + r) <= 2) out.push({ q, r });
  return out;
}

export function hexCenter(q: number, r: number) {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), z: HEX_SIZE * 1.5 * r };
}

function buildGeometry(): Geometry {
  const hexCoords = islandCoords().map(({ q, r }) => ({ q, r, ...hexCenter(q, r) }));
  const vertices: Vertex[] = [];
  const vKey = new Map<string, number>();
  const hexVertices: number[][] = [];

  hexCoords.forEach((h, hi) => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const x = h.x + HEX_SIZE * Math.cos(ang);
      const z = h.z + HEX_SIZE * Math.sin(ang);
      const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
      let id = vKey.get(key);
      if (id === undefined) {
        id = vertices.length;
        vKey.set(key, id);
        vertices.push({ id, x, z, hexes: [], edges: [], neighbors: [] });
      }
      vertices[id].hexes.push(hi);
      ids.push(id);
    }
    hexVertices.push(ids);
  });

  const edges: Edge[] = [];
  const eKey = new Map<string, number>();
  hexVertices.forEach((ids, hi) => {
    for (let i = 0; i < 6; i++) {
      const a = Math.min(ids[i], ids[(i + 1) % 6]);
      const b = Math.max(ids[i], ids[(i + 1) % 6]);
      const key = `${a}-${b}`;
      let id = eKey.get(key);
      if (id === undefined) {
        id = edges.length;
        eKey.set(key, id);
        const va = vertices[a], vb = vertices[b];
        edges.push({
          id, a, b, hexes: [],
          x: (va.x + vb.x) / 2,
          z: (va.z + vb.z) / 2,
          angle: Math.atan2(vb.z - va.z, vb.x - va.x),
        });
        va.edges.push(id);
        vb.edges.push(id);
        va.neighbors.push(b);
        vb.neighbors.push(a);
      }
      edges[id].hexes.push(hi);
    }
  });

  const coastEdges = edges
    .filter((e) => e.hexes.length === 1)
    .sort((e1, e2) => Math.atan2(e1.z, e1.x) - Math.atan2(e2.z, e2.x))
    .map((e) => e.id);

  return { hexCoords, vertices, edges, hexVertices, coastEdges };
}

export const GEO: Geometry = buildGeometry();

// ---------------------------------------------------------------- generation

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const TILE_BAG: TileType[] = [
  ...Array<TileType>(4).fill('timber'),
  ...Array<TileType>(3).fill('clay'),
  ...Array<TileType>(4).fill('wool'),
  ...Array<TileType>(4).fill('grain'),
  ...Array<TileType>(3).fill('ore'),
  'desert',
];
const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

function hexNeighbors(i: number): number[] {
  const { q, r } = GEO.hexCoords[i];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  return dirs
    .map(([dq, dr]) => GEO.hexCoords.findIndex((h) => h.q === q + dq && h.r === r + dr))
    .filter((j) => j >= 0);
}

export function generateBoard(rng: Rng): { hexes: Hex[]; ports: Port[]; raider: number } {
  let hexes: Hex[] = [];
  // Reshuffle until no two red numbers (6/8) touch – keeps the board fair.
  for (let attempt = 0; attempt < 500; attempt++) {
    const tiles = shuffle([...TILE_BAG], rng);
    const nums = shuffle([...NUMBER_BAG], rng);
    hexes = GEO.hexCoords.map((c, id) => ({
      id, q: c.q, r: c.r, type: tiles[id],
      number: tiles[id] === 'desert' ? null : nums.pop()!,
    }));
    const hot = (h: Hex) => h.number === 6 || h.number === 8;
    const ok = hexes.every((h) => !hot(h) || hexNeighbors(h.id).every((n) => !hot(hexes[n])));
    if (ok) break;
  }
  const portTypes: PortType[] = shuffle(['any', 'any', 'any', 'any', ...RESOURCES], rng);
  const coast = GEO.coastEdges; // 30 edges around the island
  const picks = [0, 3, 7, 10, 13, 17, 20, 23, 27];
  const offset = Math.floor(rng() * coast.length);
  const ports = picks.map((p, i) => ({ edge: coast[(p + offset) % coast.length], type: portTypes[i] }));
  const raider = hexes.find((h) => h.type === 'desert')!.id;
  return { hexes, ports, raider };
}

export const DEV_DECK = (): ('guard' | 'roadworks' | 'harvest' | 'embargo' | 'monument')[] => [
  ...Array(14).fill('guard'),
  ...Array(2).fill('roadworks'),
  ...Array(2).fill('harvest'),
  ...Array(2).fill('embargo'),
  ...Array(5).fill('monument'),
];
