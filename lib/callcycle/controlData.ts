import { readJson, writeJson, deleteBlob } from '../blob';
import type { StoreControlData, TeamControlData } from './types';

/**
 * Perigee control-file storage. These are the two files exported straight out
 * of the Perigee portal:
 *
 *  - STORE control  → every site Perigee knows, with its code + channel. This is
 *    what makes a built call cycle actually load back into Perigee, because a
 *    site code is only unique *within* a channel.
 *  - TEAM control   → every user, their Perigee USER ID, and their team leader.
 *    The USER ID column is required by the Perigee upload template.
 *
 * SnoMaster is single-tenant, so keys are fixed (no tenant prefix).
 */

const STORE_KEY = 'callcycle/store-control.json';
const TEAM_KEY = 'callcycle/team-control.json';

export async function loadStoreControl(): Promise<StoreControlData | null> {
  const data = await readJson<StoreControlData | null>(STORE_KEY, null);
  return data && Array.isArray(data.stores) ? data : null;
}

export async function saveStoreControl(data: StoreControlData): Promise<void> {
  await writeJson(STORE_KEY, data);
}

export async function clearStoreControl(): Promise<void> {
  await deleteBlob(STORE_KEY);
}

export async function loadTeamControl(): Promise<TeamControlData | null> {
  const data = await readJson<TeamControlData | null>(TEAM_KEY, null);
  return data && Array.isArray(data.teams) ? data : null;
}

export async function saveTeamControl(data: TeamControlData): Promise<void> {
  await writeJson(TEAM_KEY, data);
}

export async function clearTeamControl(): Promise<void> {
  await deleteBlob(TEAM_KEY);
}
