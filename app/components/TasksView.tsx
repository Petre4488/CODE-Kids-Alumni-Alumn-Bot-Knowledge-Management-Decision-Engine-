'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEPARTMENTS,
  DepartmentKey,
  PRIORITY_META,
  PriorityKey,
  Person,
  Project,
  TaskItem,
} from '../lib/pmp-types';
import { AlumniSearchPicker, CalendarRangePicker } from './SmartControls';

interface TasksViewProps {
  people: Person[];
  projects: Project[];
  tasks: TaskItem[];
  onRefresh: () => Promise<void>;
  onOpenTaskModal: (task: TaskItem) => void;
  onAskAiContext: (prompt: string) => void;
}

type PulseFilter =
  | 'active'
  | 'today'
  | 'overdue'
  | 'mine'
  | 'pm_sync'
  | 'standalone'
  | 'done';

type GroupByMode = 'horizon' | 'status' | 'department';

function addDaysIso(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function TasksView({
  people,
  projects,
  tasks,
  onRefresh,
  onOpenTaskModal,
  onAskAiContext,
}: TasksViewProps) {
  const [pulseFilter, setPulseFilter] = useState<PulseFilter>('active');
  const [groupBy, setGroupBy] = useState<GroupByMode>('horizon');
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('');

  // Quick-Add Bar State (proiectul este opțional - implicit task independent)
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDept, setQuickDept] = useState<DepartmentKey>('Board');
  const [quickProjectId, setQuickProjectId] = useState<string>('');
  const [quickAssigneeId, setQuickAssigneeId] = useState<string | null>(null);
  const [quickStart, setQuickStart] = useState<string | null>(null);
  const [quickEnd, setQuickEnd] = useState<string | null>(null);
  const [quickPriority, setQuickPriority] = useState<PriorityKey>('medium');
  const [quickPmSync, setQuickPmSync] = useState(false);
  const [creating, setCreating] = useState(false);

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [groupingModalOpen, setGroupingModalOpen] = useState(false);
  const [groupProjectTitle, setGroupProjectTitle] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [copiedAgenda, setCopiedAgenda] = useState(false);

  const [todayIso, setTodayIso] = useState<string>('');
  const [tomorrowIso, setTomorrowIso] = useState<string>('');
  const [weekEndIso, setWeekEndIso] = useState<string>('');

  useEffect(() => {
    const t = new Date().toISOString().slice(0, 10);
    setTodayIso(t);
    setTomorrowIso(addDaysIso(t, 1));
    setWeekEndIso(addDaysIso(t, 7));
  }, []);

  const personMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const rootTasks = useMemo(
    () => tasks.filter((t) => !t.parent_task_id),
    [tasks]
  );

  // Contoare pentru bara de Status Pulse
  const pulseCounts = useMemo(() => {
    const active = rootTasks.filter((t) => t.status !== 'done').length;
    const today = todayIso
      ? rootTasks.filter((t) => t.status !== 'done' && t.deadline === todayIso).length
      : 0;
    const overdue = todayIso
      ? rootTasks.filter(
          (t) => t.status !== 'done' && Boolean(t.deadline && t.deadline < todayIso)
        ).length
      : 0;
    const mine = rootTasks.filter(
      (t) => t.status !== 'done' && (t.is_my_task || t.department === 'Board')
    ).length;
    const pmSync = rootTasks.filter(
      (t) => t.status !== 'done' && Boolean(t.needs_pm_sync)
    ).length;
    const standalone = rootTasks.filter(
      (t) => t.status !== 'done' && !t.project_id
    ).length;
    const done = rootTasks.filter((t) => t.status === 'done').length;

    return { active, today, overdue, mine, pmSync, standalone, done };
  }, [rootTasks, todayIso]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return rootTasks.filter((t) => {
      if (deptFilter && t.department !== deptFilter) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;

      if (pulseFilter === 'done') return t.status === 'done';
      if (t.status === 'done') return false;

      if (pulseFilter === 'today') return Boolean(todayIso && t.deadline === todayIso);
      if (pulseFilter === 'overdue') {
        return Boolean(todayIso && t.deadline && t.deadline < todayIso);
      }
      if (pulseFilter === 'mine') return t.is_my_task || t.department === 'Board';
      if (pulseFilter === 'pm_sync') return Boolean(t.needs_pm_sync);
      if (pulseFilter === 'standalone') return !t.project_id;
      return true;
    });
  }, [rootTasks, pulseFilter, deptFilter, searchQuery, todayIso]);

  // Grupare în funcție de modul ales
  const groupedSections = useMemo(() => {
    if (groupBy === 'status') {
      const cols: { key: string; title: string; dot: string; items: TaskItem[] }[] = [
        { key: 'in_progress', title: 'In Progress', dot: 'bg-sky-400', items: [] },
        { key: 'todo', title: 'To Do', dot: 'bg-zinc-500', items: [] },
        { key: 'waiting_review', title: 'Waiting Review', dot: 'bg-amber-400', items: [] },
        { key: 'done', title: 'Done', dot: 'bg-emerald-400', items: [] },
      ];
      for (const t of filteredTasks) {
        const target = cols.find((c) => c.key === t.status) || cols[1];
        target.items.push(t);
      }
      return cols.filter((c) => c.items.length > 0 || pulseFilter === 'done');
    }

    if (groupBy === 'department') {
      const order: DepartmentKey[] = [
        'Board',
        'Tehnic',
        'Comunicare',
        'Comunitati',
        'Coordonare Judeteana',
      ];
      return order
        .map((dk) => ({
          key: dk,
          title: DEPARTMENTS[dk].label,
          dot: DEPARTMENTS[dk].dotBg,
          items: filteredTasks.filter((t) => t.department === dk),
        }))
        .filter((g) => g.items.length > 0);
    }

    // Default: Orizont (Triage zilnic)
    const overdueAndToday: TaskItem[] = [];
    const thisWeek: TaskItem[] = [];
    const later: TaskItem[] = [];
    const inboxNoDate: TaskItem[] = [];

    for (const t of filteredTasks) {
      if (!t.deadline) {
        inboxNoDate.push(t);
      } else if (todayIso && t.deadline <= todayIso) {
        overdueAndToday.push(t);
      } else if (weekEndIso && t.deadline <= weekEndIso) {
        thisWeek.push(t);
      } else {
        later.push(t);
      }
    }

    return [
      {
        key: 'today',
        title: 'Azi & Întârziate',
        dot: 'bg-rose-400',
        items: overdueAndToday,
      },
      {
        key: 'week',
        title: 'Următoarele 7 zile',
        dot: 'bg-sky-400',
        items: thisWeek,
      },
      {
        key: 'inbox',
        title: 'Fără termen (Inbox)',
        dot: 'bg-zinc-500',
        items: inboxNoDate,
      },
      {
        key: 'later',
        title: 'Mai târziu',
        dot: 'bg-emerald-400',
        items: later,
      },
    ].filter((g) => g.items.length > 0);
  }, [filteredTasks, groupBy, todayIso, weekEndIso, pulseFilter]);

  // Quick-Add cu suport pentru token-uri rapide (!urgent, !high, @Petre, @Vlad, azi, maine)
  async function handleQuickCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!quickTitle.trim() || creating) return;

    let parsedTitle = quickTitle.trim();
    let finalPriority = quickPriority;
    let finalStart = quickStart;
    let finalEnd = quickEnd;
    let finalAssignee = quickAssigneeId;
    let finalPmSync = quickPmSync;

    if (/\s?!urgent\b/i.test(parsedTitle)) {
      finalPriority = 'urgent';
      parsedTitle = parsedTitle.replace(/\s?!urgent\b/gi, '').trim();
    } else if (/\s?!high\b/i.test(parsedTitle)) {
      finalPriority = 'high';
      parsedTitle = parsedTitle.replace(/\s?!high\b/gi, '').trim();
    }

    if (/\bazi\b/i.test(parsedTitle) && !finalEnd && todayIso) {
      finalStart = todayIso;
      finalEnd = todayIso;
      parsedTitle = parsedTitle.replace(/\bazi\b/gi, '').trim();
    } else if (/\bm[aă]ine\b/i.test(parsedTitle) && !finalEnd && tomorrowIso) {
      finalStart = tomorrowIso;
      finalEnd = tomorrowIso;
      parsedTitle = parsedTitle.replace(/\bm[aă]ine\b/gi, '').trim();
    }

    if (/@vlad\b/i.test(parsedTitle)) {
      const vlad = people.find((p) => p.full_name.toLowerCase().includes('vlad'));
      if (vlad && !finalAssignee) finalAssignee = vlad.id;
      finalPmSync = true;
      parsedTitle = parsedTitle.replace(/@vlad\b/gi, '').trim();
    } else if (/@petre\b/i.test(parsedTitle)) {
      const petre = people.find((p) => p.full_name.toLowerCase().includes('petre'));
      if (petre && !finalAssignee) finalAssignee = petre.id;
      parsedTitle = parsedTitle.replace(/@petre\b/gi, '').trim();
    }

    setCreating(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: parsedTitle || quickTitle.trim(),
          type: 'task',
          project_id: quickProjectId || null,
          department: quickDept,
          assignee_id: finalAssignee,
          priority: finalPriority,
          start_date: finalStart,
          deadline: finalEnd,
          is_my_task: true,
          needs_pm_sync: finalPmSync,
        }),
      });
      setQuickTitle('');
      setQuickStart(null);
      setQuickEnd(null);
      setQuickPmSync(false);
      await onRefresh();
    } finally {
      setCreating(false);
    }
  }

  async function toggleDone(task: TaskItem) {
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
  }

  async function quickPatchTask(taskId: string, patch: Record<string, unknown>) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_task',
        id: taskId,
        ...patch,
      }),
    });
    await onRefresh();
  }

  async function promoteToProject(taskId: string) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote_task_to_project',
        id: taskId,
      }),
    });
    await onRefresh();
  }

  const selectedIdList = Object.keys(selectedIds).filter((id) => selectedIds[id]);

  async function runBatchOperation(
    operation: 'done' | 'today' | 'tomorrow' | 'pm_sync' | 'delete' | 'group_project',
    extra: Record<string, unknown> = {}
  ) {
    if (selectedIdList.length === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_update_tasks',
          ids: selectedIdList,
          operation,
          ...extra,
        }),
      });
      setSelectedIds({});
      setGroupingModalOpen(false);
      setGroupProjectTitle('');
      await onRefresh();
    } finally {
      setBatchBusy(false);
    }
  }

  function copyVladAgenda() {
    const pmTasks = rootTasks.filter((t) => t.status !== 'done' && t.needs_pm_sync);
    const lines = [
      `💬 *Agendă Sync cu Vlad (PM)* — ${new Date().toLocaleDateString('ro-RO')}`,
      '',
      ...(pmTasks.length
        ? pmTasks.map((t) => {
            const proj = t.project_id ? projectMap.get(t.project_id)?.title : 'Ad-hoc';
            return `• [${DEPARTMENTS[t.department]?.label}] ${t.title} (${proj}${
              t.deadline ? ` · termen ${t.deadline}` : ''
            })`;
          })
        : ['• Niciun punct marcat momentan.']),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAgenda(true);
    setTimeout(() => setCopiedAgenda(false), 2000);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Task-uri</h1>
          <p className="text-xs text-zinc-500">
            Execuție zilnică · Task-uri independente și livrabile din proiecte
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {pulseFilter === 'pm_sync' && (
            <button
              type="button"
              onClick={copyVladAgenda}
              className="rounded-xl border border-violet-500/30 bg-violet-500/15 px-3 py-1.5 font-medium text-violet-200 hover:bg-violet-500/25"
            >
              {copiedAgenda ? '✓ Agendă copiată!' : '📋 Copiază agenda Vlad (PM)'}
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              onAskAiContext(
                'Analizează lista mea de task-uri deschise (inclusiv cele fără proiect): ce ar trebui să prioritizez azi și ce pot delega?'
              )
            }
            className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-medium text-zinc-200 hover:bg-white/[0.08]"
          >
            <span className="mr-1.5 text-emerald-400">✦</span>
            Prioritizează cu AI
          </button>

          {/* Group By Switcher */}
          <div className="flex items-center rounded-xl bg-white/[0.03] p-0.5">
            {[
              { id: 'horizon', label: 'Orizont' },
              { id: 'status', label: 'Status' },
              { id: 'department', label: 'Departament' },
            ].map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupBy(g.id as GroupByMode)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  groupBy === g.id
                    ? 'bg-white/[0.1] text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* STATUS PULSE PILLS */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'active', label: 'Toate active', count: pulseCounts.active },
            { id: 'today', label: 'Azi', count: pulseCounts.today },
            {
              id: 'overdue',
              label: 'Întârziate',
              count: pulseCounts.overdue,
              danger: pulseCounts.overdue > 0,
            },
            { id: 'mine', label: 'Ale mele', count: pulseCounts.mine },
            {
              id: 'pm_sync',
              label: '💬 Vlad (PM)',
              count: pulseCounts.pmSync,
              violet: pulseCounts.pmSync > 0,
            },
            {
              id: 'standalone',
              label: '⚡ Fără proiect',
              count: pulseCounts.standalone,
            },
            { id: 'done', label: 'Finalizate', count: pulseCounts.done },
          ].map((pill) => {
            const active = pulseFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setPulseFilter(pill.id as PulseFilter)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition ${
                  active
                    ? 'bg-white/[0.11] text-white'
                    : 'bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
                }`}
              >
                <span>{pill.label}</span>
                <span
                  className={`rounded px-1.5 py-0.2 font-mono text-[10px] ${
                    pill.danger
                      ? 'bg-rose-500/20 text-rose-300'
                      : pill.violet
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-white/[0.06] text-zinc-400'
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-xl border border-white/[0.07] bg-[#15171D] px-2.5 py-1.5 text-zinc-300 focus:outline-none"
          >
            <option value="">Toate dept.</option>
            {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
              <option key={k} value={k}>
                {DEPARTMENTS[k].label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrează..."
            className="w-36 rounded-xl border border-white/[0.07] bg-[#15171D] px-3 py-1.5 text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
      </div>

      {/* SMART 1-LINE QUICK-ADD BAR (FĂRĂ PROIECT OBLIGATORIU) */}
      <form
        onSubmit={handleQuickCreate}
        className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-[#15171D] p-3.5 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">+</span>
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Adaugă un task rapid (ex: Sunat coordonatorii @Petre !high maine)..."
            className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!quickTitle.trim() || creating}
            className="rounded-xl bg-zinc-100 px-3.5 py-1.5 font-medium text-zinc-900 transition hover:bg-white disabled:opacity-40"
          >
            {creating ? 'Salvez...' : 'Adaugă'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-2.5 text-[11px]">
          <select
            value={quickDept}
            onChange={(e) => setQuickDept(e.target.value as DepartmentKey)}
            className="rounded-lg border border-white/[0.07] bg-[#0F1014] px-2 py-1 text-zinc-300"
          >
            {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
              <option key={k} value={k}>
                {DEPARTMENTS[k].label}
              </option>
            ))}
          </select>

          <select
            value={quickProjectId}
            onChange={(e) => setQuickProjectId(e.target.value)}
            className="max-w-[180px] rounded-lg border border-white/[0.07] bg-[#0F1014] px-2 py-1 text-zinc-300"
          >
            <option value="">⚡ Fără proiect (Ad-hoc)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                📁 {p.title}
              </option>
            ))}
          </select>

          <div className="w-44">
            <AlumniSearchPicker
              people={people}
              tasks={tasks}
              value={quickAssigneeId}
              onChange={setQuickAssigneeId}
              onPersonCreated={onRefresh}
              placeholder="Responsabil..."
            />
          </div>

          <div className="w-40">
            <CalendarRangePicker
              startDate={quickStart}
              endDate={quickEnd}
              onChange={(s, e) => {
                setQuickStart(s);
                setQuickEnd(e);
              }}
            />
          </div>

          <select
            value={quickPriority}
            onChange={(e) => setQuickPriority(e.target.value as PriorityKey)}
            className="rounded-lg border border-white/[0.07] bg-[#0F1014] px-2 py-1 text-zinc-300"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>

          <button
            type="button"
            onClick={() => setQuickPmSync((v) => !v)}
            className={`rounded-lg border px-2 py-1 font-medium transition ${
              quickPmSync
                ? 'border-violet-400/40 bg-violet-500/20 text-violet-200'
                : 'border-white/[0.07] bg-[#0F1014] text-zinc-500 hover:text-zinc-300'
            }`}
          >
            💬 Vlad PM
          </button>
        </div>
      </form>

      {/* GROUPED TASK LISTS */}
      {groupedSections.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-[#15171D] py-14 text-center text-xs text-zinc-500">
          Niciun task în acest filtru. Folosește bara de mai sus sau spune-i lui Alumn-Bot ce ai de făcut.
        </div>
      ) : (
        <div className="space-y-4">
          {groupedSections.map((group) => (
            <section
              key={group.key}
              className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#15171D]"
            >
              <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.015] px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 font-medium text-zinc-200">
                  <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                  <span>{group.title}</span>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">
                  {group.items.length}
                </span>
              </div>

              <div className="divide-y divide-white/[0.04]">
                {group.items.map((t) => {
                  const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                  const prio = PRIORITY_META[t.priority || 'medium'];
                  const proj = t.project_id ? projectMap.get(t.project_id) : null;
                  const assignee = t.assignee_id ? personMap.get(t.assignee_id) : null;
                  const subs = tasks.filter((s) => s.parent_task_id === t.id);
                  const isOverdue = Boolean(
                    todayIso && t.status !== 'done' && t.deadline && t.deadline < todayIso
                  );
                  const isSelected = Boolean(selectedIds[t.id]);

                  return (
                    <div
                      key={t.id}
                      className={`group flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs transition ${
                        isSelected ? 'bg-emerald-500/[0.07]' : 'hover:bg-white/[0.025]'
                      }`}
                    >
                      {/* Left: Batch Select + Done Checkbox + Title */}
                      <div className="flex min-w-[240px] flex-1 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) =>
                            setSelectedIds((prev) => ({
                              ...prev,
                              [t.id]: e.target.checked,
                            }))
                          }
                          title="Selectează pentru acțiuni în masă"
                          className={`h-3.5 w-3.5 cursor-pointer rounded accent-sky-500 transition ${
                            isSelected ? 'opacity-100' : 'opacity-25 group-hover:opacity-100'
                          }`}
                        />

                        <button
                          type="button"
                          onClick={() => toggleDone(t)}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${
                            t.status === 'done'
                              ? 'border-emerald-500 bg-emerald-500 text-[10px] text-zinc-950'
                              : 'border-zinc-600 hover:border-emerald-400'
                          }`}
                        >
                          {t.status === 'done' ? '✓' : ''}
                        </button>

                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${prio.dot}`}
                          title={`Prioritate: ${prio.label}`}
                        />

                        <button
                          type="button"
                          onClick={() => onOpenTaskModal(t)}
                          className={`truncate text-left font-medium transition ${
                            t.status === 'done'
                              ? 'text-zinc-500 line-through'
                              : 'text-zinc-100 group-hover:text-white'
                          }`}
                        >
                          {t.type === 'milestone' ? '🟡 ' : ''}
                          {t.title}
                        </button>

                        {subs.length > 0 && (
                          <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                            ↳ {subs.filter((s) => s.status === 'done').length}/{subs.length}
                          </span>
                        )}
                      </div>

                      {/* Right: Hover Triage + Metadata Pills */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Quick Triage Actions on Hover */}
                        {t.status !== 'done' && (
                          <div className="hidden items-center gap-1 opacity-0 transition group-hover:opacity-100 sm:flex">
                            {todayIso && t.deadline !== todayIso && (
                              <button
                                type="button"
                                onClick={() =>
                                  quickPatchTask(t.id, {
                                    start_date: todayIso,
                                    deadline: todayIso,
                                  })
                                }
                                className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/[0.14]"
                              >
                                Azi
                              </button>
                            )}
                            {tomorrowIso && t.deadline !== tomorrowIso && (
                              <button
                                type="button"
                                onClick={() =>
                                  quickPatchTask(t.id, {
                                    start_date: tomorrowIso,
                                    deadline: tomorrowIso,
                                  })
                                }
                                className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/[0.14]"
                              >
                                Mâine
                              </button>
                            )}
                            {!t.project_id && (
                              <button
                                type="button"
                                onClick={() => promoteToProject(t.id)}
                                title="Transformă într-un proiect complet"
                                className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/25"
                              >
                                🚀 Proiect
                              </button>
                            )}
                          </div>
                        )}

                        {/* Vlad PM Flag Toggle */}
                        <button
                          type="button"
                          onClick={() =>
                            quickPatchTask(t.id, { needs_pm_sync: !t.needs_pm_sync })
                          }
                          title="Semnalează de discutat cu Vlad (PM)"
                          className={`rounded-md px-1.5 py-0.5 text-[10px] transition ${
                            t.needs_pm_sync
                              ? 'bg-violet-500/20 font-medium text-violet-200'
                              : 'text-zinc-600 opacity-0 hover:text-zinc-300 group-hover:opacity-100'
                          }`}
                        >
                          💬 PM
                        </button>

                        {/* Project or Standalone Pill */}
                        {proj ? (
                          <span className="max-w-[140px] truncate rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-400">
                            {proj.is_core_team ? '✦ ' : ''}
                            {proj.title}
                          </span>
                        ) : (
                          <span className="rounded-md bg-white/[0.02] px-2 py-0.5 text-[10px] text-zinc-600">
                            Ad-hoc
                          </span>
                        )}

                        {/* Department Dot */}
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
                          title={dept.label}
                        >
                          <span className={`h-2 w-2 rounded-full ${dept.dotBg}`} />
                        </span>

                        {/* Assignee */}
                        <span className="w-20 truncate text-right text-[11px] text-zinc-400">
                          {assignee ? assignee.full_name.split(' ')[0] : '—'}
                        </span>

                        {/* Deadline */}
                        <span
                          className={`w-12 text-right font-mono text-[11px] ${
                            isOverdue
                              ? 'font-semibold text-rose-400'
                              : t.deadline === todayIso
                                ? 'font-semibold text-emerald-400'
                                : 'text-zinc-500'
                          }`}
                        >
                          {t.deadline ? t.deadline.slice(5) : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* FLOATING BATCH ACTION BAR (LINEAR STYLE) */}
      {selectedIdList.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border border-white/[0.14] bg-[#181A22] px-4 py-2.5 text-xs shadow-2xl">
          <span className="font-mono font-semibold text-emerald-400">
            {selectedIdList.length} selectate
          </span>
          <div className="h-4 w-px bg-white/[0.1]" />

          <button
            type="button"
            disabled={batchBusy}
            onClick={() => runBatchOperation('done')}
            className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-zinc-200 hover:bg-white/[0.15]"
          >
            ✓ Done
          </button>
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => runBatchOperation('today')}
            className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-zinc-200 hover:bg-white/[0.15]"
          >
            Azi
          </button>
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => runBatchOperation('tomorrow')}
            className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-zinc-200 hover:bg-white/[0.15]"
          >
            Mâine
          </button>
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => runBatchOperation('pm_sync')}
            className="rounded-lg bg-violet-500/20 px-2.5 py-1 text-violet-200 hover:bg-violet-500/30"
          >
            💬 Vlad PM
          </button>

          {!groupingModalOpen ? (
            <button
              type="button"
              onClick={() => setGroupingModalOpen(true)}
              className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-sky-200 hover:bg-sky-500/30"
            >
              📁 Grupează în Proiect
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={groupProjectTitle}
                onChange={(e) => setGroupProjectTitle(e.target.value)}
                placeholder="Nume proiect..."
                className="w-36 rounded-lg border border-white/[0.1] bg-[#0F1014] px-2 py-1 text-zinc-100"
              />
              <button
                type="button"
                disabled={!groupProjectTitle.trim() || batchBusy}
                onClick={() =>
                  runBatchOperation('group_project', {
                    projectTitle: groupProjectTitle.trim(),
                  })
                }
                className="rounded-lg bg-zinc-100 px-2.5 py-1 font-medium text-zinc-900"
              >
                OK
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={batchBusy}
            onClick={() => runBatchOperation('delete')}
            className="rounded-lg px-2 py-1 text-rose-400 hover:bg-rose-500/15"
          >
            Șterge
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedIds({});
              setGroupingModalOpen(false);
            }}
            className="px-1.5 text-zinc-500 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}