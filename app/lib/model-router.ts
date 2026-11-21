export type ThinkingMode = 'rapid' | 'analytic' | 'deep';

export interface ModeMeta {
  id: ThinkingMode;
  icon: string;
  label: string;
  shortDesc: string;
  whenToUse: string;
}

export const THINKING_MODES: Record<ThinkingMode, ModeMeta> = {
  rapid: {
    id: 'rapid',
    icon: '⚡',
    label: 'Rapid',
    shortDesc: 'Căutări punctuale dintr-un singur document',
    whenToUse:
      'Întrebări scurte, pași dintr-o singură procedură, praguri de puncte/strike-uri, verificări rapide.',
  },
  analytic: {
    id: 'analytic',
    icon: '🎯',
    label: 'Analitic',
    shortDesc: 'Diagrame, grafice, structuri & multi-document',
    whenToUse:
      'Diagrame Excalidraw, grafice statistice, organigrame/departamente, corelarea a 2+ documente, neconcordanțe.',
  },
  deep: {
    id: 'deep',
    icon: '🧠',
    label: 'Deep Think',
    shortDesc: 'Audit contradicții & decizii grele',
    whenToUse:
      'Sesiuni de Decizie (SWOT + atacarea ideilor), detectarea conflictelor ascunse, strategii și scenarii.',
  },
};

export interface ResolvedModelConfig {
  effectiveMode: ThinkingMode;
  deployment: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  thinkingPromptInjection: string;
  escalatedReason: string | null;
  inputRatePerMillion: number;
  outputRatePerMillion: number;
}

export function shouldAutoEscalateToAnalytic(
  question: string,
  uniqueDocCount: number
): string | null {
  const q = question.toLowerCase();

  if (
    /\b(diagram[aă]|mermaid|excalidraw|flowchart|schem[aă]|organigram[aă]|timeline|grafic|chart|statistic[aăi]|distribu[tț]ie)\b/i.test(
      q
    )
  ) {
    return 'Auto-escaladat la Analitic (diagramă / vizualizare)';
  }

  if (
    /\b(departament\w*|structur[aăi]|organizare|roluri\w*|board\w*|guvernan[tț][aă]|arii|makers|shapers|explorers)\b/i.test(
      q
    )
  ) {
    return 'Auto-escaladat la Analitic (structură / roluri / departamente)';
  }

  if (
    /\b(compar[aă]|diferen[tț]e|contradic[tț]ii|neconcordan[tț][aăe]|conflict|calculeaz[aă]|reten[tț]ie|kpi|procent|buget|coreleaz[aă]|procedur[aă] nou[aă])\b/i.test(
      q
    )
  ) {
    return 'Auto-escaladat la Analitic (analiză / calcul / sinteză)';
  }

  if (uniqueDocCount >= 2) {
    return `Auto-escaladat la Analitic (verificare din ${uniqueDocCount} documente)`;
  }

  return null;
}

export function resolveModelConfig(
  requestedMode: ThinkingMode,
  autoUpgradeReason: string | null = null
): ResolvedModelConfig {
  const effectiveMode: ThinkingMode =
    requestedMode === 'rapid' && autoUpgradeReason ? 'analytic' : requestedMode;

  const rapidDeployment = process.env.AZURE_CHAT_DEPLOYMENT!;
  const analyticDeployment = process.env.AZURE_ANALYTIC_DEPLOYMENT || rapidDeployment;
  const deepDeployment = process.env.AZURE_DEEP_DEPLOYMENT || analyticDeployment;

  const deploymentMap: Record<ThinkingMode, string> = {
    rapid: rapidDeployment,
    analytic: analyticDeployment,
    deep: deepDeployment,
  };

  const deployment = deploymentMap[effectiveMode];
  const isNativeReasoning = /^(o1|o3|o4|gpt-5)/i.test(deployment);

  let reasoningEffort: 'low' | 'medium' | 'high' | undefined;
  let thinkingPromptInjection = '';

  const verificationGate = `
# ANTI-HALLUCINATION VERIFICATION GATE (OBLIGATORIU ÎNAINTE DE RĂSPUNS)
1. Audit literal al entităților: verifică fiecare nume de departament, rol, arie, cifră, prag și termen din răspuns (și din fiecare nod \`\`\`mermaid sau \`\`\`chart).
2. Dacă un termen este o parafrază, traducere sau invenție care NU apare cuvânt cu cuvânt în CONTEXT DOCUMENTE, șterge-l și înlocuiește-l cu denumirea exactă din document (sau marchează „[Lipsă în documente]”).
3. Dacă două surse au variante diferite (ex: Ghid 2027 vs. documente anterioare), prezintă-le separat cu sursa fiecăreia, fără să le contopești.`;

  if (isNativeReasoning) {
    if (effectiveMode === 'analytic') {
      reasoningEffort = 'low';
      thinkingPromptInjection = verificationGate;
    } else if (effectiveMode === 'deep') {
      reasoningEffort = 'high';
      thinkingPromptInjection = verificationGate;
    }
  } else {
    if (effectiveMode === 'analytic') {
      thinkingPromptInjection = `${verificationGate}
Înainte de răspunsul final, deschide un bloc <thinking>...</thinking> în care listezi termenii exacți extrași din documente și verifici fiecare nod/cifră. După </thinking>, scrii doar răspunsul curat.`;
    } else if (effectiveMode === 'deep') {
      thinkingPromptInjection = `${verificationGate}
Înainte de răspunsul final, deschide un bloc <thinking>...</thinking> în care faci audit complet al surselor, ataci fiecare ipoteză (Devil's Advocate) și verifici riscurile. După </thinking>, scrii doar răspunsul curat.`;
    }
  }

  const isGpt5Mini = /gpt-5-mini/i.test(deployment);

  return {
    effectiveMode,
    deployment,
    reasoningEffort,
    thinkingPromptInjection,
    escalatedReason: effectiveMode !== requestedMode ? autoUpgradeReason : null,
    inputRatePerMillion: isGpt5Mini ? 0.25 : 0.15,
    outputRatePerMillion: isGpt5Mini ? 2.0 : 0.6,
  };
}

export function stripThinkingBlock(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/gi, '').trim();
}