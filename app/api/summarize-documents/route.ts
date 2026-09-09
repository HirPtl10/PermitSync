import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = 'gemini-3-flash-preview';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

type DocumentInput = { documentName: string; text: string };

function fallbackResponse(reason: string, message?: string) {
  return Response.json({
    summaries: [],
    fallback: true,
    error: message || 'AI document review is temporarily unavailable. Your application was submitted successfully; please try the review again later.',
    debug: { code: reason, model: MODEL_NAME },
  });
}

function promptFor(context: string, documentText: string) {
  return `Review these already OCR-checked government documents together for one application.
Application context:
${context}

${documentText}

Return ONLY a JSON array. Include one object per document with exactly these keys:
{"documentName":"the supplied document name","summary":"one or two plain sentences describing what the document appears to establish and any important date or authority found"}
Do not invent facts. Use only the supplied OCR text.`;
}

function parseSummaries(raw: string, documents: DocumentInput[]) {
  const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  if (!Array.isArray(parsed) || parsed.length !== documents.length || parsed.some(item => typeof item?.documentName !== 'string' || typeof item?.summary !== 'string' || item.summary.length > 500)) return null;
  return parsed;
}

export async function POST(request: Request) {
  let body: { application?: Record<string, string>; documents?: DocumentInput[] };
  try {
    body = await request.json();
  } catch {
    return fallbackResponse('invalid_request');
  }

  const documents = (body.documents || []).filter(document => document.documentName && document.text).slice(0, 12);
  if (!documents.length) return fallbackResponse('no_extracted_documents');

  const context = Object.entries(body.application || {}).map(([key, value]) => `${key}: ${value}`).join('\n');
  const documentText = documents.map((document, index) => `DOCUMENT ${index + 1}: ${document.documentName}\n${document.text}`).join('\n\n');
  const prompt = promptFor(context, documentText);

  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = ai.getGenerativeModel({ model: MODEL_NAME, generationConfig: { temperature: 0 } });
      const result = await model.generateContent(prompt, { signal: AbortSignal.timeout(40000) });
      const parsed = parseSummaries(result.response.text(), documents);
      if (parsed) return Response.json({ summaries: parsed, fallback: false, debug: { code: 'gemini_success', model: MODEL_NAME } });
      console.warn('[Permit Sync document summary]', { code: 'invalid_gemini_summary' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Permit Sync document summary]', { code: 'gemini_error', error: message.slice(0, 240) });
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    console.info('[Permit Sync document summary]', { code: 'gemini_fallback_to_openrouter', model: OPENROUTER_MODEL, documentCount: documents.length });
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://permit-sync.vercel.app', 'X-Title': 'Permit Sync' },
        body: JSON.stringify({ model: OPENROUTER_MODEL, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(40000),
      });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      const payload = await response.json();
      const raw = payload.choices?.[0]?.message?.content || '';
      const parsed = parseSummaries(raw, documents);
      if (parsed) return Response.json({ summaries: parsed, fallback: true, debug: { code: 'openrouter_success', model: OPENROUTER_MODEL } });
      throw new Error(`invalid OpenRouter summary: ${String(raw).slice(0, 180)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Permit Sync document summary]', { code: 'openrouter_error', error: message.slice(0, 240) });
    }
  }

  return fallbackResponse('ai_unavailable');
}
