import { NextRequest, NextResponse } from 'next/server';
import { noCacheHeaders } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import {
  loadPerigeeConfig,
  savePerigeeConfig,
  maskToken,
  PerigeeToken,
} from '@/lib/perigee';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'ba.perigee.manage');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await loadPerigeeConfig();
  // Mask every token's key for display
  return NextResponse.json(
    {
      endpoint: config.endpoint,
      enabled: config.enabled,
      lastPolledAt: config.lastPolledAt,
      requestBody: config.requestBody,
      tokens: config.tokens.map(t => ({
        id: t.id, label: t.label, enabled: t.enabled, project: t.project,
        masked: maskToken(t.apiKey), hasKey: !!t.apiKey,
      })),
    },
    { headers: noCacheHeaders() }
  );
}

interface IncomingToken {
  id?: string;
  label?: string;
  enabled?: boolean;
  apiKey?: string; // blank/undefined = keep existing key for this id
  project?: 'ba' | 'reps';
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, 'ba.perigee.manage');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const current = await loadPerigeeConfig();
    const existingById = new Map(current.tokens.map(t => [t.id, t]));

    let tokens = current.tokens;
    if (Array.isArray(body.tokens)) {
      tokens = (body.tokens as IncomingToken[]).map((t): PerigeeToken => {
        const prev = t.id ? existingById.get(t.id) : undefined;
        const newKey = (t.apiKey ?? '').trim();
        return {
          id: t.id || crypto.randomUUID(),
          label: (t.label ?? prev?.label ?? 'Token').trim() || 'Token',
          // keep existing key when the field is left blank (UI never echoes the real key back)
          apiKey: newKey || prev?.apiKey || '',
          enabled: t.enabled !== undefined ? !!t.enabled : (prev?.enabled ?? true),
          // Which business this token's visits belong to. Anything not
          // explicitly marked as reps stays on the BA side, which is what every
          // token that existed before the split was.
          project: t.project === 'reps' ? 'reps' : (t.project === 'ba' ? 'ba' : (prev?.project ?? 'ba')),
        };
      });
    }

    await savePerigeeConfig({
      endpoint: body.endpoint !== undefined ? body.endpoint : current.endpoint,
      enabled: body.enabled !== undefined ? body.enabled : current.enabled,
      lastPolledAt: current.lastPolledAt,
      requestBody: body.requestBody !== undefined ? body.requestBody : current.requestBody,
      tokens,
    });

    return NextResponse.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    console.error('Perigee config error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
