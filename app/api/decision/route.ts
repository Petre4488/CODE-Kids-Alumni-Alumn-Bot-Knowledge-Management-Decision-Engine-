import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import { ALUMNI_PM_SYSTEM_PROMPT } from '../../lib/system-prompt';
import { buildLiveCrmContext } from '../../lib/live-crm-context';
import {
  ThinkingMode,
  resolveModelConfig,
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

export interface ResearchCache {
  docContext: string;
  notesContext: string;
  webContext: string;
  sources: { title: string; department: string | null; similarity: number }[];
  notesUsed: { content: string; date: string }[];
  webSources: { title: string; url: string }[];
  foundInKb: boolean;
}

interface IterationHistoryItem {
  step: number;
  aiOutput: string;
  userFeedback?: string;
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
    throw new Error('Lipsește TAVILY_API_KEY în .env.local pentru căutarea online.');
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: 6,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const topic: string = body.topic?.trim() || '';
    const step: number = Number(body.step ?? 0);
    const maxIterations: number = Math.min(Math.max(Number(body.maxIterations ?? 3), 1), 6);
    const department: string | null = body.department || null;
    const webSearch: boolean = Boolean(body.webSearch);
    const thinkingMode: ThinkingMode = body.thinkingMode || 'deep';
    const allowNoKbFallback: boolean = Boolean(body.allowNoKbFallback);
    const history: IterationHistoryItem[] = Array.isArray(body.history) ? body.history : [];
    let researchCache: ResearchCache | null = body.researchCache || null;

    if (!topic) {
      return NextResponse.json({ error: 'Subiectul deciziei nu poate fi gol.' }, { status: 400 });
    }

    const modelConfig = resolveModelConfig(thinkingMode);
    let embeddingTokens = 0;

    // PASUL 0: Research-ul se face o singură dată și se ține în sesiunea locală
    if (!researchCache) {
      const embRes = await azure.embeddings.create({
        model: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
        input: topic,
      });
      embeddingTokens = embRes.usage?.total_tokens ?? 0;
      const queryEmbedding = embRes.data[0].embedding;

      const [docsRes, notesRes] = await Promise.all([
        supabase.rpc('match_documents', {
          query_embedding: queryEmbedding,
          query_text: topic,
          match_count: 7,
          filter_department: department,
        }),
        supabase.rpc('match_memory_notes', {
          query_embedding: queryEmbedding,
          match_count: 4,
        }),
      ]);

      if (docsRes.error) {
        return NextResponse.json({ error: 'Eroare la căutarea în baza de date.' }, { status: 500 });
      }

      const matched = ((docsRes.data as MatchedChunk[]) || []).filter((c) => c.similarity >= 0.35);
      const matchedNotes = ((notesRes.data as MatchedNote[]) || []).filter((n) => n.similarity >= 0.38);
      const foundInKb = matched.length > 0 || matchedNotes.length > 0;

      if (!foundInKb && !webSearch && !allowNoKbFallback) {
        const cost = (embeddingTokens / 1_000_000) * 0.02;
        await supabase.from('chat_logs').insert({
          question: `[DECIZIE - CHECK KB] ${topic}`,
          used_web: false,
          embedding_tokens: embeddingTokens,
          total_tokens: embeddingTokens,
          estimated_cost_usd: cost,
        });
        const allTime = await getAllTimeUsage();

        return NextResponse.json({
          needsWebPermission: true,
          message:
            'Nu am găsit nimic relevant în documentele interne sau în Notes despre acest subiect. Vrei să caut online cele mai bune modele/surse și să pornesc de acolo?',
          usage: {
            embeddingTokens,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: embeddingTokens,
            estimatedCostUsd: cost,
          },
          allTime,
        });
      }

      let webResults: WebResult[] = [];
      if (webSearch) {
        webResults = await searchWeb(topic);
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

      researchCache = {
        foundInKb,
        docContext: matched.length
          ? matched
              .map(
                (c) =>
                  `--- DOCUMENT INTERN: ${c.document_title} (relevanță: ${(c.similarity * 100).toFixed(0)}%) ---\n${c.content}`
              )
              .join('\n\n')
          : 'Nu s-au găsit proceduri sau date despre acest subiect în documentele interne.',
        notesContext: matchedNotes.length
          ? matchedNotes
              .map(
                (n) =>
                  `--- NOTIȚĂ CONFIRMATĂ PETRE (${new Date(n.created_at).toLocaleDateString('ro-RO')}) ---\n${n.content}`
              )
              .join('\n\n')
          : '',
        webContext: webResults.length
          ? webResults
              .map((w) => `--- SURSA WEB: ${w.title} (${w.url}) ---\n${w.content}`)
              .join('\n\n')
          : '',
        sources: uniqueSources,
        notesUsed: matchedNotes.map((n) => ({
          content: n.content,
          date: new Date(n.created_at).toLocaleDateString('ro-RO'),
        })),
        webSources: webResults.map((w) => ({ title: w.title, url: w.url })),
      };
    }

    let stageInstruction = '';

    if (step === 0) {
      stageInstruction = `
MOD LUCRU: DECISION ENGINE — PASUL 0 (ALINIERE & ATACAREA PREMISEI ÎNAINTE DE ITERAȚIA 1 din ${maxIterations}).
${
  !researchCache.foundInKb && webSearch
    ? 'Menționează explicit în prima frază că NU ai găsit informații în documentele interne și că ai făcut research online pe sursele externe atașate.'
    : researchCache.foundInKb
      ? 'Menționează pe scurt (2 rânduri) ce ai găsit deja în documentele interne ca punct de plecare.'
      : 'Menționează pe scurt că pornești fără documente interne și fără căutare online.'
}

SARCINA TA ACUM:
Nu genera încă soluțiile finale. Înainte de Iterația 1, formulează **3–4 întrebări scurte, tăioase și critice** pentru Petre ca să te asiguri că mergeți pe aceeași idee și să îi ataci presupunerile:
- Întreabă **de ce** vrea această schimbare / decizie (ce simptom concret din comunitate rezolvă).
- Întreabă **cum** vede constrângerile reale (timp, retenție, vârsta membrilor 14–17 vs 18+, încărcarea board-ului).
- Semnalează din start 1–2 capcane ascunse din documentele actuale (dacă există).
Răspunde direct, structurat numerotat (1, 2, 3, 4), fără umplutură.`;
    } else if (step < maxIterations) {
      stageInstruction = `
MOD LUCRU: DECISION ENGINE — ITERAȚIA ${step} DIN ${maxIterations}.
SARCINA TA ACUM:
1. Ținând cont de documentele interne / sursele web, de iterațiile anterioare și de feedback-ul lui Petre, propune **${step === 1 ? '3–4 opțiuni/modele distincte' : '2–3 variante rafinate (eliminând ce a picat la testul anterior)'}**.
2. **Atacă fiecare opțiune în parte** cu un **Mini-SWOT / Stress-Test**:
   - **De ce merge (Puncte tari):** ancorat în realitatea CODE Kids Alumni.
   - **De ce crapă (Puncte slabe / Riscuri):** atacă ideea fără menajamente (birocrație, lipsă de retenție, conflict cu procedurile existente).
   - **Verdict intermediar:** ce ar trebui ajustat la ea.
3. La final, sub secțiunea **„Întrebări pentru Iterația ${step + 1}:”**, pune **2–3 întrebări țintite** care să atace punctele nevralgice rămase, ca Petre să îți dea direcția pentru următoarea iterație (sau să te lase să continui singur).
Nu lua decizia în locul lui Petre.`;
    } else {
      stageInstruction = `
MOD LUCRU: DECISION ENGINE — ITERAȚIA ${maxIterations} DIN ${maxIterations} (PROPUNERE FINALĂ).
SARCINA TA ACUM:
Sintetizează toate iterațiile, atacurile SWOT și feedback-ul lui Petre într-o **Propunere Finală de Decizie**:
1. **Modelul / Soluția recomandată:** descriere clară, operațională, adaptată structurii CODE Kids Alumni.
2. **De ce câștigă față de celelalte variante testate:** argumente concrete.
3. **Riscuri rămase & Cum le blochezi din start:** 2–3 măsuri preventive.
4. **Impact pe documentele existente & Pași de implementare:** ce proceduri trebuie actualizate și în ce ordine (fără să modifici tu documentele).
5. La final, adaugă exact pe ultima linie rezumatul deciziei între paranteze drepte pentru a-l putea salva în Notes dacă Petre aprobă:
   [FINAL_DECISION_SUMMARY: <rezumat concis în 1-2 fraze al propunerii finale>]
Menționează clar că decizia finală îi aparține lui Petre.`;
    }

    const historyBlock = history.length
      ? `\n\n=== ISTORICUL SESIUNII DE DECIZIE (ITERAȚII & FEEDBACK PETRE) ===\n` +
        history
          .map(
            (h) =>
              `--- ${h.step === 0 ? 'PAS 0 (Întrebări Aliniere)' : `ITERAȚIA ${h.step}`} ---\nAI:\n${h.aiOutput}\n${
                h.userFeedback
                  ? `\nFEEDBACK / RĂSPUNS PETRE:\n${h.userFeedback}`
                  : '\n(Petre nu a adăugat feedback la acest pas)'
              }`
          )
          .join('\n\n')
      : '';

    const liveCrmContext = await buildLiveCrmContext(department);
    const completion = await azure.chat.completions.create({
      model: modelConfig.deployment,
      ...(modelConfig.reasoningEffort ? { reasoning_effort: modelConfig.reasoningEffort } : {}),
      messages: [
        {
          role: 'system',
          content: `${ALUMNI_PM_SYSTEM_PROMPT}${modelConfig.thinkingPromptInjection}\n\n${stageInstruction}`,
        },
        {
          role: 'user',
          content: `SUBIECT DECIZIE: ${topic}
NUMĂR TOTAL ITERAȚII PLANIFICATE: ${maxIterations}

=== CONTEXT DOCUMENTE INTERNE ===
${researchCache.docContext}
${researchCache.notesContext ? `\n=== NOTES CONFIRMATE PETRE ===\n${researchCache.notesContext}` : ''}
${researchCache.webContext ? `\n=== SURSE RESEARCH ONLINE ===\n${researchCache.webContext}` : ''}
${historyBlock}`,
        },
      ],
    });

    const promptTokens = completion.usage?.prompt_tokens ?? 0;
    const completionTokens = completion.usage?.completion_tokens ?? 0;
    const totalTokens = embeddingTokens + promptTokens + completionTokens;
    const cleanOutput = stripThinkingBlock(completion.choices[0].message.content || 'Fără răspuns.');

    const estimatedCostUsd =
      (embeddingTokens / 1_000_000) * 0.02 +
      (promptTokens / 1_000_000) * modelConfig.inputRatePerMillion +
      (completionTokens / 1_000_000) * modelConfig.outputRatePerMillion;

    await supabase.from('chat_logs').insert({
      question: `[DECIZIE ${modelConfig.effectiveMode.toUpperCase()} Pas ${step}/${maxIterations}] ${topic}`,
      used_web: webSearch,
      embedding_tokens: embeddingTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
    });

    const allTime = await getAllTimeUsage();

    return NextResponse.json({
      output: cleanOutput,
      researchCache,
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
    console.error('API /decision error:', err);
    const message = err instanceof Error ? err.message : 'Eroare internă de server.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}