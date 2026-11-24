import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import { ALUMNI_PM_SYSTEM_PROMPT } from '../../lib/system-prompt';
import { buildLiveCrmContext } from '../../lib/live-crm-context';
import { DepartmentKey, normalizeDepartment, PriorityKey } from '../../lib/pmp-types';
import {
  ThinkingMode,
  resolveModelConfig,
  shouldAutoEscalateToAnalytic,
  stripThinkingBlock,
} from '../../lib/model-router';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const azure = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: '2025-04-01-preview',
});

export interface AiProposedTask {
  id: string;
  selected: boolean;
  title: string;
  description: string | null;
  type: 'task' | 'milestone';
  department: DepartmentKey;
  assignee_id: string | null;
  assignee_name: string | null;
  priority: PriorityKey;
  estimated_hours: number;
  start_date: string | null;
  deadline: string | null;
  is_my_task: boolean;
  needs_pm_sync: boolean;
}

export interface AiProposedProject {
  mode: 'none' | 'existing' | 'new';
  existing_project_id: string | null;
  title: string;
  description: string | null;
  department: DepartmentKey;
  owner_id: string | null;
  owner_name: string | null;
  is_core_team: boolean;
  needs_pm_sync: boolean;
  start_date: string | null;
  deadline: string | null;
}

export interface AiActionPlan {
  summary: string;
  project: AiProposedProject;
  tasks: AiProposedTask[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MatchedChunk {
  id: string;
  document_title: string;
  department: string | null;
  content: string;
  similarity: number;
}

interface MatchedNote {
  id: string;
  content: string;
  created_at: string;
  similarity: number;
}

interface WebResult {
  title: string;
  url: string;
  content: string;
}

async function getAllTimeUsage() {
  const { data } = await supabase
    .from('chat_logs')
    .select('total_tokens, estimated_cost_usd');

  if (!data) return { totalTokens: 0, totalCostUsd: 0, totalPrompts: 0 };

  return data.reduce(
    (acc, row) => ({
      totalTokens: acc.totalTokens + (row.total_tokens || 0),
      totalCostUsd: acc.totalCostUsd + Number(row.estimated_cost_usd || 0),
      totalPrompts: acc.totalPrompts + 1,
    }),
    { totalTokens: 0, totalCostUsd: 0, totalPrompts: 0 }
  );
}

async function searchWeb(query: string): Promise<WebResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Lipsește TAVILY_API_KEY în .env.local pentru căutarea /web.');
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
    }),
  });

  if (!res.ok) {
    throw new Error(`Eroare la căutarea web (${res.status}).`);
  }

  const data = await res.json();
  return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

function extractAndNormalizeActionPlan(
  rawText: string,
  projectsList: { id: string; title: string; department: string; is_core_team: boolean }[],
  peopleList: { id: string; full_name: string; role: string; department: string }[],
  fallbackDept: string | null
): { cleanAnswer: string; actionPlan: AiActionPlan | null } {
  const regex = /```pmp_plan\s*([\s\S]*?)```/i;
  const match = rawText.match(regex);
  if (!match) {
    return { cleanAnswer: rawText, actionPlan: null };
  }

  const cleanAnswer = rawText.replace(regex, '').trim();
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return { cleanAnswer, actionPlan: null };
    }

    const validProjectIds = new Set(projectsList.map((p) => p.id));
    const validPersonIds = new Set(peopleList.map((p) => p.id));
    const rawProj = parsed.project || {};

    const rawMode = String(rawProj.mode || 'none');
    const existingId =
      rawMode === 'existing' && validProjectIds.has(String(rawProj.existing_project_id))
        ? String(rawProj.existing_project_id)
        : null;

    const mode: 'none' | 'existing' | 'new' =
      rawMode === 'existing' && existingId
        ? 'existing'
        : rawMode === 'new' && String(rawProj.title || '').trim()
          ? 'new'
          : 'none';

    const matchedExisting = existingId
      ? projectsList.find((p) => p.id === existingId)
      : null;

    const projDept = matchedExisting
      ? normalizeDepartment(matchedExisting.department)
      : normalizeDepartment(String(rawProj.department || fallbackDept || 'Board'));

    const projOwnerId = validPersonIds.has(String(rawProj.owner_id))
      ? String(rawProj.owner_id)
      : null;

    const tasks: AiProposedTask[] = parsed.tasks.map(
      (t: Record<string, unknown>, idx: number) => {
        const assigneeId = validPersonIds.has(String(t.assignee_id))
          ? String(t.assignee_id)
          : null;
        const assigneePerson = assigneeId
          ? peopleList.find((p) => p.id === assigneeId)
          : null;

        const rawPrio = String(t.priority || 'medium') as PriorityKey;
        const priority: PriorityKey = ['low', 'medium', 'high', 'urgent'].includes(rawPrio)
          ? rawPrio
          : 'medium';

        return {
          id: `ai-task-${Date.now()}-${idx}`,
          selected: true,
          title: String(t.title || `Task ${idx + 1}`).trim(),
          description: t.description ? String(t.description).trim() : null,
          type: t.type === 'milestone' ? 'milestone' : 'task',
          department: normalizeDepartment(String(t.department || projDept)),
          assignee_id: assigneeId,
          assignee_name:
            assigneePerson?.full_name || (t.assignee_name ? String(t.assignee_name) : null),
          priority,
          estimated_hours: Math.max(0.5, Number(t.estimated_hours ?? 2)),
          start_date: t.start_date ? String(t.start_date).slice(0, 10) : todayIso,
          deadline: t.deadline ? String(t.deadline).slice(0, 10) : todayIso,
          is_my_task: Boolean(t.is_my_task),
          needs_pm_sync: Boolean(t.needs_pm_sync),
        };
      }
    );

    const actionPlan: AiActionPlan = {
      summary: String(parsed.summary || 'Plan propus spre aprobare'),
      project: {
        mode,
        existing_project_id: existingId,
        title: matchedExisting
          ? matchedExisting.title
          : String(rawProj.title || '').trim(),
        description: rawProj.description ? String(rawProj.description).trim() : null,
        department: projDept,
        owner_id: projOwnerId,
        owner_name: projOwnerId
          ? peopleList.find((p) => p.id === projOwnerId)?.full_name || null
          : null,
        is_core_team: Boolean(rawProj.is_core_team),
        needs_pm_sync: Boolean(rawProj.needs_pm_sync),
        start_date: rawProj.start_date ? String(rawProj.start_date).slice(0, 10) : todayIso,
        deadline: rawProj.deadline ? String(rawProj.deadline).slice(0, 10) : null,
      },
      tasks,
    };

    return { cleanAnswer, actionPlan };
  } catch {
    return { cleanAnswer, actionPlan: null };
  }
}

export async function GET() {
  const allTime = await getAllTimeUsage();
  return NextResponse.json({ allTime });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawQuestion: string = body.question?.trim() || '';
    const department: string | null = body.department || null;
    const requestedMode: ThinkingMode = body.thinkingMode || 'rapid';
    const autoEscalate: boolean = body.autoEscalate !== false;
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history.slice(-6) : [];

    if (!rawQuestion) {
      return NextResponse.json({ error: 'Întrebarea nu poate fi goală.' }, { status: 400 });
    }

    const usedWeb = /^\/web\b/i.test(rawQuestion) || Boolean(body.webSearch);
    const question = rawQuestion.replace(/^\/web\b\s*/i, '').trim() || rawQuestion;

    // 1. Embeddings
    const embRes = await azure.embeddings.create({
      model: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
      input: question,
    });
    const embeddingTokens = embRes.usage?.total_tokens ?? 0;
    const queryEmbedding = embRes.data[0].embedding;

    // 2. Hybrid search în documente + Notes + Live CRM + IDs pentru propuneri task/proiect
    const [docsRes, notesRes, liveCrmContext, projectsRes, peopleRes] = await Promise.all([
      supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        query_text: question,
        match_count: 6,
        filter_department: department,
      }),
      supabase.rpc('match_memory_notes', {
        query_embedding: queryEmbedding,
        match_count: 3,
      }),
      buildLiveCrmContext(department),
      supabase.from('projects').select('id, title, department, is_core_team'),
      supabase.from('people').select('id, full_name, role, department'),
    ]);

    if (docsRes.error) {
      console.error('Supabase RPC error:', docsRes.error);
      return NextResponse.json({ error: 'Eroare la căutarea în baza de date.' }, { status: 500 });
    }

    const projectsList = projectsRes.data || [];
    const peopleList = peopleRes.data || [];

    const matched = ((docsRes.data as MatchedChunk[]) || []).filter((c) => c.similarity >= 0.35);
    const matchedNotes = ((notesRes.data as MatchedNote[]) || []).filter((n) => n.similarity >= 0.38);

    // 3. Căutare web (STRICT doar cu /web activat)
    let webResults: WebResult[] = [];
    if (usedWeb) {
      webResults = await searchWeb(question);
    }

    const uniqueSources = Array.from(
      matched
        .reduce((map, item) => {
          const existing = map.get(item.document_title);
          if (!existing || item.similarity > existing.similarity) {
            map.set(item.document_title, {
              title: item.document_title,
              department: item.department,
              similarity: item.similarity,
            });
          }
          return map;
        }, new Map<string, { title: string; department: string | null; similarity: number }>())
        .values()
    );

    // 4. Pre-routare deterministă (0 tokenuri extra)
    const preUpgradeReason =
      autoEscalate && requestedMode === 'rapid'
        ? shouldAutoEscalateToAnalytic(question, uniqueSources.length)
        : null;

    let modelConfig = resolveModelConfig(requestedMode, preUpgradeReason);

    const docContext = matched.length
      ? matched
          .map(
            (c) =>
              `--- DOCUMENT INTERN: ${c.document_title} (relevanță: ${(c.similarity * 100).toFixed(0)}%) ---\n${c.content}`
          )
          .join('\n\n')
      : 'Niciun fragment relevant în documentele interne.';

    const notesContext = matchedNotes.length
      ? `\n\n=== DECIZII ȘI NOTIȚE CONFIRMATE DE PETRE ===\n` +
        matchedNotes
          .map(
            (n) =>
              `--- NOTIȚĂ PETRE (${new Date(n.created_at).toLocaleDateString('ro-RO')}) ---\n${n.content}`
          )
          .join('\n\n')
      : '';

    const webContext = webResults.length
      ? `\n\n=== REZULTATE DE PE INTERNET ===\n` +
        webResults
          .map((w) => `--- SURSA WEB: ${w.title} (${w.url}) ---\n${w.content}`)
          .join('\n\n')
      : '';

    const todayIso = new Date().toISOString().slice(0, 10);
    const idLookupContext = `\n\n=== ID-URI EXACTE PENTRU PROPUNERI TASK/PROIECT (DATA: ${todayIso}) ===\nPROIECTE:\n${
      projectsList.length
        ? projectsList
            .map((p) => `- id="${p.id}" | title="${p.title}" | dept="${p.department}"`)
            .join('\n')
        : '- Niciun proiect.'
    }\nOAMENI:\n${
      peopleList.length
        ? peopleList
            .map((p) => `- id="${p.id}" | name="${p.full_name}" | role="${p.role}" | dept="${p.department}"`)
            .join('\n')
        : '- Nicio persoană.'
    }`;

    const pmpActionInstruction = `
# PROPUNERE EXECUTABILĂ DE PROIECTE & TASK-URI (DOAR LA CERERE)
- DOAR când Petre cere explicit să adaugi, să creezi sau să planifici task-uri / un proiect (ex: „adaugă task-ul...”, „ok facem asta, asta, asta”, „pune în proiect...”, „transformă în task-uri”), adaugă LA FINALUL răspunsului un bloc \`\`\`pmp_plan ... \`\`\` cu JSON valid, pe care Petre îl aprobă cu 1 click.
- NU genera \`\`\`pmp_plan\`\`\` la întrebări normale, diagrame \`\`\`mermaid\`\`\`, grafice \`\`\`chart\`\`\` sau analize simple.
- Pentru responsabilul Petre (eu) folosește STRICT UUID-ul lui Cîrceag Petre (Manager/Board), iar pentru Vlad (monitorizare) UUID-ul lui Brinzan Vlad (Monitorizare/Board). Dacă trebuie discutat cu Vlad (PM), pune "needs_pm_sync": true.
- Format JSON exact în interiorul \`\`\`pmp_plan\`:
{"summary":"Rezumat scurt","project":{"mode":"none"|"existing"|"new","existing_project_id":null,"title":"","description":null,"department":"Board","owner_id":null,"is_core_team":false,"needs_pm_sync":false,"start_date":"${todayIso}","deadline":null},"tasks":[{"title":"Titlu task","description":null,"type":"task","department":"Board","assignee_id":null,"priority":"medium","estimated_hours":2,"start_date":"${todayIso}","deadline":"${todayIso}","is_my_task":true,"needs_pm_sync":false}]}`;

    const escalationGuardInstruction =
      autoEscalate && modelConfig.effectiveMode === 'rapid'
        ? `\n\n[AUTO-ESCALATION]: Dacă observi ORICE neconcordanță, contradicție, diferență de cifre/termene între documente, date incomplete sau dacă trebuie să sintetizezi roluri/structuri complexe, nu răspunde tu — returnează DOAR cuvântul exact: [ESCALATE]`
        : '';

    const baseMessages = [
      {
        role: 'system' as const,
        content:
          ALUMNI_PM_SYSTEM_PROMPT +
          modelConfig.thinkingPromptInjection +
          pmpActionInstruction +
          escalationGuardInstruction,
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user' as const,
        content: `CONTEXT DOCUMENTE:\n${docContext}${notesContext}${liveCrmContext}${idLookupContext}${webContext}\n\nÎNTREBARE UTILIZATOR (${usedWeb ? 'CU /web ACTIVAT' : 'FĂRĂ /web'}): ${question}`,
      },
    ];

    let completion = await azure.chat.completions.create({
      model: modelConfig.deployment,
      ...(modelConfig.reasoningEffort ? { reasoning_effort: modelConfig.reasoningEffort } : {}),
      messages: baseMessages,
    });

    let promptTokens = completion.usage?.prompt_tokens ?? 0;
    let completionTokens = completion.usage?.completion_tokens ?? 0;
    let rawAnswer = stripThinkingBlock(completion.choices[0].message.content || '');

    // 5. Dacă modelul Rapid a detectat o neconcordanță ([ESCALATE]), urcăm la Analitic
    if (
      autoEscalate &&
      modelConfig.effectiveMode === 'rapid' &&
      rawAnswer.trim().startsWith('[ESCALATE]')
    ) {
      modelConfig = resolveModelConfig(
        'rapid',
        'Auto-escaladat la Analitic (neconcordanță / context complex detectat)'
      );
      completion = await azure.chat.completions.create({
        model: modelConfig.deployment,
        ...(modelConfig.reasoningEffort ? { reasoning_effort: modelConfig.reasoningEffort } : {}),
        messages: [
          {
            role: 'system',
            content:
              ALUMNI_PM_SYSTEM_PROMPT +
              modelConfig.thinkingPromptInjection +
              pmpActionInstruction,
          },
          ...baseMessages.slice(1),
        ],
      });
      promptTokens += completion.usage?.prompt_tokens ?? 0;
      completionTokens += completion.usage?.completion_tokens ?? 0;
      rawAnswer = stripThinkingBlock(completion.choices[0].message.content || '');
    }

    const { cleanAnswer, actionPlan } = extractAndNormalizeActionPlan(
      rawAnswer,
      projectsList,
      peopleList,
      department
    );

    const totalTokens = embeddingTokens + promptTokens + completionTokens;
    const estimatedCostUsd =
      (embeddingTokens / 1_000_000) * 0.02 +
      (promptTokens / 1_000_000) * modelConfig.inputRatePerMillion +
      (completionTokens / 1_000_000) * modelConfig.outputRatePerMillion;

    await supabase.from('chat_logs').insert({
      question: `[${modelConfig.effectiveMode.toUpperCase()}] ${rawQuestion}`,
      used_web: usedWeb,
      embedding_tokens: embeddingTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
    });

    const allTime = await getAllTimeUsage();

    return NextResponse.json({
      answer: cleanAnswer || 'Fără răspuns.',
      actionPlan,
      sources: uniqueSources,
      notesUsed: matchedNotes.map((n) => ({
        content: n.content,
        date: new Date(n.created_at).toLocaleDateString('ro-RO'),
      })),
      webSources: webResults.map((w) => ({ title: w.title, url: w.url })),
      modelInfo: {
        mode: modelConfig.effectiveMode,
        deployment: modelConfig.deployment,
        escalatedReason: modelConfig.escalatedReason,
      },
      usage: {
        embeddingTokens,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
      },
      allTime,
    });
  } catch (err: unknown) {
    console.error('API /ask error:', err);
    const message = err instanceof Error ? err.message : 'Eroare internă de server.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}