import dotenv from 'dotenv';
import { AzureOpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const azure = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: '2024-10-21',
});

async function ask(question: string, department: string | null = null) {
  console.log(`\n❓ Întrebare: "${question}"\n`);

  // 1. Transformăm întrebarea în vector
  const emb = await azure.embeddings.create({
    model: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
    input: question,
  });

  // 2. Căutăm top 6 fragmente relevante
  const { data: chunks, error } = await supabase.rpc('match_documents', {
    query_embedding: emb.data[0].embedding,
    query_text: question,
    match_count: 6,
    filter_department: department,
  });

  if (error || !chunks?.length || chunks[0].similarity < 0.35) {
    console.log('🤖 Răspuns: Nu am găsit informații relevante în documentele interne.');
    return;
  }

  const context = chunks
    .map((c: any) => `--- SURSA: ${c.document_title} (scor: ${c.similarity.toFixed(2)}) ---\n${c.content}`)
    .join('\n\n');

  // 3. Generăm răspunsul strict pe baza contextului
  const completion = await azure.chat.completions.create({
    model: process.env.AZURE_CHAT_DEPLOYMENT!,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `Ești asistentul intern al comunității CODE Kids Alumni. 
Răspunde STRICT pe baza fragmentelor de context furnizate mai jos. 
Reguli:
1. Dacă informația nu apare în context, spune clar: "Nu apare în documentele încărcate." Nu inventa nimic.
2. Citează obligatoriu documentul sursă între paranteze pătrate, ex: [Nume Document].
3. Răspunde concis, structurat pe bullet points.`,
      },
      {
        role: 'user',
        content: `CONTEXT:\n${context}\n\nÎNTREBARE: ${question}`,
      },
    ],
  });

  console.log('🤖 Răspuns:\n' + completion.choices[0].message.content);
  console.log('\n📚 Surse verificate:', [...new Set(chunks.map((c: any) => c.document_title))].join(', '));
}

// Pune aici o întrebare reală din cele 21 de documente:
ask('Care sunt regulile principale și responsabilitățile coordonatorilor?');