// Tile layout solver. Rather than hard-coding "2 columns up to 4 people, then
// 3", try every column count and keep whichever yields the largest tile at a
// sensible shape — one rule covering a landscape laptop, a portrait phone and
// every rotation between, because the answer falls out of the real container.

export interface Box { w: number; h: number }
export interface Layout { c: number; r: number; tw: number; th: number; fits: boolean }

export const GAP_DESKTOP = 14, GAP_PHONE = 8;
const MIN_TILE_W = 132;   // below this a face is unreadable — scroll instead
const MIN_TILE_H = 96;

// Portrait screens fill their cells instead of letterboxing to a landscape
// shape; clamped so a cell can never produce an absurd sliver.
const FILL_AR_MIN = 0.5, FILL_AR_MAX = 2.05;

export const isPhonePortrait = () => window.innerWidth <= 600 && window.innerHeight > window.innerWidth;

/**
 * The shape to aim tiles at. With a single tile, match the sender's real shape
 * (`singleAR`) so nothing is cropped. Otherwise landscape suits 16:9, and a
 * portrait container gets a squarer 4:3 (or a phone-shaped 3:4 when alone).
 */
export function targetAspect(container: Box, n: number, singleAR: number | null): number {
  if (n === 1 && singleAR) return Math.min(2.4, Math.max(0.5, singleAR));
  const portrait = container.h > container.w;
  if (!portrait) return 16 / 9;
  return n <= 1 ? 3 / 4 : 4 / 3;
}

/** Best (cols,rows) and exact tile box, maximising area under the target shape. */
export function solveLayout(n: number, container: Box, gap: number, ar: number, maxAR: number, minCols: number, fill: boolean): Layout {
  let best: (Layout & { area: number; cellW: number; cellH: number }) | null = null;
  for (let c = Math.max(1, minCols || 1); c <= n; c++) {
    const r = Math.ceil(n / c);
    const cellW = (container.w - gap * (c - 1)) / c;
    const cellH = (container.h - gap * (r - 1)) / r;
    if (cellW <= 0 || cellH <= 0) continue;
    let tw: number, th: number;
    if (fill) {
      tw = cellW; th = cellH;
      const cellAR = cellW / cellH;
      if (cellAR > FILL_AR_MAX) tw = cellH * FILL_AR_MAX;        // too wide → letterbox
      else if (cellAR < FILL_AR_MIN) th = cellW / FILL_AR_MIN;   // too tall → letterbox
    } else {
      // Fit the target shape inside the cell — letterbox, never stretch.
      tw = cellW; th = cellW / ar;
      if (th > cellH) { th = cellH; tw = cellH * ar; }
    }
    const area = tw * th;
    if (!best || area > best.area + 0.5) best = { c, r, tw, th, area, cellW, cellH, fits: false };
  }
  // Claim spare width only AFTER the arrangement is chosen; folding it into the
  // comparison biases the solver towards tall single-column stacks.
  if (best && !fill && maxAR && best.tw < best.cellW) best.tw = Math.min(best.cellW, best.th * maxAR);
  if (!best) return { c: 1, r: n, tw: container.w, th: container.w / ar, fits: false };
  return { c: best.c, r: best.r, tw: best.tw, th: best.th, fits: best.tw >= MIN_TILE_W && best.th >= MIN_TILE_H };
}

/** Nothing fits on one screen: widest comfortable column count, let it scroll. */
export function scrollLayout(n: number, container: Box, gap: number, ar: number): Layout {
  let c = Math.max(1, Math.floor((container.w + gap) / (MIN_TILE_W + gap)));
  c = Math.min(c, n);
  const tw = (container.w - gap * (c - 1)) / c;
  return { c, r: Math.ceil(n / c), tw, th: tw / ar, fits: false };
}
