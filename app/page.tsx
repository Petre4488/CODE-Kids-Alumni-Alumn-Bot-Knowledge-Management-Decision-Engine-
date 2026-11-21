'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { StatsChart } from './components/StatsChart';
import { THINKING_MODES, ThinkingMode } from './lib/model-router';

const ExcalidrawDiagram = dynamic(
  () => import('./components/ExcalidrawDiagram').then((mod) => mod.ExcalidrawDiagram),
  {
    ssr: false,
    loading: () => (
      <div className="my-3 flex h-[320px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-xs text-zinc-400 animate-pulse">
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
  'Cum funcționează sistemul de puncte și nivelul 3 în Alumni?',
  'Care sunt pașii și condițiile pentru alegerea sau demiterea board-ului?',
  'Ce reguli prevede Codul de conduită și procedura de strike-uri?',
  'Ce noutăți aduce Ghidul Operațional 2027 față de 2026?',
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
  const regex = /```(mermaid|chart)\s*([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      elements.push(
        <div key={`txt-${lastIndex}`} className="whitespace-pre-wrap">
          {textBefore}
        </div>
      );
    }

    const blockType = match[1];
    const blockBody = match[2];

    if (blockType === 'mermaid') {
      elements.push(<ExcalidrawDiagram key={`exc-${match.index}`} chart={blockBody} />);
    } else if (blockType === 'chart') {
      elements.push(<StatsChart key={`cht-${match.index}`} rawJson={blockBody} />);
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = content.slice(lastIndex);
  if (remaining.trim()) {
    elements.push(
      <div key={`txt-${lastIndex}`} className="whitespace-pre-wrap">
        {remaining}
      </div>
    );
  }

  return elements;
}

export default function AlumniKnowledgeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [department, setDepartment] = useState<string>('');
  const [webMode, setWebMode] = useState(false);
  const [decisionMode, setDecisionMode] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('rapid');
  const [autoEscalate, setAutoEscalate] = useState<boolean>(true);
  const [maxIterations, setMaxIterations] = useState<number>(3);
  const [loading, setLoading] = useState(false);

  // Sidebar & Persistență sesiuni
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionsList, setSessionsList] = useState<SavedSessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const [decisionSession, setDecisionSession] = useState<DecisionSession | null>(null);
  const [stepFeedbackInput, setStepFeedbackInput] = useState('');

  const [savedNotes, setSavedNotes] = useState<Record<string, boolean>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const [sessionStats, setSessionStats] = useState({
    totalTokens: 0,
    totalCostUsd: 0,
  });

  const [allTimeStats, setAllTimeStats] = useState({
    totalTokens: 0,
    totalCostUsd: 0,
    totalPrompts: 0,
  });

  const bottomRef = useRef<HTMLDivElement>(null);

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
      setLoadingSessionId(null);
    }
  }

  async function deleteSavedSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (res.ok) {
      setSessionsList((prev) => prev.filter((item) => item.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewChat();
      }
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
      if (!res.ok) {
        throw new Error(data.error || 'Eroare în motorul de decizie.');
      }

      const addedTokens = data.usage?.totalTokens ?? 0;
      const addedCostUsd = data.usage?.estimatedCostUsd ?? 0;

      if (data.usage) {
        setSessionStats((prev) => ({
          totalTokens: prev.totalTokens + addedTokens,
          totalCostUsd: prev.totalCostUsd + addedCostUsd,
        }));
      }
      if (data.allTime) {
        setAllTimeStats(data.allTime);
      }

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

      // Salvăm automat sesiunea de decizie în Supabase
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
        if (patchData.session) {
          upsertSidebarSession(patchData.session);
        }
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

  async function sendQuestion(textToSend?: string, forceWeb = false) {
    const rawText = (textToSend ?? input).trim();
    if (!rawText || loading) return;

    const triggerWeb = forceWeb || webMode || /^\/web\b/i.test(rawText);
    const cleanPrompt = rawText.replace(/^\/web\b\s*/i, '').trim() || rawText;

    if (decisionMode) {
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

    try {
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

      if (!res.ok) {
        throw new Error(data.error || 'Eroare la procesarea cererii.');
      }

      const { cleanContent, extracted } = extractTag(data.answer, 'NOTE_PROPOSAL');

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: cleanContent,
        noteProposal: extracted,
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

      if (data.allTime) {
        setAllTimeStats(data.allTime);
      }

      // Salvăm automat conversația în Supabase
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
        if (patchData.session) {
          upsertSidebarSession(patchData.session);
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'A apărut o eroare.';
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ Eroare: ${errMsg}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const activeModeMeta = THINKING_MODES[thinkingMode];

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* SIDEBAR ISTORIC CHAT-URI & SESIUNI DECIZIE */}
      {sidebarOpen && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/95">
          <div className="flex items-center justify-between border-b border-zinc-800 p-3">
            <button
              type="button"
              onClick={startNewChat}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
            >
              + Chat nou
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Conversații salvate ({sessionsList.length})
            </p>

            {sessionsList.length === 0 ? (
              <p className="px-2 py-4 text-xs text-zinc-500">
                Nicio conversație salvată încă. Scrie un mesaj și apare automat aici.
              </p>
            ) : (
              sessionsList.map((s) => {
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
                            title="Salvează"
                            className="rounded px-1.5 py-0.5 text-emerald-400 hover:bg-zinc-700"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSessionId(null)}
                            title="Anulează"
                            className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700"
                          >
                            ✕
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
                          title="Redenumește conversația"
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-emerald-300"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={(e) => deleteSavedSession(e, s.id)}
                          title="Șterge conversația"
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* COLOANA PRINCIPALĂ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="border-b border-zinc-800 bg-zinc-900/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((prev) => !prev)}
                title={sidebarOpen ? 'Ascunde sidebar-ul' : 'Arată istoricul'}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                ☰
              </button>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 font-bold text-emerald-400">
                PM
              </div>
              <div>
                <h1 className="text-sm font-semibold text-zinc-100">
                  CODE Kids Alumni · Alumn-Bot
                </h1>
                <p className="text-xs text-zinc-400">21 docs indexate · Azure RAG</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Toate departamentele</option>
                <option value="Tehnic">Tehnic</option>
                <option value="Comunicare">Comunicare</option>
                <option value="Comunitati">Comunități</option>
                <option value="Coordonare Judeteana">Coordonare Județeană</option>
              </select>

              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
                <span className="text-zinc-400">Sesiune:</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {sessionStats.totalTokens.toLocaleString()} tok
                </span>
                <span className="font-mono text-zinc-500">
                  (${sessionStats.totalCostUsd.toFixed(4)})
                </span>
              </div>

              <div
                className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs"
                title={`Total din ${allTimeStats.totalPrompts} prompturi salvate`}
              >
                <span className="text-zinc-400">Toate sesiunile:</span>
                <span className="font-mono font-semibold text-amber-400">
                  {allTimeStats.totalTokens.toLocaleString()} tok
                </span>
                <span className="font-mono text-amber-400/70">
                  (${allTimeStats.totalCostUsd.toFixed(4)})
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Zona principală */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {loadingSessionId ? (
              <div className="mt-16 text-center text-xs text-zinc-400 animate-pulse">
                Încarc conversația salvată...
              </div>
            ) : messages.length === 0 && !decisionSession ? (
              <div className="mt-8 space-y-6 text-center">
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-zinc-100">
                    Întreabă sau pornește o sesiune de decizie
                  </h2>
                  <p className="text-sm text-zinc-400">
                    Toate conversațiile se salvează automat în sidebar-ul din stânga.
                  </p>
                </div>

                <div className="grid gap-2.5 text-left sm:grid-cols-2">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendQuestion(q)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 text-xs text-zinc-300 transition hover:border-emerald-500/40 hover:bg-zinc-900"
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
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-emerald-600 text-white'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-100'
                      }`}
                    >
                      <div>{renderMessageContent(msg.content)}</div>

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
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                                ✓ Salvat în Notes
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => saveNote(msg.id, msg.noteProposal!)}
                                disabled={savingNoteId === msg.id}
                                className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
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
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
                          >
                            🌐 Execută căutarea pe internet (/web)
                          </button>
                        </div>
                      )}

                      {msg.notesUsed && msg.notesUsed.length > 0 && (
                        <div className="mt-3 border-t border-zinc-800 pt-2.5">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-violet-400">
                            Notes confirmate folosite
                          </p>
                          <div className="space-y-1">
                            {msg.notesUsed.map((n, idx) => (
                              <div
                                key={idx}
                                className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[11px] text-zinc-300"
                              >
                                📌 [{n.date}] {n.content}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 border-t border-zinc-800 pt-2.5">
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                            Documente interne consultate
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.sources.map((s) => (
                              <span
                                key={s.title}
                                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300"
                              >
                                <span className="max-w-[240px] truncate">{s.title}</span>
                                <span className="font-mono text-emerald-400">
                                  {(s.similarity * 100).toFixed(0)}%
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.webSources && msg.webSources.length > 0 && (
                        <div className="mt-3 border-t border-zinc-800 pt-2.5">
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-sky-400">
                            Surse externe (Internet)
                          </p>
                          <div className="flex flex-col gap-1">
                            {msg.webSources.map((w) => (
                              <a
                                key={w.url}
                                href={w.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-xs text-sky-300 underline decoration-sky-500/40 hover:text-sky-200"
                              >
                                🔗 {w.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.usage && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-2 font-mono text-[11px] text-zinc-400">
                          {msg.modelInfo && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">
                              {THINKING_MODES[msg.modelInfo.mode].icon}{' '}
                              {THINKING_MODES[msg.modelInfo.mode].label}
                            </span>
                          )}
                          <span className="font-semibold text-emerald-400">
                            {msg.usage.totalTokens.toLocaleString()} tok
                          </span>
                          <span>
                            (In: {msg.usage.promptTokens.toLocaleString()} | Out:{' '}
                            {msg.usage.completionTokens.toLocaleString()})
                          </span>
                          <span className="text-amber-400/90">
                            • ${msg.usage.estimatedCostUsd.toFixed(5)}
                          </span>
                          {msg.modelInfo?.escalatedReason && (
                            <span className="text-sky-400">
                              · ↑ {msg.modelInfo.escalatedReason}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* SESIUNE ACTIVĂ DE DECIZIE */}
            {decisionSession && (
              <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-zinc-900/90 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                      🧠 SESIUNE DECIZIE ({decisionSession.maxIterations} iterații ·{' '}
                      {THINKING_MODES[thinkingMode].icon} {THINKING_MODES[thinkingMode].label})
                    </span>
                    <h3 className="mt-1 text-sm font-semibold text-zinc-100">
                      {decisionSession.topic}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Închide sesiunea
                  </button>
                </div>

                {decisionSession.needsWebPermission && (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm">
                    <p className="text-zinc-200">{decisionSession.permissionMessage}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          runDecisionStep({
                            topic: decisionSession.topic,
                            step: 0,
                            maxIter: decisionSession.maxIterations,
                            useWeb: true,
                          })
                        }
                        className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        🌐 Da, caută online și pornește
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          runDecisionStep({
                            topic: decisionSession.topic,
                            step: 0,
                            maxIter: decisionSession.maxIterations,
                            useWeb: false,
                            allowNoKbFallback: true,
                          })
                        }
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                      >
                        Continuă fără căutare online
                      </button>
                    </div>
                  </div>
                )}

                {decisionSession.researchCache && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {decisionSession.researchCache.sources.map((s) => (
                      <span
                        key={s.title}
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300"
                      >
                        📄 {s.title} ({(s.similarity * 100).toFixed(0)}%)
                      </span>
                    ))}
                    {decisionSession.researchCache.webSources.map((w) => (
                      <a
                        key={w.url}
                        href={w.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-300 hover:underline"
                      >
                        🌐 {w.title}
                      </a>
                    ))}
                  </div>
                )}

                {decisionSession.steps.map((s, idx) => {
                  const isLastStep = idx === decisionSession.steps.length - 1;
                  const isFinalIteration = s.step === decisionSession.maxIterations;

                  return (
                    <div
                      key={s.id}
                      className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4"
                    >
                      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                        <span className="font-mono text-xs font-semibold text-amber-400">
                          {s.step === 0
                            ? 'PAS 0 · ÎNTREBĂRI DE ALINIERE & ATACAREA PREMISEI'
                            : isFinalIteration
                              ? `ITERAȚIA ${s.step} / ${decisionSession.maxIterations} · PROPUNERE FINALĂ`
                              : `ITERAȚIA ${s.step} / ${decisionSession.maxIterations} · PROPUNERI & STRESS-TEST SWOT`}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          {s.usage.totalTokens.toLocaleString()} tok · $
                          {s.usage.estimatedCostUsd.toFixed(4)}
                        </span>
                      </div>

                      <div className="text-sm leading-relaxed text-zinc-100">
                        {renderMessageContent(s.aiOutput)}
                      </div>

                      {s.userFeedback && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                          <span className="font-semibold">Input-ul tău: </span>
                          {s.userFeedback}
                        </div>
                      )}

                      {isLastStep && !isFinalIteration && !loading && (
                        <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3.5 text-xs">
                          <p className="mb-2 font-medium text-violet-200">
                            ✍️ Input-ul tău pentru{' '}
                            {s.step === 0 ? 'Iterația 1' : `Iterația ${s.step + 1}`}:
                          </p>
                          <textarea
                            rows={3}
                            value={stepFeedbackInput}
                            onChange={(e) => setStepFeedbackInput(e.target.value)}
                            placeholder="Scrie aici răspunsurile tale, constrângerile sau ce vrei să păstrezi / elimini..."
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-violet-400 focus:outline-none"
                          />
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                              className="rounded-lg bg-violet-600 px-3.5 py-1.5 font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                            >
                              Trimite input → Iterația {s.step + 1}
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
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
                            >
                              Continuă fără input → Iterația {s.step + 1}
                            </button>
                          </div>
                        </div>
                      )}

                      {isLastStep && isFinalIteration && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                          <span className="text-emerald-200">
                            ✅ Sesiune completă. Vrei să salvezi concluzia în Notes?
                          </span>
                          {savedNotes[s.id] ? (
                            <span className="font-semibold text-emerald-400">
                              ✓ Salvat în Notes
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={savingNoteId === s.id}
                              onClick={() =>
                                saveNote(
                                  s.id,
                                  s.finalSummary ||
                                    `Decizie (${decisionSession.topic}): ${s.aiOutput.slice(0, 400)}`
                                )
                              }
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {savingNoteId === s.id ? 'Salvez...' : '📌 Salvează în Notes'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-xs text-zinc-400">
                  {activeModeMeta.icon} Rulez pe {activeModeMeta.label}
                  {decisionMode || decisionSession
                    ? ' · atac ipotezele și pregătesc iterația...'
                    : webMode
                      ? ' · caut în documente și pe internet...'
                      : ' · analizez documentele...'}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-800 bg-zinc-900/90 px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5">
                {(Object.keys(THINKING_MODES) as ThinkingMode[]).map((modeKey) => {
                  const m = THINKING_MODES[modeKey];
                  const isSelected = thinkingMode === modeKey;
                  return (
                    <button
                      key={modeKey}
                      type="button"
                      onClick={() => setThinkingMode(modeKey)}
                      className={`rounded-lg border px-2.5 py-1 font-medium transition ${
                        isSelected
                          ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                          : 'border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  );
                })}
              </div>

              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={autoEscalate}
                  onChange={(e) => setAutoEscalate(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span>Auto-escaladare (⚡→🎯)</span>
              </label>
            </div>

            <p className="px-1 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-200">
                {activeModeMeta.icon} {activeModeMeta.label} ({activeModeMeta.shortDesc}):
              </span>{' '}
              {activeModeMeta.whenToUse}
            </p>

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
                title="Activează/dezactivează căutarea pe internet (/web)"
                className={`rounded-xl border px-3 py-2.5 font-mono text-xs font-medium transition ${
                  webMode
                    ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                🌐 /web
              </button>

              <button
                type="button"
                onClick={toggleDecisionMode}
                title="Activează modul iterativ de luare a deciziilor (comută automat pe Deep Think)"
                className={`rounded-xl border px-3 py-2.5 font-mono text-xs font-medium transition ${
                  decisionMode
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                🧠 Decizie
              </button>

              {decisionMode && (
                <select
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                  title="Număr de iterații"
                  className="rounded-xl border border-amber-500/40 bg-zinc-950 px-2.5 py-2.5 font-mono text-xs text-amber-300 focus:outline-none"
                >
                  <option value={1}>1 iterație</option>
                  <option value={2}>2 iterații</option>
                  <option value={3}>3 iterații</option>
                  <option value={4}>4 iterații</option>
                  <option value={5}>5 iterații</option>
                </select>
              )}

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  decisionMode
                    ? 'Ce decizie vrei să analizăm iterativ?'
                    : webMode
                      ? 'Caută pe internet + documente interne...'
                      : 'Întreabă Alumn-Bot sau comunică o decizie nouă...'
                }
                disabled={loading}
                className="min-w-[200px] flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />

              <button
                type="submit"
                disabled={loading || !input.trim()}
                className={`rounded-xl px-5 py-2.5 text-sm font-medium text-white transition disabled:opacity-40 ${
                  decisionMode
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
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