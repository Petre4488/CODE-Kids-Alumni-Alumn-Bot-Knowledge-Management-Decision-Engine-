import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { fetchFullPmpDataset } from '../../lib/live-crm-context';
import { normalizeDepartment, TaskItem } from '../../lib/pmp-types';
import { deleteOutlookEvent, syncTaskToOutlook } from '../../lib/outlook-graph';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

function normKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickCol(row: Record<string, unknown>, patterns: string[]): string {
  const entries = Object.entries(row);
  for (const pattern of patterns) {
    const pNorm = normKey(pattern);
    const found = entries.find(([k]) => {
      const kNorm = normKey(k);
      return kNorm === pNorm || kNorm.startsWith(pNorm) || kNorm.includes(pNorm);
    });
    if (found && String(found[1] ?? '').trim() !== '') {
      return String(found[1]).trim();
    }
  }
  return '';
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith('7')) {
    return `0${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('407')) {
    return `0${digits.slice(2)}`;
  }
  return raw.trim();
}

function formatExcelDate(raw: string): string {
  if (!raw) return '';
  const num = Number(raw);
  if (Number.isFinite(num) && num > 20000 && num < 60000) {
    const utcDays = Math.floor(num - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  return raw.trim();
}

function mapPeopleRows(rows: Record<string, unknown>[]) {
  return rows
    .map((r) => {
      const name = pickCol(r, [
        'nume si prenume',
        'nume complet',
        'full_name',
        'nume',
        'name',
      ]);
      if (!name) return null;

      const email = pickCol(r, ['email address', 'email', 'e-mail']) || null;
      const rawPhone = pickCol(r, ['numar de telefon', 'telefon', 'phone']);
      const phone = normalizePhone(rawPhone);

      const rawAge = Number(pickCol(r, ['varsta ta', 'varsta', 'age']));
      const age = Number.isFinite(rawAge) && rawAge > 0 ? rawAge : null;

      const judet = pickCol(r, ['judetul din care', 'judet']);
      const localitate = pickCol(r, ['localitatea din care', 'localitate', 'oras']);
      let location: string | null = null;
      if (localitate && judet) {
        location =
          normKey(localitate) === normKey(judet) ? localitate : `${localitate}, ${judet}`;
      } else {
        location = localitate || judet || null;
      }

      const rawDept = pickCol(r, [
        'din ce departament',
        'departament',
        'department',
      ]);
      const department = normalizeDepartment(rawDept);

      const rawRole = pickCol(r, ['rol ierarhic', 'rol', 'role']);
      const role = rawRole || 'Membru Activ';

      const rawSkills = pickCol(r, ['skill-uri', 'skills', 'abilitati']);
      const skills = rawSkills
        ? rawSkills
            .split(/[,;|]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const rawExperience = pickCol(r, ['de cat timp esti alumn', 'experienta', 'vechime']);
      const experience =
        normKey(rawExperience) === 'nocive' ? 'Novice' : rawExperience;

      const birthDate = formatExcelDate(pickCol(r, ['data nasterii', 'birth']));
      const fullAddress = pickCol(r, ['adresa completa', 'adresa', 'address']);
      const extraObs = pickCol(r, ['observatii', 'notes', 'note']);

      const noteParts = [
        experience ? `Status: ${experience}` : null,
        birthDate ? `Data nașterii: ${birthDate}` : null,
        fullAddress ? `Adresă: ${fullAddress}` : null,
        extraObs || null,
      ].filter(Boolean);

      return {
        full_name: name,
        role,
        department,
        age,
        email,
        phone,
        location,
        skills,
        availability: pickCol(r, ['disponibilitate', 'availability']) || 'Disponibil',
        notes: noteParts.length > 0 ? noteParts.join(' | ') : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

async function upsertPeopleRecords(
  formatted: ReturnType<typeof mapPeopleRows>
): Promise<{ inserted: number; updated: number }> {
  const { data: existingData } = await supabase
    .from('people')
    .select('id, full_name, email, role');

  const existing = existingData || [];
  const byEmail = new Map<string, { id: string; role: string }>();
  const byName = new Map<string, { id: string; role: string }>();

  for (const p of existing) {
    if (p.email) byEmail.set(p.email.toLowerCase().trim(), { id: p.id, role: p.role });
    byName.set(normKey(p.full_name), { id: p.id, role: p.role });
  }

  const toInsert: typeof formatted = [];
  let updated = 0;

  for (const row of formatted) {
    const match =
      (row.email ? byEmail.get(row.email.toLowerCase().trim()) : undefined) ||
      byName.get(normKey(row.full_name));

    if (match) {
      const preservedRole =
        match.role && match.role !== 'Membru Activ' ? match.role : row.role;

      await supabase
        .from('people')
        .update({
          full_name: row.full_name,
          role: preservedRole,
          department: row.department,
          age: row.age,
          email: row.email,
          phone: row.phone,
          location: row.location,
          notes: row.notes,
        })
        .eq('id', match.id);
      updated++;
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('people').insert(toInsert);
    if (error) throw new Error(error.message);
  }

  return { inserted: toInsert.length, updated };
}

async function recalculateProjectProgress(projectId: string | null | undefined) {
  if (!projectId) return;

  const { data: projTasks } = await supabase
    .from('tasks')
    .select(
      'id, parent_task_id, type, status, is_milestone_approved, start_date, deadline'
    )
    .eq('project_id', projectId);

  const all = projTasks || [];
  const rootItems = all.filter((t) => !t.parent_task_id);

  if (rootItems.length === 0) {
    await supabase
      .from('projects')
      .update({ progress: 0, updated_at: new Date().toISOString() })
      .eq('id', projectId);
    return;
  }

  let totalWeight = 0;
  let completedWeight = 0;
  let latestDeadline: string | null = null;

  for (const item of rootItems) {
    if (item.deadline && (!latestDeadline || item.deadline > latestDeadline)) {
      latestDeadline = item.deadline;
    }

    let weight = 1;
    if (item.start_date && item.deadline && item.deadline >= item.start_date) {
      const [y1, m1, d1] = item.start_date.split('-').map(Number);
      const [y2, m2, d2] = item.deadline.split('-').map(Number);
      const days =
        Math.round(
          (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000
        ) + 1;
      weight = Math.max(1, days);
    }

    totalWeight += weight;

    const isDone =
      item.status === 'done' ||
      (item.type === 'milestone' && Boolean(item.is_milestone_approved));

    if (isDone) {
      completedWeight += weight;
    } else {
      const subs = all.filter((s) => s.parent_task_id === item.id);
      if (subs.length > 0) {
        const doneSubs = subs.filter((s) => s.status === 'done').length;
        completedWeight += weight * (doneSubs / subs.length);
      }
    }
  }

  const computedProgress = Math.min(
    100,
    Math.max(0, Math.round((completedWeight / totalWeight) * 100))
  );

  const projectUpdates: Record<string, unknown> = {
    progress: computedProgress,
    updated_at: new Date().toISOString(),
  };

  const { data: currentProj } = await supabase
    .from('projects')
    .select('deadline')
    .eq('id', projectId)
    .single();

  if (currentProj && !currentProj.deadline && latestDeadline) {
    projectUpdates.deadline = latestDeadline;
  }

  await supabase.from('projects').update(projectUpdates).eq('id', projectId);
}

export async function GET() {
  try {
    const dataset = await fetchFullPmpDataset();
    return NextResponse.json(dataset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la încărcarea datelor PMP.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action: string = body.action;

    // 1A. IMPORT DIRECT DIN LINK GOOGLE SHEETS
    if (action === 'import_google_sheet') {
      const sheetUrl: string = String(body.sheetUrl || '').trim();
      const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!idMatch) {
        return NextResponse.json(
          { error: 'Link Google Sheets invalid. Copiază URL-ul complet din browser.' },
          { status: 400 }
        );
      }

      const gidMatch = sheetUrl.match(/[#&?]gid=([0-9]+)/);
      const exportUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv${
        gidMatch ? `&gid=${gidMatch[1]}` : ''
      }`;

      const csvRes = await fetch(exportUrl);
      if (!csvRes.ok) {
        return NextResponse.json(
          {
            error:
              'Nu pot accesa Google Sheet-ul. Setează Share -> Anyone with the link (Viewer) sau descarcă-l ca .xlsx.',
          },
          { status: 400 }
        );
      }

      const csvText = await csvRes.text();
      if (csvText.trim().startsWith('<!DOCTYPE html')) {
        return NextResponse.json(
          {
            error:
              'Sheet-ul este privat. Dă Share -> Anyone with the link (Viewer) sau încarcă fișierul .xlsx/.csv.',
          },
          { status: 400 }
        );
      }

      const wb = XLSX.read(csvText, { type: 'string' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets[wb.SheetNames[0]],
        { defval: '' }
      );

      const formatted = mapPeopleRows(rows);
      if (formatted.length === 0) {
        return NextResponse.json(
          { error: 'Nu am găsit coloana „Nume și prenume” în Google Sheet.' },
          { status: 400 }
        );
      }

      const { inserted, updated } = await upsertPeopleRecords(formatted);
      return NextResponse.json({
        ok: true,
        importedCount: inserted + updated,
        inserted,
        updated,
      });
    }

    // 1B. IMPORT EXCEL / CSV ÎN CRM
    if (action === 'import_excel') {
      const targetTable: string = body.targetTable || 'people';
      const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];

      if (rows.length === 0) {
        return NextResponse.json(
          { error: 'Fișierul Excel nu conține rânduri valide.' },
          { status: 400 }
        );
      }

      if (targetTable === 'people') {
        const formatted = mapPeopleRows(rows);
        if (formatted.length === 0) {
          return NextResponse.json(
            { error: 'Nu am găsit coloana „Nume și prenume” / „Nume” în fișier.' },
            { status: 400 }
          );
        }
        const { inserted, updated } = await upsertPeopleRecords(formatted);
        return NextResponse.json({
          ok: true,
          importedCount: inserted + updated,
          inserted,
          updated,
        });
      }

      if (targetTable === 'resources') {
        const formatted = rows
          .map((r) => {
            const title = pickCol(r, ['titlu', 'title', 'nume']);
            if (!title) return null;
            return {
              title,
              type: pickCol(r, ['tip', 'type']) || 'Document',
              url_or_ref: pickCol(r, ['link', 'url', 'referinta']) || null,
              department: normalizeDepartment(pickCol(r, ['departament', 'department'])),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        if (formatted.length === 0) {
          return NextResponse.json({ error: 'Nu am găsit rânduri valide.' }, { status: 400 });
        }
        const { error } = await supabase.from('resources').insert(formatted);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, importedCount: formatted.length });
      }

      if (targetTable === 'events') {
        const formatted = rows
          .map((r) => {
            const name = pickCol(r, ['nume eveniment', 'nume', 'name']);
            if (!name) return null;
            return {
              name,
              start_date: pickCol(r, ['data', 'start_date']) || null,
              location: pickCol(r, ['locatie', 'location']) || null,
              status: pickCol(r, ['status']) || 'Planificat',
              department: normalizeDepartment(pickCol(r, ['departament', 'department'])),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        if (formatted.length === 0) {
          return NextResponse.json({ error: 'Nu am găsit rânduri valide.' }, { status: 400 });
        }
        const { error } = await supabase.from('events').insert(formatted);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, importedCount: formatted.length });
      }

      if (targetTable === 'partners') {
        const formatted = rows
          .map((r) => {
            const name = pickCol(r, ['nume partener', 'nume', 'name']);
            if (!name) return null;
            return {
              name,
              contact_person: pickCol(r, ['persoana contact', 'contact_person']) || null,
              contact_info: pickCol(r, ['email', 'telefon', 'contact_info']) || null,
              status: pickCol(r, ['status']) || 'Activ',
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        if (formatted.length === 0) {
          return NextResponse.json({ error: 'Nu am găsit rânduri valide.' }, { status: 400 });
        }
        const { error } = await supabase.from('partners').insert(formatted);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, importedCount: formatted.length });
      }
    }

    // 1C. ACTUALIZARE ROL IERARHIC & ASIGURARE PERSOANĂ CORE (PETRE / VLAD)
    if (action === 'update_person_role') {
      const { error } = await supabase
        .from('people')
        .update({ role: String(body.role || 'Membru Activ') })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

if (action === 'ensure_core_person') {
      const targetName = String(body.full_name || '').trim();
      const targetRole = String(body.role || 'Manager').trim();
      const isPetreTarget = normKey(targetName).includes('petre');
      const isVladTarget = normKey(targetName).includes('vlad');

      const { data: allPeople } = await supabase.from('people').select('*');
      const list = allPeople || [];

      const matched = list.find((p) => {
        const n = normKey(p.full_name);
        if (isPetreTarget) {
          return (
            (n.includes('circeag') && n.includes('petre')) ||
            (n.includes('petre') && (p.role === 'Manager' || p.department === 'Board'))
          );
        }
        if (isVladTarget) {
          return (
            (n.includes('brinzan') && n.includes('vlad')) ||
            (n.includes('vlad') && (p.role === 'Monitorizare' || p.department === 'Board'))
          );
        }
        return n === normKey(targetName);
      });

      if (matched) {
        return NextResponse.json({ ok: true, person: matched });
      }

      const { data: created, error } = await supabase
        .from('people')
        .insert({
          full_name: targetName,
          role: targetRole,
          department: 'Board',
          availability: 'Disponibil',
        })
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, person: created });
    }

    // 2. CREARE / ACTUALIZARE / ȘTERGERE PROIECT
    if (action === 'create_project') {
      const { error } = await supabase.from('projects').insert({
        title: String(body.title || '').trim(),
        description: body.description || null,
        department: normalizeDepartment(body.department),
        owner_id: body.owner_id || null,
        status: body.status || 'active',
        progress: Number(body.progress || 0),
        is_core_team: Boolean(body.is_core_team),
        needs_pm_sync: Boolean(body.needs_pm_sync),
        blocked_by_project_id: body.blocked_by_project_id || null,
        start_date: body.start_date || null,
        deadline: body.deadline || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_project') {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (body.title !== undefined) updates.title = String(body.title).trim();
      if (body.description !== undefined) updates.description = body.description || null;
      if (body.department !== undefined) updates.department = normalizeDepartment(body.department);
      if (body.owner_id !== undefined) updates.owner_id = body.owner_id || null;
      if (body.status !== undefined) updates.status = body.status;
      if (body.is_core_team !== undefined) updates.is_core_team = Boolean(body.is_core_team);
      if (body.needs_pm_sync !== undefined) updates.needs_pm_sync = Boolean(body.needs_pm_sync);
      if (body.blocked_by_project_id !== undefined) {
        updates.blocked_by_project_id = body.blocked_by_project_id || null;
      }
      if (body.progress !== undefined) {
        updates.progress = Math.min(100, Math.max(0, Number(body.progress)));
      }
      if (body.start_date !== undefined) updates.start_date = body.start_date || null;
      if (body.deadline !== undefined) updates.deadline = body.deadline || null;

      const { error } = await supabase.from('projects').update(updates).eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_project') {
      const { error } = await supabase.from('projects').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // 2B. PROMOVARE TASK FĂRĂ PROIECT LA PROIECT COMPLET
    if (action === 'promote_task_to_project') {
      const { data: task, error: fetchErr } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', body.id)
        .single();

      if (fetchErr || !task) {
        return NextResponse.json({ error: 'Task negăsit.' }, { status: 404 });
      }

      const { data: newProj, error: projErr } = await supabase
        .from('projects')
        .insert({
          title: task.title,
          description: task.description || null,
          department: normalizeDepartment(task.department),
          owner_id: task.assignee_id || null,
          status: task.status === 'done' ? 'completed' : 'active',
          progress: task.status === 'done' ? 100 : 0,
          is_core_team: Boolean(task.is_my_task),
          needs_pm_sync: Boolean(task.needs_pm_sync),
          start_date: task.start_date || null,
          deadline: task.deadline || null,
        })
        .select('*')
        .single();

      if (projErr || !newProj) {
        return NextResponse.json(
          { error: projErr?.message || 'Eroare la crearea proiectului.' },
          { status: 500 }
        );
      }

      await supabase
        .from('tasks')
        .update({ project_id: newProj.id })
        .eq('id', task.id);

      await supabase
        .from('tasks')
        .update({ project_id: newProj.id, parent_task_id: null })
        .eq('parent_task_id', task.id);

      await recalculateProjectProgress(newProj.id);
      return NextResponse.json({ ok: true, project: newProj });
    }

    // 2C. EXECUTARE PLAN APROBAT DIN ALUMN-BOT (PROIECT NOU/EXISTENT + TASK-URI)
    if (action === 'execute_ai_plan') {
      const projectSpec = body.project || null;
      const proposedTasks: Record<string, unknown>[] = Array.isArray(body.tasks)
        ? body.tasks
        : [];

      let targetProjectId: string | null = null;
      let createdProjectTitle: string | null = null;

      if (projectSpec?.mode === 'new' && String(projectSpec.title || '').trim()) {
        const { data: createdProj, error: pErr } = await supabase
          .from('projects')
          .insert({
            title: String(projectSpec.title).trim(),
            description: projectSpec.description ? String(projectSpec.description).trim() : null,
            department: normalizeDepartment(String(projectSpec.department || 'Board')),
            owner_id: projectSpec.owner_id || null,
            status: 'active',
            progress: 0,
            is_core_team: Boolean(projectSpec.is_core_team),
            needs_pm_sync: Boolean(projectSpec.needs_pm_sync),
            start_date: projectSpec.start_date || null,
            deadline: projectSpec.deadline || null,
          })
          .select('*')
          .single();

        if (pErr || !createdProj) {
          return NextResponse.json(
            { error: pErr?.message || 'Nu am putut crea proiectul propus.' },
            { status: 500 }
          );
        }
        targetProjectId = createdProj.id;
        createdProjectTitle = createdProj.title;
      } else if (projectSpec?.mode === 'existing' && projectSpec.existing_project_id) {
        targetProjectId = String(projectSpec.existing_project_id);
      }

      let createdTasksCount = 0;
      const touchedProjectIds = new Set<string>();
      if (targetProjectId) touchedProjectIds.add(targetProjectId);

      for (const item of proposedTasks) {
        const tTitle = String(item.title || '').trim();
        if (!tTitle) continue;

        const itemProjId =
          item.project_id !== undefined
            ? (item.project_id as string | null)
            : targetProjectId;

        if (itemProjId) touchedProjectIds.add(itemProjId);

        const { data: createdTask, error: tErr } = await supabase
          .from('tasks')
          .insert({
            project_id: itemProjId || null,
            parent_task_id: null,
            title: tTitle,
            description: item.description ? String(item.description).trim() : null,
            type: item.type === 'milestone' ? 'milestone' : 'task',
            status: 'todo',
            priority: ['low', 'medium', 'high', 'urgent'].includes(String(item.priority))
              ? String(item.priority)
              : 'medium',
            estimated_hours: Math.max(0.5, Number(item.estimated_hours ?? 2)),
            blocked_by_id: null,
            is_my_task: Boolean(item.is_my_task),
            needs_pm_sync: Boolean(item.needs_pm_sync),
            assignee_id: item.assignee_id || null,
            department: normalizeDepartment(
              String(item.department || projectSpec?.department || 'Board')
            ),
            start_date: item.start_date || null,
            deadline: item.deadline || null,
          })
          .select('*')
          .single();

        if (!tErr && createdTask) {
          createdTasksCount++;
          await syncTaskToOutlook(createdTask as TaskItem);
        }
      }

      for (const pid of touchedProjectIds) {
        await recalculateProjectProgress(pid);
      }

      return NextResponse.json({
        ok: true,
        projectId: targetProjectId,
        createdProjectTitle,
        createdTasksCount,
      });
    }

    // 2D. ACȚIUNI ÎN MASĂ (BATCH) DIN TAB-UL TASK-URI
    if (action === 'batch_update_tasks') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      const operation: string = String(body.operation || '');
      if (ids.length === 0) {
        return NextResponse.json({ error: 'Niciun task selectat.' }, { status: 400 });
      }

      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .in('id', ids);
      const list = (existingTasks as TaskItem[]) || [];
      const affectedProjectIds = new Set<string>(
        list.map((t) => t.project_id).filter((id): id is string => Boolean(id))
      );

      if (operation === 'done') {
        await supabase
          .from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .in('id', ids);
      } else if (operation === 'today' || operation === 'tomorrow') {
        const offset = operation === 'tomorrow' ? 86400000 : 0;
        const targetDate = new Date(Date.now() + offset).toISOString().slice(0, 10);
        await supabase
          .from('tasks')
          .update({ start_date: targetDate, deadline: targetDate })
          .in('id', ids);
      } else if (operation === 'pm_sync') {
        await supabase.from('tasks').update({ needs_pm_sync: true }).in('id', ids);
      } else if (operation === 'delete') {
        for (const t of list) {
          await deleteOutlookEvent(t.outlook_event_id);
        }
        await supabase.from('tasks').delete().in('id', ids);
      } else if (operation === 'group_project') {
        const projTitle = String(body.projectTitle || 'Proiect Nou').trim();
        const dept = normalizeDepartment(body.department || list[0]?.department || 'Board');
        const { data: newProj, error: pErr } = await supabase
          .from('projects')
          .insert({
            title: projTitle,
            department: dept,
            status: 'active',
            progress: 0,
            is_core_team: Boolean(body.is_core_team),
            start_date: new Date().toISOString().slice(0, 10),
          })
          .select('*')
          .single();

        if (pErr || !newProj) {
          return NextResponse.json(
            { error: pErr?.message || 'Eroare la crearea proiectului.' },
            { status: 500 }
          );
        }
        await supabase.from('tasks').update({ project_id: newProj.id }).in('id', ids);
        affectedProjectIds.add(newProj.id);
      }

      for (const pid of affectedProjectIds) {
        await recalculateProjectProgress(pid);
      }

      return NextResponse.json({ ok: true });
    }

    // 3. CREARE / ACTUALIZARE / ȘTERGERE TASK & SUBTASK & MILESTONE
    if (action === 'create_task') {
      const { data: created, error } = await supabase
        .from('tasks')
        .insert({
          project_id: body.project_id || null,
          parent_task_id: body.parent_task_id || null,
          title: String(body.title || '').trim(),
          description: body.description || null,
          type: body.type === 'milestone' ? 'milestone' : 'task',
          status: body.status || 'todo',
          priority: body.priority || 'medium',
          estimated_hours: Number(body.estimated_hours ?? 2),
          blocked_by_id: body.blocked_by_id || null,
          is_my_task: Boolean(body.is_my_task),
          needs_pm_sync: Boolean(body.needs_pm_sync),
          assignee_id: body.assignee_id || null,
          department: normalizeDepartment(body.department),
          start_date: body.start_date || null,
          deadline: body.deadline || null,
        })
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (created) {
        await syncTaskToOutlook(created as TaskItem);
        await recalculateProjectProgress(created.project_id);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_task') {
      const { data: before } = await supabase
        .from('tasks')
        .select('project_id')
        .eq('id', body.id)
        .single();

      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = String(body.title).trim();
      if (body.description !== undefined) updates.description = body.description || null;
      if (body.project_id !== undefined) updates.project_id = body.project_id || null;
      if (body.parent_task_id !== undefined) updates.parent_task_id = body.parent_task_id || null;
      if (body.type !== undefined) updates.type = body.type === 'milestone' ? 'milestone' : 'task';
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.estimated_hours !== undefined) {
        updates.estimated_hours = Math.max(0.5, Number(body.estimated_hours));
      }
      if (body.blocked_by_id !== undefined) updates.blocked_by_id = body.blocked_by_id || null;
      if (body.status !== undefined) {
        updates.status = body.status;
        updates.completed_at = body.status === 'done' ? new Date().toISOString() : null;
      }
      if (body.assignee_id !== undefined) updates.assignee_id = body.assignee_id || null;
      if (body.department !== undefined) updates.department = normalizeDepartment(body.department);
      if (body.start_date !== undefined) updates.start_date = body.start_date || null;
      if (body.deadline !== undefined) updates.deadline = body.deadline || null;
      if (body.is_my_task !== undefined) updates.is_my_task = Boolean(body.is_my_task);
      if (body.needs_pm_sync !== undefined) updates.needs_pm_sync = Boolean(body.needs_pm_sync);

      const { data: updated, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', body.id)
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (updated) {
        await syncTaskToOutlook(updated as TaskItem);
        await recalculateProjectProgress(updated.project_id);
        if (before?.project_id && before.project_id !== updated.project_id) {
          await recalculateProjectProgress(before.project_id);
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_task') {
      const { data: existing } = await supabase
        .from('tasks')
        .select('project_id, outlook_event_id')
        .eq('id', body.id)
        .single();

      const { error } = await supabase.from('tasks').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await deleteOutlookEvent(existing?.outlook_event_id);
      await recalculateProjectProgress(existing?.project_id);
      return NextResponse.json({ ok: true });
    }

    // 4. BIFARE RAPIDĂ TASK / APROBARE MILESTONE
    if (action === 'toggle_task_done') {
      const done = Boolean(body.done);
      const { data: updated, error } = await supabase
        .from('tasks')
        .update({
          status: done ? 'done' : 'todo',
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq('id', body.id)
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (updated) {
        await syncTaskToOutlook(updated as TaskItem);
        await recalculateProjectProgress(updated.project_id);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'approve_milestone') {
      const approved = Boolean(body.approved);
      const { data: updated, error } = await supabase
        .from('tasks')
        .update({
          is_milestone_approved: approved,
          status: approved ? 'done' : 'waiting_review',
          completed_at: approved ? new Date().toISOString() : null,
        })
        .eq('id', body.id)
        .select('*')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (updated) {
        await syncTaskToOutlook(updated as TaskItem);
        await recalculateProjectProgress(updated.project_id);
      }
      return NextResponse.json({ ok: true });
    }

    // 5. NOTIȚE PER PROIECT & NOTIȚE GENERALE
    if (action === 'create_project_note') {
      const { error } = await supabase.from('project_notes').insert({
        project_id: body.project_id,
        content: String(body.content || '').trim(),
        is_ai_memory: Boolean(body.is_ai_memory),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', body.project_id);

      return NextResponse.json({ ok: true });
    }

    if (action === 'update_project_note') {
      const updates: Record<string, unknown> = {
        content: String(body.content || '').trim(),
      };
      if (body.project_id !== undefined) updates.project_id = body.project_id;
      const { error } = await supabase
        .from('project_notes')
        .update(updates)
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_project_note') {
      const { error } = await supabase.from('project_notes').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_general_note') {
      const { error } = await supabase.from('general_notes').insert({
        title: String(body.title || 'Notiță').trim(),
        category: String(body.category || 'Ședință').trim(),
        tags: Array.isArray(body.tags) ? body.tags : [],
        content: String(body.content || '').trim(),
        is_ai_memory: Boolean(body.is_ai_memory),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_general_note') {
      const { error } = await supabase
        .from('general_notes')
        .update({
          title: String(body.title || 'Notiță').trim(),
          category: String(body.category || 'Ședință').trim(),
          content: String(body.content || '').trim(),
        })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_general_note') {
      const { error } = await supabase.from('general_notes').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'toggle_note_ai_memory') {
      const table = body.noteType === 'project' ? 'project_notes' : 'general_notes';
      const { error } = await supabase
        .from(table)
        .update({ is_ai_memory: Boolean(body.is_ai_memory) })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // 6. POST-IT NOTES
    if (action === 'create_post_it') {
      const { error } = await supabase.from('post_it_notes').insert({
        content: String(body.content || '').trim(),
        color: body.color || 'amber',
        is_pinned: true,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_post_it') {
      const updates: Record<string, unknown> = {
        content: String(body.content || '').trim(),
      };
      if (body.color) updates.color = body.color;
      const { error } = await supabase
        .from('post_it_notes')
        .update(updates)
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_post_it') {
      const { error } = await supabase.from('post_it_notes').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // 7. RESURSE / EVENIMENTE / PARTENERI LEGATE DE PROIECTE
    if (action === 'create_resource') {
      const { error } = await supabase.from('resources').insert({
        title: String(body.title || '').trim(),
        type: String(body.type || 'Document').trim(),
        url_or_ref: String(body.url_or_ref || '').trim() || null,
        department: normalizeDepartment(body.department),
        project_id: body.project_id || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_event') {
      const { error } = await supabase.from('events').insert({
        name: String(body.name || '').trim(),
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        location: String(body.location || '').trim() || null,
        status: String(body.status || 'Planificat').trim(),
        department: normalizeDepartment(body.department),
        project_id: body.project_id || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_partner') {
      const { error } = await supabase.from('partners').insert({
        name: String(body.name || '').trim(),
        contact_person: String(body.contact_person || '').trim() || null,
        contact_info: String(body.contact_info || '').trim() || null,
        status: String(body.status || 'Activ').trim(),
        project_id: body.project_id || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acțiune necunoscută.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare internă PMP.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}