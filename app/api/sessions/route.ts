import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, title, department, session_type, total_tokens, total_cost_usd, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la încărcarea istoricului.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string = (body.title || 'Conversație nouă').trim();
    const department: string | null = body.department || null;
    const sessionType: 'chat' | 'decision' = body.sessionType === 'decision' ? 'decision' : 'chat';
    const decisionState = body.decisionState ?? null;
    const addedTokens = Number(body.addedTokens || 0);
    const addedCostUsd = Number(body.addedCostUsd || 0);
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const { data: session, error: sessionErr } = await supabase
      .from('chat_sessions')
      .insert({
        title,
        department,
        session_type: sessionType,
        decision_state: decisionState,
        total_tokens: addedTokens,
        total_cost_usd: addedCostUsd,
      })
      .select('id, title, department, session_type, total_tokens, total_cost_usd, updated_at')
      .single();

    if (sessionErr || !session) {
      return NextResponse.json(
        { error: sessionErr?.message || 'Nu am putut crea sesiunea.' },
        { status: 500 }
      );
    }

    if (messages.length > 0) {
      const rows = messages.map((m: Record<string, unknown>) => ({
        session_id: session.id,
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

    return NextResponse.json({ session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la salvarea sesiunii.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}