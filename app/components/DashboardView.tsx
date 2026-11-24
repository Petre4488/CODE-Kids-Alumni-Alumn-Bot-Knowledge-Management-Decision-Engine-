'use client';

import { useEffect, useState } from 'react';
import {
  DEPARTMENTS,
  DepartmentKey,
  Person,
  PostItNote,
  Project,
  TaskItem,
} from '../lib/pmp-types';
import { CalendarRangePicker } from './SmartControls';

interface DashboardViewProps {
  people: Person[];
  projects: Project[];
  tasks: TaskItem[];
  postItNotes: PostItNote[];
  onRefresh: () => Promise<void>;
  onAskAiStatus: (prompt: string) => void;
  onOpenTaskModal: (task: TaskItem) => void;
  onSelectDepartment?: (dept: DepartmentKey) => void;
}

const POSTIT_STYLES: Record<
  PostItNote['color'],
  { card: string; dot: string }
> = {
  amber: {
    card: 'border-amber-400/20 bg-amber-500/[0.07] text-amber-100/90',
    dot: 'bg-amber-400',
  },
  emerald: {
    card: 'border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-100/90',
    dot: 'bg-emerald-400',
  },
  violet: {
    card: 'border-violet-400/20 bg-violet-500/[0.07] text-violet-100/90',
    dot: 'bg-violet-400',
  },
  sky: {
    card: 'border-sky-400/20 bg-sky-500/[0.07] text-sky-100/90',
    dot: 'bg-sky-400',
  },
};

export function DashboardView({
  people,
  projects,
  tasks,
  postItNotes,
  onRefresh,
  onAskAiStatus,
  onOpenTaskModal,
  onSelectDepartment,
}: DashboardViewProps) {
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDept, setNewTaskDept] = useState<DepartmentKey>('Board');
  const [newTaskStart, setNewTaskStart] = useState<string | null>(null);
  const [newTaskEnd, setNewTaskEnd] = useState<string | null>(null);

  const [copiedDept, setCopiedDept] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Post-it state
  const [addingPostIt, setAddingPostIt] = useState(false);
  const [postItText, setPostItText] = useState('');
  const [postItColor, setPostItColor] = useState<PostItNote['color']>('amber');

  const [dateBounds, setDateBounds] = useState<{
    todayStr: string;
    weekEndStr: string;
    in48hStr: string;
    formattedDate: string;
  } | null>(null);

  useEffect(() => {
    const now = new Date();
    const ts = now.getTime();
    setDateBounds({
      todayStr: now.toISOString().slice(0, 10),
      weekEndStr: new Date(ts + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      in48hStr: new Date(ts + 48 * 60 * 60 * 1000).toISOString().slice(0, 10),
      formattedDate: now.toLocaleDateString('ro-RO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    });
  }, []);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const personMap = new Map(people.map((p) => [p.id, p]));

  const myFocusTasks = tasks.filter(
    (t) =>
      (t.is_my_task || t.department === 'Board') &&
      t.status !== 'done' &&
      (!t.deadline || !dateBounds || t.deadline <= dateBounds.weekEndStr)
  );

  const pmSyncProjects = projects.filter(
    (p) => p.needs_pm_sync && p.status !== 'completed'
  );

  const criticalItems = tasks.filter((t) => {
    if (t.needs_pm_sync && t.status !== 'done') return true;
    if (t.status === 'done' && (t.type !== 'milestone' || t.is_milestone_approved)) return false;
    if (t.type === 'milestone' && !t.is_milestone_approved && t.status === 'waiting_review') {
      return true;
    }
    return Boolean(dateBounds && t.deadline && t.deadline <= dateBounds.in48hStr);
  });

  const totalAttentionCount = pmSyncProjects.length + criticalItems.length;

  async function addQuickMyTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setBusyId('new-task');
    try {
      const fallbackToday = new Date().toISOString().slice(0, 10);
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: newTaskTitle.trim(),
          department: newTaskDept,
          start_date: newTaskStart || fallbackToday,
          deadline: newTaskEnd || newTaskStart || fallbackToday,
          is_my_task: true,
        }),
      });
      setNewTaskTitle('');
      setNewTaskStart(null);
      setNewTaskEnd(null);
      setAddingTask(false);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTask(task: TaskItem) {
    setBusyId(task.id);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_task_done',
          id: task.id,
          done: task.status !== 'done',
        }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function approveMilestone(task: TaskItem) {
    setBusyId(task.id);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_milestone',
          id: task.id,
          approved: true,
        }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function clearPmSync(kind: 'task' | 'project', id: string) {
    setBusyId(id);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: kind === 'project' ? 'update_project' : 'update_task',
          id,
          needs_pm_sync: false,
        }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddPostIt(e: React.FormEvent) {
    e.preventDefault();
    if (!postItText.trim()) return;
    setBusyId('postit');
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_post_it',
          content: postItText.trim(),
          color: postItColor,
        }),
      });
      setPostItText('');
      setAddingPostIt(false);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function convertPostItToTask(pi: PostItNote) {
    setBusyId(pi.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: pi.content.slice(0, 120),
          department: 'Board',
          start_date: today,
          deadline: today,
          is_my_task: true,
        }),
      });
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_post_it', id: pi.id }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deletePostIt(id: string) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_post_it', id }),
    });
    await onRefresh();
  }

  function copyWeeklySummary(deptKey: DepartmentKey) {
    const meta = DEPARTMENTS[deptKey];
    const coord = people.find(
      (p) => p.department === deptKey && p.role === 'Coordonator'
    );
    const deptProjects = projects.filter(
      (p) => p.department === deptKey && p.status === 'active'
    );
    const deptTasks = tasks.filter(
      (t) => t.department === deptKey && t.status !== 'done'
    );
    const avgProgress = deptProjects.length
      ? Math.round(
          deptProjects.reduce((acc, p) => acc + p.progress, 0) / deptProjects.length
        )
      : 0;

    const lines = [
      `📌 *Weekly Summary — ${meta.label}* (${new Date().toLocaleDateString('ro-RO')})`,
      coord ? `👤 Coordonator: ${coord.full_name}` : null,
      `📊 Progres mediu proiecte active: *${avgProgress}%* (${deptProjects.length} active)`,
      '',
      '*Proiecte în derulare:*',
      ...(deptProjects.length
        ? deptProjects.map((p) => `• ${p.title} — ${p.progress}% (Termen: ${p.deadline || 'N/A'})`)
        : ['• Niciun proiect activ']),
      '',
      '*Task-uri & Milestone-uri deschise:*',
      ...(deptTasks.length
        ? deptTasks.map((t) => {
            const assignee = t.assignee_id ? personMap.get(t.assignee_id)?.full_name : null;
            return `• [${t.type === 'milestone' ? 'MILESTONE' : t.status}] ${t.title}${
              assignee ? ` (@${assignee})` : ''
            }${t.deadline ? ` — termen ${t.deadline}` : ''}`;
          })
        : ['• Toate task-urile curente sunt finalizate!']),
    ].filter((l) => l !== null);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedDept(deptKey);
    setTimeout(() => setCopiedDept(null), 2000);
  }

  const deptKeys: DepartmentKey[] = [
    'Comunicare',
    'Comunitati',
    'Tehnic',
    'Coordonare Judeteana',
    'Board',
  ];

  const activeProjectsCount = projects.filter((p) => p.status === 'active').length;
  const openTasksCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="mx-auto max-w-5xl space-y-7 px-6 py-7">
      {/* ASANA-STYLE CALM HERO HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs capitalize text-zinc-500">
            {dateBounds?.formattedDate || 'Astăzi'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
            Salut, Petre
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {activeProjectsCount} proiecte active
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              {openTasksCount} task-uri deschise
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1">
              {people.length} alumni în CRM
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            onAskAiStatus(
              'Fă-mi un status update complet pe ce se întâmplă acum în Alumni: proiecte active, ce arde la deadline-uri, ce este marcat de discutat cu Vlad (PM), milestone-uri în așteptare și blocaje pe departamente.'
            )
          }
          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-white/[0.16] hover:bg-white/[0.07]"
        >
          <span className="text-emerald-400">✦</span>
          <span>Rezumat AI Live</span>
        </button>
      </div>

      {/* ZONA 1 — FOCUSUL MEU & NECESITĂ ATENȚIE */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Focusul Meu */}
        <section className="flex flex-col rounded-2xl border border-white/[0.06] bg-[#15171D] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-zinc-100">Focusul meu</h2>
              <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                {myFocusTasks.length}
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">Săptămâna curentă</span>
          </div>

          <div className="flex-1 divide-y divide-white/[0.05]">
            {myFocusTasks.map((t) => {
              const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
              return (
                <div
                  key={t.id}
                  className="group flex items-center justify-between gap-2.5 py-2.5 text-xs transition"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={t.status === 'done'}
                      disabled={busyId === t.id}
                      onChange={() => toggleTask(t)}
                      className="h-3.5 w-3.5 cursor-pointer rounded-full accent-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => onOpenTaskModal(t)}
                      className="truncate text-left text-zinc-200 transition group-hover:text-white"
                    >
                      {t.title}
                    </button>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400"
                      title={dept.label}
                    >
                      <span className={`h-2 w-2 rounded-full ${dept.dotBg}`} />
                      <span className="hidden sm:inline">{dept.label}</span>
                    </span>
                    {t.deadline && (
                      <span className="font-mono text-[11px] text-zinc-500">
                        {t.deadline.slice(5)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {myFocusTasks.length === 0 && !addingTask && (
              <p className="py-6 text-center text-xs text-zinc-500">
                Totul curat pentru săptămâna asta.
              </p>
            )}
          </div>

          {/* Progressive Add Row */}
          <div className="mt-2 pt-2">
            {!addingTask ? (
              <button
                type="button"
                onClick={() => setAddingTask(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
              >
                <span>+</span>
                <span>Adaugă un task...</span>
              </button>
            ) : (
              <form
                onSubmit={addQuickMyTask}
                className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0F1014] p-2.5 text-xs"
              >
                <input
                  type="text"
                  autoFocus
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setAddingTask(false);
                  }}
                  placeholder="Ce ai de făcut?"
                  className="w-full bg-transparent px-1 py-1 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={newTaskDept}
                      onChange={(e) => setNewTaskDept(e.target.value as DepartmentKey)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-300"
                    >
                      {deptKeys.map((k) => (
                        <option key={k} value={k}>
                          {DEPARTMENTS[k].label}
                        </option>
                      ))}
                    </select>
                    <div className="w-40">
                      <CalendarRangePicker
                        startDate={newTaskStart}
                        endDate={newTaskEnd}
                        onChange={(s, e) => {
                          setNewTaskStart(s);
                          setNewTaskEnd(e);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAddingTask(false)}
                      className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      Anulează
                    </button>
                    <button
                      type="submit"
                      disabled={!newTaskTitle.trim() || busyId === 'new-task'}
                      className="rounded-lg bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                    >
                      Salvează
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Necesită atenție (Vlad PM + Deadline-uri <48h + Milestone-uri) */}
        <section className="flex flex-col rounded-2xl border border-white/[0.06] bg-[#15171D] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-zinc-100">Necesită atenție</h2>
              {totalAttentionCount > 0 && (
                <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 font-mono text-[11px] text-rose-300">
                  {totalAttentionCount}
                </span>
              )}
            </div>
            <span className="text-[11px] text-zinc-500">
              Vlad (PM) · Termene &lt;48h · Milestone-uri
            </span>
          </div>

          <div className="flex-1 space-y-2">
            {totalAttentionCount === 0 ? (
              <div className="flex h-full min-h-[140px] items-center justify-center text-xs text-zinc-500">
                Niciun deadline critic, milestone blocat sau subiect pentru Vlad (PM).
              </div>
            ) : (
              <>
                {/* Proiecte marcate de discutat cu Vlad (PM) */}
                {pmSyncProjects.map((proj) => (
                  <div
                    key={`pm-proj-${proj.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.08] px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                          💬 Vlad (PM)
                        </span>
                        <span className="truncate font-medium text-zinc-100">
                          {proj.title}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        Proiect · {DEPARTMENTS[proj.department]?.label}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === proj.id}
                      onClick={() => clearPmSync('project', proj.id)}
                      className="shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-white/[0.1]"
                    >
                      ✓ Discutat
                    </button>
                  </div>
                ))}

                {/* Task-uri critice / milestone-uri / Vlad PM */}
                {criticalItems.map((t) => {
                  const isOverdue = Boolean(
                    dateBounds && t.deadline && t.deadline < dateBounds.todayStr
                  );
                  const proj = t.project_id ? projectMap.get(t.project_id) : null;
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs transition ${
                        t.needs_pm_sync
                          ? 'border-violet-500/25 bg-violet-500/[0.07] hover:bg-violet-500/[0.11]'
                          : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenTaskModal(t)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {t.needs_pm_sync ? (
                            <span className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                              💬 Vlad (PM)
                            </span>
                          ) : (
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                t.type === 'milestone'
                                  ? 'bg-amber-400'
                                  : isOverdue
                                    ? 'bg-rose-400'
                                    : 'bg-amber-400'
                              }`}
                            />
                          )}
                          <span className="truncate font-medium text-zinc-100">
                            {t.title}
                          </span>
                        </div>
                        <p className="mt-0.5 pl-4 text-[11px] text-zinc-500">
                          {proj ? proj.title : DEPARTMENTS[t.department]?.label} ·{' '}
                          <span className={isOverdue ? 'text-rose-400' : 'text-zinc-400'}>
                            {t.deadline || 'Fără termen'}
                          </span>
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {t.needs_pm_sync && (
                          <button
                            type="button"
                            disabled={busyId === t.id}
                            onClick={() => clearPmSync('task', t.id)}
                            className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-white/[0.1]"
                          >
                            ✓ Discutat
                          </button>
                        )}
                        {t.type === 'milestone' && !t.is_milestone_approved && (
                          <button
                            type="button"
                            disabled={busyId === t.id}
                            onClick={() => approveMilestone(t)}
                            className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                          >
                            Aprobă
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>
      </div>

      {/* ZONA 2 — POST-IT STICKY NOTES */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-zinc-100">Post-it Board</h2>
            <span className="text-[11px] text-zinc-500">Sincronizat cu Hub-ul de Notițe</span>
          </div>

          {!addingPostIt ? (
            <button
              type="button"
              onClick={() => setAddingPostIt(true)}
              className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/[0.07]"
            >
              + Notă rapidă
            </button>
          ) : (
            <form onSubmit={handleAddPostIt} className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#0F1014] px-2 py-1">
                {(Object.keys(POSTIT_STYLES) as PostItNote['color'][]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPostItColor(c)}
                    className={`h-3 w-3 rounded-full transition ${POSTIT_STYLES[c].dot} ${
                      postItColor === c ? 'ring-2 ring-white/80' : 'opacity-40'
                    }`}
                  />
                ))}
              </div>
              <input
                type="text"
                autoFocus
                value={postItText}
                onChange={(e) => setPostItText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAddingPostIt(false);
                }}
                placeholder="Notează o idee din zbor..."
                className="w-60 rounded-lg border border-white/[0.08] bg-[#0F1014] px-3 py-1 text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!postItText.trim() || busyId === 'postit'}
                className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
              >
                Lipește
              </button>
            </form>
          )}
        </div>

        {postItNotes.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">
            Nicio notiță rapidă lipită momentan.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {postItNotes.map((pi) => {
              const st = POSTIT_STYLES[pi.color] || POSTIT_STYLES.amber;
              return (
                <div
                  key={pi.id}
                  className={`group flex flex-col justify-between rounded-xl border p-3.5 text-xs ${st.card}`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{pi.content}</p>
                  <div className="mt-3 flex items-center justify-between pt-2 text-[11px] opacity-70 transition group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={busyId === pi.id}
                      onClick={() => convertPostItToTask(pi)}
                      className="rounded bg-black/25 px-2 py-0.5 font-medium hover:bg-black/40"
                    >
                      → Fă Task
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePostIt(pi.id)}
                      className="px-1 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ZONA 3 — PULS DEPARTAMENTE */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-zinc-400">Departamente</h2>
          <span className="text-[11px] text-zinc-600">
            Click pe departament pentru folder · Summary pentru WhatsApp
          </span>
        </div>

        <div className="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06] bg-[#15171D]">
          {deptKeys.map((deptKey) => {
            const meta = DEPARTMENTS[deptKey];
            const coord = people.find(
              (p) =>
                p.department === deptKey &&
                (p.role === 'Coordonator' || (deptKey === 'Board' && p.role === 'Lider'))
            );
            const deptProjects = projects.filter(
              (p) => p.department === deptKey && p.status === 'active'
            );
            const openTasks = tasks.filter(
              (t) => t.department === deptKey && t.status !== 'done'
            );
            const avgProgress = deptProjects.length
              ? Math.round(
                  deptProjects.reduce((acc, p) => acc + p.progress, 0) / deptProjects.length
                )
              : 0;

            return (
              <div
                key={deptKey}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-white/[0.02]"
              >
                <button
                  type="button"
                  onClick={() => onSelectDepartment?.(deptKey)}
                  className="flex min-w-[200px] items-center gap-2.5 text-left"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotBg}`} />
                  <div>
                    <span className="font-medium text-zinc-100 hover:underline">
                      {meta.label}
                    </span>
                    <span className="ml-2 text-[11px] text-zinc-500">
                      {coord ? coord.full_name : 'Nealocat'}
                    </span>
                  </div>
                </button>

                <div className="flex flex-1 items-center justify-end gap-4">
                  <span className="hidden text-[11px] text-zinc-500 sm:inline">
                    {deptProjects.length} proiecte · {openTasks.length} task-uri
                  </span>

                  <div className="flex w-28 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full ${meta.barBg} opacity-80`}
                        style={{ width: `${avgProgress}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[11px] text-zinc-400">
                      {avgProgress}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyWeeklySummary(deptKey)}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-white/[0.15] hover:text-zinc-200"
                  >
                    {copiedDept === deptKey ? '✓ Copiat' : 'Summary'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}