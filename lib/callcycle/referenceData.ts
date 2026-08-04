import type { ReferenceData, ReferenceStore } from './types';
import { loadStoreControl, loadTeamControl } from './controlData';
import { loadStores, storeAllCodes } from '../storeData';
import { loadChannels } from '../channelData';

const EMPTY: ReferenceData = { stores: [], users: [], teams: [], storeSource: 'none' };

/**
 * Build the store list from SnoMaster's own store master.
 *
 * This is a FALLBACK for when no Perigee store control file has been uploaded.
 * It works because the store master is already keyed by the Perigee visit code,
 * so a call cycle built against it lines up with Perigee's own site codes.
 *
 * The caveat — and the reason the control file is still preferred — is that the
 * CHANNEL here is SnoMaster's channel name ("MAKRO", "HIRSCH'S"), which only
 * loads into Perigee if it matches Perigee's channel name exactly.
 */
async function storesFromStoreMaster(): Promise<ReferenceStore[]> {
  const [stores, channels] = await Promise.all([loadStores(), loadChannels()]);
  const channelName = new Map(channels.map(c => [c.id, c.name]));

  const out: ReferenceStore[] = [];
  const seen = new Set<string>();
  for (const s of stores) {
    // A DC is never visited, so it can never appear in a call cycle.
    if (s.isDc) continue;
    const channel = channelName.get(s.channelId) || '';
    const name = (s.storeName || s.salesName || '').trim();
    // Every code the store answers to, so a cycle written against an alias code
    // (Perigee logs some stores under several codes) still resolves.
    for (const code of storeAllCodes(s)) {
      const key = code.trim().toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ storeCode: code.trim(), storeName: name, channel });
    }
  }
  return out;
}

/**
 * Reference data used by the parsers and the schedule merge.
 *
 * Stores come from the Perigee store control file when one is loaded, else from
 * SnoMaster's store master. Users/teams only ever come from the team control
 * file — Perigee's USER ID has no equivalent anywhere else in SnoMaster.
 */
export async function loadReferences(): Promise<ReferenceData> {
  const [storeControl, teamControl] = await Promise.all([
    loadStoreControl(),
    loadTeamControl(),
  ]);

  const ref: ReferenceData = { stores: [], users: [], teams: [], storeSource: 'none' };

  if (storeControl && storeControl.stores.length > 0) {
    ref.stores = storeControl.stores.map(s => ({
      storeCode: s.storeCode,
      storeName: s.storeName,
      channel: s.channel,
    }));
    ref.storeSource = 'control';
  } else {
    const fallback = await storesFromStoreMaster();
    if (fallback.length > 0) {
      ref.stores = fallback;
      ref.storeSource = 'store-master';
    }
  }

  if (teamControl) {
    const seenEmails = new Set<string>();
    for (const t of teamControl.teams) {
      const emailKey = t.memberEmail.toLowerCase();
      if (!emailKey || seenEmails.has(emailKey)) continue;
      seenEmails.add(emailKey);
      ref.users.push({
        userId: t.memberId,
        userEmail: t.memberEmail,
        firstName: '',
        surname: '',
        status: 'ACTIVE',
      });
    }

    const seenTeams = new Set<string>();
    for (const t of teamControl.teams) {
      if (t.teamName && !seenTeams.has(t.teamName)) {
        seenTeams.add(t.teamName);
        ref.teams.push({ teamName: t.teamName, leader: t.teamLeader });
      }
    }
  }

  if (ref.stores.length === 0 && ref.users.length === 0) return EMPTY;
  return ref;
}
