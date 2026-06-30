import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import {
  loadHirschData, saveHirschData, loadHirschRaw, deleteHirschRaw, rebuildHirschAggregates,
} from '@/lib/hirschData';
import { logFromUser } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const data = await loadHirschData();
  const meta = data.uploads.find(u => u.id === id);
  if (!meta) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

  data.uploads = data.uploads.filter(u => u.id !== id);
  await deleteHirschRaw(id);

  // Rebuild aggregates from the remaining uploads.
  const rawByUpload: Record<string, Awaited<ReturnType<typeof loadHirschRaw>>> = {};
  for (const u of data.uploads) rawByUpload[u.id] = await loadHirschRaw(u.id);
  const agg = rebuildHirschAggregates(data.uploads, rawByUpload);
  data.sales = agg.sales;
  data.stock = agg.stock;
  data.items = agg.items;
  await saveHirschData(data);

  logFromUser(user, 'delete_hirsch', `hirsch/${id}`, `Deleted Hirsch's upload ${meta.fileName} (${meta.periodStart}–${meta.periodEnd}).`);
  return NextResponse.json({ ok: true }, { headers: noCacheHeaders() });
}
