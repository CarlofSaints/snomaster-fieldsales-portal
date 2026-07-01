import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import { Visit, loadVisitIndex, saveVisitIndex, saveVisitData, loadVisitData, visitDedupeKey } from '@/lib/visitData';
import { seedScoresFromVisits } from '@/lib/seedScores';
import { loadPerigeeConfig, savePerigeeConfig, activeTokens, fetchAllVisits, mapPerigeeVisit } from '@/lib/perigee';
import { syncVisitedStores } from '@/lib/storeData';
import { loadExcludedReps, excludedEmailSet, filterExcluded } from '@/lib/excludedReps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await requireRole(req, ['super_admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await loadPerigeeConfig();

  if (!config.endpoint || activeTokens(config).length === 0) {
    return NextResponse.json(
      { error: 'Perigee API not configured. Set an endpoint and at least one enabled token in Settings.' },
      { status: 400, headers: noCacheHeaders() }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = (body as Record<string, string>).mode || 'test';

    // The client sends the full Perigee request body — strip 'mode' before forwarding
    const perigeeBody = { ...(body as Record<string, unknown>) };
    delete perigeeBody.mode;

    if (!perigeeBody.startDate) {
      return NextResponse.json(
        { error: 'startDate is required in the request body' },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    // Call the endpoint once per active token and merge the rows
    const { rawVisits, perToken } = await fetchAllVisits(config, perigeeBody, mode === 'test');
    const tokenSummary = perToken.map(t => ({ label: t.label, ok: t.ok, count: t.count, error: t.error }));
    const anyOk = perToken.some(t => t.ok);
    const allFailed = perToken.length > 0 && !anyOk;

    if (allFailed) {
      const first = perToken[0];
      return NextResponse.json(
        { error: `All Perigee tokens failed. First error — ${first?.label}: ${first?.error}`, tokens: tokenSummary },
        { status: 502, headers: noCacheHeaders() }
      );
    }

    // Update lastPolledAt
    await savePerigeeConfig({ ...config, lastPolledAt: new Date().toISOString() });

    if (mode === 'test') {
      const sample = rawVisits.slice(0, 3);
      const responseKeys = rawVisits.length > 0 ? Object.keys(rawVisits[0]) : [];
      const mappedSample = sample.map(mapPerigeeVisit);
      // Surface the first token's response metadata for debugging
      const firstRaw = perToken.find(t => t.ok && t.raw)?.raw as Record<string, unknown> | undefined;
      const meta: Record<string, unknown> = {};
      if (firstRaw && !Array.isArray(firstRaw)) {
        for (const k of Object.keys(firstRaw)) {
          if (k === 'visits' && typeof firstRaw[k] === 'object' && !Array.isArray(firstRaw[k])) {
            const { data: _data, ...visitsMeta } = firstRaw[k] as Record<string, unknown>;
            void _data;
            meta['visits'] = visitsMeta;
          } else if (k !== 'visits') {
            meta[k] = firstRaw[k];
          }
        }
      }
      return NextResponse.json({
        ok: true,
        mode: 'test',
        totalRows: rawVisits.length,
        tokens: tokenSummary,
        responseKeys,
        sample,
        mappedSample,
        meta,
        sentBody: perigeeBody,
      }, { headers: noCacheHeaders() });
    }

    // mode === 'import' — map, deduplicate, and save
    if (rawVisits.length === 0) {
      return NextResponse.json(
        { ok: true, mode: 'import', message: 'No visits returned for this date range', totalRows: 0, tokens: tokenSummary },
        { headers: noCacheHeaders() }
      );
    }

    const excluded = excludedEmailSet(await loadExcludedReps());
    const mappedVisits: Visit[] = filterExcluded(
      rawVisits.map(mapPerigeeVisit).filter(v => v.storeName || v.repName),
      excluded,
    );

    // Deduplicate within this batch (Perigee returns same GUID 2+ times; also de-overlaps across tokens)
    const batchSeen = new Set<string>();
    const visits: Visit[] = [];
    for (const v of mappedVisits) {
      const key = visitDedupeKey(v);
      if (batchSeen.has(key)) continue;
      batchSeen.add(key);
      visits.push(v);
    }

    // Deduplication: build set of existing keys across all uploads (visitId + composite)
    const index = await loadVisitIndex();
    const existingKeys = new Set<string>();
    for (const meta of index) {
      const existingVisits = await loadVisitData(meta.id);
      for (const ev of existingVisits) existingKeys.add(visitDedupeKey(ev));
    }

    const newVisits = visits.filter(v => !existingKeys.has(visitDedupeKey(v)));
    const skippedDuplicates = mappedVisits.length - newVisits.length;

    if (newVisits.length === 0) {
      return NextResponse.json({
        ok: true,
        mode: 'import',
        message: 'All visits already imported (duplicates skipped)',
        totalRows: rawVisits.length,
        importedRows: 0,
        skippedDuplicates,
        tokens: tokenSummary,
      }, { headers: noCacheHeaders() });
    }

    const uploadId = crypto.randomUUID();
    await saveVisitData(uploadId, newVisits);

    index.unshift({
      id: uploadId,
      fileName: `perigee-api-${perigeeBody.startDate}.json`,
      uploadedAt: new Date().toISOString(),
      uploadedBy: `${user.name} ${user.surname} (API)`,
      rowCount: newVisits.length,
    });
    await saveVisitIndex(index);

    // Keep the store master in sync with newly-visited stores.
    try { await syncVisitedStores(newVisits); } catch (e) { console.error('syncVisitedStores failed:', e); }

    const seedResult = await seedScoresFromVisits(`${user.name} ${user.surname} (auto-seed)`);

    return NextResponse.json({
      ok: true,
      mode: 'import',
      uploadId,
      totalRows: rawVisits.length,
      importedRows: newVisits.length,
      skippedDuplicates,
      scoresSeeded: seedResult,
      tokens: tokenSummary,
    }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Perigee poll error:', err);
    return NextResponse.json(
      { error: 'Failed to call Perigee API: ' + (err instanceof Error ? err.message : 'Unknown') },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
