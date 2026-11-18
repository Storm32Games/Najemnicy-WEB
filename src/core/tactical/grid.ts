// Siatka taktyczna: Dijkstra 8-kierunkowa (przekątna 1.5), linia strzału z osłoną, pole widzenia.
// Migracja z Oldgame/src/mission/util.js. Współrzędne (x, z) z Three.js = (gx, gy) tutaj.
import type { GridPos } from '../rules/types.ts';

/** Rodzaj pola: wolne / niska osłona (blokuje ruch, nie wzrok) / wysoka przeszkoda (blokuje oba) / skażenie (blokuje ruch). */
export const CellKind = { FREE: 0, LOW: 1, HIGH: 2, HAZARD: 3 } as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

export const DIRS8: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const DIRS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Odległość Czebyszewa (pola, przekątna = 1) - zasięgi broni i sąsiedztwo. */
export const cheb = (a: GridPos, b: GridPos): number => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
/** Odległość euklidesowa w polach. */
export const dist = (a: GridPos, b: GridPos): number => Math.hypot(a.gx - b.gx, a.gy - b.gy);
export const samePos = (a: GridPos, b: GridPos): boolean => a.gx === b.gx && a.gy === b.gy;

export const UNREACHABLE = 1e9;

export interface SearchResult {
  /** Koszt dojścia do pola [gy * width + gx]; UNREACHABLE = brak drogi. */
  cost: Float32Array;
  prev: Int32Array;
  width: number;
}

export interface LosResult {
  clear: boolean;
  /** Niska przeszkoda tuż przy celu na linii strzału -> cel w osłonie (+2 KP). */
  cover: boolean;
}

export class TacticalGrid {
  readonly width: number;
  readonly height: number;
  /** Rodzaje pól, indeks gy * width + gx. */
  readonly cells: Uint8Array;

  constructor(width: number, height: number, cells?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.cells = cells ?? new Uint8Array(width * height);
  }

  index(gx: number, gy: number): number {
    return gy * this.width + gx;
  }
  posOf(i: number): GridPos {
    return { gx: i % this.width, gy: (i / this.width) | 0 };
  }
  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }
  /** Rodzaj pola; poza mapą = wysoka przeszkoda. */
  kind(gx: number, gy: number): number {
    return this.inBounds(gx, gy) ? this.cells[gy * this.width + gx] : CellKind.HIGH;
  }
  isFree(gx: number, gy: number): boolean {
    return this.kind(gx, gy) === CellKind.FREE;
  }
  setKind(gx: number, gy: number, k: CellKind): void {
    if (this.inBounds(gx, gy)) this.cells[gy * this.width + gx] = k;
  }

  /**
   * Dijkstra od `start` do kosztu `maxCost`. Ruch po przekątnej kosztuje 1.5 i nie może ścinać rogów przeszkód.
   * `pass(gx, gy)` = false blokuje pole (np. wrogie postacie).
   */
  search(start: GridPos, maxCost: number, pass?: (gx: number, gy: number) => boolean): SearchResult {
    const W = this.width;
    const N = W * this.height;
    const cost = new Float32Array(N).fill(UNREACHABLE);
    const prev = new Int32Array(N).fill(-1);
    const open: [number, number, number][] = [[0, start.gx, start.gy]];
    cost[start.gy * W + start.gx] = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [c, x, y] = open.splice(bi, 1)[0];
      if (c > cost[y * W + x]) continue;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.isFree(nx, ny)) continue;
        if (pass && !pass(nx, ny)) continue;
        if (dx && dy && (!this.isFree(x + dx, y) || !this.isFree(x, y + dy))) continue;
        const nc = c + (dx && dy ? 1.5 : 1);
        if (nc > maxCost) continue;
        const ni = ny * W + nx;
        if (nc < cost[ni]) {
          cost[ni] = nc;
          prev[ni] = y * W + x;
          open.push([nc, nx, ny]);
        }
      }
    }
    return { cost, prev, width: W };
  }

  costAt(res: SearchResult, p: GridPos): number {
    return res.cost[p.gy * res.width + p.gx];
  }
  reachable(res: SearchResult, p: GridPos): boolean {
    return this.inBounds(p.gx, p.gy) && this.costAt(res, p) < UNREACHABLE;
  }

  /** Ścieżka (bez pola startowego) z wyniku search(); null = nieosiągalne. */
  pathFrom(res: SearchResult, target: GridPos): GridPos[] | null {
    const W = this.width;
    let i = target.gy * W + target.gx;
    if (res.cost[i] >= UNREACHABLE) return null;
    const p: GridPos[] = [];
    while (res.prev[i] >= 0) {
      p.push({ gx: i % W, gy: (i / W) | 0 });
      i = res.prev[i];
    }
    return p.reverse();
  }

  /** Najkrótsza ścieżka a -> b (lub null). */
  findPath(a: GridPos, b: GridPos, pass?: (gx: number, gy: number) => boolean, maxCost = 999): GridPos[] | null {
    return this.pathFrom(this.search(a, maxCost, pass), b);
  }

  private clear(a: GridPos, b: GridPos): LosResult {
    const dx = b.gx - a.gx;
    const dy = b.gy - a.gy;
    const n = Math.max(2, Math.ceil(Math.hypot(dx, dy) * 3));
    let cover = false;
    let last = -1;
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const x = Math.round(a.gx + dx * t);
      const y = Math.round(a.gy + dy * t);
      const key = y * this.width + x;
      if (key === last || (x === a.gx && y === a.gy) || (x === b.gx && y === b.gy)) continue;
      last = key;
      const k = this.kind(x, y);
      if (k === CellKind.HIGH) return { clear: false, cover: false };
      if (k === CellKind.LOW && Math.max(Math.abs(x - b.gx), Math.abs(y - b.gy)) <= 1) cover = true;
    }
    return { clear: true, cover };
  }

  /** Pola na linii a -> b bez końców (ta sama próbka co linia strzału) - kto stoi na drodze pocisku. */
  lineCells(a: GridPos, b: GridPos): GridPos[] {
    const dx = b.gx - a.gx;
    const dy = b.gy - a.gy;
    const n = Math.max(2, Math.ceil(Math.hypot(dx, dy) * 3));
    const out: GridPos[] = [];
    let last = -1;
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const x = Math.round(a.gx + dx * t);
      const y = Math.round(a.gy + dy * t);
      const key = y * this.width + x;
      if (key === last || (x === a.gx && y === a.gy) || (x === b.gx && y === b.gy)) continue;
      last = key;
      out.push({ gx: x, gy: y });
    }
    return out;
  }

  /** Linia strzału a -> b. Symetryczna przy blokadzie (sprawdza też b -> a), osłona liczona od strony celu. */
  los(a: GridPos, b: GridPos): LosResult {
    const r = this.clear(a, b);
    if (r.clear) return r;
    return { clear: this.clear(b, a).clear, cover: false };
  }

  /** Indeksy pól widocznych z `origin` w promieniu r. */
  visible(origin: GridPos, r: number): number[] {
    const out: number[] = [];
    for (let y = origin.gy - r; y <= origin.gy + r; y++) {
      for (let x = origin.gx - r; x <= origin.gx + r; x++) {
        if (!this.inBounds(x, y) || Math.hypot(x - origin.gx, y - origin.gy) > r + 0.3) continue;
        const p = { gx: x, gy: y };
        if (this.clear(origin, p).clear || this.clear(p, origin).clear) out.push(y * this.width + x);
      }
    }
    return out;
  }

  /** Pola w promieniu (euklidesowym, z tolerancją 0.45 jak w oryginale) - obszar wybuchu. */
  cellsInRadius(center: GridPos, r: number): GridPos[] {
    const out: GridPos[] = [];
    const R = Math.ceil(r);
    for (let y = center.gy - R; y <= center.gy + R; y++) {
      for (let x = center.gx - R; x <= center.gx + R; x++) {
        if (this.inBounds(x, y) && Math.hypot(x - center.gx, y - center.gy) <= r + 0.45) out.push({ gx: x, gy: y });
      }
    }
    return out;
  }

  /** Czy przy polu jest niska osłona (4 kierunki). */
  hasLowCoverNear(p: GridPos): boolean {
    return DIRS4.some(([dx, dy]) => this.kind(p.gx + dx, p.gy + dy) === CellKind.LOW);
  }

  /** Mapa kolizji [gy][gx] (0 = wolne, 1 = zablokowane) dla prostego GridSystem / Pathfindera. */
  toCollisionMap(): number[][] {
    const rows: number[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.width; x++) row.push(this.isFree(x, y) ? 0 : 1);
      rows.push(row);
    }
    return rows;
  }
}

/** Ile akcji Marszu kosztuje droga o koszcie `cost` przy prędkości `speed`. */
export const strideActions = (cost: number, speed: number): number => Math.max(1, Math.ceil(cost / speed - 1e-6));
