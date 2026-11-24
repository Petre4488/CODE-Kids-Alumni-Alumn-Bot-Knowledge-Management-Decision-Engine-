import { createClient } from '@supabase/supabase-js';
import {
  AppNotification,
  EventItem,
  GeneralNote,
  PartnerItem,
  Person,
  PostItNote,
  Project,
  ProjectNote,
  ResourceItem,
  TaskItem,
} from './pmp-types';
import { fetchOutlookEvents } from './outlook-graph';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export interface FullPmpDataset {
  people: Person[];
  projects: Project[];
  tasks: TaskItem[];
  resources: ResourceItem[];
  events: EventItem[];
  partners: PartnerItem[];
  projectNotes: ProjectNote[];
  generalNotes: GeneralNote[];
  postItNotes: PostItNote[];
  notifications: AppNotification[];
}

export function computeNotifications(
  projects: Project[],
  tasks: TaskItem[]
): AppNotification[] {
  const alerts: AppNotification[] = [];
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fourDaysAgo = now.getTime() - 4 * 24 * 60 * 60 * 1000;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  for (const t of tasks) {
    if (t.status === 'done' && (t.type !== 'milestone' || t.is_milestone_approved)) continue;
    if (!t.deadline) continue;

    const projName = t.project_id ? projectMap.get(t.project_id)?.title : 'Task individual';

    if (t.deadline < todayStr) {
      alerts.push({
        id: `overdue-${t.id}`,
        kind: 'overdue',
        title: `Întârziat: ${t.title}`,
        detail: `Termen depășit (${t.deadline}) · ${projName}`,
        department: t.department,
      });
    } else if (t.deadline <= in48h) {
      alerts.push({
        id: `duesoon-${t.id}`,
        kind: 'due_soon',
        title: `Deadline <48h: ${t.title}`,
        detail: `Expiră pe ${t.deadline} · ${projName}`,
        department: t.department,
      });
    }
  }

  for (const m of tasks.filter((t) => t.type === 'milestone' && !t.is_milestone_approved)) {
    if (!m.project_id) continue;
    const siblingTasks = tasks.filter(
      (t) => t.project_id === m.project_id && t.type === 'task' && !t.parent_task_id
    );
    const allPrereqsDone =
      siblingTasks.length > 0 && siblingTasks.every((t) => t.status === 'done');

    if (allPrereqsDone || m.status === 'waiting_review') {
      const proj = projectMap.get(m.project_id);
      alerts.push({
        id: `ms-${m.id}`,
        kind: 'milestone_ready',
        title: `Milestone gata de aprobare: ${m.title}`,
        detail: `Toate task-urile premergătoare sunt gata în „${proj?.title || 'Proiect'}”.`,
        department: m.department,
      });
    }
  }

  for (const p of projects.filter((pr) => pr.status === 'active')) {
    if (new Date(p.updated_at).getTime() < fourDaysAgo) {
      alerts.push({
        id: `stale-${p.id}`,
        kind: 'stale_project',
        title: `Fără update recent: ${p.title}`,
        detail: `Ultima actualizare: ${new Date(p.updated_at).toLocaleDateString('ro-RO')} (${p.progress}%)`,
        department: p.department,
      });
    }
  }

  return alerts;
}

export async function fetchFullPmpDataset(): Promise<FullPmpDataset> {
  const [
    peopleRes,
    projectsRes,
    tasksRes,
    resourcesRes,
    eventsRes,
    partnersRes,
    pNotesRes,
    gNotesRes,
    postItRes,
  ] = await Promise.all([
    supabase.from('people').select('*').order('full_name', { ascending: true }),
    supabase.from('projects').select('*').order('deadline', { ascending: true }),
    supabase.from('tasks').select('*').order('deadline', { ascending: true }),
    supabase.from('resources').select('*').order('created_at', { ascending: false }),
    supabase.from('events').select('*').order('start_date', { ascending: true }),
    supabase.from('partners').select('*').order('name', { ascending: true }),
    supabase.from('project_notes').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('general_notes').select('*').order('created_at', { ascending: false }).limit(40),
    supabase.from('post_it_notes').select('*').order('created_at', { ascending: false }).limit(30),
  ]);

  const people = (peopleRes.data as Person[]) || [];
  const projects = (projectsRes.data as Project[]) || [];
  const tasks = (tasksRes.data as TaskItem[]) || [];
  const resources = (resourcesRes.data as ResourceItem[]) || [];
  const events = (eventsRes.data as EventItem[]) || [];
  const partners = (partnersRes.data as PartnerItem[]) || [];
  const projectNotes = (pNotesRes.data as ProjectNote[]) || [];
  const generalNotes = (gNotesRes.data as GeneralNote[]) || [];
  const postItNotes = (postItRes.data as PostItNote[]) || [];

  const notifications = computeNotifications(projects, tasks);

  return {
    people,
    projects,
    tasks,
    resources,
    events,
    partners,
    projectNotes,
    generalNotes,
    postItNotes,
    notifications,
  };
}

export async function buildLiveCrmContext(filterDepartment?: string | null): Promise<string> {
  try {
    const data = await fetchFullPmpDataset();
    const {
      people,
      projects,
      tasks,
      resources,
      events,
      partners,
      projectNotes,
      generalNotes,
      postItNotes,
      notifications,
    } = data;

    const totalItems =
      people.length +
      projects.length +
      tasks.length +
      resources.length +
      events.length +
      partners.length;

    if (totalItems === 0) {
      return '\n\n=== LIVE CRM & PMP DATABASE ===\nBaza de date CRM/PMP este momentan goală.';
    }

    const personMap = new Map(people.map((p) => [p.id, p.full_name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.title]));
    const taskMap = new Map(tasks.map((t) => [t.id, t.title]));
    const todayStr = new Date().toISOString().slice(0, 10);

    const filteredPeople = filterDepartment
      ? people.filter((p) => p.department === filterDepartment || p.department === 'Board')
      : people;

    const peopleBlock = filteredPeople.length
      ? filteredPeople
          .map(
            (p) =>
              `- ${p.full_name} | Rol: ${p.role} | Dept: ${p.department}${
                p.age ? ` | Vârstă: ${p.age}` : ''
              }${p.location ? ` | Locație: ${p.location}` : ''}${
                p.skills?.length ? ` | Skills: ${p.skills.join(', ')}` : ''
              }${p.email || p.phone ? ` | Contact: ${[p.email, p.phone].filter(Boolean).join(' / ')}` : ''}${
                p.notes ? ` | Note: ${p.notes}` : ''
              }`
          )
          .join('\n')
      : 'Nicio persoană înregistrată.';

    const filteredProjects = filterDepartment
      ? projects.filter((p) => p.department === filterDepartment)
      : projects;

    const projectsBlock = filteredProjects.length
      ? filteredProjects
          .map((p) => {
            const owner = p.owner_id ? personMap.get(p.owner_id) || 'Nealocat' : 'Nealocat';
            const coreTag = p.is_core_team ? '[CORE TEAM - PETRE] ' : '[ALUMNI DEPT] ';
            const pNotes = projectNotes
              .filter((n) => n.project_id === p.id)
              .slice(0, 2)
              .map((n) => `[${n.created_at.slice(0, 10)}] ${n.content}`)
              .join(' ; ');
            return `- ${coreTag}[${p.department}] ${p.title} | Status: ${p.status} | Progres: ${p.progress}% | Coordonator: ${owner} | Perioadă: ${p.start_date || '?'} -> ${p.deadline || '?'}${
              pNotes ? ` | Ultimele update-uri: ${pNotes}` : ''
            }`;
          })
          .join('\n')
      : 'Niciun proiect activ.';

    const filteredTasks = filterDepartment
      ? tasks.filter((t) => t.department === filterDepartment)
      : tasks;

    const tasksBlock = filteredTasks.length
      ? filteredTasks
          .map((t) => {
            const assignee = t.assignee_id ? personMap.get(t.assignee_id) || 'Nealocat' : 'Nealocat';
            const proj = t.project_id ? projectMap.get(t.project_id) || 'Proiect' : 'Task Personal';
            const parentInfo = t.parent_task_id
              ? ` | Subtask la: ${taskMap.get(t.parent_task_id) || 'Task'}`
              : '';
            const milestoneTag =
              t.type === 'milestone'
                ? t.is_milestone_approved
                  ? ' [MILESTONE APROBAT - VERDE]'
                  : ' [MILESTONE NEAPROBAT - GALBEN]'
                : '';
            return `- (${t.status.toUpperCase()} · ${t.priority.toUpperCase()} · ${t.estimated_hours}h)${milestoneTag} ${t.title} | Dept: ${t.department} | Proiect: ${proj}${parentInfo} | Responsabil: ${assignee} | Termen: ${t.start_date || '?'} -> ${t.deadline || 'Nesetat'}`;
          })
          .join('\n')
      : 'Niciun task înregistrat.';

    const alertsBlock = notifications.length
      ? notifications.map((a) => `- [${a.kind.toUpperCase()}] ${a.title}: ${a.detail}`).join('\n')
      : 'Nicio alertă critică în acest moment.';

    const aiGeneralNotes = generalNotes.filter((n) => n.is_ai_memory);
    const notesBlock = aiGeneralNotes.length
      ? aiGeneralNotes.map((n) => `- [${n.category}] ${n.title}: ${n.content}`).join('\n')
      : '';

    const postItsBlock = postItNotes.length
      ? postItNotes.map((pi) => `- ${pi.content}`).join('\n')
      : '';

    const in14DaysStr = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const outlookEvents = await fetchOutlookEvents(todayStr, in14DaysStr);
    const nonTaskOutlook = outlookEvents.filter((e) => !e.isAppSyncedTask);

    const outlookBlock = nonTaskOutlook.length
      ? nonTaskOutlook
          .map(
            (e) =>
              `- ${e.start} -> ${e.end} | ${e.subject}${
                e.location ? ` (${e.location})` : ''
              }`
          )
          .join('\n')
      : 'Niciun eveniment extern în Outlook în următoarele 14 zile (sau Outlook neconectat).';

    return `

=== LIVE CRM & PMP DATABASE (DATA CURENTĂ: ${todayStr}) ===
Total: ${people.length} oameni, ${projects.length} proiecte, ${tasks.length} task-uri/subtask-uri, ${resources.length} resurse, ${events.length} evenimente, ${partners.length} parteneri.

--- ALERTE OPERAȚIONALE ACTIVE ---
${alertsBlock}

--- PROIECTE & STATUS CURENT ---
${projectsBlock}

--- TASK-URI, SUBTASK-URI & MILESTONE-URI ---
${tasksBlock}

--- BAZA DE DATE OAMENI (ALUMNI & BOARD) ---
${peopleBlock}${notesBlock ? `\n\n--- NOTIȚE GENERALE (MEMORIE AI) ---\n${notesBlock}` : ''}${
      postItsBlock ? `\n\n--- POST-IT RAPIDE PETRE ---\n${postItsBlock}` : ''
    }

--- OUTLOOK CALENDAR LIVE (URMĂTOARELE 14 ZILE - FUS ORAR BUCUREȘTI) ---
${outlookBlock}`;
  } catch (err) {
    console.error('buildLiveCrmContext error:', err);
    return '';
  }
}