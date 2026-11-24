'use client';

import { useState } from 'react';
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

interface TaskDetailModalProps {
  task: TaskItem;
  allTasks: TaskItem[];
  projects: Project[];
  people: Person[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSelectTask: (nextTask: TaskItem) => void;
}

export function TaskDetailModal({
  task,
  allTasks,
  projects,
  people,
  onClose,
  onRefresh,
  onSelectTask,
}: TaskDetailModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [status, setStatus] = useState<TaskItem['status']>(task.status);
  const [priority, setPriority] = useState<PriorityKey>(task.priority || 'medium');
  const [estimatedHours, setEstimatedHours] = useState<number>(
    Number(task.estimated_hours || 2)
  );
  const [department, setDepartment] = useState<DepartmentKey>(task.department);
  const [projectId, setProjectId] = useState<string | null>(task.project_id);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assignee_id);
  const [blockedById, setBlockedById] = useState<string | null>(task.blocked_by_id);
  const [startDate, setStartDate] = useState<string | null>(task.start_date);
  const [deadline, setDeadline] = useState<string | null>(task.deadline);
  const [isMyTask, setIsMyTask] = useState<boolean>(task.is_my_task);
  const [needsPmSync, setNeedsPmSync] = useState<boolean>(Boolean(task.needs_pm_sync));

  // Subtask creator inline
  const [subTitle, setSubTitle] = useState('');
  const [subAssigneeId, setSubAssigneeId] = useState<string | null>(null);
  const [subDeadline, setSubDeadline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const subtasks = allTasks.filter((t) => t.parent_task_id === task.id);
  const doneSubtasks = subtasks.filter((s) => s.status === 'done').length;
  const subtaskPct = subtasks.length
    ? Math.round((doneSubtasks / subtasks.length) * 100)
    : 0;

  const blockerTask = blockedById
    ? allTasks.find((t) => t.id === blockedById) || null
    : null;

  async function saveChanges() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_task',
          id: task.id,
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          estimated_hours: estimatedHours,
          department,
          project_id: projectId,
          assignee_id: assigneeId,
          blocked_by_id: blockedById,
          start_date: startDate,
          deadline,
          is_my_task: isMyTask,
          needs_pm_sync: needsPmSync,
        }),
      });
      await onRefresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handlePromoteToProject() {
    if (saving) return;
    setSaving(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote_task_to_project',
          id: task.id,
        }),
      });
      await onRefresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!subTitle.trim() || saving) return;
    setSaving(true);
    try {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: subTitle.trim(),
          type: 'task',
          project_id: projectId,
          parent_task_id: task.id,
          department,
          assignee_id: subAssigneeId || assigneeId,
          start_date: startDate,
          deadline: subDeadline || deadline,
          estimated_hours: 1,
          priority: 'medium',
        }),
      });
      setSubTitle('');
      setSubAssigneeId(null);
      setSubDeadline(null);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleSubtaskDone(sub: TaskItem) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_task_done',
        id: sub.id,
        done: sub.status !== 'done',
      }),
    });
    await onRefresh();
  }

  async function handleToggleMilestone() {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve_milestone',
        id: task.id,
        approved: !task.is_milestone_approved,
      }),
    });
    await onRefresh();
    onClose();
  }

  async function handleDelete() {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_task', id: task.id }),
    });
    await onRefresh();
    onClose();
  }

  const personMap = new Map(people.map((p) => [p.id, p.full_name]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="flex h-[88vh] max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-6 py-3.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-zinc-800 px-2.5 py-0.5 font-mono text-[11px] text-zinc-300">
              {task.parent_task_id
                ? '↳ SUBTASK'
                : task.type === 'milestone'
                  ? task.is_milestone_approved
                    ? '🟢 MILESTONE APROBAT'
                    : '🟡 MILESTONE'
                  : '⚡ TASK'}
            </span>
            {!task.project_id && !task.parent_task_id && (
              <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-400">
                Task Ad-hoc (fără proiect)
              </span>
            )}
            {blockerTask && blockerTask.status !== 'done' && (
              <span className="rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] text-rose-300">
                🔒 Blocat de: {blockerTask.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!task.project_id && !task.parent_task_id && (
              <button
                type="button"
                disabled={saving}
                onClick={handlePromoteToProject}
                className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-40"
              >
                🚀 Promovează la Proiect
              </button>
            )}

            {task.type === 'milestone' && (
              <button
                type="button"
                onClick={handleToggleMilestone}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  task.is_milestone_approved
                    ? 'border border-zinc-700 bg-zinc-800 text-zinc-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                {task.is_milestone_approved
                  ? 'Anulează bulina verde'
                  : '🟢 Aprobă Milestone'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/15"
            >
              Șterge
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body 2 Coloane Aerisite */}
        <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-[1fr_340px]">
          {/* Coloana Stângă: Titlu, Descriere & Subtask-uri */}
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Titlu
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-base font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Descriere, Specificații & Link-uri
              </label>
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Adaugă detalii de execuție, link Google Drive / Figma / Notion, criterii de acceptare..."
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs leading-relaxed text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {/* Subtask-uri */}
            {!task.parent_task_id && (
              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    ↳ Subtask-uri ({doneSubtasks}/{subtasks.length})
                  </span>
                  {subtasks.length > 0 && (
                    <span className="font-mono text-xs text-emerald-400">
                      {subtaskPct}%
                    </span>
                  )}
                </div>

                {subtasks.length > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${subtaskPct}%` }}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  {subtasks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900 px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={sub.status === 'done'}
                          onChange={() => toggleSubtaskDone(sub)}
                          className="h-3.5 w-3.5 rounded accent-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => onSelectTask(sub)}
                          className={`truncate text-left hover:text-emerald-300 ${
                            sub.status === 'done'
                              ? 'text-zinc-500 line-through'
                              : 'text-zinc-200'
                          }`}
                        >
                          {sub.title}
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-400">
                        {sub.assignee_id && (
                          <span>{personMap.get(sub.assignee_id)?.split(' ')[0]}</span>
                        )}
                        {sub.deadline && <span className="font-mono">{sub.deadline}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Formular rapid adăugare subtask */}
                <form onSubmit={handleAddSubtask} className="space-y-2 border-t border-zinc-800/80 pt-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={subTitle}
                      onChange={(e) => setSubTitle(e.target.value)}
                      placeholder="+ Adaugă subtask nou..."
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
                    />
                    <button
                      type="submit"
                      disabled={!subTitle.trim() || saving}
                      className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      Adaugă
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <AlumniSearchPicker
                      people={people}
                      tasks={allTasks}
                      value={subAssigneeId}
                      onChange={setSubAssigneeId}
                      onPersonCreated={onRefresh}
                      placeholder="Responsabil subtask (opțional)..."
                    />
                    <CalendarRangePicker
                      startDate={subDeadline}
                      endDate={subDeadline}
                      onChange={(_, end) => setSubDeadline(end)}
                      openUpward
                      alignRight
                    />
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Coloana Dreaptă: Proprietăți */}
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Interval Calendar (Start → Deadline)
              </label>
              <CalendarRangePicker
                startDate={startDate}
                endDate={deadline}
                onChange={(s, e) => {
                  setStartDate(s);
                  setDeadline(e);
                }}
                alignRight
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskItem['status'])}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-200"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_review">Waiting Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Responsabil (CRM)</label>
              <AlumniSearchPicker
                people={people}
                tasks={allTasks}
                value={assigneeId}
                onChange={setAssigneeId}
                onPersonCreated={onRefresh}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Prioritate</label>
              <div className="grid grid-cols-4 gap-1">
                {(Object.keys(PRIORITY_META) as PriorityKey[]).map((pk) => {
                  const meta = PRIORITY_META[pk];
                  return (
                    <button
                      key={pk}
                      type="button"
                      onClick={() => setPriority(pk)}
                      className={`rounded-md border py-1.5 text-[11px] font-medium transition ${
                        priority === pk
                          ? `${meta.badgeBg} ${meta.badgeText} border-current`
                          : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                      }`}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Efort / Load (ore)
                </label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-zinc-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Departament</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as DepartmentKey)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
                >
                  {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                    <option key={k} value={k}>
                      {DEPARTMENTS[k].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Proiect Părinte</label>
              <select
                value={projectId || ''}
                onChange={(e) => setProjectId(e.target.value || null)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-200"
              >
                <option value="">Task ad-hoc (fără proiect)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">
                Dependință (Blocked by)
              </label>
              <select
                value={blockedById || ''}
                onChange={(e) => setBlockedById(e.target.value || null)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-200"
              >
                <option value="">Fără blocaj</option>
                {allTasks
                  .filter((t) => t.id !== task.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.status})
                    </option>
                  ))}
              </select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 pt-1 text-zinc-300">
              <input
                type="checkbox"
                checked={isMyTask}
                onChange={(e) => setIsMyTask(e.target.checked)}
                className="accent-emerald-500"
              />
              <span>Apare în „Focusul Meu” (Dashboard)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-2 text-violet-200">
              <input
                type="checkbox"
                checked={needsPmSync}
                onChange={(e) => setNeedsPmSync(e.target.checked)}
                className="accent-violet-500"
              />
              <span>💬 De discutat cu Vlad (PM)</span>
            </label>
          </div>
        </div>

        {/* Footer Save */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-950 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Anulează
          </button>
          <button
            type="button"
            disabled={!title.trim() || saving}
            onClick={saveChanges}
            className="rounded-lg bg-emerald-600 px-5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving ? 'Salvez...' : 'Salvează modificările'}
          </button>
        </div>
      </div>
    </div>
  );
}