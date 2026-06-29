import { NextRequest, NextResponse } from 'next/server';
import { requireRole, noCacheHeaders } from '@/lib/auth';
import {
  loadPerigeeConfig,
  savePerigeeConfig,
  maskToken,
  PerigeeToken,
} from '@/lib/perigee';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireRole(req, ['super_admin']);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await loadPerigeeConfig();
  // Mask every token's key for display
  return NextResponse.json(
    {
      endpoint: config.endpoint,
      enabled: config.enabled,
      lastPolledAt: config.lastPolledAt,
      requestBody: config.requestBody,
      tokens: config.tokens.map(t => ({ id: t.id, label: t.label, enabled: t.enabled, masked: maskToken(t.apiKey), hasKey: !!t.apiKey })),
    },
    { headers: noCacheHeaders() }
  );
}

interface IncomingToken {
  id?: string;
  label?: string;
  enabled?: boolean;
  apiKey?: string; // blank/undefined = keep existing key for this id
}

export async function PUT(req: NextRequest) {
  const user = await requireRole(req, ['super_admin']);
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
