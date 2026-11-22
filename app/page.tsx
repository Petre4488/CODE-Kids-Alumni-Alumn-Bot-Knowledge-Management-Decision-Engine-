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

export default function AlumniCommandCenter() {
  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [navCollapsed, setNavCollapsed] = useState(false);

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
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
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

  async function handleCreateGeneralNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    await fetch('/api/pmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_general_note',
        title: noteTitle.trim() || 'Notiță operațională',
        category: noteCategory,
        content: noteContent.trim(),
        is_ai_memory: noteAiMemory,
      }),
    });
    setNoteTitle('');
    setNoteContent('');
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

  const NAV_ITEMS: { id: MainTab; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'workspace', icon: '📐', label: 'Workspace Proiecte' },
    { id: 'crm', icon: '🗂️', label: 'Bază de Date (CRM)' },
    { id: 'notes', icon: '📝', label: `Notițe (${totalAllNotes})` },
    { id: 'ai', icon: '🤖', label: 'Alumn-Bot & Decizii' },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* LEFT MASTER SIDEBAR */}
      <aside
        className={`flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/95 transition-all ${
          navCollapsed ? 'w-14' : 'w-56'
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b border-zinc-800 px-3">
          {!navCollapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 font-mono text-xs font-bold text-emerald-400">
                CK
              </div>
              <span className="text-xs font-semibold tracking-tight text-zinc-100">
                Alumni Command
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setNavCollapsed((p) => !p)}
            className="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title={navCollapsed ? 'Extinde meniul' : 'Restrânge meniul'}
          >
            {navCollapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                  active
                    ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    : 'border border-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                {!navCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!navCollapsed && (
          <div className="border-t border-zinc-800 p-3 text-[11px] text-zinc-500">
            Single-Operator Mode · Petre
          </div>
        )}
      </aside>

      {/* MAIN CONTENT SHELL */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP HEADER BAR */}
        <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <span>{NAV_ITEMS.find((n) => n.id === activeTab)?.icon}</span>
            <span>{NAV_ITEMS.find((n) => n.id === activeTab)?.label}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* BUTON POPUP OUTLOOK CALENDAR */}
            {outlookConnected ? (
              <button
                type="button"
                disabled={syncingOutlook}
                onClick={handleManualOutlookSync}
                title="Sincronizează task-urile cu Outlook Calendar"
                className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
              >
                {syncingOutlook ? '⏳ Sincronizez...' : '📅 Outlook Synced ✓'}
              </button>
            ) : (
              <button
                type="button"
                onClick={openOutlookPopup}
                className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
              >
                📅 Conectează Outlook
              </button>
            )}

            <button
              type="button"
              onClick={() => setExcelModalOpen(true)}
              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-emerald-500/50"
            >
              📥 Import Excel / Sheets
            </button>

            {/* Clopoțel Notificări In-App */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((p) => !p)}
                className="relative rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                title="Centru de Notificări"
              >
                🔔
                {notifications.length > 0 && (
                  <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white">
                    {notifications.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between border-b border-zinc-800 pb-1.5">
                    <span className="text-xs font-semibold text-zinc-200">
                      Notificări Operaționale ({notifications.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-zinc-400"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-zinc-500">
                        Nicio alertă activă.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs"
                        >
                          <p className="font-medium text-zinc-200">{n.title}</p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">{n.detail}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {activeTab !== 'ai' && (
              <button
                type="button"
                onClick={() => setAiDrawerOpen((p) => !p)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  aiDrawerOpen
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                    : 'border-emerald-500/40 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30'
                }`}
              >
                🤖 Ask AI
              </button>
            )}
          </div>
        </header>

        {/* TAB CONTENT */}
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
              onRefresh={loadPmpData}
              onAskAiContext={triggerAskAi}
              onOpenTaskModal={(t) => setActiveTaskModalId(t.id)}
            />
          )}

          {activeTab === 'crm' && (
            <div className="mx-auto max-w-6xl space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {[
                    { id: 'people', label: `👥 Oameni (${people.length})` },
                    { id: 'resources', label: `📁 Resurse (${resources.length})` },
                    { id: 'events', label: `📅 Evenimente (${events.length})` },
                    { id: 'partners', label: `🤝 Parteneri (${partners.length})` },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCrmTab(t.id as CrmSubTab)}
                      className={`rounded-lg px-3 py-1.5 font-medium transition ${
                        crmTab === t.id
                          ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setExcelModalOpen(true)}
                  className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  📥 Sincronizează Google Sheets / Excel
                </button>
              </div>

              {crmTab === 'people' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={crmSearch}
                      onChange={(e) => setCrmSearch(e.target.value)}
                      placeholder="Caută după nume, rol, oraș, skill..."
                      className="min-w-[220px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100"
                    />
                    <select
                      value={crmDeptFilter}
                      onChange={(e) => setCrmDeptFilter(e.target.value)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200"
                    >
                      <option value="">Toate departamentele</option>
                      {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                        <option key={k} value={k}>
                          {DEPARTMENTS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/80">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-800 bg-zinc-950 text-[11px] uppercase text-zinc-400">
                        <tr>
                          <th className="px-3 py-2.5">Nume & Contact</th>
                          <th className="px-3 py-2.5">Rol</th>
                          <th className="px-3 py-2.5">Departament</th>
                          <th className="px-3 py-2.5">Locație / Vârstă</th>
                          <th className="px-3 py-2.5">Detalii / Status</th>
                          <th className="px-3 py-2.5">Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {filteredPeople.map((p) => {
                          const meta = DEPARTMENTS[p.department] || DEPARTMENTS.Comunitati;
                          return (
                            <tr key={p.id} className="hover:bg-zinc-800/40">
                              <td className="px-3 py-2">
                                <div className="font-medium text-zinc-100">{p.full_name}</div>
                                <div className="text-[11px] text-zinc-500">
                                  {[p.phone, p.email].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={p.role}
                                  onChange={(e) => handleRoleChange(p.id, e.target.value)}
                                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 focus:border-emerald-500 focus:outline-none"
                                >
                                  {HIERARCHICAL_ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] ${meta.badgeBg} ${meta.badgeText}`}
                                >
                                  {meta.label}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-zinc-400">
                                {[p.location, p.age ? `${p.age} ani` : null]
                                  .filter(Boolean)
                                  .join(' · ') || '-'}
                              </td>
                              <td className="max-w-[260px] px-3 py-2 text-[11px] text-zinc-400">
                                {p.notes || '-'}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => copyPersonSummary(p)}
                                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500/50"
                                >
                                  {copiedPersonId === p.id ? '✓ Copiat' : '📋 Summary'}
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
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 text-xs">
                  {resources.length === 0 ? (
                    <p className="text-center text-zinc-500">Nicio resursă importată încă.</p>
                  ) : (
                    <div className="space-y-2">
                      {resources.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                        >
                          <div>
                            <span className="mr-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                              {r.type}
                            </span>
                            <span className="font-medium text-zinc-100">{r.title}</span>
                          </div>
                          {r.url_or_ref && (
                            <span className="truncate font-mono text-[11px] text-sky-400">
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
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 text-xs">
                  {events.length === 0 ? (
                    <p className="text-center text-zinc-500">Niciun eveniment înregistrat încă.</p>
                  ) : (
                    <div className="space-y-2">
                      {events.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                        >
                          <span className="font-medium text-zinc-100">{ev.name}</span>
                          <span className="text-zinc-400">
                            {ev.location || 'Locație N/A'} · {ev.start_date || 'Dată N/A'} (
                            {ev.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {crmTab === 'partners' && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 text-xs">
                  {partners.length === 0 ? (
                    <p className="text-center text-zinc-500">Niciun partener înregistrat încă.</p>
                  ) : (
                    <div className="space-y-2">
                      {partners.map((pt) => (
                        <div
                          key={pt.id}
                          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                        >
                          <span className="font-medium text-zinc-100">{pt.name}</span>
                          <span className="text-zinc-400">
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

          {/* HUB CENTRAL NOTIȚE */}
          {activeTab === 'notes' && (
            <div className="mx-auto max-w-5xl space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: `Toate (${totalAllNotes})` },
                    { id: 'postit', label: `📌 Post-it Dashboard (${postItNotes.length})` },
                    { id: 'project', label: `📁 Notițe Proiecte (${projectNotes.length})` },
                    { id: 'general', label: `📝 Ședințe & Generale (${generalNotes.length})` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setNotesFilter(f.id as NotesFilter)}
                      className={`rounded-lg px-3 py-1.5 font-medium transition ${
                        notesFilter === f.id
                          ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleCreateGeneralNote}
                className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-100">
                    📝 Adaugă Notiță de Ședință / Operațională
                  </h3>
                  <label className="flex cursor-pointer items-center gap-1.5 text-violet-300">
                    <input
                      type="checkbox"
                      checked={noteAiMemory}
                      onChange={(e) => setNoteAiMemory(e.target.checked)}
                      className="accent-violet-500"
                    />
                    <span>📌 Include în Memoria Live a AI-ului</span>
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Titlu notiță..."
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-100 sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={noteCategory}
                    onChange={(e) => setNoteCategory(e.target.value)}
                    placeholder="Categorie (ex: Board, 1-on-1)"
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-100"
                  />
                </div>

                <textarea
                  rows={3}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Scrie idei, decizii din ședințe sau observații..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 text-zinc-100"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500"
                  >
                    Salvează Notița
                  </button>
                </div>
              </form>

              <div className="grid gap-3 sm:grid-cols-2">
                {(notesFilter === 'all' || notesFilter === 'postit') &&
                  postItNotes.map((pi) => (
                    <div
                      key={`pi-${pi.id}`}
                      className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          📌 Post-it Dashboard
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {new Date(pi.created_at).toLocaleDateString('ro-RO')}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-amber-100">{pi.content}</p>
                      <div className="mt-3 flex justify-end border-t border-amber-500/20 pt-2">
                        <button
                          type="button"
                          disabled={extractingNoteId === pi.id}
                          onClick={() =>
                            handleExtractActions(pi.id, 'Post-it Dashboard', pi.content)
                          }
                          className="rounded-lg border border-amber-500/40 bg-zinc-950/60 px-2.5 py-1 text-[11px] font-medium text-amber-300"
                        >
                          {extractingNoteId === pi.id
                            ? 'Analizez...'
                            : '✨ Extrage acțiuni în PMP'}
                        </button>
                      </div>
                    </div>
                  ))}

                {(notesFilter === 'all' || notesFilter === 'project') &&
                  projectNotes.map((pn) => {
                    const parentProj = projectMap.get(pn.project_id);
                    return (
                      <div
                        key={`pn-${pn.id}`}
                        className="rounded-xl border border-sky-500/30 bg-zinc-900/80 p-4 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                            📁 Proiect: {parentProj?.title || 'Proiect'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              toggleNoteMemory('project', pn.id, !pn.is_ai_memory)
                            }
                            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                              pn.is_ai_memory
                                ? 'border border-violet-500/40 bg-violet-500/20 text-violet-300'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {pn.is_ai_memory ? '📌 Memorie AI' : '+ Memorie AI'}
                          </button>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-zinc-200">{pn.content}</p>
                        <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2">
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
                            className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300"
                          >
                            {extractingNoteId === pn.id
                              ? 'Analizez...'
                              : '✨ Extrage acțiuni în PMP'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                {(notesFilter === 'all' || notesFilter === 'general') &&
                  generalNotes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
                          {n.category}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleNoteMemory('general', n.id, !n.is_ai_memory)}
                          className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                            n.is_ai_memory
                              ? 'border border-violet-500/40 bg-violet-500/20 text-violet-300'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {n.is_ai_memory ? '📌 Memorie AI Activă' : 'Adaugă în Memorie AI'}
                        </button>
                      </div>
                      <h4 className="mt-2 font-semibold text-zinc-100">{n.title}</h4>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-300">{n.content}</p>

                      <div className="mt-3 flex items-center justify-end border-t border-zinc-800/80 pt-2">
                        <button
                          type="button"
                          disabled={extractingNoteId === n.id}
                          onClick={() => handleExtractActions(n.id, n.title, n.content)}
                          className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-40"
                        >
                          {extractingNoteId === n.id
                            ? 'Analizez notița...'
                            : '✨ Extrage acțiuni în PMP'}
                        </button>
                      </div>

                      {noteProposals[n.id] && (
                        <div className="mt-2.5 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                          {noteProposals[n.id].length === 0 ? (
                            <p className="text-[11px] text-zinc-500">
                              Nu am detectat task-uri sau update-uri concrete în această notiță.
                            </p>
                          ) : (
                            noteProposals[n.id].map((prop) => (
                              <div
                                key={prop.id}
                                className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-zinc-100">
                                    {prop.kind === 'create_milestone'
                                      ? '🟡 Milestone: '
                                      : prop.kind === 'update_project_progress'
                                        ? `📈 Progres ${prop.new_progress}%: `
                                        : '⚡ Task: '}
                                    {prop.title}
                                  </div>
                                  <div className="text-[10px] text-zinc-400">
                                    {prop.department}
                                    {prop.assignee_name ? ` · 👤 ${prop.assignee_name}` : ''}
                                    {prop.deadline ? ` · 📅 ${prop.deadline}` : ''}
                                  </div>
                                </div>

                                {appliedProposalIds[prop.id] ? (
                                  <span className="font-semibold text-emerald-400">✓ Aplicat</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => applyExtractedProposal(prop)}
                                    className="shrink-0 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500"
                                  >
                                    ✓ Aplică
                                  </button>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
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
      </div>

      {/* JIRA / ASANA TASK & SUBTASK DETAIL MODAL */}
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

      {/* CONTEXTUAL ASK AI SLIDE-OVER DRAWER */}
      {aiDrawerOpen && activeTab !== 'ai' && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl">
          <div className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
            <span className="text-xs font-semibold text-emerald-300">
              🤖 Alumn-Bot Live Copilot
            </span>
            <button
              type="button"
              onClick={() => setAiDrawerOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              ✕ Închide
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