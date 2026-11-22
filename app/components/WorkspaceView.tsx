'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEPARTMENTS,
  DepartmentKey,
  EventItem,
  PRIORITY_META,
  PartnerItem,
  Person,
  Project,
  ProjectNote,
  ResourceItem,
  TaskItem,
} from '../lib/pmp-types';
import type { OutlookCalendarEvent } from '../lib/outlook-graph';
import { AlumniSearchPicker, CalendarRangePicker } from './SmartControls';

type WorkspaceMode = 'gantt' | 'kanban' | 'calendar' | 'database';
type ZoomScale = 'day' | 'week' | 'month' | 'year';

interface TimelineColumn {
  key: string;
  label: string;
  subLabel?: string;
  startIso: string;
  endIso: string;
  isCurrent: boolean;
}

interface WorkspaceViewProps {
  people: Person[];
  projects: Project[];
  tasks: TaskItem[];
  resources: ResourceItem[];
  events: EventItem[];
  partners: PartnerItem[];
  projectNotes: ProjectNote[];
  outlookEvents?: OutlookCalendarEvent[];
  onRefresh: () => Promise<void>;
  onAskAiContext: (prompt: string) => void;
  onOpenTaskModal: (task: TaskItem) => void;
}

const KANBAN_COLUMNS: {
  id: TaskItem['status'];
  label: string;
  accent: string;
}[] = [
  { id: 'todo', label: 'To Do', accent: 'border-zinc-700 text-zinc-300' },
  { id: 'in_progress', label: 'In Progress', accent: 'border-sky-500/40 text-sky-300' },
  {
    id: 'waiting_review',
    label: 'Waiting Review',
    accent: 'border-amber-500/40 text-amber-300',
  },
  { id: 'done', label: 'Done', accent: 'border-emerald-500/40 text-emerald-300' },
];

const MONTHS_SHORT = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function diffDays(startIso: string, endIso: string): number {
  const [y1, m1, d1] = startIso.split('-').map(Number);
  const [y2, m2, d2] = endIso.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

export function WorkspaceView({
  people,
  projects,
  tasks,
  resources,
  events,
  partners,
  projectNotes,
  outlookEvents = [],
  onRefresh,
  onAskAiContext,
  onOpenTaskModal,
}: WorkspaceViewProps) {
  const [viewMode, setViewMode] = useState<WorkspaceMode>('gantt');
  const [zoomScale, setZoomScale] = useState<ZoomScale>('week');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Filtre comune
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterProject, setFilterProject] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [onlyMine, setOnlyMine] = useState<boolean>(false);

  // Timeline & Calendar state
  const [todayIso, setTodayIso] = useState<string | null>(null);
  const [periodOffset, setPeriodOffset] = useState<number>(0);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [inspectedColKey, setInspectedColKey] = useState<string | null>(null);

  // Creare inline task direct sub un proiect din Gantt
  const [inlineProjectId, setInlineProjectId] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const [inlineTaskType, setInlineTaskType] = useState<'task' | 'milestone'>('task');
  const [inlineAssigneeId, setInlineAssigneeId] = useState<string | null>(null);
  const [inlineStart, setInlineStart] = useState<string | null>(null);
  const [inlineEnd, setInlineEnd] = useState<string | null>(null);

  // Formular rapid Proiect Nou
  const [showNewProject, setShowNewProject] = useState(false);
  const [projTitle, setProjTitle] = useState('');
  const [projDept, setProjDept] = useState<DepartmentKey>('Tehnic');
  const [projOwnerId, setProjOwnerId] = useState<string | null>(null);
  const [projStart, setProjStart] = useState<string | null>(null);
  const [projDeadline, setProjDeadline] = useState<string | null>(null);

  // Panou lateral proiect
  const [drawerNoteText, setDrawerNoteText] = useState('');
  const [drawerNoteAiMem, setDrawerNoteAiMem] = useState(true);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const iso = new Date().toISOString().slice(0, 10);
    setTodayIso(iso);
  }, []);

  useEffect(() => {
    if (projects.length > 0 && Object.keys(expandedProjectIds).length === 0) {
      const initial: Record<string, boolean> = {};
      projects.forEach((p) => {
        initial[p.id] = true;
      });
      setExpandedProjectIds(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length]);

  const personMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const timelineCols = useMemo<TimelineColumn[]>(() => {
    if (!todayIso) return [];

    if (zoomScale === 'day') {
      const anchor = addDays(todayIso, -2 + periodOffset * 7);
      return Array.from({ length: 14 }, (_, i) => {
        const d = addDays(anchor, i);
        return {
          key: d,
          label: `${d.slice(8, 10)} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`,
          subLabel: d === todayIso ? 'AZI' : undefined,
          startIso: d,
          endIso: d,
          isCurrent: d === todayIso,
        };
      });
    }

    if (zoomScale === 'week') {
      const anchor = addDays(todayIso, -4 + periodOffset * 14);
      return Array.from({ length: 28 }, (_, i) => {
        const d = addDays(anchor, i);
        const dayNum = d.slice(8, 10);
        return {
          key: d,
          label: dayNum,
          subLabel: dayNum === '01' || i === 0 ? MONTHS_SHORT[Number(d.slice(5, 7)) - 1] : undefined,
          startIso: d,
          endIso: d,
          isCurrent: d === todayIso,
        };
      });
    }

    if (zoomScale === 'month') {
      const anchor = addDays(todayIso, -14 + periodOffset * 28);
      return Array.from({ length: 16 }, (_, i) => {
        const wStart = addDays(anchor, i * 7);
        const wEnd = addDays(wStart, 6);
        const isCurrent = todayIso >= wStart && todayIso <= wEnd;
        return {
          key: `w-${wStart}`,
          label: `${wStart.slice(8, 10)} ${MONTHS_SHORT[Number(wStart.slice(5, 7)) - 1]}`,
          subLabel: `S${i + 1}`,
          startIso: wStart,
          endIso: wEnd,
          isCurrent,
        };
      });
    }

    const baseYear = Number(todayIso.slice(0, 4)) + periodOffset;
    return Array.from({ length: 12 }, (_, mIdx) => {
      const mStart = new Date(Date.UTC(baseYear, mIdx, 1)).toISOString().slice(0, 10);
      const mEnd = new Date(Date.UTC(baseYear, mIdx + 1, 0)).toISOString().slice(0, 10);
      return {
        key: `m-${baseYear}-${mIdx}`,
        label: MONTHS_SHORT[mIdx],
        subLabel: String(baseYear),
        startIso: mStart,
        endIso: mEnd,
        isCurrent: todayIso >= mStart && todayIso <= mEnd,
      };
    });
  }, [todayIso, zoomScale, periodOffset]);

  const visibleProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterDept && p.department !== filterDept) return false;
      if (filterProject && p.id !== filterProject) return false;
      if (filterAssignee && p.owner_id !== filterAssignee) return false;
      return true;
    });
  }, [projects, filterDept, filterProject, filterAssignee]);

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterDept && t.department !== filterDept) return false;
      if (filterProject && t.project_id !== filterProject) return false;
      if (filterAssignee && t.assignee_id !== filterAssignee) return false;
      if (onlyMine && !t.is_my_task) return false;
      return true;
    });
  }, [tasks, filterDept, filterProject, filterAssignee, onlyMine]);

  const columnLoads = useMemo(() => {
    return timelineCols.map((col) => {
      const overlapping = visibleTasks.filter((t) => {
        if (t.status === 'done') return false;
        const s = t.start_date || t.deadline;
        const e = t.deadline || s;
        if (!s || !e) return false;
        return s <= col.endIso && e >= col.startIso;
      });
      const totalHours = overlapping.reduce(
        (acc, t) => acc + Number(t.estimated_hours || 2),
        0
      );
      return {
        col,
        tasks: overlapping,
        count: overlapping.length,
        hours: totalHours,
      };
    });
  }, [timelineCols, visibleTasks]);

  const inspectedLoad = inspectedColKey
    ? columnLoads.find((c) => c.col.key === inspectedColKey) || null
    : null;

  const selectedProject = selectedProjectId ? projectMap.get(selectedProjectId) || null : null;

  function openProjectDrawer(project: Project) {
    setSelectedProjectId(project.id);
    setExpandedProjectIds((prev) => ({ ...prev, [project.id]: true }));
  }

  function computeSpanPct(startIso: string | null, endIso: string | null) {
    if (timelineCols.length === 0 || !todayIso) return null;
    const winStart = timelineCols[0].startIso;
    const winEnd = timelineCols[timelineCols.length - 1].endIso;
    const totalWinDays = Math.max(1, diffDays(winStart, winEnd) + 1);

    const effStart = startIso || endIso || todayIso;
    const effEnd = endIso || effStart;

    if (effEnd < winStart || effStart > winEnd) return null;

    const clampedStart = effStart < winStart ? winStart : effStart;
    const clampedEnd = effEnd > winEnd ? winEnd : effEnd;

    const offsetDays = Math.max(0, diffDays(winStart, clampedStart));
    const durationDays = Math.max(1, diffDays(clampedStart, clampedEnd) + 1);

    const leftPct = (offsetDays / totalWinDays) * 100;
    const widthPct = Math.min(100 - leftPct, Math.max(2.2, (durationDays / totalWinDays) * 100));

    return { leftPct, widthPct };
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projTitle.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          title: projTitle.trim(),
          department: projDept,
          owner_id: projOwnerId,
          start_date: projStart || todayIso,
          deadline: projDeadline,
        }),
      });
      setProjTitle('');
      setProjStart(null);
      setProjDeadline(null);
      setShowNewProject(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateInlineTask(e: React.FormEvent, proj: Project) {
    e.preventDefault();
    if (!inlineTaskTitle.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: inlineTaskTitle.trim(),
          type: inlineTaskType,
          project_id: proj.id,
          department: proj.department,
          assignee_id: inlineAssigneeId,
          start_date: inlineStart || todayIso,
          deadline: inlineEnd || inlineStart || proj.deadline || todayIso,
          estimated_hours: 2,
          priority: 'medium',
        }),
      });
      setInlineTaskTitle('');
      setInlineAssigneeId(null);
      setInlineStart(null);
      setInlineEnd(null);
      setInlineProjectId(null);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function addProjectNote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProject || !drawerNoteText.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project_note',
          project_id: selectedProject.id,
          content: drawerNoteText.trim(),
          is_ai_memory: drawerNoteAiMem,
        }),
      });
      setDrawerNoteText('');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function updateTaskField(taskId: string, fields: Record<string, unknown>) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_task',
        id: taskId,
        ...fields,
      }),
    });
    await onRefresh();
  }

  const monthCalendarDays = useMemo(() => {
    if (!todayIso) return { year: 2026, month: 10, cells: [] as (string | null)[] };
    const [baseY, baseM] = todayIso.split('-').map(Number);
    const dt = new Date(Date.UTC(baseY, baseM - 1 + periodOffset, 1));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const startWeekday = (dt.getUTCDay() + 6) % 7;
    const daysCount = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysCount; d++) {
      cells.push(new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10));
    }
    return { year: y, month: m, cells };
  }, [todayIso, periodOffset]);

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-40 flex flex-col bg-zinc-950 text-zinc-100'
          : 'flex h-full flex-col'
      }
    >
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1 text-xs">
          {[
            { id: 'gantt', icon: '📊', label: 'Gantt + Load' },
            { id: 'kanban', icon: '📋', label: 'Kanban' },
            { id: 'calendar', icon: '🗓️', label: 'Calendar' },
            { id: 'database', icon: '🗃️', label: 'Database' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id as WorkspaceMode)}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                viewMode === tab.id
                  ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                  : 'border border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Filtre */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-200"
          >
            <option value="">Toate departamentele</option>
            {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
              <option key={k} value={k}>
                {DEPARTMENTS[k].label}
              </option>
            ))}
          </select>

          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="max-w-[160px] rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-200"
          >
            <option value="">Toate proiectele</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <div className="w-48">
            <AlumniSearchPicker
              people={people}
              tasks={tasks}
              value={filterAssignee || null}
              onChange={(id) => setFilterAssignee(id || '')}
              placeholder="Filtrează responsabil..."
            />
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-300">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>Ale mele</span>
          </label>

          <button
            type="button"
            onClick={() => setShowNewProject((p) => !p)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
          >
            + Proiect
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-medium text-zinc-200 hover:border-sky-500/50"
          >
            {isFullscreen ? '✕ Ieși Fullscreen' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      {/* FORMULAR PROIECT NOU */}
      {showNewProject && (
        <form
          onSubmit={handleCreateProject}
          className="grid gap-3 border-b border-zinc-800 bg-zinc-900/95 px-5 py-3 text-xs sm:grid-cols-5"
        >
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] text-zinc-400">Nume Proiect</label>
            <input
              type="text"
              required
              value={projTitle}
              onChange={(e) => setProjTitle(e.target.value)}
              placeholder="ex: Tabăra Alumni Vară 2027"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Departament</label>
            <select
              value={projDept}
              onChange={(e) => setProjDept(e.target.value as DepartmentKey)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-200"
            >
              {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                <option key={k} value={k}>
                  {DEPARTMENTS[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Coordonator Proiect</label>
            <AlumniSearchPicker
              people={people}
              tasks={tasks}
              value={projOwnerId}
              onChange={setProjOwnerId}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Perioadă (Calendar)</label>
            <div className="flex gap-1.5">
              <div className="flex-1">
                <CalendarRangePicker
                  startDate={projStart}
                  endDate={projDeadline}
                  onChange={(s, e) => {
                    setProjStart(s);
                    setProjDeadline(e);
                  }}
                  alignRight
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
              >
                OK
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 1. MASTER GANTT + CALENDAR LOAD HYBRID */}
      {viewMode === 'gantt' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[1500px] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">Scară timp:</span>
                <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                  {(
                    [
                      { id: 'day', label: 'Zi pe zi' },
                      { id: 'week', label: 'Săptămâni' },
                      { id: 'month', label: 'Luni' },
                      { id: 'year', label: 'An (12 luni)' },
                    ] as { id: ZoomScale; label: string }[]
                  ).map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => {
                        setZoomScale(z.id);
                        setPeriodOffset(0);
                      }}
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        zoomScale === z.id
                          ? 'border border-sky-500/40 bg-sky-500/20 text-sky-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o - 1)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  ← Înapoi
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset(0)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  Azi
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  Înainte →
                </button>
              </div>
            </div>

            {inspectedLoad && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs">
                <div>
                  <span className="font-semibold text-sky-300">
                    📊 Load {inspectedLoad.col.label} ({inspectedLoad.col.startIso} →{' '}
                    {inspectedLoad.col.endIso}):
                  </span>{' '}
                  <span className="text-zinc-200">
                    {inspectedLoad.count} task-uri active · {inspectedLoad.hours}h efort estimat
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedColKey(null)}
                  className="text-zinc-400 hover:text-zinc-100"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/70">
              <div className="min-w-[1020px]">
                <div className="grid grid-cols-[310px_1fr] border-b border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400">
                  <div className="border-r border-zinc-800 px-3.5 py-2 font-semibold uppercase tracking-wider">
                    Proiect → Task → Subtask
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, timelineCols.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    {timelineCols.map((col) => (
                      <div
                        key={col.key}
                        className={`border-r border-zinc-800/50 py-1.5 text-center font-mono ${
                          col.isCurrent ? 'bg-emerald-500/20 font-bold text-emerald-300' : ''
                        }`}
                      >
                        <div>{col.label}</div>
                        {col.subLabel && (
                          <div className="text-[9px] text-zinc-500">{col.subLabel}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rând Workload / Load Heatmap */}
                <div className="grid grid-cols-[310px_1fr] border-b border-zinc-800 bg-zinc-950/80 text-[10px]">
                  <div className="flex items-center justify-between border-r border-zinc-800 px-3.5 py-1.5 text-zinc-400">
                    <span>⚡ Load Organizație (Task-uri / Ore)</span>
                    <span className="text-[9px] text-zinc-500">click pe coloană</span>
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, timelineCols.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    {columnLoads.map(({ col, count, hours }) => {
                      const loadBg =
                        count === 0
                          ? 'text-zinc-600'
                          : hours >= 16 || count >= 5
                            ? 'bg-rose-500/25 text-rose-300 font-bold'
                            : hours >= 8 || count >= 3
                              ? 'bg-amber-500/20 text-amber-300 font-semibold'
                              : 'bg-emerald-500/15 text-emerald-300';

                      return (
                        <button
                          key={`load-${col.key}`}
                          type="button"
                          onClick={() => setInspectedColKey(col.key)}
                          title={`${col.label}: ${count} task-uri active (${hours}h)`}
                          className={`border-r border-zinc-800/40 py-1 text-center font-mono transition hover:brightness-125 ${loadBg}`}
                        >
                          {count > 0 ? `${count}t` : '·'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Proiecte */}
                {visibleProjects.length === 0 ? (
                  <div className="p-10 text-center text-xs text-zinc-500">
                    Niciun proiect găsit. Apasă „+ Proiect” din bara de sus pentru a începe.
                  </div>
                ) : (
                  visibleProjects.map((proj) => {
                    const meta = DEPARTMENTS[proj.department] || DEPARTMENTS.Board;
                    const isExpanded = Boolean(expandedProjectIds[proj.id]);
                    const rootTasks = visibleTasks.filter(
                      (t) => t.project_id === proj.id && !t.parent_task_id
                    );
                    const milestones = rootTasks.filter((t) => t.type === 'milestone');
                    const projSpan = computeSpanPct(proj.start_date, proj.deadline);

                    return (
                      <div key={proj.id} className="border-b border-zinc-800/80 last:border-b-0">
                        <div className="group grid grid-cols-[310px_1fr] items-center hover:bg-zinc-800/25">
                          <div className="flex items-center justify-between gap-2 border-r border-zinc-800 px-3 py-2.5 text-xs">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedProjectIds((prev) => ({
                                    ...prev,
                                    [proj.id]: !prev[proj.id],
                                  }))
                                }
                                className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                              >
                                {isExpanded ? '▾' : '▸'}
                              </button>

                              <button
                                type="button"
                                onClick={() => openProjectDrawer(proj)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="truncate font-semibold text-zinc-100 hover:text-emerald-300">
                                  {proj.title}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                  <span
                                    className={`rounded px-1.5 py-0.2 text-[10px] ${meta.badgeBg} ${meta.badgeText}`}
                                  >
                                    {meta.label}
                                  </span>
                                  <span className="font-mono text-[10px] text-zinc-400">
                                    {proj.progress}%
                                  </span>
                                </div>
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setInlineProjectId(
                                  inlineProjectId === proj.id ? null : proj.id
                                );
                                setExpandedProjectIds((prev) => ({ ...prev, [proj.id]: true }));
                              }}
                              className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/10"
                            >
                              + Task
                            </button>
                          </div>

                          <div
                            onClick={() => openProjectDrawer(proj)}
                            className="relative h-12 cursor-pointer"
                          >
                            {projSpan && (
                              <>
                                <div
                                  style={{
                                    left: `${projSpan.leftPct}%`,
                                    width: `${projSpan.widthPct}%`,
                                  }}
                                  className={`absolute top-3 h-6 overflow-hidden rounded-md border ${meta.border} bg-zinc-800 shadow`}
                                >
                                  <div
                                    className={`h-full ${meta.barBg} opacity-75 transition-all`}
                                    style={{ width: `${proj.progress}%` }}
                                  />
                                  {projSpan.widthPct >= 18 && (
                                    <span className="absolute inset-0 flex items-center truncate px-2 font-mono text-[10px] font-semibold text-white">
                                      {proj.progress}% · {proj.title}
                                    </span>
                                  )}
                                </div>

                                {projSpan.widthPct < 18 && (
                                  <span
                                    style={{
                                      left: `calc(${Math.min(82, projSpan.leftPct + projSpan.widthPct)}% + 6px)`,
                                    }}
                                    className="pointer-events-none absolute top-3.5 whitespace-nowrap font-mono text-[10px] font-semibold text-zinc-200"
                                  >
                                    {proj.progress}% · {proj.title}
                                  </span>
                                )}
                              </>
                            )}

                            {milestones.map((ms) => {
                              const msSpan = computeSpanPct(ms.deadline, ms.deadline);
                              if (!msSpan) return null;
                              return (
                                <div
                                  key={ms.id}
                                  style={{ left: `${msSpan.leftPct}%` }}
                                  title={`Milestone: ${ms.title} (${ms.deadline})`}
                                  className={`absolute top-1.5 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-zinc-950 ${
                                    ms.is_milestone_approved
                                      ? 'bg-emerald-400 ring-2 ring-emerald-400/40'
                                      : 'bg-amber-400 ring-2 ring-amber-400/40'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </div>

                        {inlineProjectId === proj.id && (
                          <form
                            onSubmit={(e) => handleCreateInlineTask(e, proj)}
                            className="grid gap-2 border-t border-emerald-500/30 bg-emerald-950/20 px-6 py-2.5 text-xs sm:grid-cols-[110px_1fr_190px_190px_auto]"
                          >
                            <select
                              value={inlineTaskType}
                              onChange={(e) =>
                                setInlineTaskType(e.target.value as 'task' | 'milestone')
                              }
                              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200"
                            >
                              <option value="task">⚡ Task</option>
                              <option value="milestone">🟡 Milestone</option>
                            </select>
                            <input
                              type="text"
                              autoFocus
                              required
                              value={inlineTaskTitle}
                              onChange={(e) => setInlineTaskTitle(e.target.value)}
                              placeholder={`Task nou în „${proj.title}”...`}
                              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-zinc-100"
                            />
                            <AlumniSearchPicker
                              people={people}
                              tasks={tasks}
                              value={inlineAssigneeId}
                              onChange={setInlineAssigneeId}
                              placeholder="Responsabil..."
                            />
                            <CalendarRangePicker
                              startDate={inlineStart}
                              endDate={inlineEnd}
                              onChange={(s, e) => {
                                setInlineStart(s);
                                setInlineEnd(e);
                              }}
                              alignRight
                            />
                            <div className="flex gap-1">
                              <button
                                type="submit"
                                className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500"
                              >
                                Adaugă
                              </button>
                              <button
                                type="button"
                                onClick={() => setInlineProjectId(null)}
                                className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800"
                              >
                                ✕
                              </button>
                            </div>
                          </form>
                        )}

                        {isExpanded &&
                          rootTasks.map((t) => {
                            const subtasks = tasks.filter((st) => st.parent_task_id === t.id);
                            const isTaskExpanded = Boolean(expandedTaskIds[t.id]);
                            const tSpan = computeSpanPct(t.start_date, t.deadline);
                            const assignee = t.assignee_id
                              ? personMap.get(t.assignee_id)?.full_name
                              : null;
                            const prio = PRIORITY_META[t.priority || 'medium'];
                            const isBlocked = Boolean(
                              t.blocked_by_id &&
                                taskMap.get(t.blocked_by_id)?.status !== 'done'
                            );

                            return (
                              <div key={t.id} className="bg-zinc-950/50">
                                <div className="group grid grid-cols-[310px_1fr] items-center border-t border-zinc-800/50 text-xs hover:bg-zinc-900/70">
                                  <div className="flex items-center justify-between gap-1.5 border-r border-zinc-800 py-2 pl-6 pr-3">
                                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                      {subtasks.length > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedTaskIds((prev) => ({
                                              ...prev,
                                              [t.id]: !prev[t.id],
                                            }))
                                          }
                                          className="text-[10px] text-zinc-400 hover:text-zinc-100"
                                        >
                                          {isTaskExpanded ? '▾' : '▸'}
                                        </button>
                                      ) : (
                                        <span className="w-2.5" />
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => onOpenTaskModal(t)}
                                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                      >
                                        <span>
                                          {t.type === 'milestone'
                                            ? t.is_milestone_approved
                                              ? '🟢'
                                              : '🟡'
                                            : isBlocked
                                              ? '🔒'
                                              : t.status === 'done'
                                                ? '✅'
                                                : '•'}
                                        </span>
                                        <span
                                          className={`truncate font-medium hover:text-emerald-300 ${
                                            t.status === 'done'
                                              ? 'text-zinc-500 line-through'
                                              : 'text-zinc-200'
                                          }`}
                                        >
                                          {t.title}
                                        </span>
                                      </button>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {subtasks.length > 0 && (
                                        <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[10px] text-zinc-400">
                                          {subtasks.filter((s) => s.status === 'done').length}/
                                          {subtasks.length}
                                        </span>
                                      )}
                                      <span
                                        className={`h-2 w-2 rounded-full ${prio.dot}`}
                                        title={`Prioritate: ${prio.label}`}
                                      />
                                      {assignee && (
                                        <span className="text-[10px] text-zinc-400">
                                          {assignee.split(' ')[0]}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div
                                    onClick={() => onOpenTaskModal(t)}
                                    className="relative h-9 cursor-pointer"
                                  >
                                    {tSpan && (
                                      <>
                                        <div
                                          style={{
                                            left: `${tSpan.leftPct}%`,
                                            width: `${tSpan.widthPct}%`,
                                          }}
                                          title={`${t.title} · ${assignee || 'Nealocat'} · ${t.estimated_hours}h`}
                                          className={`absolute top-2 h-5 rounded-md border px-2 text-[10px] leading-5 transition hover:brightness-125 ${
                                            t.type === 'milestone'
                                              ? t.is_milestone_approved
                                                ? 'border-emerald-500/50 bg-emerald-500/25 text-emerald-200'
                                                : 'border-amber-500/50 bg-amber-500/25 text-amber-200'
                                              : t.status === 'done'
                                                ? 'border-zinc-700 bg-zinc-800/80 text-zinc-400'
                                                : 'border-sky-500/40 bg-sky-500/20 text-sky-100'
                                          }`}
                                        >
                                          {tSpan.widthPct >= 16 && (
                                            <span className="block truncate font-medium">
                                              {t.title}
                                            </span>
                                          )}
                                        </div>

                                        {tSpan.widthPct < 16 && (
                                          <span
                                            style={{
                                              left: `calc(${Math.min(82, tSpan.leftPct + tSpan.widthPct)}% + 6px)`,
                                            }}
                                            className="pointer-events-none absolute top-2.5 whitespace-nowrap text-[11px] font-medium text-zinc-300"
                                          >
                                            {t.title}
                                            {assignee ? ` · ${assignee.split(' ')[0]}` : ''}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>

                                {isTaskExpanded &&
                                  subtasks.map((sub) => {
                                    const subSpan = computeSpanPct(sub.start_date, sub.deadline);
                                    return (
                                      <div
                                        key={sub.id}
                                        onClick={() => onOpenTaskModal(sub)}
                                        className="grid cursor-pointer grid-cols-[310px_1fr] items-center border-t border-zinc-800/30 bg-zinc-950/90 text-[11px] hover:bg-zinc-900/50"
                                      >
                                        <div className="truncate border-r border-zinc-800 py-1.5 pl-12 pr-3 text-zinc-400">
                                          ↳ {sub.status === 'done' ? '✓ ' : ''}
                                          {sub.title}
                                        </div>
                                        <div className="relative h-7">
                                          {subSpan && (
                                            <>
                                              <div
                                                style={{
                                                  left: `${subSpan.leftPct}%`,
                                                  width: `${subSpan.widthPct}%`,
                                                }}
                                                className="absolute top-1.5 h-3.5 rounded bg-zinc-700/80"
                                              />
                                              <span
                                                style={{
                                                  left: `calc(${Math.min(82, subSpan.leftPct + subSpan.widthPct)}% + 6px)`,
                                                }}
                                                className="pointer-events-none absolute top-1.5 whitespace-nowrap text-[10px] text-zinc-400"
                                              >
                                                {sub.title}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-x-auto p-5">
          <div className="mx-auto grid min-w-[960px] max-w-[1400px] grid-cols-4 gap-3.5">
            {KANBAN_COLUMNS.map((col) => {
              const colTasks = visibleTasks.filter(
                (t) => t.status === col.id && !t.parent_task_id
              );

              return (
                <div
                  key={col.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedTaskId) {
                      updateTaskField(draggedTaskId, { status: col.id });
                      setDraggedTaskId(null);
                    }
                  }}
                  className="flex min-h-[520px] flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                >
                  <div
                    className={`mb-3 flex items-center justify-between border-b pb-2 text-xs font-semibold ${col.accent}`}
                  >
                    <span>{col.label}</span>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-2">
                    {colTasks.map((t) => {
                      const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                      const prio = PRIORITY_META[t.priority || 'medium'];
                      const proj = t.project_id ? projectMap.get(t.project_id) : null;
                      const assignee = t.assignee_id ? personMap.get(t.assignee_id) : null;
                      const subs = tasks.filter((s) => s.parent_task_id === t.id);

                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDraggedTaskId(t.id)}
                          onClick={() => onOpenTaskModal(t)}
                          className="cursor-pointer rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs shadow transition hover:border-emerald-500/40"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${dept.badgeBg} ${dept.badgeText}`}
                            >
                              {dept.label}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${prio.badgeBg} ${prio.badgeText}`}
                            >
                              {prio.label}
                            </span>
                          </div>

                          <p className="mt-2 font-medium text-zinc-100">{t.title}</p>

                          {proj && (
                            <p className="mt-1 truncate text-[11px] text-zinc-500">
                              📁 {proj.title}
                            </p>
                          )}

                          <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-[11px] text-zinc-400">
                            <span>{assignee ? `👤 ${assignee.full_name}` : 'Nealocat'}</span>
                            <div className="flex items-center gap-2 font-mono">
                              {subs.length > 0 && (
                                <span>
                                  ↳ {subs.filter((s) => s.status === 'done').length}/{subs.length}
                                </span>
                              )}
                              {t.deadline && <span>{t.deadline.slice(5)}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. CALENDAR VIEW LUNAR (PMP + OUTLOOK EVENTS) */}
      {viewMode === 'calendar' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-6xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-100">
                  🗓️ {MONTHS_SHORT[monthCalendarDays.month]} {monthCalendarDays.year}
                </h3>
                {outlookEvents.length > 0 && (
                  <span className="rounded border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">
                    📅 {outlookEvents.length} evenimente Outlook sincronizate
                  </span>
                )}
              </div>

              <div className="flex gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o - 1)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300"
                >
                  ← Luna anterioară
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset(0)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300"
                >
                  Azi
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-300"
                >
                  Luna următoare →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
              {['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'].map((d) => (
                <div
                  key={d}
                  className="border-b border-r border-zinc-800 bg-zinc-950 py-2 text-center text-[11px] font-semibold text-zinc-400"
                >
                  {d}
                </div>
              ))}

              {monthCalendarDays.cells.map((iso, idx) => {
                if (!iso) {
                  return (
                    <div
                      key={`empty-cal-${idx}`}
                      className="min-h-[115px] border-b border-r border-zinc-800/60 bg-zinc-950/40"
                    />
                  );
                }

                const dayTasks = visibleTasks.filter((t) => {
                  const s = t.start_date || t.deadline;
                  const e = t.deadline || s;
                  return Boolean(s && e && iso >= s && iso <= e);
                });

                const dayOutlook = outlookEvents.filter((ev) => {
                  if (ev.isAppSyncedTask) return false;
                  const s = ev.start.slice(0, 10);
                  const e = ev.end ? ev.end.slice(0, 10) : s;
                  return Boolean(s && iso >= s && iso <= e);
                });

                const isToday = iso === todayIso;

                return (
                  <div
                    key={iso}
                    className={`min-h-[115px] border-b border-r border-zinc-800/60 p-1.5 text-xs ${
                      isToday ? 'bg-emerald-500/10' : ''
                    }`}
                  >
                    <div
                      className={`mb-1 font-mono text-[11px] ${
                        isToday ? 'font-bold text-emerald-300' : 'text-zinc-500'
                      }`}
                    >
                      {Number(iso.slice(8, 10))}
                    </div>

                    <div className="space-y-1">
                      {dayOutlook.slice(0, 2).map((ev) => (
                        <a
                          key={ev.id}
                          href={ev.onlineMeetingUrl || ev.webLink || '#'}
                          target={ev.onlineMeetingUrl || ev.webLink ? '_blank' : undefined}
                          rel="noopener noreferrer"
                          title={`Outlook: ${ev.subject} (${ev.start.slice(11, 16)} - ${ev.end.slice(11, 16)})`}
                          className="block w-full truncate rounded border border-indigo-500/30 bg-indigo-500/20 px-1.5 py-0.5 text-left text-[10px] font-medium text-indigo-200 hover:brightness-125"
                        >
                          📅 {!ev.isAllDay ? `${ev.start.slice(11, 16)} ` : ''}
                          {ev.subject}
                        </a>
                      ))}

                      {dayTasks.slice(0, 3).map((t) => {
                        const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onOpenTaskModal(t)}
                            className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${dept.badgeBg} ${dept.badgeText} hover:brightness-125`}
                          >
                            {t.type === 'milestone' ? '🟡 ' : ''}
                            {t.title}
                          </button>
                        );
                      })}

                      {dayTasks.length + dayOutlook.length > 5 && (
                        <div className="text-[10px] text-zinc-500">
                          +{dayTasks.length + dayOutlook.length - 5} altele
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 4. DATABASE VIEW */}
      {viewMode === 'database' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-6xl overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/80">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-[11px] uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5">Titlu</th>
                  <th className="px-3 py-2.5">Proiect</th>
                  <th className="px-3 py-2.5">Prioritate</th>
                  <th className="px-3 py-2.5">Responsabil</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Load</th>
                  <th className="px-3 py-2.5">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {visibleTasks.map((t) => {
                  const prio = PRIORITY_META[t.priority || 'medium'];
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onOpenTaskModal(t)}
                      className="cursor-pointer hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium text-zinc-100">
                        {t.parent_task_id ? '↳ ' : ''}
                        {t.title}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">
                        {t.project_id ? projectMap.get(t.project_id)?.title || '-' : 'Individual'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-medium ${prio.badgeBg} ${prio.badgeText}`}
                        >
                          {prio.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-300">
                        {t.assignee_id ? personMap.get(t.assignee_id)?.full_name : 'Nealocat'}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-300">{t.status}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">
                        {t.estimated_hours}h
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">
                        {t.deadline || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PANOU LATERAL DETALII PROIECT (PROGRES AUTOMAT, FĂRĂ SLIDER MANUAL) */}
      {selectedProject && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
            <div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  DEPARTMENTS[selectedProject.department]?.badgeBg
                } ${DEPARTMENTS[selectedProject.department]?.badgeText}`}
              >
                {DEPARTMENTS[selectedProject.department]?.label}
              </span>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">
                {selectedProject.title}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onAskAiContext(
                    `Analizează proiectul „${selectedProject.title}” (progres ${selectedProject.progress}%, deadline ${selectedProject.deadline || 'nesetat'}): ce task-uri sunt blocate și ce recomandări ai?`
                  )
                }
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300"
              >
                🤖 Ask AI
              </button>
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-4 text-xs">
            {(() => {
              const projItems = tasks.filter(
                (t) => t.project_id === selectedProject.id && !t.parent_task_id
              );
              const doneCount = projItems.filter(
                (t) =>
                  t.status === 'done' ||
                  (t.type === 'milestone' && t.is_milestone_approved)
              ).length;

              const starts = projItems
                .map((t) => t.start_date || t.deadline)
                .filter(Boolean) as string[];
              const ends = projItems
                .map((t) => t.deadline || t.start_date)
                .filter(Boolean) as string[];

              const minStart = starts.length ? starts.sort()[0] : selectedProject.start_date;
              const maxEnd = ends.length ? ends.sort().reverse()[0] : selectedProject.deadline;

              let schedulePct = 0;
              if (todayIso && minStart && maxEnd && maxEnd >= minStart) {
                const totalDays = Math.max(1, diffDays(minStart, maxEnd) + 1);
                const elapsedDays = Math.min(
                  totalDays,
                  Math.max(0, diffDays(minStart, todayIso) + 1)
                );
                schedulePct = Math.round((elapsedDays / totalDays) * 100);
              }

              return (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">
                      Progres Automat (din Task-uri)
                    </span>
                    <span className="font-mono text-sm font-bold text-emerald-400">
                      {selectedProject.progress}%
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${selectedProject.progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>
                      ✓ {doneCount}/{projItems.length} livrabile finalizate
                    </span>
                    {maxEnd && (
                      <span className="font-mono">
                        Timp scurs: {schedulePct}% (până la {maxEnd})
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3.5">
              <h4 className="font-semibold text-zinc-200">📝 Notițe Specifice Proiectului</h4>
              <form onSubmit={addProjectNote} className="space-y-2">
                <textarea
                  rows={2}
                  value={drawerNoteText}
                  onChange={(e) => setDrawerNoteText(e.target.value)}
                  placeholder="Scrie un status update pe acest proiect..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100"
                />
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-violet-300">
                    <input
                      type="checkbox"
                      checked={drawerNoteAiMem}
                      onChange={(e) => setDrawerNoteAiMem(e.target.checked)}
                      className="accent-violet-500"
                    />
                    <span>📌 Memorie AI</span>
                  </label>
                  <button
                    type="submit"
                    disabled={!drawerNoteText.trim() || busy}
                    className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-40"
                  >
                    Adaugă Update
                  </button>
                </div>
              </form>

              <div className="space-y-1.5">
                {projectNotes
                  .filter((n) => n.project_id === selectedProject.id)
                  .map((n) => (
                    <div
                      key={n.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    >
                      <div className="text-[10px] text-zinc-500">
                        {new Date(n.created_at).toLocaleDateString('ro-RO')}
                      </div>
                      <p className="mt-0.5 text-zinc-200">{n.content}</p>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}