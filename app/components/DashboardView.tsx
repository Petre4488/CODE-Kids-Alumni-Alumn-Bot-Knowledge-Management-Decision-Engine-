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
}

const POSTIT_STYLES: Record<
  PostItNote['color'],
  { card: string; dot: string }
> = {
  amber: {
    card: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    dot: 'bg-amber-400',
  },
  emerald: {
    card: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    dot: 'bg-emerald-400',
  },
  violet: {
    card: 'border-violet-500/40 bg-violet-500/10 text-violet-100',
    dot: 'bg-violet-400',
  },
  sky: {
    card: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
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
}: DashboardViewProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDept, setNewTaskDept] = useState<DepartmentKey>('Board');
  const [newTaskStart, setNewTaskStart] = useState<string | null>(null);
  const [newTaskEnd, setNewTaskEnd] = useState<string | null>(null);
  const [copiedDept, setCopiedDept] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Post-it state
  const [postItText, setPostItText] = useState('');
  const [postItColor, setPostItColor] = useState<PostItNote['color']>('amber');

  const [dateBounds, setDateBounds] = useState<{
    todayStr: string;
    weekEndStr: string;
    in48hStr: string;
  } | null>(null);

  useEffect(() => {
    const now = Date.now();
    setDateBounds({
      todayStr: new Date(now).toISOString().slice(0, 10),
      weekEndStr: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      in48hStr: new Date(now + 48 * 60 * 60 * 1000).toISOString().slice(0, 10),
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

  const criticalItems = tasks.filter((t) => {
    if (t.status === 'done' && (t.type !== 'milestone' || t.is_milestone_approved)) return false;
    if (t.type === 'milestone' && !t.is_milestone_approved && t.status === 'waiting_review') {
      return true;
    }
    return Boolean(dateBounds && t.deadline && t.deadline <= dateBounds.in48hStr);
  });

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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5">
      {/* Top Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Master Overview · CODE Kids Alumni
          </h2>
          <p className="text-xs text-zinc-400">
            {projects.filter((p) => p.status === 'active').length} proiecte active ·{' '}
            {tasks.filter((t) => t.status !== 'done').length} task-uri deschise ·{' '}
            {people.length} oameni în CRM
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onAskAiStatus(
              'Fă-mi un status update complet pe ce se întâmplă acum în Alumni: proiecte active, ce arde la deadline-uri, milestone-uri în așteptare și blocaje pe departamente.'
            )
          }
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
        >
          🤖 Cere AI Status Update Live
        </button>
      </div>

      {/* ZONA 1 — FOCUSUL MEU + DEADLINE-URI CRITICE */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              ⚡ Focusul Meu (Azi & Săptămâna Curentă)
            </h3>
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
              {myFocusTasks.length}
            </span>
          </div>

          <form onSubmit={addQuickMyTask} className="mb-3 flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="+ Adaugă task rapid pentru tine..."
              className="min-w-[160px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={newTaskDept}
              onChange={(e) => setNewTaskDept(e.target.value as DepartmentKey)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300"
            >
              {deptKeys.map((k) => (
                <option key={k} value={k}>
                  {DEPARTMENTS[k].label}
                </option>
              ))}
            </select>
            <div className="min-w-[165px]">
              <CalendarRangePicker
                startDate={newTaskStart}
                endDate={newTaskEnd}
                onChange={(s, e) => {
                  setNewTaskStart(s);
                  setNewTaskEnd(e);
                }}
                alignRight
              />
            </div>
            <button
              type="submit"
              disabled={!newTaskTitle.trim() || busyId === 'new-task'}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Adaugă
            </button>
          </form>

          <div className="flex-1 space-y-1.5">
            {myFocusTasks.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                Niciun task personal deschis pentru săptămâna asta.
              </p>
            ) : (
              myFocusTasks.map((t) => {
                const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/90 bg-zinc-950/80 px-3 py-2 text-xs hover:border-zinc-700"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        disabled={busyId === t.id}
                        onChange={() => toggleTask(t)}
                        className="h-3.5 w-3.5 rounded accent-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => onOpenTaskModal(t)}
                        className="truncate text-left font-medium text-zinc-200 hover:text-emerald-300"
                      >
                        {t.title}
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${dept.badgeBg} ${dept.badgeText}`}
                      >
                        {dept.label}
                      </span>
                      {t.deadline && (
                        <span className="font-mono text-[10px] text-zinc-400">{t.deadline}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300">
              🔥 Deadline-uri Critice & Milestone-uri de Verificat
            </h3>
            <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-[11px] text-rose-300">
              {criticalItems.length}
            </span>
          </div>

          <div className="flex-1 space-y-1.5">
            {criticalItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                Niciun deadline critic sau milestone blocat în următoarele 48h.
              </p>
            ) : (
              criticalItems.map((t) => {
                const isOverdue = Boolean(
                  dateBounds && t.deadline && t.deadline < dateBounds.todayStr
                );
                const proj = t.project_id ? projectMap.get(t.project_id) : null;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                      isOverdue
                        ? 'border-rose-500/40 bg-rose-500/10'
                        : 'border-amber-500/30 bg-amber-500/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenTaskModal(t)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{t.type === 'milestone' ? '🟡' : isOverdue ? '🚨' : '⏳'}</span>
                        <span className="truncate font-medium text-zinc-100 hover:underline">
                          {t.title}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                        {proj ? proj.title : DEPARTMENTS[t.department]?.label} · Termen:{' '}
                        <span className="font-mono">{t.deadline || 'Așteaptă aprobare'}</span>
                      </p>
                    </button>

                    {t.type === 'milestone' && !t.is_milestone_approved && (
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => approveMilestone(t)}
                        className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                      >
                        🟢 Aprobă
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ZONA 2 — POST-IT STICKY BOARD (SINCRONIZAT CU HUB-UL DE NOTIȚE) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            📌 Post-it Board (Idei rapide · apar și în tab-ul Notițe)
          </h3>

          <form onSubmit={handleAddPostIt} className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1">
              {(Object.keys(POSTIT_STYLES) as PostItNote['color'][]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPostItColor(c)}
                  className={`h-3.5 w-3.5 rounded-full transition ${POSTIT_STYLES[c].dot} ${
                    postItColor === c ? 'ring-2 ring-white' : 'opacity-50'
                  }`}
                />
              ))}
            </div>

            <input
              type="text"
              value={postItText}
              onChange={(e) => setPostItText(e.target.value)}
              placeholder="Lipește un gând rapid aici..."
              className="w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-100 placeholder-zinc-500 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!postItText.trim() || busyId === 'postit'}
              className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              + Post-it
            </button>
          </form>
        </div>

        {postItNotes.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            Niciun post-it lipit încă. Folosește bara de mai sus pentru notițe din zbor.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {postItNotes.map((pi) => {
              const st = POSTIT_STYLES[pi.color] || POSTIT_STYLES.amber;
              return (
                <div
                  key={pi.id}
                  className={`flex flex-col justify-between rounded-xl border p-3 text-xs shadow ${st.card}`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{pi.content}</p>
                  <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px]">
                    <button
                      type="button"
                      disabled={busyId === pi.id}
                      onClick={() => convertPostItToTask(pi)}
                      className="rounded bg-black/30 px-2 py-0.5 font-medium hover:bg-black/50"
                    >
                      → Fă Task
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePostIt(pi.id)}
                      className="opacity-60 hover:opacity-100"
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

      {/* ZONA 3 — STATUS DEPARTAMENTE */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Status Departamente & Management
        </h3>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            const overdueTasks = dateBounds
              ? openTasks.filter((t) => t.deadline && t.deadline < dateBounds.todayStr)
              : [];
            const avgProgress = deptProjects.length
              ? Math.round(
                  deptProjects.reduce((acc, p) => acc + p.progress, 0) / deptProjects.length
                )
              : 0;

            return (
              <div
                key={deptKey}
                className={`flex flex-col justify-between rounded-xl border ${meta.border} bg-zinc-900/90 p-4`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${meta.badgeBg} ${meta.badgeText}`}
                    >
                      {meta.label}
                    </span>
                    <span className="font-mono text-xs font-bold text-zinc-200">
                      {avgProgress}%
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-zinc-400">
                    Coordonator:{' '}
                    <span className="font-medium text-zinc-200">
                      {coord ? coord.full_name : 'Nealocat în CRM'}
                    </span>
                  </p>

                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full ${meta.barBg} transition-all`}
                      style={{ width: `${avgProgress}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-zinc-400">
                    <span>{deptProjects.length} proiecte active</span>
                    <span>· {openTasks.length} în lucru</span>
                    {overdueTasks.length > 0 && (
                      <span className="text-rose-400">· {overdueTasks.length} întârziate</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
                  <button
                    type="button"
                    onClick={() => copyWeeklySummary(deptKey)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-emerald-500/50 hover:text-emerald-300"
                  >
                    {copiedDept === deptKey ? '✓ Copiat pentru WhatsApp!' : '📋 Copy Weekly Summary'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onAskAiStatus(
                        `Fă-mi un status update detaliat pe departamentul ${meta.label}: cine lucrează, cum merg proiectele active, ce blocaje sau riscuri apar și ce ar trebui să verific.`
                      )
                    }
                    className="rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Ask AI →
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