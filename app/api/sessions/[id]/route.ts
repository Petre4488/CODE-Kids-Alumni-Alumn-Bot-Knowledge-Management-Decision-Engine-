import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [sessionRes, msgsRes] = await Promise.all([
      supabase.from('chat_sessions').select('*').eq('id', id).single(),
      supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true }),
    ]);

    if (sessionRes.error || !sessionRes.data) {
      return NextResponse.json({ error: 'Sesiunea nu a fost găsită.' }, { status: 404 });
    }

    return NextResponse.json({
      session: sessionRes.data,
      messages: msgsRes.data || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la citirea sesiunii.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const addedTokens = Number(body.addedTokens || 0);
    const addedCostUsd = Number(body.addedCostUsd || 0);
    const newTitle = typeof body.title === 'string' ? body.title.trim() : '';

    const updatePayload: Record<string, unknown> = {};

    if (newTitle) {
      updatePayload.title = newTitle;
    }

    if (messages.length > 0 || addedTokens > 0 || body.decisionState !== undefined) {
      const { data: current } = await supabase
        .from('chat_sessions')
        .select('total_tokens, total_cost_usd')
        .eq('id', id)
        .single();

      updatePayload.updated_at = new Date().toISOString();
      updatePayload.total_tokens = (current?.total_tokens || 0) + addedTokens;
      updatePayload.total_cost_usd = Number(current?.total_cost_usd || 0) + addedCostUsd;
    }

    if (messages.length > 0) {
      const rows = messages.map((m: Record<string, unknown>) => ({
        session_id: id,
        role: m.role,
        content: m.content,
        metadata: {
          noteProposal: m.noteProposal ?? null,
          questionAsked: m.questionAsked ?? null,
          usedWeb: m.usedWeb ?? false,
          sources: m.sources ?? [],
          notesUsed: m.notesUsed ?? [],
          webSources: m.webSources ?? [],
          modelInfo: m.modelInfo ?? null,
          usage: m.usage ?? null,
        },
      }));

      await supabase.from('chat_messages').insert(rows);
    }

    if (body.decisionState !== undefined) {
      updatePayload.decision_state = body.decisionState;
    }

    const { data: updated, error } = await supabase
      .from('chat_sessions')
      .update(updatePayload)
      .eq('id', id)
      .select('id, title, department, session_type, total_tokens, total_cost_usd, updated_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ session: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la actualizarea sesiunii.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { error } = await supabase.from('chat_sessions').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la ștergere.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}