import type { ReferenceStore } from './types';

/**
 * Match a store name typed into a planner against the Perigee store list.
 *
 * The planners carry no store codes — the STORE CODE column exists in the
 * template but is empty in every real file — so the name is all we have, and
 * the names are typed freehand by six different people. Real examples:
 *
 *   "Chamnerlains Riviera"        -> Chamberlains
 *   "Makro Carnivile"             -> Makro Carnival
 *   "Makro Strunenvalley"         -> Makro Strubensvalley
 *   "CHECEKRS OUTDOOR PAARDEVLEI" -> Checkers Outdoor
 *   "Chekers Outdoor Strubenvalley"
 *
 * So this is edit-distance work, not exact lookup. Every match comes back with
 * a confidence so the UI can insist a human confirms anything shaky — a wrong
 * store here silently builds a call cycle against the wrong shop.
 */

export type MatchConfidence = 'exact' | 'high' | 'low' | 'none';

export interface StoreMatch {
  /** The name exactly as typed in the planner. */
  input: string;
  confidence: MatchConfidence;
  /** Best candidate, or null when nothing was close enough. */
  storeCode: string;
  storeName: string;
  channel: string;
  /** 0-1. */
  score: number;
  /** Runners-up, so the UI can offer a dropdown instead of a blank. */
  alternatives: { storeCode: string; storeName: string; channel: string; score: number }[];
}

/** Lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Fully squished: no spaces at all, so "DIS-CHEM" == "dischem". */
function squish(s: string): string {
  return norm(s).replace(/ /g, '');
}

/**
 * Parenthetical and trailing notes the reps add that are not part of the name:
 * "(NEW)", "(new unit)", "(EVERY 2ND MONTH)", "- (ONCE OFF)".
 */
function stripNotes(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bnew\b/gi, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .trim();
}

/** Levenshtein distance, capped for speed on long strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - editDistance(a, b) / max;
}

/** Share of the planner name's words that appear in the candidate. */
function tokenOverlap(a: string, b: string): number {
  const at = norm(a).split(' ').filter(t => t.length > 2);
  const bt = new Set(norm(b).split(' ').filter(Boolean));
  if (at.length === 0) return 0;
  let hit = 0;
  for (const t of at) {
    if (bt.has(t)) { hit++; continue; }
    // A near-miss token still counts: "chamnerlains" vs "chamberlains".
    for (const c of bt) {
      if (Math.abs(c.length - t.length) <= 3 && similarity(t, c) >= 0.75) { hit++; break; }
    }
  }
  return hit / at.length;
}

export interface StoreMatcher {
  match(name: string, hintCode?: string): StoreMatch;
}

export function buildStoreMatcher(stores: ReferenceStore[]): StoreMatcher {
  // Pre-compute the normalised forms once — a planner has up to ~130 stores and
  // the Perigee list runs to tens of thousands, so this is the hot loop.
  const prepared = stores.map(s => ({
    ref: s,
    squished: squish(stripNotes(s.storeName)),
    normed: norm(stripNotes(s.storeName)),
  }));

  const byExact = new Map<string, typeof prepared[number]>();
  for (const p of prepared) {
    if (p.squished && !byExact.has(p.squished)) byExact.set(p.squished, p);
  }
  const byCode = new Map<string, typeof prepared[number]>();
  for (const p of prepared) {
    const c = (p.ref.storeCode || '').trim().toUpperCase();
    if (c && !byCode.has(c)) byCode.set(c, p);
  }

  function match(name: string, hintCode?: string): StoreMatch {
    const cleaned = stripNotes(name);
    const base: StoreMatch = {
      input: name, confidence: 'none', storeCode: '', storeName: '', channel: '',
      score: 0, alternatives: [],
    };
    if (!cleaned.trim()) return base;

    // A store code typed into the planner beats any name guess.
    if (hintCode) {
      const hit = byCode.get(hintCode.trim().toUpperCase());
      if (hit) {
        return {
          ...base, confidence: 'exact', score: 1,
          storeCode: hit.ref.storeCode, storeName: hit.ref.storeName, channel: hit.ref.channel,
        };
      }
    }

    const sq = squish(cleaned);
    const exact = byExact.get(sq);
    if (exact) {
      return {
        ...base, confidence: 'exact', score: 1,
        storeCode: exact.ref.storeCode, storeName: exact.ref.storeName, channel: exact.ref.channel,
      };
    }

    // Score every candidate: string similarity plus how many of the planner's
    // words landed. Token overlap carries most of the weight because the retail
    // brand and the suburb are what actually identify a store.
    const scored: { p: typeof prepared[number]; score: number }[] = [];
    for (const p of prepared) {
      if (!p.squished) continue;
      // Cheap reject: wildly different lengths can't be the same shop.
      if (Math.abs(p.squished.length - sq.length) > Math.max(8, sq.length * 0.6)) continue;
      const sim = similarity(sq, p.squished);
      const tok = tokenOverlap(cleaned, p.ref.storeName);
      const score = tok * 0.65 + sim * 0.35;
      if (score > 0.35) scored.push({ p, score });
    }

    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) return base;

    const best = scored[0];
    const runnerUp = scored[1]?.score ?? 0;

    // High confidence needs a good score AND a clear win over second place —
    // "Makro Centurion" vs "Hirsch Centurion" score similarly on the suburb, and
    // guessing between them is exactly the failure worth avoiding.
    const decisive = best.score - runnerUp >= 0.08;
    const confidence: MatchConfidence =
      best.score >= 0.86 && decisive ? 'high'
        : best.score >= 0.55 ? 'low'
          : 'none';

    return {
      input: name,
      confidence,
      score: Number(best.score.toFixed(3)),
      storeCode: confidence === 'none' ? '' : best.p.ref.storeCode,
      storeName: confidence === 'none' ? '' : best.p.ref.storeName,
      channel: confidence === 'none' ? '' : best.p.ref.channel,
      alternatives: scored.slice(0, 6).map(s => ({
        storeCode: s.p.ref.storeCode,
        storeName: s.p.ref.storeName,
        channel: s.p.ref.channel,
        score: Number(s.score.toFixed(3)),
      })),
    };
  }

  return { match };
}
