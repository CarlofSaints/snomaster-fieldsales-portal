import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { loadStores, saveStores, StoreMaster, normalizeCode } from '@/lib/storeData';
import { loadChannels } from '@/lib/channelData';
import { loadSiteFileData, buildSiteLookup } from '@/lib/siteFileData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin', 'client']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [stores, channels, siteData] = await Promise.all([loadStores(), loadChannels(), loadSiteFileData()]);

  const channelMap = Object.fromEntries(channels.map(c => [c.id, c]));
  const siteLookup = buildSiteLookup(siteData);

  const enriched = stores.map(s => {
    const ch = channelMap[s.channelId];
    const parent = ch?.parentId ? channelMap[ch.parentId] : undefined;
    // Resolve a name from the retailer site files by any of the store's codes.
    let site = undefined;
    for (const code of [s.perigeeCode, s.salesCode, s.siteCode]) {
      if (code && code.trim()) { site = siteLookup.get(normalizeCode(code)); if (site) break; }
    }
    return {
      ...s,
      channelName: ch?.name || '',
      mainChannelId: parent?.id || ch?.id || '',
      mainChannelName: parent?.name || ch?.name || '',
      siteName: site?.storeName || '',
      siteProvince: site?.province || '',
      siteSubChannel: site?.subChannel || '',
    };
  });

  return NextResponse.json(enriched, { headers: noCacheHeaders() });
}

export async function PUT(req: NextRequest) {
  const user = await requireRole(req, ['super_admin', 'admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { stores } = await req.json() as { stores: StoreMaster[] };
  if (!Array.isArray(stores)) {
    return NextResponse.json({ error: 'stores array required' }, { status: 400 });
  }

  await saveStores(stores);
  return NextResponse.json({ ok: true, count: stores.length }, { headers: noCacheHeaders() });
}
