import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export const maxDuration = 30;

type Fields = { document_type: string; name: string; address: string; issue_date: string; expiry_date: string };
function usableFields(value: unknown): value is Fields {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return typeof fields.document_type === 'string' && fields.document_type.trim().length > 0
    && typeof fields.name === 'string' && fields.name.trim().length > 0
    && ['address', 'issue_date', 'expiry_date'].every(key => typeof fields[key] === 'string');
}

export async function POST(req: Request) {
  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  if (!process.env.GEMINI_API_KEY) return Response.json({ ai: false, debug: { code: 'missing_api_key', keyConfigured: false, model: modelName } });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 256 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return Response.json({ ai: false, debug: { code: 'structural_validation_failed', keyConfigured: true, model: modelName } });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
    const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const signatureMatches = (file.type === 'application/pdf' && isPdf) || (file.type === 'image/png' && isPng) || (file.type === 'image/jpeg' && isJpeg);
    if (!signatureMatches) return Response.json({ ai: false, debug: { code: 'structural_validation_failed', keyConfigured: true, model: modelName, reason: 'file_signature_mismatch' } });
    const data = Buffer.from(bytes).toString('base64');
    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: 'application/json', responseSchema: { type: SchemaType.OBJECT, properties: { document_type: { type: SchemaType.STRING }, name: { type: SchemaType.STRING }, address: { type: SchemaType.STRING }, issue_date: { type: SchemaType.STRING }, expiry_date: { type: SchemaType.STRING } }, required: ['document_type', 'name'] } } });
    const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'Extract these fields from the document as strict JSON only. Use an empty string when a field is not legible: document_type, name, address, issue_date, expiry_date.' }, { inlineData: { mimeType: file.type, data } }] }] }, { signal: AbortSignal.timeout(22000) });
    const raw = result.response.text().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const fields: unknown = JSON.parse(raw);
    if (!usableFields(fields)) { console.warn('[ApprovalOS Gemini]', { route: 'validate-document', code: 'gemini_invalid_fields', model: modelName, raw, fields }); return Response.json({ ai: false, debug: { code: 'gemini_invalid_fields', keyConfigured: true, model: modelName } }); }
    console.info('[ApprovalOS Gemini]', { route: 'validate-document', code: 'gemini_success', model: modelName });
    return Response.json({ ai: true, fields, debug: { code: 'gemini_success', keyConfigured: true, model: modelName } });
  } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error('[ApprovalOS Gemini]', { route: 'validate-document', code: 'gemini_error', model: modelName, error: message.slice(0, 240) }); return Response.json({ ai: false, debug: { code: 'gemini_error', keyConfigured: true, model: modelName, error: message.slice(0, 240) } }); }
}
