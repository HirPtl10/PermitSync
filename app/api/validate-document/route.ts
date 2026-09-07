import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
export const maxDuration = 60;
type Fields = { document_type: string; name: string; address: string; issue_date: string; expiry_date: string; valid: boolean; confidence: number };
const result = (code: string, extra: Record<string, unknown> = {}) => ({ route: 'validate-document', code, ...extra });
const groups: Record<string, RegExp> = {
  'MPCB consent': /mpcb|pollution\s+control|consent\s+to\s+(establish|operate)/i,
  'Fire NOC': /fire\s*(safety)?\s*(noc|certificate)|fire\s+prevention/i,
  'MIDC plot / land allotment': /midc|industrial\s+(plot|land)|land\s+allotment/i,
  'Labour licence': /labou?r\s+(licen[cs]e|department)|shops?\s+and\s+establishments?/i
};
function signature(type: string, b: Uint8Array) { const pdf = b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45; const png = [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x); const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255; return (type === 'application/pdf' && pdf) || (type === 'image/png' && png) || (type === 'image/jpeg' && jpg); }
async function ocr(bytes: Uint8Array, ext: string) { const id = randomUUID(); const input = join(tmpdir(), `${id}.${ext}`); const output = join(tmpdir(), id); try { await writeFile(input, bytes); await exec('tesseract', [input, output, '--psm', '6']); return await readFile(`${output}.txt`, 'utf8'); } finally { await unlink(input).catch(() => {}); await unlink(`${output}.txt`).catch(() => {}); } }
function field(text: string, labels: string[]) { const re = new RegExp(`(?:${labels.join('|')})\\s*[:\-]?\\s*([^\\n]{2,120})`, 'i'); return text.match(re)?.[1]?.trim() || ''; }
const DATE_PATTERN = /\b(?:\d{1,2}[\\/]\d{1,2}[\\/]\d{4}|\d{1,2}-\d{1,2}-\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/g;
function parseDate(value: string) { const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); const dmy = value.match(/^(\d{1,2})[\\/-](\d{1,2})[\\/-](\d{4})$/); const year = Number(iso?.[1] || dmy?.[3]); const month = Number(iso?.[2] || dmy?.[2]); const day = Number(iso?.[3] || dmy?.[1]); if (!year || !month || !day) return null; const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null; }
function classify(text: string, expected: string): Fields & { reason: string } { const type = Object.entries(groups).find(([, re]) => re.test(text))?.[0] || ''; const name = field(text, ['name', 'applicant', 'company']); const address = field(text, ['address', 'location', 'registered office']); const issue_date = field(text, ['issue date', 'issued', 'date of issue']); const dates = [...text.matchAll(DATE_PATTERN)].map(match => ({ raw: match[0], parsed: parseDate(match[0]) })).filter((entry): entry is { raw: string; parsed: Date } => Boolean(entry.parsed)); const latest = dates.sort((a, b) => b.parsed.getTime() - a.parsed.getTime())[0]; const expiryMatch = latest?.raw || ''; const expiry = latest?.parsed || null; const matches = type && (groups[expected] ? groups[expected].test(text) : type.toLowerCase().includes(expected.toLowerCase().split(' ')[0])); const meaningful = Boolean(name || address); const today = new Date(); today.setHours(0, 0, 0, 0); const future = Boolean(expiry && expiry >= today); const valid = Boolean(matches && meaningful && expiry && future); const confidence = valid ? 90 : type ? 35 : 10; const reason = !text.trim() ? 'Query raised — OCR returned no readable text.' : !matches ? `Query raised — OCR does not contain evidence for ${expected}.` : !meaningful ? 'Query raised — OCR did not find meaningful identifying information.' : !expiryMatch ? 'Query raised — could not read expiry date.' : !future ? `Query raised — latest date ${expiryMatch} is before today.` : `Deterministic OCR matched ${expected}; latest date ${expiryMatch} is valid.`; return { document_type: type, name, address, issue_date, expiry_date: expiryMatch, valid, confidence, reason }; }

export async function POST(req: Request) {
  try {
    const form = await req.formData(); const file = form.get('file'); const expected = String(form.get('expectedDocumentType') || 'the requested approval document');
    if (!(file instanceof File) || file.size < 256 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return Response.json({ ai: false, debug: result('structural_validation_failed') });
    const bytes = new Uint8Array(await file.arrayBuffer()); if (!signature(file.type, bytes)) return Response.json({ ai: false, debug: result('structural_validation_failed', { reason: 'file_signature_mismatch' }) });
    if (file.type === 'application/pdf') return Response.json({ ai: true, fields: { document_type: '', name: '', address: '', issue_date: '', expiry_date: '', valid: false, confidence: 0 }, debug: result('pdf_ocr_unavailable', { reason: 'PDF text extraction is unavailable without a PDF conversion dependency.' }) });
    let text: string; try { text = await ocr(bytes, file.type === 'image/png' ? 'png' : 'jpg'); } catch (error) { const message = error instanceof Error ? error.message : String(error); return Response.json({ ai: false, debug: result('ocr_failed', { error: message.slice(0, 240) }) }); }
    const fields = classify(text, expected); const matchedDate = fields.expiry_date || 'no match'; const parsedDate = parseDate(fields.expiry_date); const today = new Date(); today.setHours(0, 0, 0, 0); console.info('[ApprovalOS validation]', result(fields.valid ? 'deterministic_valid' : 'deterministic_query', { expected, confidence: fields.confidence, reason: fields.reason, rawOcr: text, matchedExpiry: matchedDate, parsedExpiry: parsedDate?.toISOString() || 'no parsed date', comparison: parsedDate ? (parsedDate >= today ? 'future' : 'past') : 'not comparable' }));
    return Response.json({ ai: true, fields, debug: result(fields.valid ? 'deterministic_valid' : 'deterministic_query', { reason: fields.reason, confidence: fields.confidence }) });
  } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error('[ApprovalOS validation]', result('route_error', { error: message.slice(0, 240) })); return Response.json({ ai: false, debug: result('route_error', { error: message.slice(0, 240) }) }); }
}
