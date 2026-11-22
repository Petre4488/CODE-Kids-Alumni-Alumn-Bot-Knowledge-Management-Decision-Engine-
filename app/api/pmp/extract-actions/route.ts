import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const azure = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: '2025-04-01-preview',
});

export interface ExtractedActionProposal {
  id: string;
  kind: 'create_task' | 'create_milestone' | 'update_project_progress';
  title: string;
  department: 'Comunicare' | 'Comunitati' | 'Tehnic' | 'Coordonare Judeteana' | 'Board';
  project_id: string | null;
  project_title: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  deadline: string | null;
  is_my_task: boolean;
  new_progress?: number;
  rationale: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const noteText: string = String(body.noteText || '').trim();
    const noteTitle: string = String(body.noteTitle || '').trim();

    if (!noteText) {
      return NextResponse.json({ error: 'Notița este goală.' }, { status: 400 });
    }

    const [peopleRes, projectsRes] = await Promise.all([
      supabase.from('people').select('id, full_name, role, department'),
      supabase.from('projects').select('id, title, department, progress'),
    ]);

    const people = peopleRes.data || [];
    const projects = projectsRes.data || [];
    const todayStr = new Date().toISOString().slice(0, 10);

    const peopleList = people
      .map((p) => `- id: "${p.id}" | nume: "${p.full_name}" | rol: "${p.role}" | dept: "${p.department}"`)
      .join('\n');

    const projectsList = projects
      .map((p) => `- id: "${p.id}" | titlu: "${p.title}" | dept: "${p.department}" | progres: ${p.progress}%`)
      .join('\n');

    const completion = await azure.chat.completions.create({
      model: process.env.AZURE_CHAT_DEPLOYMENT!,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Ești un extractor determinist de acțiuni operaționale pentru CODE Kids Alumni (data curentă: ${todayStr}).
Analizează notița scrisă de Petre (Managerul comunității) și extrage DOAR acțiunile concrete menționate explicit în text:
- "create_task": un task nou de execuție;
- "create_milestone": un livrabil major / termen de verificare;
- "update_project_progress": dacă notița menționează explicit un procent nou de progres pentru un proiect existent.

REGULI STRICTE ANTI-HALUCINAȚIE:
1. Folosește EXCLUSIV id-urile reale din lista OAMENI și PROIECTE de mai jos. Dacă o persoană sau un proiect nu există în liste, pune null la id, dar păstrează numele menționat în text.
2. Nu inventa task-uri care nu reies din notiță.
3. Valorile permise pentru "department": "Comunicare", "Comunitati", "Tehnic", "Coordonare Judeteana", "Board".
4. Returnează EXCLUSIV un JSON valid cu forma:
{
  "proposals": [
    {
      "kind": "create_task",
      "title": "Titlu scurt acțiune",
      "department": "Tehnic",
      "project_id": "uuid-sau-null",
      "project_title": "Nume proiect sau null",
      "assignee_id": "uuid-sau-null",
      "assignee_name": "Nume persoană sau null",
      "deadline": "YYYY-MM-DD sau null",
      "is_my_task": false,
      "new_progress": null,
      "rationale": "Citat scurt / motiv din notiță"
    }
  ]
}`,
        },
        {
          role: 'user',
          content: `=== OAMENI ÎN CRM ===
${peopleList || 'Nicio persoană în CRM.'}

=== PROIECTE ACTIVE ===
${projectsList || 'Niciun proiect activ.'}

=== NOTIȚĂ DE ANALIZAT ===
Titlu: ${noteTitle}
Conținut:
${noteText}`,
        },
      ],
    });

    const raw = completion.choices[0].message.content || '{"proposals":[]}';
    const parsed = JSON.parse(raw) as { proposals?: Omit<ExtractedActionProposal, 'id'>[] };
    const proposals: ExtractedActionProposal[] = (parsed.proposals || []).map((item) => ({
      ...item,
      id: crypto.randomUUID(),
    }));

    return NextResponse.json({ proposals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare la extragerea acțiunilor.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}