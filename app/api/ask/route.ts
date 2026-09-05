import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs'; import path from 'path';

export async function POST(req: Request) {
  const { question = '' } = await req.json();
  const folder = path.join(process.cwd(), 'data/regulations');
  const words: string[] = question.toLowerCase().match(/[a-z]{3,}/g) || [];
  const docs = fs.readdirSync(folder)
    .map(file => ({ file, text: fs.readFileSync(path.join(folder, file), 'utf8') }))
    .filter(doc => !doc.text.includes('CURATOR_CONTENT_PENDING'));
  const scored = docs.map(d => ({ ...d, score: words.filter(w => d.text.toLowerCase().includes(w)).length })).sort((a,b) => b.score-a.score);
  const match = scored[0];
  if (!match || !match.score) return Response.json({ answer: 'The local ApprovalOS regulatory context does not cover that question. Please consult the relevant department guidance.', source: 'No matching local document', fallback: true, debug: { code: 'no_document_match', keyConfigured: Boolean(process.env.GEMINI_API_KEY) } });
  const source = match.file.replace('.md','').replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  if (!process.env.GEMINI_API_KEY) return Response.json({ answer: `I found ${source}. ${match.text.split('\n').slice(4).join(' ').trim()}`, source, fallback: true, debug: { code: 'missing_api_key', keyConfigured: false, model: modelName } });
  try {
    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(`Answer ONLY from this local document. Name the document you used. If it does not answer the question, say so plainly.\n\nDOCUMENT: ${match.text}\n\nQUESTION: ${question}`, { signal: AbortSignal.timeout(8000) });
    console.info('[ApprovalOS Gemini]', { route: 'ask', code: 'gemini_success', model: modelName });
    return Response.json({ answer: result.response.text(), source, debug: { code: 'gemini_success', keyConfigured: true, model: modelName } });
  } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error('[ApprovalOS Gemini]', { route: 'ask', code: 'gemini_error', model: modelName, error: message.slice(0, 240) }); return Response.json({ answer: `Live assistance is unavailable, but the local ${source} says: ${match.text.split('\n').slice(4).join(' ').trim()}`, source, fallback: true, debug: { code: 'gemini_error', keyConfigured: true, model: modelName, error: message.slice(0, 240) } }); }
}
