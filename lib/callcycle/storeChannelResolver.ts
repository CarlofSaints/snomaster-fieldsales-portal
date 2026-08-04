/**
 * Resolve a schedule store's CHANNEL from the store control file.
 *
 * Perigee allows the SAME site code in more than one channel (a code is only
 * unique *within* a channel). For our clients this happens between BEX and
 * Dis-Chem — e.g. "S074" and "S119" exist in both. A plain `code → channel`
 * Map therefore loses information: whichever row is inserted last wins, so the
 * call cycle gets built against the wrong store.
 *
 * Site code stays the primary lookup. When (and only when) a code is shared
 * across channels, we fall back to the store NAME to decide which channel it
 * belongs to — the name reliably carries the channel ("DIS-CHEM ALBEMARLE
 * GARDENS - S074", "BEX CARNIVAL MALL S119").
 */
import { StoreControlEntry } from './types';

export interface StoreLike {
  storeCode: string;
  storeName: string;
  channel: string;
  active?: boolean;
}

export type ChannelMatchType =
  | 'unique'    // code maps to exactly one channel — no ambiguity
  | 'exact'     // duplicate code, resolved by exact store-name match
  | 'keyword'   // duplicate code, resolved by channel keyword in the name
  | 'token'     // duplicate code, resolved by a single best token overlap
  | 'ambiguous' // duplicate code, name could NOT pick a channel (tie / no signal)
  | 'unknown';  // code not present in the control file

export interface ChannelResolution {
  channel: string;
  matchType: ChannelMatchType;
  /** True when we trust the channel. False for 'ambiguous'/'unknown'. */
  confident: boolean;
  /** Distinct channels this code appears under (for reporting ambiguity). */
  candidateChannels: string[];
}

export interface StoreChannelResolver {
  /** Channel for a store, disambiguating duplicate codes by store name. '' if the code is unknown. */
  resolve(storeCode: string, storeName: string): string;
  /** Full resolution with match type + confidence, used for upload validation. */
  resolveDetailed(storeCode: string, storeName: string): ChannelResolution;
  /** True when this code exists under more than one channel in the control file. */
  isAmbiguous(storeCode: string): boolean;
}

/** Uppercase, fold dashes/punctuation to spaces, collapse whitespace. */
function normalizeName(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/ /g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Separator-insensitive form: uppercase with ALL non-alphanumerics removed.
 * Makes "DIS-CHEM", "DIS CHEM" and "DISCHEM" all compare equal ("DISCHEM").
 */
function squish(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function buildStoreChannelResolver(stores: StoreLike[]): StoreChannelResolver {
  const byCode = new Map<string, StoreLike[]>();
  for (const s of stores) {
    const code = (s.storeCode || '').trim().toUpperCase();
    if (!code) continue;
    const list = byCode.get(code);
    if (list) list.push(s);
    else byCode.set(code, [s]);
  }

  function isAmbiguous(storeCode: string): boolean {
    const list = byCode.get((storeCode || '').trim().toUpperCase());
    if (!list || list.length < 2) return false;
    const channels = new Set(
      list.map(s => (s.channel || '').trim().toUpperCase()).filter(Boolean),
    );
    return channels.size > 1;
  }

  function distinctChannels(list: StoreLike[]): string[] {
    return [...new Set(list.map(s => (s.channel || '').trim()).filter(Boolean))];
  }

  function resolveDetailed(storeCode: string, storeName: string): ChannelResolution {
    const code = (storeCode || '').trim().toUpperCase();
    const list = byCode.get(code);
    if (!list || list.length === 0) {
      return { channel: '', matchType: 'unknown', confident: false, candidateChannels: [] };
    }

    const channels = distinctChannels(list);
    // Single entry, or many entries that all share one channel → unambiguous.
    if (list.length === 1 || channels.length <= 1) {
      return { channel: list[0].channel, matchType: 'unique', confident: true, candidateChannels: channels };
    }

    // Duplicate code across channels — disambiguate by the schedule store name.
    const target = normalizeName(storeName);
    const targetSquished = squish(storeName);
    if (target) {
      // 1. Exact store-name match, separator-insensitive (most specific).
      const exact = list.find(s => squish(s.storeName) === targetSquished);
      if (exact) return { channel: exact.channel, matchType: 'exact', confident: true, candidateChannels: channels };

      // 2. Channel keyword present in the store name (e.g. "DIS-CHEM"/"DISCHEM",
      //    "BEX"). Separator-insensitive so "DISCHEM" matches "DIS-CHEM ...".
      const byKeyword = list.find(s => {
        const ch = squish(s.channel);
        return ch && targetSquished.includes(ch);
      });
      if (byKeyword) return { channel: byKeyword.channel, matchType: 'keyword', confident: true, candidateChannels: channels };

      // 3. Best token overlap. Only confident when there is a STRICT single
      //    winner — a tie (e.g. "BIX Norwood" matching both on "NORWOOD") is
      //    treated as unresolved so it gets flagged for review.
      const targetTokens = new Set(target.split(' ').filter(Boolean));
      let best: StoreLike | null = null;
      let bestScore = 0;
      let tie = false;
      for (const s of list) {
        const tokens = normalizeName(s.storeName).split(' ').filter(Boolean);
        let score = 0;
        for (const t of tokens) if (targetTokens.has(t)) score++;
        if (score > bestScore) { bestScore = score; best = s; tie = false; }
        else if (score === bestScore && score > 0) { tie = true; }
      }
      if (best && bestScore > 0 && !tie) {
        return { channel: best.channel, matchType: 'token', confident: true, candidateChannels: channels };
      }
    }

    // Could not disambiguate — guess (active, else first) but flag as ambiguous.
    const guess = list.find(s => s.active !== false) ?? list[0];
    return { channel: guess.channel, matchType: 'ambiguous', confident: false, candidateChannels: channels };
  }

  function resolve(storeCode: string, storeName: string): string {
    return resolveDetailed(storeCode, storeName).channel;
  }

  return { resolve, resolveDetailed, isAmbiguous };
}

/** Convenience builder straight from control-file entries. */
export function resolverFromControl(stores: StoreControlEntry[]): StoreChannelResolver {
  return buildStoreChannelResolver(stores);
}
