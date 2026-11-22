import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import { ALUMNI_PM_SYSTEM_PROMPT } from '../../lib/system-prompt';
import { buildLiveCrmContext } from '../../lib/live-crm-context';

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

    // 2. Hybrid search în documente + Notes
    const [docsRes, notesRes, liveCrmContext] = await Promise.all([
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
    ]);

    if (docsRes.error) {
      console.error('Supabase RPC error:', docsRes.error);
      return NextResponse.json({ error: 'Eroare la căutarea în baza de date.' }, { status: 500 });
    }

    const matched = ((docsRes.data as MatchedChunk[]) || []).filter((c) => c.similarity >= 0.35);
    const matchedNotes = ((notesRes.data as MatchedNote[]) || []).filter((n) => n.similarity >= 0.38);

    // 3. Căutare web (doar cu /web)
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
            escalationGuardInstruction,
        },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user' as const,
          content: `CONTEXT DOCUMENTE:\n${docContext}${notesContext}${liveCrmContext}${webContext}\n\nÎNTREBARE UTILIZATOR (${usedWeb ? 'CU /web ACTIVAT' : 'FĂRĂ /web'}): ${question}`,
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
            content: ALUMNI_PM_SYSTEM_PROMPT + modelConfig.thinkingPromptInjection,
          },
          ...baseMessages.slice(1),
        ],
      });
      promptTokens += completion.usage?.prompt_tokens ?? 0;
      completionTokens += completion.usage?.completion_tokens ?? 0;
      rawAnswer = stripThinkingBlock(completion.choices[0].message.content || '');
    }

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
      answer: rawAnswer || 'Fără răspuns.',
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