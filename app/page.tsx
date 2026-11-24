'use client';

import { useEffect, useState } from 'react';
import {
  AppNotification,
  DEPARTMENTS,
  DepartmentKey,
  EventItem,
  GeneralNote,
  HIERARCHICAL_ROLES,
  PartnerItem,
  Person,
  PostItNote,
  Project,
  ProjectNote,
  ResourceItem,
  TaskItem,
} from './lib/pmp-types';
import type { OutlookCalendarEvent } from './lib/outlook-graph';
import { DashboardView } from './components/DashboardView';
import { WorkspaceView } from './components/WorkspaceView';
import { TaskDetailModal } from './components/TaskDetailModal';
import { AlumnBotView } from './components/AlumnBotView';
import { CrmExcelImportModal } from './components/CrmExcelImportModal';
import type { ExtractedActionProposal } from './api/pmp/extract-actions/route';

type MainTab = 'dashboard' | 'workspace' | 'crm' | 'notes' | 'ai';
type CrmSubTab = 'people' | 'resources' | 'events' | 'partners';
type NotesFilter = 'all' | 'postit' | 'project' | 'general';

const DEPT_FOLDER_ORDER: DepartmentKey[] = [
  'Tehnic',
  'Comunicare',
  'Comunitati',
  'Coordonare Judeteana',
  'Board',
];

export default function AlumniCommandCenter() {
  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Dia-style Folders state
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    CORE_TEAM: true,
    Tehnic: true,
    Board: true,
  });
  const [selectedDeptFolder, setSelectedDeptFolder] = useState<DepartmentKey | null>(null);
  const [selectedProjectNavId, setSelectedProjectNavId] = useState<string | null>(null);
  const [onlyCoreTeamNav, setOnlyCoreTeamNav] = useState<boolean>(false);

  // Date live din Supabase PMP & CRM
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [generalNotes, setGeneralNotes] = useState<GeneralNote[]>([]);
  const [postItNotes, setPostItNotes] = useState<PostItNote[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Outlook Calendar State
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [outlookEvents, setOutlookEvents] = useState<OutlookCalendarEvent[]>([]);
  const [syncingOutlook, setSyncingOutlook] = useState(false);

  // Modal Global Jira/Asana Task Detail
  const [activeTaskModalId, setActiveTaskModalId] = useState<string | null>(null);

  // Notificări & AI Drawer
  const [notifOpen, setNotifOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | null>(null);

  // CRM State
  const [crmTab, setCrmTab] = useState<CrmSubTab>('people');
  const [crmSearch, setCrmSearch] = useState('');
  const [crmDeptFilter, setCrmDeptFilter] = useState<string>('');
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [copiedPersonId, setCopiedPersonId] = useState<string | null>(null);

  // Hub Notițe State
  const [notesFilter, setNotesFilter] = useState<NotesFilter>('all');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteCategory, setNoteCategory] = useState('Ședință Board');
  const [noteContent, setNoteContent] = useState('');
  const [noteAiMemory, setNoteAiMemory] = useState(true);
  const [noteDestination, setNoteDestination] = useState<'general' | 'postit' | 'project'>('general');
  const [noteTargetProjectId, setNoteTargetProjectId] = useState<string>('');
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editContent, setEditContent] = useState('');
  const [extractingNoteId, setExtractingNoteId] = useState<string | null>(null);
  const [noteProposals, setNoteProposals] = useState<Record<string, ExtractedActionProposal[]>>({});
  const [appliedProposalIds, setAppliedProposalIds] = useState<Record<string, boolean>>({});

  async function loadPmpData() {
    try {
      const [pmpRes, outlookRes] = await Promise.all([
        fetch('/api/pmp'),
        fetch('/api/outlook/events'),
      ]);

      if (pmpRes.ok) {
        const data = await pmpRes.json();
        setPeople(data.people || []);
        setProjects(data.projects || []);
        setTasks(data.tasks || []);
        setResources(data.resources || []);
        setEvents(data.events || []);
        setPartners(data.partners || []);
        setProjectNotes(data.projectNotes || []);
        setGeneralNotes(data.generalNotes || []);
        setPostItNotes(data.postItNotes || []);
        setNotifications(data.notifications || []);
      }

      if (outlookRes.ok) {
        const oData = await outlookRes.json();
        setOutlookConnected(Boolean(oData.connected));
        setOutlookEvents(oData.events || []);
      }
    } catch {
      // Ignorăm erorile tranzitorii de rețea
    }
  }

  useEffect(() => {
    loadPmpData();

    function onMessage(e: MessageEvent) {
      if (e.origin === window.location.origin && e.data?.type === 'OUTLOOK_AUTH_DONE') {
        loadPmpData();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAiDrawerOpen((prev) => !prev);
      }
    }

    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function openOutlookPopup() {
    const w = 520;
    const h = 680;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(
      '/api/outlook/auth',
      'OutlookAuth',
      `width=${w},height=${h},left=${left},top=${top}`
    );
  }

  async function handleManualOutlookSync() {
    if (syncingOutlook) return;
    setSyncingOutlook(true);
    try {
      await fetch('/api/outlook/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_all_tasks' }),
      });
      await loadPmpData();
    } finally {
      setSyncingOutlook(false);
    }
  }

  function triggerAskAi(prompt: string) {
    setQueuedAiPrompt(prompt);
    if (activeTab !== 'ai') {
      setAiDrawerOpen(true);
    }
  }

  function navigateToDepartmentFolder(dept: DepartmentKey, projectId: string | null = null) {
    setOnlyCoreTeamNav(false);
    setSelectedDeptFolder(dept);
    setSelectedProjectNavId(projectId);
    setOpenFolders((prev) => ({ ...prev, [dept]: true }));
    setActiveTab('workspace');
  }

  function navigateToCoreTeamFolder(projectId: string | null = null) {
    setSelectedDeptFolder(null);
    setOnlyCoreTeamNav(true);
    setSelectedProjectNavId(projectId);
    setOpenFolders((prev) => ({ ...prev, CORE_TEAM: true }));
    setActiveTab('workspace');
  }

  function copyPersonSummary(person: Person) {
    const personTasks = tasks.filter(
      (t) => t.assignee_id === person.id && t.status !== 'done'
    );
    const lines = [
      `👤 *Status Săptămânal — ${person.full_name}* (${person.role} · ${DEPARTMENTS[person.department]?.label || person.department})`,
      ...(personTasks.length
        ? personTasks.map(
            (t) => `• [${t.status}] ${t.title}${t.deadline ? ` — termen ${t.deadline}` : ''}`
          )
        : ['• Niciun task activ asignat momentan.']),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedPersonId(person.id);
    setTimeout(() => setCopiedPersonId(null), 2000);
  }

  async function handleRoleChange(personId: string, newRole: string) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_person_role',
        id: personId,
        role: newRole,
      }),
    });
    await loadPmpData();
  }

  async function handleCreateUnifiedNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;

    if (noteDestination === 'postit') {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_post_it',
          content: noteContent.trim(),
          color: 'amber',
        }),
      });
    } else if (noteDestination === 'project' && noteTargetProjectId) {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project_note',
          project_id: noteTargetProjectId,
          content: noteContent.trim(),
          is_ai_memory: noteAiMemory,
        }),
      });
    } else {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_general_note',
          title: noteTitle.trim() || 'Notiță ședință',
          category: noteCategory,
          content: noteContent.trim(),
          is_ai_memory: noteAiMemory,
        }),
      });
    }

    setNoteTitle('');
    setNoteContent('');
    await loadPmpData();
  }

  async function saveEditedNote(
    kind: 'postit' | 'project' | 'general',
    id: string
  ) {
    if (!editContent.trim()) return;
    if (kind === 'postit') {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_post_it',
          id,
          content: editContent.trim(),
        }),
      });
    } else if (kind === 'project') {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project_note',
          id,
          content: editContent.trim(),
        }),
      });
    } else {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_general_note',
          id,
          title: editTitle.trim() || 'Notiță',
          category: editCategory.trim() || 'Ședință',
          content: editContent.trim(),
        }),
      });
    }
    setEditingNoteKey(null);
    await loadPmpData();
  }

  async function deleteAnyNote(kind: 'postit' | 'project' | 'general', id: string) {
    const actionMap = {
      postit: 'delete_post_it',
      project: 'delete_project_note',
      general: 'delete_general_note',
    } as const;

    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionMap[kind], id }),
    });
    await loadPmpData();
  }

  async function toggleNoteMemory(
    noteType: 'general' | 'project',
    noteId: string,
    nextVal: boolean
  ) {
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_note_ai_memory',
        noteType,
        id: noteId,
        is_ai_memory: nextVal,
      }),
    });
    await loadPmpData();
  }

  async function handleExtractActions(noteId: string, title: string, content: string) {
    if (extractingNoteId) return;
    setExtractingNoteId(noteId);
    try {
      const res = await fetch('/api/pmp/extract-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteTitle: title,
          noteText: content,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.proposals)) {
        setNoteProposals((prev) => ({ ...prev, [noteId]: data.proposals }));
      }
    } finally {
      setExtractingNoteId(null);
    }
  }

  async function applyExtractedProposal(prop: ExtractedActionProposal) {
    if (appliedProposalIds[prop.id]) return;

    if (
      prop.kind === 'update_project_progress' &&
      prop.project_id &&
      prop.new_progress !== undefined
    ) {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project',
          id: prop.project_id,
          progress: prop.new_progress,
        }),
      });
    } else {
      await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          title: prop.title,
          type: prop.kind === 'create_milestone' ? 'milestone' : 'task',
          department: prop.department,
          project_id: prop.project_id,
          assignee_id: prop.assignee_id,
          deadline: prop.deadline,
          is_my_task: prop.is_my_task,
        }),
      });
    }

    setAppliedProposalIds((prev) => ({ ...prev, [prop.id]: true }));
    await loadPmpData();
  }

  const activeTaskModal = activeTaskModalId
    ? tasks.find((t) => t.id === activeTaskModalId) || null
    : null;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const coreTeamProjects = projects.filter((p) => p.is_core_team && p.status !== 'completed');

  const filteredPeople = people.filter((p) => {
    const matchesDept = !crmDeptFilter || p.department === crmDeptFilter;
    const q = crmSearch.toLowerCase();
    const matchesQuery =
      !q ||
      p.full_name.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q) ||
      (p.skills || []).some((s) => s.toLowerCase().includes(q));
    return matchesDept && matchesQuery;
  });

  const totalAllNotes = generalNotes.length + projectNotes.length + postItNotes.length;

  return (
    <div className="flex h-screen gap-2.5 overflow-hidden bg-[#0B0C0E] p-2.5 text-zinc-100">
      {/* ===================================================================== */}
      {/* DIA-STYLE FLOATING SIDEBAR (CORE TEAM + DEPARTMENT FOLDERS)           */}
      {/* ===================================================================== */}
      <aside
        className={`flex shrink-0 flex-col rounded-2xl border border-white/[0.07] bg-[#13151A] shadow-2xl transition-all duration-200 ${
          navCollapsed ? 'w-14' : 'w-60'
        }`}
      >
        {/* Top Brand + Collapse */}
        <div className="flex h-12 items-center justify-between px-3.5">
          {!navCollapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.08] font-mono text-[11px] font-bold text-zinc-100">
                CK
              </div>
              <span className="text-xs font-semibold tracking-tight text-zinc-200">
                Alumni Command
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setNavCollapsed((p) => !p)}
            className="rounded-lg p-1.5 text-xs text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
            title={navCollapsed ? 'Extinde sidebar' : 'Restrânge sidebar'}
          >
            {navCollapsed ? '»' : '«'}
          </button>
        </div>

        {/* Dia-style Command / Ask AI Trigger */}
        {!navCollapsed && activeTab !== 'ai' && (
          <div className="px-2.5 pb-2">
            <button
              type="button"
              onClick={() => setAiDrawerOpen(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs text-zinc-400 transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-zinc-200"
            >
              <span className="flex items-center gap-2">
                <span className="text-emerald-400">✦</span>
                <span>Ask Alumn-Bot...</span>
              </span>
              <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {/* Primary Navigation */}
        <div className="flex-1 space-y-4 overflow-y-auto px-2 py-1">
          <nav className="space-y-0.5">
            {[
              { id: 'dashboard', icon: '⌂', label: 'Acasă' },
              { id: 'workspace', icon: '◫', label: 'Toate Proiectele' },
              { id: 'crm', icon: '◎', label: 'Oameni & CRM' },
              {
                id: 'notes',
                icon: '✎',
                label: 'Notițe',
                badge: totalAllNotes > 0 ? totalAllNotes : undefined,
              },
              { id: 'ai', icon: '✦', label: 'Alumn-Bot' },
            ].map((item) => {
              const isAllWorkspace =
                item.id === 'workspace' &&
                activeTab === 'workspace' &&
                !selectedDeptFolder &&
                !onlyCoreTeamNav;
              const isActive =
                item.id === 'workspace' ? isAllWorkspace : activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'workspace') {
                      setSelectedDeptFolder(null);
                      setSelectedProjectNavId(null);
                      setOnlyCoreTeamNav(false);
                    }
                    setActiveTab(item.id as MainTab);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs font-medium transition ${
                    isActive
                      ? 'bg-white/[0.09] text-white'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <span className="w-4 text-center text-sm opacity-80">{item.icon}</span>
                    {!navCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!navCollapsed && item.badge !== undefined && (
                    <span className="font-mono text-[10px] text-zinc-500">{item.badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* FOLDER DEDICAT CORE TEAM */}
          {!navCollapsed && (
            <div className="space-y-1">
              <div
                className={`flex items-center justify-between rounded-xl px-2 py-1.5 text-xs transition ${
                  activeTab === 'workspace' && onlyCoreTeamNav && !selectedProjectNavId
                    ? 'bg-amber-500/15 font-medium text-amber-200'
                    : 'text-amber-300/80 hover:bg-white/[0.04] hover:text-amber-200'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenFolders((prev) => ({
                        ...prev,
                        CORE_TEAM: !prev.CORE_TEAM,
                      }))
                    }
                    className="rounded p-0.5 text-[10px] opacity-70 hover:opacity-100"
                  >
                    {openFolders.CORE_TEAM ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToCoreTeamFolder(null)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <span>✦</span>
                    <span className="truncate">Core Team</span>
                  </button>
                </div>
                {coreTeamProjects.length > 0 && (
                  <span className="font-mono text-[10px] text-amber-300/60">
                    {coreTeamProjects.length}
                  </span>
                )}
              </div>

              {openFolders.CORE_TEAM && coreTeamProjects.length > 0 && (
                <div className="ml-4 space-y-0.5 border-l border-amber-500/20 pl-2.5">
                  {coreTeamProjects.map((proj) => (
                    <button
                      key={`core-${proj.id}`}
                      type="button"
                      onClick={() => navigateToCoreTeamFolder(proj.id)}
                      className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] transition ${
                        activeTab === 'workspace' && selectedProjectNavId === proj.id
                          ? 'bg-amber-500/15 font-medium text-amber-200'
                          : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                      }`}
                    >
                      <span className="truncate">{proj.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                        {proj.progress}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* FOLDERE PE DEPARTAMENTE (AUTO-SINCRONIZATE DIN SUPABASE) */}
          {!navCollapsed && (
            <div className="space-y-1 pt-1">
              <div className="px-2.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Departamente
              </div>

              <div className="space-y-0.5">
                {DEPT_FOLDER_ORDER.map((deptKey) => {
                  const meta = DEPARTMENTS[deptKey];
                  const deptProjects = projects.filter(
                    (p) => p.department === deptKey && p.status !== 'completed'
                  );
                  const isFolderOpen = Boolean(openFolders[deptKey]);
                  const isDeptSelected =
                    activeTab === 'workspace' &&
                    selectedDeptFolder === deptKey &&
                    !selectedProjectNavId;

                  return (
                    <div key={deptKey}>
                      <div
                        className={`group flex items-center justify-between rounded-xl px-2 py-1.5 text-xs transition ${
                          isDeptSelected
                            ? 'bg-white/[0.09] font-medium text-white'
                            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenFolders((prev) => ({
                                ...prev,
                                [deptKey]: !prev[deptKey],
                              }));
                            }}
                            className="rounded p-0.5 text-[10px] text-zinc-500 hover:text-zinc-200"
                          >
                            {isFolderOpen ? '▾' : '▸'}
                          </button>

                          <button
                            type="button"
                            onClick={() => navigateToDepartmentFolder(deptKey, null)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${meta.dotBg}`}
                            />
                            <span className="truncate">{meta.label}</span>
                          </button>
                        </div>

                        {deptProjects.length > 0 && (
                          <span className="font-mono text-[10px] text-zinc-600">
                            {deptProjects.length}
                          </span>
                        )}
                      </div>

                      {isFolderOpen && deptProjects.length > 0 && (
                        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-2.5">
                          {deptProjects.map((proj) => {
                            const isProjActive =
                              activeTab === 'workspace' && selectedProjectNavId === proj.id;
                            return (
                              <button
                                key={proj.id}
                                type="button"
                                onClick={() => navigateToDepartmentFolder(deptKey, proj.id)}
                                className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] transition ${
                                  isProjActive
                                    ? 'bg-white/[0.08] font-medium text-white'
                                    : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'
                                }`}
                              >
                                <span className="truncate">
                                  {proj.is_core_team ? '✦ ' : ''}
                                  {proj.title}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                                  {proj.progress}%
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Utility Dock */}
        <div className="space-y-1 border-t border-white/[0.06] p-2">
          {!navCollapsed ? (
            <>
              {outlookConnected ? (
                <button
                  type="button"
                  disabled={syncingOutlook}
                  onClick={handleManualOutlookSync}
                  className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-[11px] text-sky-300 transition hover:bg-white/[0.04]"
                >
                  <span>
                    {syncingOutlook ? '⏳ Sincronizez...' : '📅 Outlook Synced'}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openOutlookPopup}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
                >
                  <span>📅</span>
                  <span>Conectează Outlook</span>
                </button>
              )}

              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => setExcelModalOpen(true)}
                  className="flex-1 rounded-xl px-2.5 py-1.5 text-left text-[11px] text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
                >
                  📥 Import Sheets
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setNotifOpen((p) => !p)}
                    className="relative rounded-xl px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200"
                    title="Alerte operaționale"
                  >
                    🔔
                    {notifications.length > 0 && (
                      <span className="ml-1 rounded-full bg-rose-500 px-1.5 font-mono text-[10px] font-bold text-white">
                        {notifications.length}
                      </span>
                    )}
                  </button>

                  {notifOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-white/[0.1] bg-[#171920] p-3 shadow-2xl">
                      <div className="mb-2 flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                        <span className="text-xs font-medium text-zinc-200">
                          Alerte ({notifications.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setNotifOpen(false)}
                          className="text-xs text-zinc-500"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="max-h-64 space-y-1.5 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="py-4 text-center text-xs text-zinc-500">
                            Nicio alertă activă.
                          </p>
                        ) : (
                          notifications.map((n) => (
                            <div
                              key={n.id}
                              className="rounded-xl bg-white/[0.03] p-2.5 text-xs"
                            >
                              <p className="font-medium text-zinc-200">{n.title}</p>
                              <p className="mt-0.5 text-[11px] text-zinc-500">{n.detail}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAiDrawerOpen(true)}
              className="flex w-full justify-center rounded-xl py-2 text-xs text-emerald-400 hover:bg-white/[0.05]"
              title="Ask Alumn-Bot"
            >
              ✦
            </button>
          )}
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* MAIN FLOATING WORKSPACE SURFACE                                       */}
      {/* ===================================================================== */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#101115]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              people={people}
              projects={projects}
              tasks={tasks}
              postItNotes={postItNotes}
              onRefresh={loadPmpData}
              onAskAiStatus={triggerAskAi}
              onOpenTaskModal={(t) => setActiveTaskModalId(t.id)}
              onSelectDepartment={(dept) => navigateToDepartmentFolder(dept, null)}
            />
          )}

          {activeTab === 'workspace' && (
            <WorkspaceView
              people={people}
              projects={projects}
              tasks={tasks}
              resources={resources}
              events={events}
              partners={partners}
              projectNotes={projectNotes}
              outlookEvents={outlookEvents}
              selectedDepartment={selectedDeptFolder}
              selectedProjectFromNav={selectedProjectNavId}
              onlyCoreTeamFromNav={onlyCoreTeamNav}
              onClearNavSelection={() => {
                setSelectedDeptFolder(null);
                setSelectedProjectNavId(null);
                setOnlyCoreTeamNav(false);
              }}
              onRefresh={loadPmpData}
              onAskAiContext={triggerAskAi}
              onOpenTaskModal={(t) => setActiveTaskModalId(t.id)}
            />
          )}

          {activeTab === 'crm' && (
            <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                <div className="flex flex-wrap gap-1 rounded-xl bg-white/[0.03] p-0.5 text-xs">
                  {[
                    { id: 'people', label: `Oameni (${people.length})` },
                    { id: 'resources', label: `Resurse (${resources.length})` },
                    { id: 'events', label: `Evenimente (${events.length})` },
                    { id: 'partners', label: `Parteneri (${partners.length})` },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCrmTab(t.id as CrmSubTab)}
                      className={`rounded-lg px-3 py-1.5 font-medium transition ${
                        crmTab === t.id
                          ? 'bg-white/[0.1] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setExcelModalOpen(true)}
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
                >
                  + Import Sheets / Excel
                </button>
              </div>

              {crmTab === 'people' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={crmSearch}
                      onChange={(e) => setCrmSearch(e.target.value)}
                      placeholder="Caută după nume, rol, oraș..."
                      className="min-w-[220px] flex-1 rounded-xl border border-white/[0.07] bg-[#15171D] px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
                    />
                    <select
                      value={crmDeptFilter}
                      onChange={(e) => setCrmDeptFilter(e.target.value)}
                      className="rounded-xl border border-white/[0.07] bg-[#15171D] px-3 py-2 text-xs text-zinc-200"
                    >
                      <option value="">Toate departamentele</option>
                      {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                        <option key={k} value={k}>
                          {DEPARTMENTS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#15171D]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-white/[0.06] text-[11px] text-zinc-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Nume &amp; Contact</th>
                          <th className="px-4 py-3 font-medium">Rol</th>
                          <th className="px-4 py-3 font-medium">Departament</th>
                          <th className="px-4 py-3 font-medium">Locație</th>
                          <th className="px-4 py-3 font-medium">Detalii</th>
                          <th className="px-4 py-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {filteredPeople.map((p) => {
                          const meta = DEPARTMENTS[p.department] || DEPARTMENTS.Comunitati;
                          return (
                            <tr key={p.id} className="hover:bg-white/[0.02]">
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-zinc-100">{p.full_name}</div>
                                <div className="text-[11px] text-zinc-500">
                                  {[p.phone, p.email].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <select
                                  value={p.role}
                                  onChange={(e) => handleRoleChange(p.id, e.target.value)}
                                  className="rounded-lg border border-white/[0.07] bg-[#0F1014] px-2 py-1 text-[11px] text-zinc-200 focus:outline-none"
                                >
                                  {HIERARCHICAL_ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300">
                                  <span className={`h-2 w-2 rounded-full ${meta.dotBg}`} />
                                  {meta.label}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-zinc-400">
                                {[p.location, p.age ? `${p.age} ani` : null]
                                  .filter(Boolean)
                                  .join(' · ') || '-'}
                              </td>
                              <td className="max-w-[240px] truncate px-4 py-2.5 text-[11px] text-zinc-500">
                                {p.notes || '-'}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => copyPersonSummary(p)}
                                  className="rounded-lg border border-white/[0.07] px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white"
                                >
                                  {copiedPersonId === p.id ? '✓ Copiat' : 'Summary'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {crmTab === 'resources' && (
                <div className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs">
                  {resources.length === 0 ? (
                    <p className="py-6 text-center text-zinc-500">Nicio resursă importată.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {resources.map((r) => (
                        <div key={r.id} className="flex items-center justify-between py-2.5">
                          <div>
                            <span className="mr-2 rounded bg-white/[0.05] px-2 py-0.5 text-[10px] text-zinc-400">
                              {r.type}
                            </span>
                            <span className="font-medium text-zinc-200">{r.title}</span>
                          </div>
                          {r.url_or_ref && (
                            <span className="truncate font-mono text-[11px] text-zinc-400">
                              {r.url_or_ref}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {crmTab === 'events' && (
                <div className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs">
                  {events.length === 0 ? (
                    <p className="py-6 text-center text-zinc-500">Niciun eveniment înregistrat.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {events.map((ev) => (
                        <div key={ev.id} className="flex items-center justify-between py-2.5">
                          <span className="font-medium text-zinc-200">{ev.name}</span>
                          <span className="text-zinc-500">
                            {ev.location || 'N/A'} · {ev.start_date || 'N/A'} ({ev.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {crmTab === 'partners' && (
                <div className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs">
                  {partners.length === 0 ? (
                    <p className="py-6 text-center text-zinc-500">Niciun partener înregistrat.</p>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {partners.map((pt) => (
                        <div key={pt.id} className="flex items-center justify-between py-2.5">
                          <span className="font-medium text-zinc-200">{pt.name}</span>
                          <span className="text-zinc-500">
                            {pt.contact_person || '-'} · {pt.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

{/* HUB CENTRAL NOTIȚE (POST-IT + PROIECTE + ȘEDINȚE — CU EDITARE & ȘTERGERE) */}
          {activeTab === 'notes' && (
            <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3 text-xs">
                <div className="flex flex-wrap gap-1 rounded-xl bg-white/[0.03] p-0.5">
                  {[
                    { id: 'all', label: `Toate (${totalAllNotes})` },
                    { id: 'postit', label: `📌 Post-it (${postItNotes.length})` },
                    { id: 'project', label: `📁 Proiecte (${projectNotes.length})` },
                    { id: 'general', label: `📝 Ședințe (${generalNotes.length})` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setNotesFilter(f.id as NotesFilter)}
                      className={`rounded-lg px-3 py-1.5 font-medium transition ${
                        notesFilter === f.id
                          ? 'bg-white/[0.1] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Formular Unificat cu Alegere Destinație */}
              <form
                onSubmit={handleCreateUnifiedNote}
                className="space-y-3 rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-xl bg-[#0F1014] p-1">
                    {[
                      { id: 'general', label: '📝 Notiță Ședință / Generală' },
                      { id: 'project', label: '📁 Legată de Proiect' },
                      { id: 'postit', label: '📌 Post-it Personal (Dashboard)' },
                    ].map((dest) => (
                      <button
                        key={dest.id}
                        type="button"
                        onClick={() =>
                          setNoteDestination(dest.id as 'general' | 'postit' | 'project')
                        }
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                          noteDestination === dest.id
                            ? 'bg-white/[0.12] text-white'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {dest.label}
                      </button>
                    ))}
                  </div>

                  {noteDestination !== 'postit' && (
                    <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
                      <input
                        type="checkbox"
                        checked={noteAiMemory}
                        onChange={(e) => setNoteAiMemory(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      <span>Memorie live AI</span>
                    </label>
                  )}
                </div>

                {noteDestination === 'general' && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      value={noteTitle}
                      onChange={(e) => setNoteTitle(e.target.value)}
                      placeholder="Titlu ședință / notiță..."
                      className="rounded-xl border border-white/[0.07] bg-[#0F1014] px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none sm:col-span-2"
                    />
                    <input
                      type="text"
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value)}
                      placeholder="Categorie (ex: Ședință Board)"
                      className="rounded-xl border border-white/[0.07] bg-[#0F1014] px-3 py-2 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                    />
                  </div>
                )}

                {noteDestination === 'project' && (
                  <select
                    required
                    value={noteTargetProjectId}
                    onChange={(e) => setNoteTargetProjectId(e.target.value)}
                    className="w-full rounded-xl border border-white/[0.07] bg-[#0F1014] px-3 py-2 text-zinc-200 focus:outline-none"
                  >
                    <option value="">Alege proiectul în care se salvează notița...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({DEPARTMENTS[p.department]?.label})
                      </option>
                    ))}
                  </select>
                )}

                <textarea
                  rows={3}
                  required
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Scrie conținutul notiței..."
                  className="w-full rounded-xl border border-white/[0.07] bg-[#0F1014] p-3 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-zinc-100 px-4 py-1.5 font-medium text-zinc-900 hover:bg-white"
                  >
                    Salvează Notița
                  </button>
                </div>
              </form>

              {/* Lista Tuturor Notițelor cu Editare & Ștergere */}
              <div className="grid gap-3 sm:grid-cols-2">
                {/* 1. POST-IT NOTES */}
                {(notesFilter === 'all' || notesFilter === 'postit') &&
                  postItNotes.map((pi) => {
                    const isEditing = editingNoteKey === `postit-${pi.id}`;
                    return (
                      <div
                        key={`pi-${pi.id}`}
                        className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-amber-300/80">
                          <span>📌 Post-it Personal</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteKey(isEditing ? null : `postit-${pi.id}`);
                                setEditContent(pi.content);
                              }}
                              className="text-zinc-300 hover:text-white"
                            >
                              {isEditing ? 'Anulează' : 'Editează'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAnyNote('postit', pi.id)}
                              className="text-rose-400 hover:text-rose-300"
                            >
                              Șterge
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              rows={3}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded-xl border border-white/[0.1] bg-[#0F1014] p-2.5 text-zinc-100"
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => saveEditedNote('postit', pi.id)}
                                className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900"
                              >
                                Salvează
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-2 whitespace-pre-wrap text-zinc-200">
                              {pi.content}
                            </p>
                            <div className="mt-3 flex justify-end pt-2">
                              <button
                                type="button"
                                disabled={extractingNoteId === pi.id}
                                onClick={() =>
                                  handleExtractActions(pi.id, 'Post-it Dashboard', pi.content)
                                }
                                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
                              >
                                {extractingNoteId === pi.id
                                  ? 'Analizez...'
                                  : '✦ Extrage acțiuni'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                {/* 2. PROJECT NOTES */}
                {(notesFilter === 'all' || notesFilter === 'project') &&
                  projectNotes.map((pn) => {
                    const parentProj = projectMap.get(pn.project_id);
                    const isEditing = editingNoteKey === `project-${pn.id}`;
                    return (
                      <div
                        key={`pn-${pn.id}`}
                        className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] font-medium text-sky-300">
                            📁 {parentProj?.title || 'Proiect'}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                toggleNoteMemory('project', pn.id, !pn.is_ai_memory)
                              }
                              className={`rounded-md px-2 py-0.5 text-[10px] ${
                                pn.is_ai_memory
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-white/[0.04] text-zinc-500'
                              }`}
                            >
                              {pn.is_ai_memory ? 'Memorie AI' : '+ Memorie'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteKey(isEditing ? null : `project-${pn.id}`);
                                setEditContent(pn.content);
                              }}
                              className="text-[11px] text-zinc-400 hover:text-white"
                            >
                              {isEditing ? 'Anulează' : 'Editează'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAnyNote('project', pn.id)}
                              className="text-[11px] text-rose-400 hover:text-rose-300"
                            >
                              Șterge
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              rows={3}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded-xl border border-white/[0.1] bg-[#0F1014] p-2.5 text-zinc-100"
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => saveEditedNote('project', pn.id)}
                                className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900"
                              >
                                Salvează
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-2 whitespace-pre-wrap text-zinc-200">
                              {pn.content}
                            </p>
                            <div className="mt-3 flex items-center justify-between pt-2">
                              <span className="text-[10px] text-zinc-500">
                                {new Date(pn.created_at).toLocaleDateString('ro-RO')}
                              </span>
                              <button
                                type="button"
                                disabled={extractingNoteId === pn.id}
                                onClick={() =>
                                  handleExtractActions(
                                    pn.id,
                                    parentProj?.title || 'Proiect',
                                    pn.content
                                  )
                                }
                                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
                              >
                                {extractingNoteId === pn.id
                                  ? 'Analizez...'
                                  : '✦ Extrage acțiuni'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                {/* 3. GENERAL / MEETING NOTES */}
                {(notesFilter === 'all' || notesFilter === 'general') &&
                  generalNotes.map((n) => {
                    const isEditing = editingNoteKey === `general-${n.id}`;
                    return (
                      <div
                        key={n.id}
                        className="rounded-2xl border border-white/[0.06] bg-[#15171D] p-4 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-500">📝 {n.category}</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                toggleNoteMemory('general', n.id, !n.is_ai_memory)
                              }
                              className={`rounded-md px-2 py-0.5 text-[10px] ${
                                n.is_ai_memory
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-white/[0.04] text-zinc-500'
                              }`}
                            >
                              {n.is_ai_memory ? 'Memorie AI' : '+ Memorie'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteKey(isEditing ? null : `general-${n.id}`);
                                setEditTitle(n.title);
                                setEditCategory(n.category);
                                setEditContent(n.content);
                              }}
                              className="text-[11px] text-zinc-400 hover:text-white"
                            >
                              {isEditing ? 'Anulează' : 'Editează'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAnyNote('general', n.id)}
                              className="text-[11px] text-rose-400 hover:text-rose-300"
                            >
                              Șterge
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-2 space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="rounded-lg border border-white/[0.1] bg-[#0F1014] px-2.5 py-1.5 text-zinc-100"
                              />
                              <input
                                type="text"
                                value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value)}
                                className="rounded-lg border border-white/[0.1] bg-[#0F1014] px-2.5 py-1.5 text-zinc-100"
                              />
                            </div>
                            <textarea
                              rows={3}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded-xl border border-white/[0.1] bg-[#0F1014] p-2.5 text-zinc-100"
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => saveEditedNote('general', n.id)}
                                className="rounded-lg bg-zinc-100 px-3 py-1 font-medium text-zinc-900"
                              >
                                Salvează
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <h4 className="mt-1.5 font-semibold text-zinc-100">{n.title}</h4>
                            <p className="mt-1 whitespace-pre-wrap text-zinc-300">
                              {n.content}
                            </p>

                            <div className="mt-3 flex items-center justify-end pt-2">
                              <button
                                type="button"
                                disabled={extractingNoteId === n.id}
                                onClick={() =>
                                  handleExtractActions(n.id, n.title, n.content)
                                }
                                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
                              >
                                {extractingNoteId === n.id
                                  ? 'Analizez...'
                                  : '✦ Extrage acțiuni'}
                              </button>
                            </div>
                          </>
                        )}

                        {noteProposals[n.id] && (
                          <div className="mt-2.5 space-y-1.5 rounded-xl bg-[#0F1014] p-2.5">
                            {noteProposals[n.id].length === 0 ? (
                              <p className="text-[11px] text-zinc-500">
                                Nicio acțiune concretă detectată.
                              </p>
                            ) : (
                              noteProposals[n.id].map((prop) => (
                                <div
                                  key={prop.id}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[11px]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-zinc-200">
                                      {prop.title}
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                      {prop.department}
                                      {prop.assignee_name ? ` · ${prop.assignee_name}` : ''}
                                    </div>
                                  </div>

                                  {appliedProposalIds[prop.id] ? (
                                    <span className="text-emerald-400">✓ Aplicat</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => applyExtractedProposal(prop)}
                                      className="rounded-md bg-zinc-100 px-2.5 py-1 font-medium text-zinc-900"
                                    >
                                      Aplică
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}        

          {activeTab === 'ai' && (
            <AlumnBotView
              initialPrompt={queuedAiPrompt}
              onInitialPromptConsumed={() => setQueuedAiPrompt(null)}
            />
          )}
        </div>
      </main>

      {/* JIRA / ASANA TASK DETAIL MODAL */}
      {activeTaskModal && (
        <TaskDetailModal
          task={activeTaskModal}
          allTasks={tasks}
          projects={projects}
          people={people}
          onClose={() => setActiveTaskModalId(null)}
          onRefresh={loadPmpData}
          onSelectTask={(next) => setActiveTaskModalId(next.id)}
        />
      )}

      {/* DIA-STYLE FLOATING AI COPILOT DRAWER */}
      {aiDrawerOpen && activeTab !== 'ai' && (
        <div className="fixed inset-y-3 right-3 z-40 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#13151A] shadow-2xl">
          <div className="flex h-11 items-center justify-between border-b border-white/[0.06] px-4">
            <span className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              <span className="text-emerald-400">✦</span>
              <span>Alumn-Bot</span>
            </span>
            <button
              type="button"
              onClick={() => setAiDrawerOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <AlumnBotView
              compactDrawer
              initialPrompt={queuedAiPrompt}
              onInitialPromptConsumed={() => setQueuedAiPrompt(null)}
            />
          </div>
        </div>
      )}

      {/* EXCEL / GOOGLE SHEETS IMPORT MODAL */}
      {excelModalOpen && (
        <CrmExcelImportModal
          onClose={() => setExcelModalOpen(false)}
          onImported={loadPmpData}
        />
      )}
    </div>
  );
}