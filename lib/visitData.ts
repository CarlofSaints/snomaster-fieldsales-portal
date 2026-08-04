import { readJson, writeJson, deleteBlob } from './blob';

export interface Visit {
  email: string;
  repName: string;
  channel: string;
  storeName: string;
  storeCode: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  checkInDistance: string;
  checkOutDistance: string;
  visitDuration: string;
  formsCompleted: number;
  picsUploaded: number;
  status: string;
  networkOnCheckIn: string;
  visitId?: string;
  /**
   * Which business this visit belongs to — set from the Perigee token it
   * arrived on. Absent on anything loaded before the split, which is treated as
   * 'ba' because that is all there was.
   */
  project?: 'ba' | 'reps';
}

/** A visit's project, defaulting anything pre-split to the BA side. */
export function visitProject(v: Visit): 'ba' | 'reps' {
  return v.project === 'reps' ? 'reps' : 'ba';
}

/** Keep only the visits belonging to one business. */
export function filterVisitsByProject(visits: Visit[], project: 'ba' | 'reps'): Visit[] {
  return visits.filter(v => visitProject(v) === project);
}

export interface VisitUploadMeta {
  id: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  rowCount: number;
}

const INDEX_KEY = 'visits/index.json';

/** Consistent dedup key: visitId when present, otherwise composite of email|store|date|time */
export function visitDedupeKey(v: Visit): string {
  if (v.visitId) return `id:${v.visitId}`;
  return `comp:${(v.email || v.repName || '').toLowerCase()}|${(v.storeCode || v.storeName || '').toLowerCase()}|${v.checkInDate || ''}|${v.checkInTime || ''}`;
}

export async function loadVisitIndex(): Promise<VisitUploadMeta[]> {
  return readJson<VisitUploadMeta[]>(INDEX_KEY, []);
}

export async function saveVisitIndex(index: VisitUploadMeta[]): Promise<void> {
  await writeJson(INDEX_KEY, index);
}

export async function loadVisitData(uploadId: string): Promise<Visit[]> {
  return readJson<Visit[]>(`visits/${uploadId}.json`, []);
}

export async function saveVisitData(uploadId: string, visits: Visit[]): Promise<void> {
  await writeJson(`visits/${uploadId}.json`, visits);
}

/**
 * Every visit across every upload, de-duplicated, optionally narrowed to one
 * business.
 *
 * Pass a project unless you genuinely want both. BA scoring must never see
 * internal-rep visits and call cycle adherence must never see brand-ambassador
 * visits — they are different people, managed by different departments, and
 * mixing them silently corrupts both.
 */
export async function loadAllVisits(project?: 'ba' | 'reps'): Promise<Visit[]> {
  const index = await loadVisitIndex();
  const all: Visit[] = [];
  for (const meta of index) all.push(...await loadVisitData(meta.id));

  const seen = new Set<string>();
  const out: Visit[] = [];
  for (const v of all) {
    if (project && visitProject(v) !== project) continue;
    const key = visitDedupeKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export async function deleteVisitUpload(uploadId: string): Promise<void> {
  // Delete data file
  await deleteBlob(`visits/${uploadId}.json`);
  // Remove from index
  const index = await loadVisitIndex();
  const updated = index.filter(u => u.id !== uploadId);
  await saveVisitIndex(updated);
}
