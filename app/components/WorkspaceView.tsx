'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
type ScopeFilter = 'all' | 'core_team' | 'alumni';

interface TimelineColumn {
  key: string;
  label: string;
  subLabel?: string;
  startIso: string;
  endIso: string;
  isCurrent: boolean;
  isWeekend: boolean;
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
  selectedDepartment?: DepartmentKey | null;
  selectedProjectFromNav?: string | null;
  onlyCoreTeamFromNav?: boolean;
  onClearNavSelection?: () => void;
  onRefresh: () => Promise<void>;
  onAskAiContext: (prompt: string) => void;
  onOpenTaskModal: (task: TaskItem) => void;
}

const KANBAN_COLUMNS: {
  id: TaskItem['status'];
  label: string;
  dot: string;
}[] = [
  { id: 'todo', label: 'To Do', dot: 'bg-zinc-500' },
  { id: 'in_progress', label: 'In Progress', dot: 'bg-sky-400' },
  { id: 'waiting_review', label: 'Waiting Review', dot: 'bg-amber-400' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-400' },
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

function isWeekendIso(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function WorkspaceView({
  people,
  projects,
  tasks,
  projectNotes,
  outlookEvents = [],
  selectedDepartment = null,
  selectedProjectFromNav = null,
  onlyCoreTeamFromNav = false,
  onClearNavSelection,
  onRefresh,
  onAskAiContext,
  onOpenTaskModal,
}: WorkspaceViewProps) {
  const [viewMode, setViewMode] = useState<WorkspaceMode>('gantt');
  const [zoomScale, setZoomScale] = useState<ZoomScale>('week');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLoadHeatmap, setShowLoadHeatmap] = useState(false);

  // Popover Filtre
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
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
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Creare inline task direct sub un proiect în Timeline
  const [inlineProjectId, setInlineProjectId] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const [inlineTaskType, setInlineTaskType] = useState<'task' | 'milestone'>('task');
  const [inlineAssigneeId, setInlineAssigneeId] = useState<string | null>(null);
  const [inlineStart, setInlineStart] = useState<string | null>(null);
  const [inlineEnd, setInlineEnd] = useState<string | null>(null);

  // Formular Proiect Nou
  const [showNewProject, setShowNewProject] = useState(false);
  const [projTitle, setProjTitle] = useState('');
  const [projDept, setProjDept] = useState<DepartmentKey>('Tehnic');
  const [projOwnerId, setProjOwnerId] = useState<string | null>(null);
  const [projStart, setProjStart] = useState<string | null>(null);
  const [projDeadline, setProjDeadline] = useState<string | null>(null);
  const [projIsCoreTeam, setProjIsCoreTeam] = useState<boolean>(false);

  // State-uri pentru Project Side Drawer (editare completă + task-uri)
  const [drawerTitle, setDrawerTitle] = useState('');
  const [drawerDesc, setDrawerDesc] = useState('');
  const [drawerDept, setDrawerDept] = useState<DepartmentKey>('Tehnic');
  const [drawerOwnerId, setDrawerOwnerId] = useState<string | null>(null);
  const [drawerStatus, setDrawerStatus] = useState<Project['status']>('active');
  const [drawerIsCoreTeam, setDrawerIsCoreTeam] = useState(false);
  const [drawerNeedsPmSync, setDrawerNeedsPmSync] = useState(false);
  const [drawerBlockedByProjectId, setDrawerBlockedByProjectId] = useState<string | null>(null);
  const [drawerStart, setDrawerStart] = useState<string | null>(null);
  const [drawerDeadline, setDrawerDeadline] = useState<string | null>(null);
  const [drawerDetailsDirty, setDrawerDetailsDirty] = useState(false);

  // Creare task rapid direct în Project Side Drawer
  const [drawerAddingTask, setDrawerAddingTask] = useState(false);
  const [drawerNewTaskTitle, setDrawerNewTaskTitle] = useState('');
  const [drawerNewTaskType, setDrawerNewTaskType] = useState<'task' | 'milestone'>('task');
  const [drawerNewTaskAssignee, setDrawerNewTaskAssignee] = useState<string | null>(null);
  const [drawerNewTaskDeadline, setDrawerNewTaskDeadline] = useState<string | null>(null);

  // Notițe în Project Side Drawer
  const [drawerNoteText, setDrawerNoteText] = useState('');
  const [drawerNoteAiMem, setDrawerNoteAiMem] = useState(true);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTodayIso(new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (
        filterPopoverRef.current &&
        !filterPopoverRef.current.contains(e.target as Node)
      ) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  useEffect(() => {
    if (selectedDepartment) {
      setProjDept(selectedDepartment);
    }
  }, [selectedDepartment]);

  useEffect(() => {
    if (onlyCoreTeamFromNav) {
      setScopeFilter('core_team');
      setProjIsCoreTeam(true);
    } else if (!selectedDepartment && !selectedProjectFromNav) {
      setScopeFilter('all');
    }
  }, [onlyCoreTeamFromNav, selectedDepartment, selectedProjectFromNav]);

  useEffect(() => {
    if (selectedProjectFromNav) {
      setExpandedProjectIds((prev) => ({ ...prev, [selectedProjectFromNav]: true }));
      const p = projects.find((item) => item.id === selectedProjectFromNav);
      if (p) openProjectDrawer(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectFromNav]);

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

  const effectiveDept = selectedDepartment || filterDept;
  const effectiveProject = selectedProjectFromNav || filterProject;

  const activeFiltersCount = [
    !selectedDepartment && filterDept,
    !selectedProjectFromNav && filterProject,
    filterAssignee,
    onlyMine ? 'mine' : '',
  ].filter(Boolean).length;

  const timelineCols = useMemo<TimelineColumn[]>(() => {
    if (!todayIso) return [];

    if (zoomScale === 'day') {
      const anchor = addDays(todayIso, -2 + periodOffset * 7);
      return Array.from({ length: 14 }, (_, i) => {
        const d = addDays(anchor, i);
        return {
          key: d,
          label: `${d.slice(8, 10)} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`,
          subLabel: d === todayIso ? 'Azi' : undefined,
          startIso: d,
          endIso: d,
          isCurrent: d === todayIso,
          isWeekend: isWeekendIso(d),
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
          subLabel:
            dayNum === '01' || i === 0 ? MONTHS_SHORT[Number(d.slice(5, 7)) - 1] : undefined,
          startIso: d,
          endIso: d,
          isCurrent: d === todayIso,
          isWeekend: isWeekendIso(d),
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
          isWeekend: false,
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
        isWeekend: false,
      };
    });
  }, [todayIso, zoomScale, periodOffset]);

  const visibleProjects = useMemo(() => {
    return projects.filter((p) => {
      if (scopeFilter === 'core_team' && !p.is_core_team) return false;
      if (scopeFilter === 'alumni' && p.is_core_team) return false;
      if (effectiveDept && p.department !== effectiveDept) return false;
      if (effectiveProject && p.id !== effectiveProject) return false;
      if (filterAssignee && p.owner_id !== filterAssignee) return false;
      return true;
    });
  }, [projects, scopeFilter, effectiveDept, effectiveProject, filterAssignee]);

  const coreTeamProjects = useMemo(
    () => visibleProjects.filter((p) => p.is_core_team),
    [visibleProjects]
  );
  const alumniProjects = useMemo(
    () => visibleProjects.filter((p) => !p.is_core_team),
    [visibleProjects]
  );

  const visibleProjectIdSet = useMemo(
    () => new Set(visibleProjects.map((p) => p.id)),
    [visibleProjects]
  );

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (scopeFilter !== 'all') {
        if (!t.project_id || !visibleProjectIdSet.has(t.project_id)) return false;
      }
      if (effectiveDept && t.department !== effectiveDept) return false;
      if (effectiveProject && t.project_id !== effectiveProject) return false;
      if (filterAssignee && t.assignee_id !== filterAssignee) return false;
      if (onlyMine && !t.is_my_task) return false;
      return true;
    });
  }, [tasks, scopeFilter, visibleProjectIdSet, effectiveDept, effectiveProject, filterAssignee, onlyMine]);

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
    setDrawerNeedsPmSync(Boolean(project.needs_pm_sync));
    setSelectedProjectId(project.id);
    setDrawerTitle(project.title);
    setDrawerDesc(project.description || '');
    setDrawerDept(project.department);
    setDrawerOwnerId(project.owner_id);
    setDrawerStatus(project.status);
    setDrawerIsCoreTeam(Boolean(project.is_core_team));
    setDrawerBlockedByProjectId(project.blocked_by_project_id || null);
    setDrawerStart(project.start_date);
    setDrawerDeadline(project.deadline);
    setDrawerDetailsDirty(false);
    setDrawerAddingTask(false);
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
    const widthPct = Math.min(100 - leftPct, Math.max(2.4, (durationDays / totalWinDays) * 100));

    return { leftPct, widthPct };
  }

  const todayLinePct = useMemo(() => {
    if (!todayIso || timelineCols.length === 0) return null;
    const winStart = timelineCols[0].startIso;
    const winEnd = timelineCols[timelineCols.length - 1].endIso;
    if (todayIso < winStart || todayIso > winEnd) return null;
    const totalWinDays = Math.max(1, diffDays(winStart, winEnd) + 1);
    const offset = diffDays(winStart, todayIso) + 0.5;
    return (offset / totalWinDays) * 100;
  }, [todayIso, timelineCols]);

  function copyDepartmentSummary(deptKey: DepartmentKey) {
    const meta = DEPARTMENTS[deptKey];
    const coord = people.find(
      (p) =>
        p.department === deptKey &&
        (p.role === 'Coordonator' || (deptKey === 'Board' && p.role === 'Lider'))
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
      `📊 Progres mediu proiecte active: *${avgProgress}%*`,
      '',
      '*Proiecte:*',
      ...(deptProjects.length
        ? deptProjects.map((p) => `• ${p.title} — ${p.progress}%`)
        : ['• Niciun proiect activ']),
      '',
      '*Task-uri deschise:*',
      ...(deptTasks.length
        ? deptTasks.map((t) => {
            const assignee = t.assignee_id ? personMap.get(t.assignee_id)?.full_name : null;
            return `• ${t.title}${assignee ? ` (@${assignee})` : ''}${t.deadline ? ` — ${t.deadline}` : ''}`;
          })
        : ['• Totul finalizat!']),
    ].filter((l) => l !== null);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
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
          is_core_team: projIsCoreTeam,
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

  async function handleSaveProjectDrawer() {
    if (!selectedProject || !drawerTitle.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project',
          needs_pm_sync: drawerNeedsPmSync,
          id: selectedProject.id,
          title: drawerTitle.trim(),
          description: drawerDesc.trim() || null,
          department: drawerDept,
          owner_id: drawerOwnerId,
          status: drawerStatus,
          is_core_team: drawerIsCoreTeam,
          blocked_by_project_id: drawerBlockedByProjectId,
          start_date: drawerStart,
          deadline: drawerDeadline,
        }),
      });
      setDrawerDetailsDirty(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_project', id: projectId }),
      });
      setSelectedProjectId(null);
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

  async function handleCreateDrawerTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProject || !drawerNewTaskTitle.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: drawerNewTaskTitle.trim(),
          type: drawerNewTaskType,
          project_id: selectedProject.id,
          department: selectedProject.department,
          assignee_id: drawerNewTaskAssignee,
          start_date: todayIso,
          deadline: drawerNewTaskDeadline || selectedProject.deadline || todayIso,
          estimated_hours: 2,
          priority: 'medium',
        }),
      });
      setDrawerNewTaskTitle('');
      setDrawerNewTaskAssignee(null);
      setDrawerNewTaskDeadline(null);
      setDrawerAddingTask(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTaskDoneQuick(task: TaskItem) {
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

  const activeDeptMeta = selectedDepartment ? DEPARTMENTS[selectedDepartment] : null;
  const activeDeptCoord = selectedDepartment
    ? people.find(
        (p) =>
          p.department === selectedDepartment &&
          (p.role === 'Coordonator' ||
            (selectedDepartment === 'Board' && p.role === 'Lider'))
      )
    : null;
  const activeNavProject = selectedProjectFromNav
    ? projectMap.get(selectedProjectFromNav) || null
    : null;

  /* =========================================================================
     HELPER RANDARE RÂND PROIECT + TASK-URI + SUBTASK-URI PE TIMELINE
     ========================================================================= */
  function renderProjectTimelineRows(proj: Project) {
    const meta = DEPARTMENTS[proj.department] || DEPARTMENTS.Board;
    const isExpanded = Boolean(expandedProjectIds[proj.id]);
    const rootTasks = visibleTasks.filter(
      (t) => t.project_id === proj.id && !t.parent_task_id
    );
    const milestones = rootTasks.filter((t) => t.type === 'milestone');
    const projSpan = computeSpanPct(proj.start_date, proj.deadline);
    const owner = proj.owner_id ? personMap.get(proj.owner_id) : null;
    const isProjectBlocked = Boolean(
      proj.blocked_by_project_id &&
        projectMap.get(proj.blocked_by_project_id)?.status !== 'completed'
    );

    return (
      <div
        key={proj.id}
        className={`border-b border-white/[0.05] last:border-b-0 ${
          proj.is_core_team ? 'bg-amber-500/[0.015]' : ''
        }`}
      >
        {/* NIVEL 1: PROIECT */}
        <div className="group grid grid-cols-[310px_1fr] items-center transition hover:bg-white/[0.025]">
          <div className="flex items-center justify-between gap-2 border-r border-white/[0.06] px-4 py-3 text-xs">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedProjectIds((prev) => ({
                    ...prev,
                    [proj.id]: !prev[proj.id],
                  }))
                }
                className="text-zinc-500 hover:text-zinc-200"
              >
                {isExpanded ? '▾' : '▸'}
              </button>

              {proj.is_core_team ? (
                <span
                  title="Core Team Project"
                  className="shrink-0 text-[11px] text-amber-400"
                >
                  ✦
                </span>
              ) : (
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotBg}`} />
              )}

              <button
                type="button"
                onClick={() => openProjectDrawer(proj)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-zinc-100 group-hover:text-white">
                    {proj.title}
                  </span>
                  {isProjectBlocked && (
                    <span title="Proiect blocat de alt proiect" className="text-[10px]">
                      🔒
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span>{meta.label}</span>
                  {owner && <span>· {owner.full_name.split(' ')[0]}</span>}
                </div>
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-zinc-400">{proj.progress}%</span>
              <button
                type="button"
                onClick={() => {
                  setInlineProjectId(inlineProjectId === proj.id ? null : proj.id);
                  setExpandedProjectIds((prev) => ({ ...prev, [proj.id]: true }));
                }}
                className="rounded-md bg-white/[0.07] px-2 py-0.5 text-[11px] text-zinc-200 opacity-0 transition hover:bg-white/[0.15] group-hover:opacity-100"
              >
                + Task
              </button>
            </div>
          </div>

          {/* Canvas Bară Proiect (Linear / Notion Timeline Style) */}
          <div
            onClick={() => openProjectDrawer(proj)}
            className="relative h-12 cursor-pointer"
          >
            {/* Weekend Column Backgrounds */}
            <div
              className="pointer-events-none absolute inset-0 grid"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, timelineCols.length)}, minmax(0, 1fr))`,
              }}
            >
              {timelineCols.map((col) => (
                <div
                  key={`bg-${proj.id}-${col.key}`}
                  className={`border-r border-white/[0.025] ${
                    col.isWeekend ? 'bg-white/[0.015]' : ''
                  }`}
                />
              ))}
            </div>

            {/* Full-height Today Vertical Line */}
            {todayLinePct !== null && (
              <div
                style={{ left: `${todayLinePct}%` }}
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-emerald-400/50"
              />
            )}

            {projSpan && (
              <>
                <div
                  style={{
                    left: `${projSpan.leftPct}%`,
                    width: `${projSpan.widthPct}%`,
                  }}
                  className={`absolute top-2.5 h-7 overflow-hidden rounded-lg border backdrop-blur-sm transition-all group-hover:brightness-110 ${
                    proj.is_core_team
                      ? 'border-amber-400/40 bg-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.08)]'
                      : 'border-white/[0.12] bg-white/[0.06]'
                  }`}
                >
                  <div
                    className={`h-full transition-all ${
                      proj.is_core_team ? 'bg-amber-400/35' : `${meta.barBg} opacity-45`
                    }`}
                    style={{ width: `${proj.progress}%` }}
                  />
                  {projSpan.widthPct >= 20 && (
                    <div className="absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[11px]">
                      <span className="truncate font-medium text-white">
                        {proj.is_core_team ? '✦ ' : ''}
                        {proj.title}
                      </span>
                      {owner && (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/40 font-mono text-[9px] font-bold text-zinc-200">
                          {getInitials(owner.full_name)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {projSpan.widthPct < 20 && (
                  <span
                    style={{
                      left: `calc(${Math.min(82, projSpan.leftPct + projSpan.widthPct)}% + 8px)`,
                    }}
                    className="pointer-events-none absolute top-3.5 whitespace-nowrap text-[11px] font-medium text-zinc-200"
                  >
                    {proj.is_core_team ? '✦ ' : ''}
                    {proj.title}
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
                  className={`absolute top-1.5 z-20 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border border-[#101115] shadow ${
                    ms.is_milestone_approved ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* FORMULAR INLINE + TASK */}
        {inlineProjectId === proj.id && (
          <form
            onSubmit={(e) => handleCreateInlineTask(e, proj)}
            className="grid gap-2 border-t border-white/[0.06] bg-[#14161C] px-8 py-2.5 text-xs sm:grid-cols-[105px_1fr_185px_185px_auto]"
          >
            <select
              value={inlineTaskType}
              onChange={(e) => setInlineTaskType(e.target.value as 'task' | 'milestone')}
              className="rounded-lg border border-white/[0.08] bg-[#0F1014] px-2 py-1 text-zinc-200"
            >
              <option value="task">Task</option>
              <option value="milestone">Milestone</option>
            </select>
            <input
              type="text"
              autoFocus
              required
              value={inlineTaskTitle}
              onChange={(e) => setInlineTaskTitle(e.target.value)}
              placeholder={`Task nou în ${proj.title}...`}
              className="rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1 text-zinc-100 focus:outline-none"
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
                className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900 hover:bg-white"
              >
                Adaugă
              </button>
              <button
                type="button"
                onClick={() => setInlineProjectId(null)}
                className="rounded-lg px-2 py-1 text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          </form>
        )}

        {/* NIVEL 2: TASK-URI */}
        {isExpanded &&
          rootTasks.map((t) => {
            const subtasks = tasks.filter((st) => st.parent_task_id === t.id);
            const isTaskExpanded = Boolean(expandedTaskIds[t.id]);
            const tSpan = computeSpanPct(t.start_date, t.deadline);
            const assignee = t.assignee_id ? personMap.get(t.assignee_id)?.full_name : null;
            const prio = PRIORITY_META[t.priority || 'medium'];
            const isBlocked = Boolean(
              t.blocked_by_id && taskMap.get(t.blocked_by_id)?.status !== 'done'
            );

            return (
              <div key={t.id}>
                <div className="group grid grid-cols-[310px_1fr] items-center border-t border-white/[0.03] text-xs transition hover:bg-white/[0.02]">
                  <div className="flex items-center justify-between gap-2 border-r border-white/[0.06] py-2 pl-8 pr-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {subtasks.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTaskIds((prev) => ({
                              ...prev,
                              [t.id]: !prev[t.id],
                            }))
                          }
                          className="text-[10px] text-zinc-500 hover:text-zinc-200"
                        >
                          {isTaskExpanded ? '▾' : '▸'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-zinc-700">└</span>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenTaskModal(t)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            t.type === 'milestone'
                              ? t.is_milestone_approved
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                              : t.status === 'done'
                                ? 'bg-emerald-500/60'
                                : prio.dot
                          }`}
                        />
                        <span
                          className={`truncate ${
                            t.status === 'done'
                              ? 'text-zinc-500 line-through'
                              : 'text-zinc-300 group-hover:text-white'
                          }`}
                        >
                          {isBlocked ? '🔒 ' : ''}
                          {t.title}
                        </span>
                      </button>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-500">
                      {subtasks.length > 0 && (
                        <span className="font-mono">
                          {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length}
                        </span>
                      )}
                      {assignee && <span>{assignee.split(' ')[0]}</span>}
                    </div>
                  </div>

                  <div
                    onClick={() => onOpenTaskModal(t)}
                    className="relative h-8 cursor-pointer"
                  >
                    {/* Weekend Column Backgrounds */}
                    <div
                      className="pointer-events-none absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, timelineCols.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      {timelineCols.map((col) => (
                        <div
                          key={`bg-t-${t.id}-${col.key}`}
                          className={`border-r border-white/[0.02] ${
                            col.isWeekend ? 'bg-white/[0.015]' : ''
                          }`}
                        />
                      ))}
                    </div>

                    {/* Today Vertical Line */}
                    {todayLinePct !== null && (
                      <div
                        style={{ left: `${todayLinePct}%` }}
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-emerald-400/50"
                      />
                    )}

                    {tSpan && (
                      <>
                        <div
                          style={{
                            left: `${tSpan.leftPct}%`,
                            width: `${tSpan.widthPct}%`,
                          }}
                          className={`absolute top-2 h-4 rounded-md px-2 text-[10px] leading-4 transition ${
                            t.type === 'milestone'
                              ? t.is_milestone_approved
                                ? 'bg-emerald-500/25 text-emerald-200'
                                : 'bg-amber-500/25 text-amber-200'
                              : t.status === 'done'
                                ? 'bg-white/[0.04] text-zinc-500'
                                : 'bg-white/[0.1] text-zinc-200 group-hover:bg-white/[0.16]'
                          }`}
                        >
                          {tSpan.widthPct >= 16 && (
                            <span className="block truncate">{t.title}</span>
                          )}
                        </div>

                        {tSpan.widthPct < 16 && (
                          <span
                            style={{
                              left: `calc(${Math.min(82, tSpan.leftPct + tSpan.widthPct)}% + 8px)`,
                            }}
                            className="pointer-events-none absolute top-2 whitespace-nowrap text-[11px] text-zinc-400"
                          >
                            {t.title}
                            {assignee ? ` · ${assignee.split(' ')[0]}` : ''}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* NIVEL 3: SUBTASK-URI */}
                {isTaskExpanded &&
                  subtasks.map((sub) => {
                    const subSpan = computeSpanPct(sub.start_date, sub.deadline);
                    return (
                      <div
                        key={sub.id}
                        onClick={() => onOpenTaskModal(sub)}
                        className="grid cursor-pointer grid-cols-[310px_1fr] items-center border-t border-white/[0.02] text-[11px] hover:bg-white/[0.02]"
                      >
                        <div className="truncate border-r border-white/[0.06] py-1.5 pl-14 pr-4 text-zinc-500">
                          ↳ {sub.title}
                        </div>
                        <div className="relative h-7">
                          {todayLinePct !== null && (
                            <div
                              style={{ left: `${todayLinePct}%` }}
                              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-emerald-400/50"
                            />
                          )}
                          {subSpan && (
                            <>
                              <div
                                style={{
                                  left: `${subSpan.leftPct}%`,
                                  width: `${subSpan.widthPct}%`,
                                }}
                                className="absolute top-2 h-3 rounded bg-white/[0.06]"
                              />
                              <span
                                style={{
                                  left: `calc(${Math.min(82, subSpan.leftPct + subSpan.widthPct)}% + 8px)`,
                                }}
                                className="pointer-events-none absolute top-1.5 whitespace-nowrap text-[10px] text-zinc-500"
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
  }

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-40 flex flex-col bg-[#101115] text-zinc-100'
          : 'flex h-full flex-col bg-[#101115]'
      }
    >
      {/* SINGLE UNIFIED ASANA-STYLE WORKSPACE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        {/* Left: Context Breadcrumb + View Switcher + Scope Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            {onlyCoreTeamFromNav && !activeDeptMeta ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
                <span>✦</span>
                <span>Core Team Projects</span>
              </span>
            ) : activeDeptMeta ? (
              <>
                <span className={`h-2.5 w-2.5 rounded-full ${activeDeptMeta.dotBg}`} />
                <span className="text-sm font-semibold text-zinc-100">
                  {activeDeptMeta.label}
                </span>
                {activeNavProject && (
                  <>
                    <span className="text-zinc-600">/</span>
                    <span className="text-sm font-medium text-zinc-300">
                      {activeNavProject.title}
                    </span>
                  </>
                )}
                {activeDeptCoord && !activeNavProject && (
                  <span className="hidden rounded-full bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-zinc-400 md:inline">
                    Coord: {activeDeptCoord.full_name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => copyDepartmentSummary(selectedDepartment!)}
                  className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  {copiedSummary ? '✓ Copiat' : '📋 Summary'}
                </button>
                {onClearNavSelection && (
                  <button
                    type="button"
                    onClick={onClearNavSelection}
                    className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
                  >
                    ✕
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm font-semibold text-zinc-100">Proiecte</span>
            )}
          </div>

          <div className="h-4 w-px bg-white/[0.08]" />

          {/* Clean View Switcher */}
          <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.03] p-0.5 text-xs">
            {[
              { id: 'gantt', label: 'Timeline' },
              { id: 'kanban', label: 'Board' },
              { id: 'calendar', label: 'Calendar' },
              { id: 'database', label: 'Listă' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id as WorkspaceMode)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  viewMode === tab.id
                    ? 'bg-white/[0.1] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Scope Switcher: Toate vs Core Team vs Alumni */}
          {!onlyCoreTeamFromNav && !selectedProjectFromNav && (
            <div className="hidden items-center gap-0.5 rounded-xl bg-white/[0.03] p-0.5 text-[11px] lg:flex">
              {[
                { id: 'all', label: 'Toate' },
                { id: 'core_team', label: '✦ Core Team' },
                { id: 'alumni', label: '◎ Alumni' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScopeFilter(s.id as ScopeFilter)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    scopeFilter === s.id
                      ? s.id === 'core_team'
                        ? 'bg-amber-500/20 text-amber-200'
                        : 'bg-white/[0.1] text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Zoom, Navigation, Popover Filters & Primary Actions */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {viewMode === 'gantt' && (
            <>
              <select
                value={zoomScale}
                onChange={(e) => {
                  setZoomScale(e.target.value as ZoomScale);
                  setPeriodOffset(0);
                }}
                className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-zinc-200 focus:outline-none"
              >
                <option value="day">Zi pe zi</option>
                <option value="week">Săptămâni</option>
                <option value="month">Luni</option>
                <option value="year">An (12 luni)</option>
              </select>

              <div className="flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o - 1)}
                  className="px-2 py-1.5 text-zinc-400 hover:text-white"
                  title="Înapoi"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset(0)}
                  className="border-x border-white/[0.06] px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-white"
                >
                  Azi
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                  className="px-2 py-1.5 text-zinc-400 hover:text-white"
                  title="Înainte"
                >
                  ›
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowLoadHeatmap((l) => !l)}
                className={`rounded-lg border px-2.5 py-1.5 font-medium transition ${
                  showLoadHeatmap
                    ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                    : 'border-white/[0.07] bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                ⚡ Load
              </button>
            </>
          )}

          {/* Popover Filtre */}
          <div ref={filterPopoverRef} className="relative">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`rounded-lg border px-2.5 py-1.5 font-medium transition ${
                activeFiltersCount > 0
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/[0.07] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
              }`}
            >
              Filtre{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''} ▾
            </button>

            {filtersOpen && (
              <div className="absolute right-0 z-50 mt-2 w-72 space-y-3 rounded-2xl border border-white/[0.1] bg-[#171920] p-4 shadow-2xl">
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Tip Proiect</label>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#0F1014] p-1 text-[11px]">
                    {[
                      { id: 'all', label: 'Toate' },
                      { id: 'core_team', label: '✦ Core' },
                      { id: 'alumni', label: 'Alumni' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setScopeFilter(s.id as ScopeFilter)}
                        className={`rounded py-1 font-medium ${
                          scopeFilter === s.id
                            ? 'bg-white/[0.12] text-white'
                            : 'text-zinc-500'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {!selectedDepartment && (
                  <div>
                    <label className="mb-1 block text-[11px] text-zinc-400">
                      Departament
                    </label>
                    <select
                      value={filterDept}
                      onChange={(e) => setFilterDept(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
                    >
                      <option value="">Toate departamentele</option>
                      {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                        <option key={k} value={k}>
                          {DEPARTMENTS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!selectedProjectFromNav && (
                  <div>
                    <label className="mb-1 block text-[11px] text-zinc-400">Proiect</label>
                    <select
                      value={filterProject}
                      onChange={(e) => setFilterProject(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
                    >
                      <option value="">Toate proiectele</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Responsabil</label>
                  <AlumniSearchPicker
                    people={people}
                    tasks={tasks}
                    value={filterAssignee || null}
                    onChange={(id) => setFilterAssignee(id || '')}
                    placeholder="Caută responsabil..."
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2 pt-1 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={onlyMine}
                    onChange={(e) => setOnlyMine(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span>Doar task-urile mele</span>
                </label>

                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDept('');
                      setFilterProject('');
                      setFilterAssignee('');
                      setOnlyMine(false);
                    }}
                    className="w-full rounded-lg border border-white/[0.07] py-1 text-[11px] text-zinc-400 hover:text-white"
                  >
                    Resetează filtrele
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowNewProject((p) => !p)}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 font-medium text-zinc-900 transition hover:bg-white"
          >
            + Proiect
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-zinc-400 hover:text-zinc-100"
            title={isFullscreen ? 'Ieși din Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? '✕' : '⛶'}
          </button>
        </div>
      </div>

      {/* FORMULAR PROIECT NOU (CU TOGGLE CORE TEAM) */}
      {showNewProject && (
        <form
          onSubmit={handleCreateProject}
          className="grid gap-3 border-b border-white/[0.06] bg-[#15171D] px-5 py-3.5 text-xs sm:grid-cols-6"
        >
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] text-zinc-400">Nume Proiect</label>
            <input
              type="text"
              autoFocus
              required
              value={projTitle}
              onChange={(e) => setProjTitle(e.target.value)}
              placeholder="ex: Tabăra Alumni Vară 2027"
              className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-3 py-1.5 text-zinc-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Departament</label>
            <select
              value={projDept}
              onChange={(e) => setProjDept(e.target.value as DepartmentKey)}
              className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
            >
              {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                <option key={k} value={k}>
                  {DEPARTMENTS[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Responsabil</label>
            <AlumniSearchPicker
              people={people}
              tasks={tasks}
              value={projOwnerId}
              onChange={setProjOwnerId}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Interval</label>
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
          <div className="flex items-end justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-amber-300">
              <input
                type="checkbox"
                checked={projIsCoreTeam}
                onChange={(e) => setProjIsCoreTeam(e.target.checked)}
                className="accent-amber-500"
              />
              <span>✦ Core Team</span>
            </label>
            <button
                type="button"
                onClick={() => {
                  setDrawerNeedsPmSync((v) => !v);
                  setDrawerDetailsDirty(true);
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                  drawerNeedsPmSync
                    ? 'border-violet-400/40 bg-violet-500/20 text-violet-200'
                    : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {drawerNeedsPmSync ? '💬 De vorbit cu Vlad (PM)' : '💬 Vlad (PM)'}
              </button>
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-3.5 py-1.5 font-medium text-zinc-900 hover:bg-white"
            >
              Creează
            </button>
          </div>
        </form>
      )}

      {/* 1. MASTER TIMELINE CU SWIMLANES (CORE TEAM VS ALUMNI) */}
      {viewMode === 'gantt' && (
        <div className="flex-1 overflow-y-auto">
          {inspectedLoad && showLoadHeatmap && (
            <div className="flex items-center justify-between border-b border-white/[0.06] bg-sky-500/10 px-5 py-2 text-xs">
              <span className="text-sky-200">
                Load {inspectedLoad.col.label}:{' '}
                <strong>{inspectedLoad.count} task-uri active</strong> ({inspectedLoad.hours}h
                estimate)
              </span>
              <button
                type="button"
                onClick={() => setInspectedColKey(null)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              {/* Header Zile / Săptămâni */}
              <div className="grid grid-cols-[310px_1fr] border-b border-white/[0.06] bg-[#13151A] text-[11px] text-zinc-500">
                <div className="border-r border-white/[0.06] px-5 py-2.5 font-medium">
                  Proiecte &amp; Livrabile
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
                      className={`relative border-r border-white/[0.03] py-2 text-center font-mono text-[10px] ${
                        col.isCurrent
                          ? 'font-semibold text-emerald-400'
                          : col.isWeekend
                            ? 'bg-white/[0.015] text-zinc-600'
                            : ''
                      }`}
                    >
                      <div>{col.label}</div>
                      {col.subLabel && (
                        <div className="text-[9px] text-zinc-600">{col.subLabel}</div>
                      )}
                      {col.isCurrent && (
                        <div className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-emerald-400" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Load Heatmap */}
              {showLoadHeatmap && (
                <div className="grid grid-cols-[310px_1fr] border-b border-white/[0.06] bg-[#121419] text-[10px]">
                  <div className="border-r border-white/[0.06] px-5 py-1.5 text-zinc-400">
                    Capacitate (task-uri / zi)
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, timelineCols.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    {columnLoads.map(({ col, count, hours }) => {
                      const style =
                        count === 0
                          ? 'text-zinc-700'
                          : hours >= 16 || count >= 5
                            ? 'bg-rose-500/20 text-rose-300 font-semibold'
                            : hours >= 8 || count >= 3
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-emerald-500/10 text-emerald-300';

                      return (
                        <button
                          key={`load-${col.key}`}
                          type="button"
                          onClick={() => setInspectedColKey(col.key)}
                          className={`border-r border-white/[0.03] py-1 text-center font-mono transition hover:brightness-125 ${style}`}
                        >
                          {count > 0 ? `${count}` : '·'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rânduri Proiecte (grupate vizual între Core Team și Departamente Alumni) */}
              {visibleProjects.length === 0 ? (
                <div className="py-16 text-center text-xs text-zinc-500">
                  Niciun proiect aici încă. Apasă <strong>+ Proiect</strong> în dreapta sus.
                </div>
              ) : (
                <>
                  {/* SWIMLANE 1: CORE TEAM (PROIECTELE MELE / NUCLEU) */}
                  {coreTeamProjects.length > 0 && (
                    <div>
                      {scopeFilter === 'all' && !selectedProjectFromNav && (
                        <div className="flex items-center justify-between border-b border-amber-500/15 bg-amber-500/[0.05] px-5 py-1.5 text-[11px]">
                          <span className="font-medium text-amber-300">
                            ✦ Core Team · Proiecte coordonate direct ({coreTeamProjects.length})
                          </span>
                          <span className="text-amber-300/60">Nucleu &amp; Management</span>
                        </div>
                      )}
                      {coreTeamProjects.map((proj) => renderProjectTimelineRows(proj))}
                    </div>
                  )}

                  {/* SWIMLANE 2: PROIECTE DEPARTAMENTE ALUMNI */}
                  {alumniProjects.length > 0 && (
                    <div>
                      {scopeFilter === 'all' &&
                        !selectedProjectFromNav &&
                        coreTeamProjects.length > 0 && (
                          <div className="flex items-center justify-between border-y border-white/[0.06] bg-white/[0.02] px-5 py-1.5 text-[11px]">
                            <span className="font-medium text-zinc-300">
                              ◎ Proiecte Departamente Alumni ({alumniProjects.length})
                            </span>
                            <span className="text-zinc-500">Inițiative pe departamente</span>
                          </div>
                        )}
                      {alumniProjects.map((proj) => renderProjectTimelineRows(proj))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. KANBAN BOARD */}
      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-x-auto p-5">
          <div className="mx-auto grid min-w-[920px] max-w-6xl grid-cols-4 gap-4">
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
                  className="flex min-h-[500px] flex-col rounded-2xl bg-white/[0.02] p-3"
                >
                  <div className="mb-3 flex items-center justify-between px-1 text-xs">
                    <div className="flex items-center gap-2 font-medium text-zinc-300">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      <span>{col.label}</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-2">
                    {colTasks.map((t) => {
                      const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                      const prio = PRIORITY_META[t.priority || 'medium'];
                      const proj = t.project_id ? projectMap.get(t.project_id) : null;
                      const assignee = t.assignee_id ? personMap.get(t.assignee_id) : null;

                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDraggedTaskId(t.id)}
                          onClick={() => onOpenTaskModal(t)}
                          className="cursor-pointer rounded-xl border border-white/[0.06] bg-[#16181F] p-3 text-xs transition hover:border-white/[0.15]"
                        >
                          <div className="flex items-center justify-between text-[10px] text-zinc-400">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${dept.dotBg}`} />
                              {dept.label}
                            </span>
                            <span className={prio.badgeText}>{prio.label}</span>
                          </div>

                          <p className="mt-2 font-medium text-zinc-100">{t.title}</p>

                          {proj && (
                            <p className="mt-1 truncate text-[11px] text-zinc-500">
                              {proj.is_core_team ? '✦ ' : ''}
                              {proj.title}
                            </p>
                          )}

                          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                            <span>{assignee ? assignee.full_name : 'Nealocat'}</span>
                            {t.deadline && <span className="font-mono">{t.deadline.slice(5)}</span>}
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

      {/* 3. CALENDAR VIEW LUNAR */}
      {viewMode === 'calendar' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-6xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {MONTHS_SHORT[monthCalendarDays.month]} {monthCalendarDays.year}
                </h3>
                {outlookEvents.length > 0 && (
                  <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-300">
                    {outlookEvents.length} evenimente Outlook
                  </span>
                )}
              </div>

              <div className="flex items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs">
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o - 1)}
                  className="px-2.5 py-1 text-zinc-400 hover:text-white"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset(0)}
                  className="border-x border-white/[0.06] px-3 py-1 text-zinc-300 hover:text-white"
                >
                  Azi
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                  className="px-2.5 py-1 text-zinc-400 hover:text-white"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#13151A]">
              {['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'].map((d) => (
                <div
                  key={d}
                  className="border-b border-r border-white/[0.05] py-2 text-center text-[11px] font-medium text-zinc-500"
                >
                  {d}
                </div>
              ))}

              {monthCalendarDays.cells.map((iso, idx) => {
                if (!iso) {
                  return (
                    <div
                      key={`empty-cal-${idx}`}
                      className="min-h-[110px] border-b border-r border-white/[0.04] bg-black/20"
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
                    className={`min-h-[110px] border-b border-r border-white/[0.04] p-2 text-xs ${
                      isToday ? 'bg-emerald-500/[0.05]' : ''
                    }`}
                  >
                    <div
                      className={`mb-1.5 font-mono text-[11px] ${
                        isToday ? 'font-bold text-emerald-400' : 'text-zinc-500'
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
                          className="block truncate rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200 hover:bg-indigo-500/25"
                        >
                          {!ev.isAllDay ? `${ev.start.slice(11, 16)} ` : ''}
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
                            className="flex w-full items-center gap-1.5 truncate rounded-md bg-white/[0.05] px-1.5 py-0.5 text-left text-[10px] text-zinc-200 hover:bg-white/[0.1]"
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dept.dotBg}`} />
                            <span className="truncate">{t.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 4. LIST / TABLE VIEW */}
      {viewMode === 'database' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/[0.06] bg-[#13151A]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] text-[11px] text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Titlu</th>
                  <th className="px-4 py-3 font-medium">Proiect</th>
                  <th className="px-4 py-3 font-medium">Prioritate</th>
                  <th className="px-4 py-3 font-medium">Responsabil</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visibleTasks.map((t) => {
                  const prio = PRIORITY_META[t.priority || 'medium'];
                  const dept = DEPARTMENTS[t.department] || DEPARTMENTS.Board;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onOpenTaskModal(t)}
                      className="cursor-pointer transition hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-medium text-zinc-200">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${dept.dotBg}`} />
                          {t.parent_task_id ? '↳ ' : ''}
                          {t.title}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">
                        {t.project_id ? projectMap.get(t.project_id)?.title || '-' : 'Individual'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] ${prio.badgeText}`}>{prio.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">
                        {t.assignee_id ? personMap.get(t.assignee_id)?.full_name : 'Nealocat'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-400">{t.status}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">
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

      {/* ===================================================================== */}
      {/* PROJECT DETAIL SIDE DRAWER (COMPLET: DESCRIERE, RESPO, DEPT, TASK-URI) */}
      {/* ===================================================================== */}
      {selectedProject && (
        <div className="fixed inset-y-3 right-3 z-40 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#15171D] shadow-2xl">
          {/* Top Header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDrawerIsCoreTeam((c) => !c);
                  setDrawerDetailsDirty(true);
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                  drawerIsCoreTeam
                    ? 'border-amber-400/40 bg-amber-500/20 text-amber-200'
                    : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {drawerIsCoreTeam ? '✦ Core Team' : '◎ Alumni Dept'}
              </button>

              <span className="font-mono text-xs font-semibold text-emerald-400">
                {selectedProject.progress}%
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onAskAiContext(
                    `Analizează proiectul „${selectedProject.title}” (${
                      selectedProject.is_core_team ? 'Core Team' : 'Alumni'
                    }, progres ${selectedProject.progress}%, deadline ${
                      selectedProject.deadline || 'nesetat'
                    }): ce task-uri sunt blocate și ce pași recomanzi?`
                  )
                }
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/[0.08]"
              >
                ✦ Ask AI
              </button>
              <button
                type="button"
                onClick={() => handleDeleteProject(selectedProject.id)}
                className="rounded-lg border border-rose-500/20 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/15"
                title="Șterge proiect"
              >
                Șterge
              </button>
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
            {/* 1. Titlu & Descriere */}
            <div className="space-y-2.5">
              <input
                type="text"
                value={drawerTitle}
                onChange={(e) => {
                  setDrawerTitle(e.target.value);
                  setDrawerDetailsDirty(true);
                }}
                className="w-full rounded-xl border border-white/[0.07] bg-[#0F1014] px-3.5 py-2 text-base font-semibold text-zinc-100 focus:border-white/[0.2] focus:outline-none"
              />

              <textarea
                rows={3}
                value={drawerDesc}
                onChange={(e) => {
                  setDrawerDesc(e.target.value);
                  setDrawerDetailsDirty(true);
                }}
                placeholder="Descrierea proiectului, obiective, link folder Drive / Notion..."
                className="w-full rounded-xl border border-white/[0.07] bg-[#0F1014] p-3 leading-relaxed text-zinc-200 placeholder-zinc-600 focus:border-white/[0.2] focus:outline-none"
              />
            </div>

            {/* 2. Metadate: Responsabil (+ departamentul lui), Departament proiect, Interval, Status, Dependencies */}
            <div className="grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Responsabil Proiect
                </label>
                <AlumniSearchPicker
                  people={people}
                  tasks={tasks}
                  value={drawerOwnerId}
                  onChange={(id) => {
                    setDrawerOwnerId(id);
                    setDrawerDetailsDirty(true);
                  }}
                />
                {drawerOwnerId && personMap.get(drawerOwnerId) && (
                  <p className="mt-1 text-[10px] text-zinc-400">
                    Dept. responsabil:{' '}
                    <span className="font-medium text-zinc-200">
                      {DEPARTMENTS[personMap.get(drawerOwnerId)!.department]?.label}
                    </span>{' '}
                    ({personMap.get(drawerOwnerId)!.role})
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Departament Proiect
                </label>
                <select
                  value={drawerDept}
                  onChange={(e) => {
                    setDrawerDept(e.target.value as DepartmentKey);
                    setDrawerDetailsDirty(true);
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
                >
                  {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                    <option key={k} value={k}>
                      {DEPARTMENTS[k].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Perioadă (Start → Deadline)
                </label>
                <CalendarRangePicker
                  startDate={drawerStart}
                  endDate={drawerDeadline}
                  onChange={(s, e) => {
                    setDrawerStart(s);
                    setDrawerDeadline(e);
                    setDrawerDetailsDirty(true);
                  }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">Status</label>
                <select
                  value={drawerStatus}
                  onChange={(e) => {
                    setDrawerStatus(e.target.value as Project['status']);
                    setDrawerDetailsDirty(true);
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
                >
                  <option value="active">Activ</option>
                  <option value="planned">Planificat</option>
                  <option value="on_hold">În așteptare</option>
                  <option value="completed">Finalizat</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-zinc-500">
                  Dependință (Depinde de alt proiect)
                </label>
                <select
                  value={drawerBlockedByProjectId || ''}
                  onChange={(e) => {
                    setDrawerBlockedByProjectId(e.target.value || null);
                    setDrawerDetailsDirty(true);
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0F1014] px-2.5 py-1.5 text-zinc-200"
                >
                  <option value="">Fără dependință</option>
                  {projects
                    .filter((p) => p.id !== selectedProject.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.progress}%)
                      </option>
                    ))}
                </select>
              </div>

              {drawerDetailsDirty && (
                <div className="flex justify-end sm:col-span-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveProjectDrawer}
                    className="rounded-lg bg-zinc-100 px-3.5 py-1.5 font-medium text-zinc-900 hover:bg-white"
                  >
                    {busy ? 'Salvez...' : 'Salvează detaliile proiectului'}
                  </button>
                </div>
              )}
            </div>

            {/* 3. Progres Automat */}
            {(() => {
              const projItems = tasks.filter(
                (t) => t.project_id === selectedProject.id && !t.parent_task_id
              );
              const doneCount = projItems.filter(
                (t) =>
                  t.status === 'done' ||
                  (t.type === 'milestone' && t.is_milestone_approved)
              ).length;
              const totalHours = projItems.reduce(
                (acc, t) => acc + Number(t.estimated_hours || 0),
                0
              );

              return (
                <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">
                      Progres automat: {doneCount}/{projItems.length} livrabile · {totalHours}h
                      estimate
                    </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {selectedProject.progress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full bg-emerald-400 transition-all"
                      style={{ width: `${selectedProject.progress}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* 4. Task-uri & Milestone-uri sub acest proiect (clickabile direct de aici) */}
            <div className="space-y-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-zinc-200">
                  Task-uri &amp; Milestone-uri (
                  {tasks.filter((t) => t.project_id === selectedProject.id && !t.parent_task_id).length}
                  )
                </h4>
                <button
                  type="button"
                  onClick={() => setDrawerAddingTask((a) => !a)}
                  className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.14]"
                >
                  + Adaugă task
                </button>
              </div>

              {drawerAddingTask && (
                <form
                  onSubmit={handleCreateDrawerTask}
                  className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0F1014] p-3"
                >
                  <div className="flex gap-1.5">
                    <select
                      value={drawerNewTaskType}
                      onChange={(e) =>
                        setDrawerNewTaskType(e.target.value as 'task' | 'milestone')
                      }
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-zinc-200"
                    >
                      <option value="task">Task</option>
                      <option value="milestone">Milestone</option>
                    </select>
                    <input
                      type="text"
                      autoFocus
                      required
                      value={drawerNewTaskTitle}
                      onChange={(e) => setDrawerNewTaskTitle(e.target.value)}
                      placeholder="Titlu task sau milestone..."
                      className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-zinc-100 focus:outline-none"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <AlumniSearchPicker
                      people={people}
                      tasks={tasks}
                      value={drawerNewTaskAssignee}
                      onChange={setDrawerNewTaskAssignee}
                      placeholder="Responsabil..."
                    />
                    <CalendarRangePicker
                      startDate={drawerNewTaskDeadline}
                      endDate={drawerNewTaskDeadline}
                      onChange={(_, end) => setDrawerNewTaskDeadline(end)}
                      alignRight
                    />
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDrawerAddingTask(false)}
                      className="px-2.5 py-1 text-[11px] text-zinc-500"
                    >
                      Anulează
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-900"
                    >
                      Salvează task
                    </button>
                  </div>
                </form>
              )}

              <div className="divide-y divide-white/[0.05]">
                {tasks.filter(
                  (t) => t.project_id === selectedProject.id && !t.parent_task_id
                ).length === 0 ? (
                  <p className="py-4 text-center text-zinc-500">
                    Niciun task definit încă în acest proiect.
                  </p>
                ) : (
                  tasks
                    .filter((t) => t.project_id === selectedProject.id && !t.parent_task_id)
                    .map((t) => {
                      const assignee = t.assignee_id ? personMap.get(t.assignee_id) : null;
                      const isBlocked = Boolean(
                        t.blocked_by_id && taskMap.get(t.blocked_by_id)?.status !== 'done'
                      );
                      const subs = tasks.filter((s) => s.parent_task_id === t.id);

                      return (
                        <div
                          key={t.id}
                          className="group flex items-center justify-between gap-2 py-2.5"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={t.status === 'done'}
                              onChange={() => toggleTaskDoneQuick(t)}
                              className="h-3.5 w-3.5 cursor-pointer rounded accent-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => onOpenTaskModal(t)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div
                                className={`truncate font-medium group-hover:text-white ${
                                  t.status === 'done'
                                    ? 'text-zinc-500 line-through'
                                    : 'text-zinc-200'
                                }`}
                              >
                                {t.type === 'milestone'
                                  ? t.is_milestone_approved
                                    ? '🟢 '
                                    : '🟡 '
                                  : isBlocked
                                    ? '🔒 '
                                    : ''}
                                {t.title}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                                <span>
                                  {assignee
                                    ? `${assignee.full_name} (${DEPARTMENTS[assignee.department]?.label})`
                                    : 'Nealocat'}
                                </span>
                                {subs.length > 0 && (
                                  <span>
                                    · ↳ {subs.filter((s) => s.status === 'done').length}/
                                    {subs.length} subtask-uri
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {t.deadline && (
                              <span className="font-mono text-[10px] text-zinc-500">
                                {t.deadline.slice(5)}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenTaskModal(t)}
                              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                              title="Deschide detalii task"
                            >
                              ↗
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* 5. Update-uri & Notițe Proiect */}
            <div className="space-y-3">
              <h4 className="font-medium text-zinc-300">Update-uri &amp; Notițe Proiect</h4>
              <form onSubmit={addProjectNote} className="space-y-2">
                <textarea
                  rows={2}
                  value={drawerNoteText}
                  onChange={(e) => setDrawerNoteText(e.target.value)}
                  placeholder="Scrie un update de status..."
                  className="w-full rounded-xl border border-white/[0.08] bg-[#0F1014] p-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                    <input
                      type="checkbox"
                      checked={drawerNoteAiMem}
                      onChange={(e) => setDrawerNoteAiMem(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    <span>Memorie AI</span>
                  </label>
                  <button
                    type="submit"
                    disabled={!drawerNoteText.trim() || busy}
                    className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                  >
                    Adaugă
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {projectNotes
                  .filter((n) => n.project_id === selectedProject.id)
                  .map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"
                    >
                      <div className="text-[10px] text-zinc-500">
                        {new Date(n.created_at).toLocaleDateString('ro-RO')}
                      </div>
                      <p className="mt-1 text-zinc-200">{n.content}</p>
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