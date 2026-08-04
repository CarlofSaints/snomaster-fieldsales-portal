/**
 * Call Cycle module types.
 *
 * Ported from the iRAM Perigee Call Cycle Builder. The shapes are deliberately
 * unchanged so the proven parsers and the Perigee export template port across
 * verbatim — the only difference here is that SnoMaster is single-tenant, so
 * there is no tenant slug on any of the loaders.
 */

export interface ScheduleRow {
  userEmail: string;
  firstName: string;
  surname: string;
  storeId: string;
  storeName: string;
  channel: string;
  cycle: string;         // e.g. "Week 1&3" or "Week 2&4"
  days: string[];        // e.g. ["Monday", "Wednesday"]
  action: 'ADD' | 'UPDATE' | 'REMOVE' | 'LIVE';
  uploadedAt: string;
  uploadedBy: string;
  /**
   * Computed server-side on read by joining userEmail against the team control.
   * Never persisted to disk — always reflects the latest team control upload.
   */
  teamLeader?: string;
}

export interface ParsedEntry {
  userEmail: string;
  firstName: string;
  surname: string;
  storeId: string;
  storeName: string;
  cycle: string;
  days: string[];
}

export interface ReferenceStore {
  storeCode: string;
  storeName: string;
  channel: string;
}

export interface ReferenceUser {
  userId: string;
  userEmail: string;
  firstName: string;
  surname: string;
  status: string;
}

export interface ReferenceData {
  stores: ReferenceStore[];
  users: ReferenceUser[];
  teams: { teamName: string; leader: string }[];
  /**
   * Where `stores` came from. 'control' = the Perigee store control file (the
   * authoritative source). 'store-master' = derived from SnoMaster's own store
   * master as a fallback, which means channel names are SnoMaster channel names
   * and may not match Perigee's exactly.
   */
  storeSource: 'control' | 'store-master' | 'none';
}

export interface UnmatchedDuplicate {
  storeCode: string;
  storeName: string;
  /** The channels this code exists under in the control file. */
  candidateChannels: string[];
  /** The channel we fell back to (best guess) — needs human verification. */
  assignedChannel: string;
}

export interface UploadResult {
  rowsAdded: number;
  rowsUpdated: number;
  totalRows: number;
  warnings: string[];
  /** Duplicate site codes whose channel could not be confidently matched by name. */
  unmatchedDuplicates: UnmatchedDuplicate[];
  /**
   * True when the load was aborted (nothing saved) because error sites were
   * found and "ignore error sites" was off. The user must fix the file & reload.
   */
  aborted?: boolean;
  /** Count of error-site rows skipped because "ignore error sites" was on. */
  skippedRows?: number;
}

// --- Control file types ---

export interface StoreControlEntry {
  country: string;
  province: string;
  channel: string;
  storeName: string;
  storeCode: string;
  active: boolean;
  longitude: string;
  latitude: string;
  locationStatus: string;
  ignoreLocationData: boolean;
  email: string;
  createdBy: string;
  updatedBy: string;
}

export interface StoreControlData {
  stores: StoreControlEntry[];
  uploadedAt: string;
  uploadedBy: string;
}

export interface TeamControlEntry {
  teamName: string;
  teamLeader: string;
  teamLeaderEmail: string;
  teamLeaderId: string;
  memberEmail: string;
  memberId: string;
}

export interface TeamControlData {
  teams: TeamControlEntry[];
  uploadedAt: string;
  uploadedBy: string;
}
