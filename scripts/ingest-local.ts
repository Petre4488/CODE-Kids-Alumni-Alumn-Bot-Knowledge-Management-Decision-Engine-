import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

// Citește recursiv toate fișierele .md din clean_docs/
function getMarkdownFiles(dir: string): { filePath: string; department: string | null }[] {
  const results: { filePath: string; department: string | null }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const parent = path.basename(path.dirname(fullPath));
      const department = parent === 'clean_docs' ? null : parent;
      results.push({ filePath: fullPath, department });
    }
  }
  return results;
}

// Taie Markdown-ul păstrând secțiunile (# / ## / ###) și un overlap mic
function chunkMarkdown(markdown: string, title: string, maxChars = 2200, overlap = 300): string[] {
  const sections = markdown.split(/(?=^#{1,3}\s)/m);
  const chunks: string[] = [];
  let currentHeading = 'General';

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^(#{1,3}\s.+)/);
    if (headingMatch) currentHeading = headingMatch[1].replace(/^#+\s*/, '').trim();

    if (trimmed.length <= maxChars) {
      chunks.push(`[Document: ${title} | Secțiune: ${currentHeading}]\n\n${trimmed}`);
    } else {
      let start = 0;
      while (start < trimmed.length) {
        let end = start + maxChars;
        if (end < trimmed.length) {
          const breakIdx = trimmed.lastIndexOf('\n', end);
          if (breakIdx > start + maxChars * 0.5) end = breakIdx;
        }
        const slice = trimmed.slice(start, end).trim();
        if (slice.length > 40) {
          chunks.push(`[Document: ${title} | Secțiune: ${currentHeading}]\n\n${slice}`);
        }
        start = end - overlap;
      }
    }
  }
  return chunks;
}

async function main() {
  const docsDir = path.join(process.cwd(), 'clean_docs');
  const files = getMarkdownFiles(docsDir);
  console.log(`📂 Am găsit ${files.length} fișiere Markdown.\n`);

  for (const { filePath, department } of files) {
    const title = path.basename(filePath, '.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) continue;

    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const { data: existing } = await supabase
      .from('documents')
      .select('id, content_hash')
      .eq('title', title)
      .maybeSingle();

    if (existing?.content_hash === hash) {
      console.log(`⏭️  Deja actualizat: ${title}`);
      continue;
    }

    if (existing) {
      await supabase.from('documents').delete().eq('id', existing.id);
    }

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .insert({ title, department, content_hash: hash })
      .select('id')
      .single();

    if (docErr || !doc) {
      console.error(`❌ Eroare doc ${title}:`, docErr);
      continue;
    }

    const chunks = chunkMarkdown(content, title);

    // Trimitem în batch-uri de câte 50 de chunks către Azure Embeddings
    const rows: {
      document_id: string;
      chunk_index: number;
      content: string;
      embedding: number[];
    }[] = [];
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50);
      const embRes = await azure.embeddings.create({
        model: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
        input: batch,
      });

      batch.forEach((chunkText, idx) => {
        rows.push({
          document_id: doc.id,
          chunk_index: i + idx,
          content: chunkText,
          embedding: embRes.data[idx].embedding,
        });
      });
    }

    const { error: chunkErr } = await supabase.from('document_chunks').insert(rows);
    if (chunkErr) {
      console.error(`❌ Eroare chunks ${title}:`, chunkErr);
    } else {
      console.log(`✅ Urcat: ${title} (${rows.length} chunks)`);
    }
  }

  console.log('\n🎉 Gata! Toate cele 21 de documente sunt în Supabase.');
}

main().catch(console.error);