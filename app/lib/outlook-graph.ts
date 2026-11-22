import { createClient } from '@supabase/supabase-js';
import { TaskItem } from './pmp-types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPES = 'openid profile email offline_access User.Read Calendars.ReadWrite';

export interface OutlookCalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  webLink?: string;
  onlineMeetingUrl?: string;
  attendees?: string[];
  isAppSyncedTask?: boolean;
}

export function getOutlookAuthUrl(): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID!;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI!;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    prompt: 'select_account',
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    scope: SCOPES,
  });

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Eroare OAuth Microsoft.');
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();

  await supabase.from('outlook_integration').upsert({
    id: 'default',
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function getValidOutlookToken(): Promise<string | null> {
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return null;
  }

  const { data: row } = await supabase
    .from('outlook_integration')
    .select('*')
    .eq('id', 'default')
    .single();

  if (!row || !row.access_token || !row.refresh_token) {
    return null;
  }

  const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresMs - Date.now() > 5 * 60 * 1000) {
    return row.access_token;
  }

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    scope: SCOPES,
  });

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const refreshed = await res.json();
  if (!res.ok || !refreshed.access_token) {
    return null;
  }

  const newExpiresAt = new Date(
    Date.now() + Number(refreshed.expires_in || 3600) * 1000
  ).toISOString();

  await supabase
    .from('outlook_integration')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || row.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'default');

  return refreshed.access_token;
}

export async function fetchOutlookEvents(
  startIso: string,
  endIso: string
): Promise<OutlookCalendarEvent[]> {
  const token = await getValidOutlookToken();
  if (!token) return [];

  const url = `${GRAPH_BASE}/me/calendarView?startDateTime=${encodeURIComponent(
    `${startIso}T00:00:00`
  )}&endDateTime=${encodeURIComponent(`${endIso}T23:59:59`)}&$top=100&$orderby=start/dateTime`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.timezone="Europe/Bucharest"',
    },
  });

  if (!res.ok) return [];
  const data = await res.json();
  const items = Array.isArray(data.value) ? data.value : [];

  return items.map((ev: Record<string, unknown>) => {
    const startObj = (ev.start as { dateTime?: string }) || {};
    const endObj = (ev.end as { dateTime?: string }) || {};
    const locObj = (ev.location as { displayName?: string }) || {};
    const onlineObj = (ev.onlineMeeting as { joinUrl?: string }) || {};
    const categories = Array.isArray(ev.categories) ? (ev.categories as string[]) : [];
    const attendeesRaw = Array.isArray(ev.attendees)
      ? (ev.attendees as { emailAddress?: { address?: string; name?: string } }[])
      : [];

    return {
      id: String(ev.id),
      subject: String(ev.subject || '(Fără titlu)'),
      start: String(startObj.dateTime || '').slice(0, 16),
      end: String(endObj.dateTime || '').slice(0, 16),
      isAllDay: Boolean(ev.isAllDay),
      location: locObj.displayName || undefined,
      webLink: ev.webLink ? String(ev.webLink) : undefined,
      onlineMeetingUrl: onlineObj.joinUrl || undefined,
      attendees: attendeesRaw
        .map((a) => a.emailAddress?.address || a.emailAddress?.name || '')
        .filter(Boolean),
      isAppSyncedTask: categories.includes('AlumniCommandCenter'),
    };
  });
}

export async function createOutlookMeeting(params: {
  subject: string;
  startDateTime: string;
  endDateTime: string;
  attendees: string[];
  description?: string;
  isOnlineMeeting?: boolean;
}) {
  const token = await getValidOutlookToken();
  if (!token) {
    throw new Error('Outlook Calendar nu este conectat. Apasă „Conectează Outlook” din bara de sus.');
  }

  const basePayload: Record<string, unknown> = {
    subject: params.subject,
    body: {
      contentType: 'Text',
      content: params.description || 'Ședință programată din Alumni Command Center.',
    },
    start: {
      dateTime: params.startDateTime.length === 16 ? `${params.startDateTime}:00` : params.startDateTime,
      timeZone: 'Europe/Bucharest',
    },
    end: {
      dateTime: params.endDateTime.length === 16 ? `${params.endDateTime}:00` : params.endDateTime,
      timeZone: 'Europe/Bucharest',
    },
    attendees: params.attendees.map((email) => ({
      emailAddress: { address: email.trim() },
      type: 'required',
    })),
    categories: ['AlumniCommandCenter'],
  };

  if (params.isOnlineMeeting !== false) {
    basePayload.isOnlineMeeting = true;
    basePayload.onlineMeetingProvider = 'teamsForBusiness';
  }

  let res = await fetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(basePayload),
  });

  if (!res.ok && basePayload.isOnlineMeeting) {
    delete basePayload.isOnlineMeeting;
    delete basePayload.onlineMeetingProvider;
    res = await fetch(`${GRAPH_BASE}/me/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(basePayload),
    });
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Eroare la crearea evenimentului în Outlook.');
  }

  return {
    id: data.id as string,
    webLink: data.webLink as string | undefined,
    joinUrl: data.onlineMeeting?.joinUrl as string | undefined,
  };
}

export async function syncTaskToOutlook(task: TaskItem): Promise<void> {
  try {
    const token = await getValidOutlookToken();
    if (!token) return;

    const targetDate = task.deadline || task.start_date;
    if (!targetDate) return;

    const prefix =
      task.type === 'milestone'
        ? task.is_milestone_approved
          ? '🟢 [Milestone] '
          : '🟡 [Milestone] '
        : task.status === 'done'
          ? '✅ '
          : '📌 ';

    const eventPayload = {
      subject: `${prefix}${task.title}`,
      body: {
        contentType: 'Text',
        content: `${task.description || ''}\n\nDepartament: ${task.department} | Status: ${task.status} | Efort: ${task.estimated_hours}h`,
      },
      start: {
        dateTime: `${targetDate}T09:00:00`,
        timeZone: 'Europe/Bucharest',
      },
      end: {
        dateTime: `${targetDate}T10:00:00`,
        timeZone: 'Europe/Bucharest',
      },
      categories: ['AlumniCommandCenter'],
    };

    if (task.outlook_event_id) {
      await fetch(`${GRAPH_BASE}/me/events/${task.outlook_event_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });
    } else {
      const createRes = await fetch(`${GRAPH_BASE}/me/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });
      if (createRes.ok) {
        const created = await createRes.json();
        if (created.id) {
          await supabase
            .from('tasks')
            .update({ outlook_event_id: created.id })
            .eq('id', task.id);
        }
      }
    }
  } catch (err) {
    console.error('syncTaskToOutlook error:', err);
  }
}

export async function deleteOutlookEvent(outlookEventId?: string | null): Promise<void> {
  if (!outlookEventId) return;
  try {
    const token = await getValidOutlookToken();
    if (!token) return;
    await fetch(`${GRAPH_BASE}/me/events/${outlookEventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Ignorăm dacă evenimentul a fost deja șters manual din Outlook
  }
}