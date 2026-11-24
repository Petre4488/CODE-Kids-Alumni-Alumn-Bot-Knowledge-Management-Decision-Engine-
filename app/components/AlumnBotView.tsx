'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { StatsChart } from './StatsChart';
import { THINKING_MODES, ThinkingMode } from '../lib/model-router';
import { DEPARTMENTS, DepartmentKey, Person, Project } from '../lib/pmp-types';
import type { AiActionPlan, AiProposedTask } from '../api/ask/route';

const ExcalidrawDiagram = dynamic(
  () => import('./ExcalidrawDiagram').then((mod) => mod.ExcalidrawDiagram),
  {
    ssr: false,
    loading: () => (
      <div className="my-3 flex h-[320px] animate-pulse items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-xs text-zinc-400">
        Încarc tabla Excalidraw...
      </div>
    ),
  }
);

interface TokenUsage {
  embeddingTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface SourceDoc {
  title: string;
  department: string | null;
  similarity: number;
}

interface UsedNote {
  content: string;
  date: string;
}

interface WebSource {
  title: string;
  url: string;
}

interface ModelInfo {
  mode: ThinkingMode;
  deployment: string;
  escalatedReason: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  noteProposal?: string | null;
  actionPlan?: AiActionPlan | null;
  planApproved?: boolean;
  planResultText?: string;
  questionAsked?: string;
  usedWeb?: boolean;
  sources?: SourceDoc[];
  notesUsed?: UsedNote[];
  webSources?: WebSource[];
  modelInfo?: ModelInfo;
  usage?: TokenUsage;
}

interface ResearchCache {
  docContext: string;
  notesContext: string;
  webContext: string;
  sources: SourceDoc[];
  notesUsed: UsedNote[];
  webSources: WebSource[];
  foundInKb: boolean;
}

interface DecisionStepRecord {
  id: string;
  step: number;
  aiOutput: string;
  finalSummary?: string | null;
  userFeedback?: string;
  usage: TokenUsage;
}

interface DecisionSession {
  topic: string;
  maxIterations: number;
  webSearch: boolean;
  researchCache: ResearchCache | null;
  needsWebPermission?: boolean;
  permissionMessage?: string;
  steps: DecisionStepRecord[];
}

interface SavedSessionItem {
  id: string;
  title: string;
  department: string | null;
  session_type: 'chat' | 'decision';
  total_tokens: number;
  total_cost_usd: number;
  updated_at: string;
}

const STARTER_QUESTIONS = [
  'Fă-mi un status update live pe toate departamentele și proiectele active.',
  'Cine din baza de date CRM are skill-uri tehnice sau de organizare și e disponibil?',
  'Care sunt pașii și condițiile pentru alegerea sau demiterea board-ului?',
  'Adaugă task-ul de a crea agenda pentru ședința de Board și propune pașii necesari.',
];

function extractTag(rawContent: string, tagName: string): {
  cleanContent: string;
  extracted: string | null;
} {
  const regex = new RegExp(`\\[${tagName}:\\s*([\\s\\S]*?)\\]`);
  const match = rawContent.match(regex);
  if (!match) {
    return { cleanContent: rawContent, extracted: null };
  }
  const cleanContent = rawContent.replace(regex, '').trim();
  return { cleanContent, extracted: match[1].trim() };
}

function renderMessageContent(content: string) {
  // Ignoră mențiunile goale de tip ```chart``` sau ```mermaid``` din propoziții
  const sanitized = content.replace(/```(mermaid|chart)\s*```/gi, '`$1`');

  const regex = /```(mermaid|chart)\r?\n([\s\S]*?)```/gi;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sanitized)) !== null) {
    const textBefore = sanitized.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      elements.push(
        <div key={`txt-${lastIndex}`} className="whitespace-pre-wrap">
          {textBefore}
        </div>
      );
    }

    const blockType = match[1].toLowerCase();
    const blockBody = match[2].trim();

    if (blockType === 'mermaid' && blockBody) {
      elements.push(<ExcalidrawDiagram key={`exc-${match.index}`} chart={blockBody} />);
    } else if (blockType === 'chart' && blockBody) {
      elements.push(<StatsChart key={`cht-${match.index}`} rawJson={blockBody} />);
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = sanitized.slice(lastIndex);
  if (remaining.trim()) {
    elements.push(
      <div key={`txt-${lastIndex}`} className="whitespace-pre-wrap">
        {remaining}
      </div>
    );
  }

  return elements;
}

interface AlumnBotViewProps {
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  compactDrawer?: boolean;
  people?: Person[];
  projects?: Project[];
  onDataMutated?: () => Promise<void>;
  onNavigateTab?: (
    tab: 'dashboard' | 'tasks' | 'workspace' | 'crm' | 'notes' | 'ai'
  ) => void;
}

export function AlumnBotView({
  initialPrompt,
  onInitialPromptConsumed,
  compactDrawer = false,
  people = [],
  projects = [],
  onDataMutated,
  onNavigateTab,
}: AlumnBotViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [department, setDepartment] = useState<string>('');
  const [webMode, setWebMode] = useState(false);
  const [decisionMode, setDecisionMode] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('rapid');
  const [autoEscalate, setAutoEscalate] = useState<boolean>(true);
  const [maxIterations, setMaxIterations] = useState<number>(3);
  const [loading, setLoading] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(!compactDrawer);
  const [sessionsList, setSessionsList] = useState<SavedSessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const [decisionSession, setDecisionSession] = useState<DecisionSession | null>(null);
  const [stepFeedbackInput, setStepFeedbackInput] = useState('');

  const [savedNotes, setSavedNotes] = useState<Record<string, boolean>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [approvingMsgId, setApprovingMsgId] = useState<string | null>(null);

  const [sessionStats, setSessionStats] = useState({ totalTokens: 0, totalCostUsd: 0 });
  const [allTimeStats, setAllTimeStats] = useState({
    totalTokens: 0,
    totalCostUsd: 0,
    totalPrompts: 0,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);
  const lastConsumedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/ask')
      .then((res) => res.json())
      .then((data) => {
        if (data.allTime) setAllTimeStats(data.allTime);
      })
      .catch(() => {});

    fetch('/api/sessions')
      .then((res) => res.json())
      .then((data) => {
        if (data.sessions) setSessionsList(data.sessions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialPrompt) {
      lastConsumedPromptRef.current = null;
      return;
    }
    if (lastConsumedPromptRef.current === initialPrompt || isSubmittingRef.current) {
      return;
    }

    lastConsumedPromptRef.current = initialPrompt;
    sendQuestion(initialPrompt);
    onInitialPromptConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, decisionSession, loading]);

  function startNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setDecisionSession(null);
    setDecisionMode(false);
    setThinkingMode('rapid');
    setSessionStats({ totalTokens: 0, totalCostUsd: 0 });
  }

  async function openSavedSession(sessionId: string) {
    if (loading || loadingSessionId) return;
    setLoadingSessionId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (!res.ok || !data.session) return;

      const s = data.session;
      setActiveSessionId(s.id);
      setDepartment(s.department || '');
      setSessionStats({
        totalTokens: s.total_tokens || 0,
        totalCostUsd: Number(s.total_cost_usd || 0),
      });

      if (s.session_type === 'decision' && s.decision_state) {
        setDecisionSession(s.decision_state);
        setMessages([]);
        setDecisionMode(true);
        setThinkingMode('deep');
      } else {
        const restoredMsgs: Message[] = (data.messages || []).map(
          (m: {
            id: string;
            role: 'user' | 'assistant';
            content: string;
            metadata?: Record<string, unknown>;
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            ...(m.metadata || {}),
          })
        );
        setMessages(restoredMsgs);
        setDecisionSession(null);
        setDecisionMode(false);
        setThinkingMode('rapid');
      }
    } finally {
      isSubmittingRef.current = false;
      setLoadingSessionId(null);
      setLoading(false);
    }
  }

  async function deleteSavedSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (res.ok) {
      setSessionsList((prev) => prev.filter((item) => item.id !== sessionId));
      if (activeSessionId === sessionId) startNewChat();
    }
  }

  function startRenamingSession(e: React.MouseEvent, session: SavedSessionItem) {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  }

  async function saveRenamedSession(sessionId: string) {
    const trimmed = editingTitle.trim();
    setEditingSessionId(null);
    if (!trimmed) return;
    const current = sessionsList.find((item) => item.id === sessionId);
    if (!current || current.title === trimmed) return;

    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });

    if (res.ok) {
      setSessionsList((prev) =>
        prev.map((item) => (item.id === sessionId ? { ...item, title: trimmed } : item))
      );
    }
  }

  function upsertSidebarSession(updated: SavedSessionItem) {
    setSessionsList((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)]);
  }

  function toggleDecisionMode() {
    setDecisionMode((prev) => {
      const next = !prev;
      setThinkingMode(next ? 'deep' : 'rapid');
      return next;
    });
  }

  async function saveNote(targetId: string, noteContent: string) {
    if (savingNoteId || savedNotes[targetId]) return;
    setSavingNoteId(targetId);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteContent }),
      });
      if (res.ok) {
        setSavedNotes((prev) => ({ ...prev, [targetId]: true }));
      }
    } finally {
      setSavingNoteId(null);
    }
  }

  function updateMessagePlan(
    msgId: string,
    updater: (plan: AiActionPlan) => AiActionPlan
  ) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.actionPlan ? { ...m, actionPlan: updater(m.actionPlan) } : m
      )
    );
  }

  function updatePlanTask(
    msgId: string,
    taskId: string,
    patch: Partial<AiProposedTask>
  ) {
    updateMessagePlan(msgId, (plan) => ({
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    }));
  }

  async function handleApprovePlan(msg: Message) {
    if (!msg.actionPlan || approvingMsgId) return;
    const selectedTasks = msg.actionPlan.tasks.filter((t) => t.selected);
    if (selectedTasks.length === 0 && msg.actionPlan.project.mode !== 'new') return;

    setApprovingMsgId(msg.id);
    try {
      const res = await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute_ai_plan',
          project: msg.actionPlan.project,
          tasks: selectedTasks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Eroare la salvarea planului.');
        return;
      }

      await onDataMutated?.();

      const parts: string[] = [];
      if (data.createdProjectTitle) parts.push(`proiectul „${data.createdProjectTitle}”`);
      if (data.createdTasksCount > 0) parts.push(`${data.createdTasksCount} task-uri`);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                planApproved: true,
                planResultText: `✓ Creat: ${parts.join(' + ')}`,
              }
            : m
        )
      );
    } finally {
      setApprovingMsgId(null);
    }
  }

  async function runDecisionStep(params: {
    topic: string;
    step: number;
    maxIter: number;
    useWeb: boolean;
    allowNoKbFallback?: boolean;
    existingSession?: DecisionSession | null;
    feedbackForPreviousStep?: string;
  }) {
    const {
      topic,
      step,
      maxIter,
      useWeb,
      allowNoKbFallback = false,
      existingSession = null,
      feedbackForPreviousStep,
    } = params;

    setLoading(true);

    const updatedSteps: DecisionStepRecord[] = existingSession
      ? existingSession.steps.map((s, idx) =>
          idx === existingSession.steps.length - 1 && feedbackForPreviousStep
            ? { ...s, userFeedback: feedbackForPreviousStep }
            : s
        )
      : [];

    try {
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          step,
          maxIterations: maxIter,
          department: department || null,
          webSearch: useWeb,
          thinkingMode,
          allowNoKbFallback,
          researchCache: existingSession?.researchCache || null,
          history: updatedSteps.map((s) => ({
            step: s.step,
            aiOutput: s.aiOutput,
            userFeedback: s.userFeedback,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare în motorul de decizie.');

      const addedTokens = data.usage?.totalTokens ?? 0;
      const addedCostUsd = data.usage?.estimatedCostUsd ?? 0;

      if (data.usage) {
        setSessionStats((prev) => ({
          totalTokens: prev.totalTokens + addedTokens,
          totalCostUsd: prev.totalCostUsd + addedCostUsd,
        }));
      }
      if (data.allTime) setAllTimeStats(data.allTime);

      if (data.needsWebPermission) {
        setDecisionSession({
          topic,
          maxIterations: maxIter,
          webSearch: false,
          researchCache: null,
          needsWebPermission: true,
          permissionMessage: data.message,
          steps: [],
        });
        return;
      }

      const { cleanContent, extracted } = extractTag(data.output, 'FINAL_DECISION_SUMMARY');

      const newStepRecord: DecisionStepRecord = {
        id: crypto.randomUUID(),
        step,
        aiOutput: cleanContent,
        finalSummary: extracted,
        usage: data.usage,
      };

      const nextDecisionState: DecisionSession = {
        topic,
        maxIterations: maxIter,
        webSearch: useWeb,
        researchCache: data.researchCache,
        needsWebPermission: false,
        steps: [...updatedSteps, newStepRecord],
      };

      setDecisionSession(nextDecisionState);
      setStepFeedbackInput('');

      if (!activeSessionId) {
        const saveRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: topic.slice(0, 60),
            department: department || null,
            sessionType: 'decision',
            decisionState: nextDecisionState,
            addedTokens,
            addedCostUsd,
          }),
        });
        const saveData = await saveRes.json();
        if (saveData.session) {
          setActiveSessionId(saveData.session.id);
          upsertSidebarSession(saveData.session);
        }
      } else {
        const patchRes = await fetch(`/api/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decisionState: nextDecisionState,
            addedTokens,
            addedCostUsd,
          }),
        });
        const patchData = await patchRes.json();
        if (patchData.session) upsertSidebarSession(patchData.session);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'A apărut o eroare.';
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `⚠️ Eroare Decizie: ${errMsg}` },
      ]);
      setDecisionSession(null);
    } finally {
      setLoading(false);
    }
  }

  async function sendQuestion(
    textToSend?: string,
    forceWeb = false,
    forceChatMode = false
  ) {
    const rawText = (textToSend ?? input).trim();
    if (!rawText || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      const triggerWeb = forceWeb || webMode || /^\/web\b/i.test(rawText);
      const cleanPrompt = rawText.replace(/^\/web\b\s*/i, '').trim() || rawText;

      if (decisionMode && !forceChatMode) {
        if (!textToSend) setInput('');
        setActiveSessionId(null);
        setDecisionSession(null);
        await runDecisionStep({
          topic: cleanPrompt,
          step: 0,
          maxIter: maxIterations,
          useWeb: triggerWeb,
        });
        return;
      }

      const displayQuestion =
        triggerWeb && !/^\/web\b/i.test(rawText) ? `/web ${rawText}` : rawText;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: displayQuestion,
        usedWeb: triggerWeb,
      };

      setMessages((prev) => [...prev, userMsg]);
      if (!textToSend) setInput('');
      setWebMode(false);
      setLoading(true);

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: displayQuestion,
          department: department || null,
          webSearch: triggerWeb,
          thinkingMode,
          autoEscalate,
          history,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la procesarea cererii.');

      const { cleanContent, extracted } = extractTag(data.answer, 'NOTE_PROPOSAL');

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: cleanContent,
        noteProposal: extracted,
        actionPlan: data.actionPlan || null,
        questionAsked: cleanPrompt,
        usedWeb: triggerWeb,
        sources: data.sources,
        notesUsed: data.notesUsed,
        webSources: data.webSources,
        modelInfo: data.modelInfo,
        usage: data.usage,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      const addedTokens = data.usage?.totalTokens ?? 0;
      const addedCostUsd = data.usage?.estimatedCostUsd ?? 0;

      if (data.usage) {
        setSessionStats((prev) => ({
          totalTokens: prev.totalTokens + addedTokens,
          totalCostUsd: prev.totalCostUsd + addedCostUsd,
        }));
      }
      if (data.allTime) setAllTimeStats(data.allTime);

      if (!activeSessionId) {
        const saveRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: cleanPrompt.slice(0, 60),
            department: department || null,
            sessionType: 'chat',
            messages: [userMsg, assistantMsg],
            addedTokens,
            addedCostUsd,
          }),
        });
        const saveData = await saveRes.json();
        if (saveData.session) {
          setActiveSessionId(saveData.session.id);
          upsertSidebarSession(saveData.session);
        }
      } else {
        const patchRes = await fetch(`/api/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [userMsg, assistantMsg],
            addedTokens,
            addedCostUsd,
          }),
        });
        const patchData = await patchRes.json();
        if (patchData.session) upsertSidebarSession(patchData.session);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'A apărut o eroare.';
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: `⚠️ Eroare: ${errMsg}` },
      ]);
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }

  function convertDecisionToTasks(topic: string, summary: string) {
    setDecisionSession(null);
    setDecisionMode(false);
    setActiveSessionId(null);
    setMessages([]);
    setThinkingMode('analytic');
    sendQuestion(
      `Transformă această decizie aprobată în proiectul potrivit și task-urile concrete cu responsabili și termene (generează planul spre aprobare): ${topic}\n\nRezumat decizie:\n${summary}`,
      false,
      true
    );
  }

  const activeModeMeta = THINKING_MODES[thinkingMode];

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Sidebar Istoric Chat-uri */}
      {sidebarOpen && !compactDrawer && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/70">
          <div className="border-b border-zinc-800 p-2.5">
            <button
              type="button"
              onClick={startNewChat}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
            >
              + Chat nou
            </button>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Conversații ({sessionsList.length})
            </p>

            {sessionsList.map((s) => {
              const isActive = activeSessionId === s.id;
              const isEditing = editingSessionId === s.id;

              return (
                <div
                  key={s.id}
                  onClick={() => !isEditing && openSavedSession(s.id)}
                  className={`group flex cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition ${
                    isActive
                      ? 'border border-zinc-700 bg-zinc-800 text-zinc-100'
                      : 'border border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRenamedSession(s.id);
                            if (e.key === 'Escape') setEditingSessionId(null);
                          }}
                          className="w-full rounded border border-emerald-500/60 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => saveRenamedSession(s.id)}
                          className="rounded px-1 text-emerald-400 hover:bg-zinc-700"
                        >
                          ✓
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span>{s.session_type === 'decision' ? '🧠' : '💬'}</span>
                          <span className="truncate font-medium">{s.title}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                          <span>
                            {new Date(s.updated_at).toLocaleDateString('ro-RO', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                          <span>· {s.total_tokens.toLocaleString()} tok</span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => startRenamingSession(e, s)}
                        title="Redenumește"
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-emerald-300"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={(e) => deleteSavedSession(e, s.id)}
                        title="Șterge"
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Zona Chat & Decision Engine */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sub-header Alumn-Bot */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            {!compactDrawer && (
              <button
                type="button"
                onClick={() => setSidebarOpen((p) => !p)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
              >
                ☰ Istoric
              </button>
            )}
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Toate departamentele</option>
              <option value="Tehnic">Tehnic</option>
              <option value="Comunicare">Comunicare</option>
              <option value="Comunitati">Comunități</option>
              <option value="Coordonare Judeteana">Coordonare Județeană</option>
              <option value="Board">Board / Management</option>
            </select>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-emerald-400">
              Sesiune: {sessionStats.totalTokens.toLocaleString()} tok ($
              {sessionStats.totalCostUsd.toFixed(4)})
            </span>
            <span className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-amber-400">
              Total: {allTimeStats.totalTokens.toLocaleString()} tok ($
              {allTimeStats.totalCostUsd.toFixed(4)})
            </span>
          </div>
        </div>

        {/* Mesaje */}
        <main className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-3xl space-y-5">
            {loadingSessionId ? (
              <div className="mt-16 animate-pulse text-center text-xs text-zinc-400">
                Încarc conversația...
              </div>
            ) : messages.length === 0 && !decisionSession ? (
              <div className="mt-6 space-y-5 text-center">
                <div className="space-y-1.5">
                  <h2 className="text-base font-semibold text-zinc-100">
                    Alumn-Bot · Conectat la Documente + CRM Live
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Poți cere status update-uri live, genera diagrame Excalidraw / grafice, rula
                    sesiuni iterative de decizie offline pe fișierele tale sau aproba direct
                    proiecte și task-uri.
                  </p>
                </div>

                <div className="grid gap-2 text-left sm:grid-cols-2">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendQuestion(q)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:bg-zinc-900"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const suggestsWeb =
                  msg.role === 'assistant' &&
                  !msg.usedWeb &&
                  msg.content.toLowerCase().includes('/web') &&
                  msg.questionAsked;

                return (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-emerald-600 text-white'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-100'
                      }`}
                    >
                      <div>{renderMessageContent(msg.content)}</div>

                      {/* CARD APROBARE PROIECT & TASK-URI (PMP ACTION PLAN) */}
                      {msg.actionPlan && (
                        <div className="mt-3 overflow-hidden rounded-xl border border-emerald-500/30 bg-zinc-950 text-xs">
                          <div className="flex items-center justify-between border-b border-zinc-800 bg-emerald-500/10 px-3.5 py-2">
                            <span className="font-semibold text-emerald-300">
                              ✦ {msg.actionPlan.summary}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">
                              {msg.actionPlan.tasks.filter((t) => t.selected).length}/
                              {msg.actionPlan.tasks.length} selectate
                            </span>
                          </div>

                          {!msg.planApproved && (
                            <div className="space-y-2 border-b border-zinc-800 px-3.5 py-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-zinc-400">Proiect:</span>
                                <div className="flex rounded-lg bg-zinc-900 p-0.5 text-[11px]">
                                  {[
                                    { id: 'new', label: '+ Nou' },
                                    { id: 'existing', label: 'Existent' },
                                    { id: 'none', label: '⚡ Ad-hoc' },
                                  ].map((opt) => (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() =>
                                        updateMessagePlan(msg.id, (pl) => ({
                                          ...pl,
                                          project: {
                                            ...pl.project,
                                            mode: opt.id as 'new' | 'existing' | 'none',
                                          },
                                        }))
                                      }
                                      className={`rounded px-2 py-0.5 font-medium ${
                                        msg.actionPlan!.project.mode === opt.id
                                          ? 'bg-zinc-700 text-white'
                                          : 'text-zinc-500'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {msg.actionPlan.project.mode === 'new' && (
                                <div className="grid gap-1.5 sm:grid-cols-[1fr_130px_auto]">
                                  <input
                                    type="text"
                                    value={msg.actionPlan.project.title}
                                    onChange={(e) =>
                                      updateMessagePlan(msg.id, (pl) => ({
                                        ...pl,
                                        project: { ...pl.project, title: e.target.value },
                                      }))
                                    }
                                    placeholder="Titlu proiect nou..."
                                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-100"
                                  />
                                  <select
                                    value={msg.actionPlan.project.department}
                                    onChange={(e) =>
                                      updateMessagePlan(msg.id, (pl) => ({
                                        ...pl,
                                        project: {
                                          ...pl.project,
                                          department: e.target.value as DepartmentKey,
                                        },
                                      }))
                                    }
                                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
                                  >
                                    {(Object.keys(DEPARTMENTS) as DepartmentKey[]).map((k) => (
                                      <option key={k} value={k}>
                                        {DEPARTMENTS[k].label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateMessagePlan(msg.id, (pl) => ({
                                        ...pl,
                                        project: {
                                          ...pl.project,
                                          is_core_team: !pl.project.is_core_team,
                                        },
                                      }))
                                    }
                                    className={`rounded-lg border px-2 py-1 text-[11px] ${
                                      msg.actionPlan.project.is_core_team
                                        ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                                        : 'border-zinc-700 text-zinc-400'
                                    }`}
                                  >
                                    ✦ Core
                                  </button>
                                </div>
                              )}

                              {msg.actionPlan.project.mode === 'existing' && (
                                <select
                                  value={msg.actionPlan.project.existing_project_id || ''}
                                  onChange={(e) =>
                                    updateMessagePlan(msg.id, (pl) => ({
                                      ...pl,
                                      project: {
                                        ...pl.project,
                                        existing_project_id: e.target.value || null,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-200"
                                >
                                  <option value="">Alege proiectul existent...</option>
                                  {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.title} ({DEPARTMENTS[p.department]?.label})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}

                          <div className="divide-y divide-zinc-800/80 px-3.5">
                            {msg.actionPlan.tasks.map((t) => (
                              <div
                                key={t.id}
                                className={`py-2 ${t.selected ? '' : 'opacity-45'}`}
                              >
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    disabled={Boolean(msg.planApproved)}
                                    checked={t.selected}
                                    onChange={(e) =>
                                      updatePlanTask(msg.id, t.id, {
                                        selected: e.target.checked,
                                      })
                                    }
                                    className="mt-1 h-3.5 w-3.5 accent-emerald-500"
                                  />
                                  <div className="min-w-0 flex-1 space-y-1">
                                    {msg.planApproved ? (
                                      <div className="font-medium text-zinc-200">{t.title}</div>
                                    ) : (
                                      <input
                                        type="text"
                                        value={t.title}
                                        onChange={(e) =>
                                          updatePlanTask(msg.id, t.id, {
                                            title: e.target.value,
                                          })
                                        }
                                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-zinc-100 focus:border-zinc-700 focus:bg-zinc-900 focus:outline-none"
                                      />
                                    )}
                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                                      {!msg.planApproved && people.length > 0 ? (
                                        <select
                                          value={t.assignee_id || ''}
                                          onChange={(e) => {
                                            const nextId = e.target.value || null;
                                            const found = people.find((p) => p.id === nextId);
                                            updatePlanTask(msg.id, t.id, {
                                              assignee_id: nextId,
                                              assignee_name: found?.full_name || null,
                                            });
                                          }}
                                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-200"
                                        >
                                          <option value="">Nealocat</option>
                                          {people.map((p) => (
                                            <option key={p.id} value={p.id}>
                                              {p.full_name} ({p.role})
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <span>👤 {t.assignee_name || 'Nealocat'}</span>
                                      )}
                                      <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                                        {DEPARTMENTS[t.department]?.label || t.department}
                                      </span>
                                      {t.deadline && (
                                        <span className="font-mono">📅 {t.deadline}</span>
                                      )}
                                      {!msg.planApproved && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updatePlanTask(msg.id, t.id, {
                                              needs_pm_sync: !t.needs_pm_sync,
                                            })
                                          }
                                          className={`rounded px-1.5 py-0.5 ${
                                            t.needs_pm_sync
                                              ? 'bg-violet-500/25 text-violet-200'
                                              : 'bg-zinc-800 text-zinc-500'
                                          }`}
                                        >
                                          💬 Vlad PM
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-900/70 px-3.5 py-2">
                            {msg.planApproved ? (
                              <>
                                <span className="font-medium text-emerald-400">
                                  {msg.planResultText || '✓ Adăugat!'}
                                </span>
                                {onNavigateTab && (
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => onNavigateTab('tasks')}
                                      className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                                    >
                                      Vezi în Task-uri →
                                    </button>
                                    {msg.actionPlan.project.mode !== 'none' && (
                                      <button
                                        type="button"
                                        onClick={() => onNavigateTab('workspace')}
                                        className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                                      >
                                        Proiecte →
                                      </button>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-[11px] text-zinc-500">
                                  Nu se salvează nimic până nu aprobi
                                </span>
                                <button
                                  type="button"
                                  disabled={approvingMsgId === msg.id}
                                  onClick={() => handleApprovePlan(msg)}
                                  className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                >
                                  {approvingMsgId === msg.id
                                    ? 'Salvez...'
                                    : `✓ Aprobă și adaugă (${
                                        msg.actionPlan.tasks.filter((t) => t.selected).length
                                      })`}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {msg.noteProposal && (
                        <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs">
                          <p className="text-zinc-200">
                            📌 Informația{' '}
                            <span className="font-semibold text-violet-300">
                              „{msg.noteProposal}”
                            </span>{' '}
                            este decisă? O adaug în Notes?
                          </p>
                          <div className="mt-2">
                            {savedNotes[msg.id] ? (
                              <span className="font-medium text-emerald-400">
                                ✓ Salvat în Notes
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => saveNote(msg.id, msg.noteProposal!)}
                                disabled={savingNoteId === msg.id}
                                className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-500"
                              >
                                {savingNoteId === msg.id ? 'Salvez...' : 'Da, adaugă în Notes'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {suggestsWeb && (
                        <div className="mt-3">
                          <button
                            onClick={() => sendQuestion(msg.questionAsked, true)}
                            disabled={loading}
                            className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                          >
                            🌐 Execută căutarea pe internet (/web)
                          </button>
                        </div>
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 border-t border-zinc-800 pt-2">
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                            Documente interne consultate
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.sources.map((s) => (
                              <span
                                key={s.title}
                                className="inline-flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300"
                              >
                                <span className="max-w-[220px] truncate">{s.title}</span>
                                <span className="font-mono text-emerald-400">
                                  {(s.similarity * 100).toFixed(0)}%
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.webSources && msg.webSources.length > 0 && (
                        <div className="mt-2.5 border-t border-zinc-800 pt-2">
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-sky-400">
                            Surse externe
                          </p>
                          <div className="flex flex-col gap-1">
                            {msg.webSources.map((w) => (
                              <a
                                key={w.url}
                                href={w.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-xs text-sky-300 underline"
                              >
                                🔗 {w.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.usage && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-1.5 font-mono text-[11px] text-zinc-400">
                          {msg.modelInfo && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">
                              {THINKING_MODES[msg.modelInfo.mode].icon}{' '}
                              {THINKING_MODES[msg.modelInfo.mode].label}
                            </span>
                          )}
                          <span className="text-emerald-400">
                            {msg.usage.totalTokens.toLocaleString()} tok
                          </span>
                          <span className="text-amber-400/90">
                            · ${msg.usage.estimatedCostUsd.toFixed(5)}
                          </span>
                          {msg.modelInfo?.escalatedReason && (
                            <span className="text-sky-400">· ↑ {msg.modelInfo.escalatedReason}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Sesiune Decizie */}
            {decisionSession && (
              <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-zinc-900/90 p-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div>
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                      🧠 SESIUNE DECIZIE ({decisionSession.maxIterations} iterații)
                    </span>
                    <h3 className="mt-1 text-sm font-semibold text-zinc-100">
                      {decisionSession.topic}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    Închide
                  </button>
                </div>

                {decisionSession.needsWebPermission && (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
                    <p className="text-zinc-200">{decisionSession.permissionMessage}</p>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          runDecisionStep({
                            topic: decisionSession.topic,
                            step: 0,
                            maxIter: decisionSession.maxIterations,
                            useWeb: true,
                          })
                        }
                        className="rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white"
                      >
                        🌐 Da, caută online
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runDecisionStep({
                            topic: decisionSession.topic,
                            step: 0,
                            maxIter: decisionSession.maxIterations,
                            useWeb: false,
                            allowNoKbFallback: true,
                          })
                        }
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-zinc-300"
                      >
                        Continuă fără web
                      </button>
                    </div>
                  </div>
                )}

                {decisionSession.steps.map((s, idx) => {
                  const isLastStep = idx === decisionSession.steps.length - 1;
                  const isFinalIteration = s.step === decisionSession.maxIterations;

                  return (
                    <div
                      key={s.id}
                      className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5"
                    >
                      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-1.5 font-mono text-[11px]">
                        <span className="font-semibold text-amber-400">
                          {s.step === 0
                            ? 'PAS 0 · ÎNTREBĂRI DE ALINIERE'
                            : isFinalIteration
                              ? `ITERAȚIA ${s.step}/${decisionSession.maxIterations} · PROPUNERE FINALĂ`
                              : `ITERAȚIA ${s.step}/${decisionSession.maxIterations} · SWOT & ATAC`}
                        </span>
                        <span className="text-zinc-500">
                          {s.usage.totalTokens.toLocaleString()} tok
                        </span>
                      </div>

                      <div className="text-sm leading-relaxed text-zinc-100">
                        {renderMessageContent(s.aiOutput)}
                      </div>

                      {s.userFeedback && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                          <strong>Input-ul tău:</strong> {s.userFeedback}
                        </div>
                      )}

                      {isLastStep && !isFinalIteration && !loading && (
                        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs">
                          <textarea
                            rows={2}
                            value={stepFeedbackInput}
                            onChange={(e) => setStepFeedbackInput(e.target.value)}
                            placeholder="Răspunsul sau direcția ta pentru iterația următoare..."
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-100 focus:border-violet-400 focus:outline-none"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={!stepFeedbackInput.trim()}
                              onClick={() =>
                                runDecisionStep({
                                  topic: decisionSession.topic,
                                  step: s.step + 1,
                                  maxIter: decisionSession.maxIterations,
                                  useWeb: decisionSession.webSearch,
                                  existingSession: decisionSession,
                                  feedbackForPreviousStep: stepFeedbackInput.trim(),
                                })
                              }
                              className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                            >
                              Trimite → Iterația {s.step + 1}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                runDecisionStep({
                                  topic: decisionSession.topic,
                                  step: s.step + 1,
                                  maxIter: decisionSession.maxIterations,
                                  useWeb: decisionSession.webSearch,
                                  existingSession: decisionSession,
                                })
                              }
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300"
                            >
                              Continuă fără input
                            </button>
                          </div>
                        </div>
                      )}

                      {isLastStep && isFinalIteration && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs">
                          <span className="text-emerald-200">
                            Următorul pas după decizie:
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                convertDecisionToTasks(
                                  decisionSession.topic,
                                  s.finalSummary || s.aiOutput.slice(0, 1200)
                                )
                              }
                              className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1 font-medium text-sky-200 hover:bg-sky-500/30"
                            >
                              ✦ Generează Proiect & Task-uri
                            </button>

                            {savedNotes[s.id] ? (
                              <span className="font-semibold text-emerald-400">✓ Salvat</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  saveNote(
                                    s.id,
                                    s.finalSummary || `Decizie (${decisionSession.topic})`
                                  )
                                }
                                className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white"
                              >
                                📌 Salvează în Notes
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {loading && (
              <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs text-zinc-400">
                {activeModeMeta.icon} Rulez pe {activeModeMeta.label} (Documente + CRM Live)...
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* Footer Controls */}
        <footer className="border-t border-zinc-800 bg-zinc-900/90 px-4 py-2.5">
          <div className="mx-auto max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/90 px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-1">
                {(Object.keys(THINKING_MODES) as ThinkingMode[]).map((modeKey) => {
                  const m = THINKING_MODES[modeKey];
                  const isSelected = thinkingMode === modeKey;
                  return (
                    <button
                      key={modeKey}
                      type="button"
                      onClick={() => setThinkingMode(modeKey)}
                      className={`rounded-md border px-2 py-0.5 font-medium transition ${
                        isSelected
                          ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                          : 'border-transparent text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  );
                })}
              </div>

              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={autoEscalate}
                  onChange={(e) => setAutoEscalate(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span>Auto-escaladare (⚡→🎯)</span>
              </label>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendQuestion();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => setWebMode((prev) => !prev)}
                className={`rounded-lg border px-2.5 py-2 font-mono text-xs ${
                  webMode
                    ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400'
                }`}
              >
                🌐 /web
              </button>

              <button
                type="button"
                onClick={toggleDecisionMode}
                className={`rounded-lg border px-2.5 py-2 font-mono text-xs ${
                  decisionMode
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400'
                }`}
              >
                🧠 Decizie
              </button>

              {decisionMode && (
                <select
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                  className="rounded-lg border border-amber-500/40 bg-zinc-950 px-2 py-2 font-mono text-xs text-amber-300"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} iterații
                    </option>
                  ))}
                </select>
              )}

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Întreabă despre proceduri, cere o diagramă sau adaugă task-uri..."
                disabled={loading}
                className="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
              />

              <button
                type="submit"
                disabled={loading || !input.trim()}
                className={`rounded-lg px-4 py-2 text-xs font-medium text-white disabled:opacity-40 ${
                  decisionMode ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {decisionMode ? 'Pornește' : 'Trimite'}
              </button>
            </form>
          </div>
        </footer>
      </div>
    </div>
  );
}