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
  apiVersion: '2024-10-21',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content: string = body.content?.trim();

    if (!content) {
      return NextResponse.json({ error: 'Conținutul notiței este gol.' }, { status: 400 });
    }

    const embRes = await azure.embeddings.create({
      model: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
      input: content,
    });

    const { error } = await supabase.from('memory_notes').insert({
      content,
      embedding: embRes.data[0].embedding,
    });

    if (error) {
      console.error('Supabase insert note error:', error);
      return NextResponse.json({ error: 'Eroare la salvarea notiței.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      embeddingTokens: embRes.usage?.total_tokens ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Eroare internă.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}