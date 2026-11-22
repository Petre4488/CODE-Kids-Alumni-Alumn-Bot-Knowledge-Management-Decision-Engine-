import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createOutlookMeeting,
  fetchOutlookEvents,
  getValidOutlookToken,
  syncTaskToOutlook,
} from '../../../lib/outlook-graph';
import { TaskItem } from '../../../lib/pmp-types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const token = await getValidOutlookToken();
    if (!token) {
      return NextResponse.json({ connected: false, events: [] });
    }

    const now = new Date();
    const defaultStart = new Date(now.getTime() - 15 * 86400000).toISOString().slice(0, 10);
    const defaultEnd = new Date(now.getTime() + 45 * 86400000).toISOString().slice(0, 10);

    const start = req.nextUrl.searchParams.get('start') || defaultStart;
    const end = req.nextUrl.searchParams.get('end') || defaultEnd;

    const events = await fetchOutlookEvents(start, end);
    return NextResponse.json({ connected: true, events });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Eroare citire Outlook.';
    return NextResponse.json({ connected: false, events: [], error: msg });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'sync_all_tasks') {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .neq('status', 'done');

      const list = (tasks as TaskItem[]) || [];
      let synced = 0;
      for (const t of list) {
        if (t.deadline || t.start_date) {
          await syncTaskToOutlook(t);
          synced++;
        }
      }
      return NextResponse.json({ ok: true, synced });
    }

    const created = await createOutlookMeeting({
      subject: String(body.subject || 'Meet Alumni CODE Kids'),
      startDateTime: String(body.start),
      endDateTime: String(body.end),
      attendees: Array.isArray(body.attendees) ? body.attendees : [],
      description: body.description ? String(body.description) : undefined,
      isOnlineMeeting: body.isOnlineMeeting !== false,
    });

    return NextResponse.json({ ok: true, event: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Eroare la programarea meet-ului.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  await supabase.from('outlook_integration').delete().eq('id', 'default');
  return NextResponse.json({ ok: true });
}