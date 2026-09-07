import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';

const exec = promisify(execFile);
export const maxDuration = 60;

type ParsedDate = { raw: string; parsed: Date };
type Fields = {
  document_type: string;
  name: string;
  address: string;
  issue_date: string;
  expiry_date: string;
  possession_date: string;
  valid: boolean;
  confidence: number;
  validity_path: string;
  reason: string;
};

const result = (code: string, extra: Record<string, unknown> = {}) => ({ route: 'validate-document', code, ...extra });

const DATE_PATTERN = /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/g;

function signature(type: string, b: Uint8Array) {
  const pdf = b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x);
  const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  return (type === 'application/pdf' && pdf) || (type === 'image/png' && png) || (type === 'image/jpeg' && jpg);
}

async function ocr(bytes: Uint8Array, ext: string) {
  const id = randomUUID();
  const input = join(tmpdir(), `${id}.${ext}`);
  const output = join(tmpdir(), id);
  try {
    await writeFile(input, bytes);
    await exec('tesseract', [input, output, '--psm', '6']);
    return await readFile(`${output}.txt`, 'utf8');
  } finally {
    await unlink(input).catch(() => {});
    await unlink(`${output}.txt`).catch(() => {});
  }
}

function field(text: string, labels: string[]) {
  const re = new RegExp(`(?:${labels.join('|')})\\s*[:\\-]?\\s*([^\\n]{2,120})`, 'i');
  return normalizeEntityPrefix(text.match(re)?.[1]?.trim() || '');
}

function normalizeEntityPrefix(value: string) {
  return value.replace(/^\s*(?:m\/s\.?|messrs\.?)\s*/i, '').trim();
}

function applicantName(text: string) {
  const labeled = field(text, ['name', 'applicant', 'company', 'licensed\\s+to']);
  if (labeled) return labeled;
  const entity = text.match(/(?:^|\n)\s*(?:m\/s\.?|messrs\.?)\s*([^\n]{2,120})/i)?.[1] || '';
  return normalizeEntityPrefix(entity);
}

function containsApplicantName(text: string, name: string) {
  const normalizedText = normalizeEntityPrefix(text).toLocaleLowerCase();
  return Boolean(name && normalizedText.includes(name.toLocaleLowerCase()));
}

function identifyingInfo(text: string, name: string, address: string, expectedApplicantName = '') {
  return Boolean(expectedApplicantName ? containsApplicantName(text, normalizeEntityPrefix(expectedApplicantName)) : (name && containsApplicantName(text, name)) || address);
}

function parseDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  const year = Number(iso?.[1] || dmy?.[3]);
  const month = Number(iso?.[2] || dmy?.[2]);
  const day = Number(iso?.[3] || dmy?.[1]);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function dates(text: string): ParsedDate[] {
  return [...text.matchAll(DATE_PATTERN)]
    .map(match => ({ raw: match[0], parsed: parseDate(match[0]) }))
    .filter((entry): entry is ParsedDate => Boolean(entry.parsed));
}

function labeledDate(text: string, labels: string[]) {
  const match = text.match(new RegExp(`(?:${labels.join('|')})[^\\d]{0,30}(${DATE_PATTERN.source})`, 'i'));
  if (!match) return null;
  const parsed = parseDate(match[1]);
  return parsed ? { raw: match[1], parsed } : null;
}

function nearbyDate(text: string, words: string[]) {
  const date = `(${DATE_PATTERN.source})`;
  const terms = `(?:${words.join('|')})`;
  const forward = text.match(new RegExp(`${terms}[\\s\\S]{0,80}?${date}`, 'i'));
  const reverse = forward ? null : text.match(new RegExp(`${date}[\\s\\S]{0,80}?${terms}`, 'i'));
  const raw = (forward || reverse)?.[0].match(DATE_PATTERN)?.[0];
  if (!raw) return null;
  const parsed = parseDate(raw);
  return parsed ? { raw, parsed } : null;
}

function addYears(date: Date, years: number) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function today() {
  const value = new Date();
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

type RuleContext = {
  text: string;
  expected: string;
  sector: string;
  state: string;
  applicantName: string;
  name: string;
  address: string;
  issue: ParsedDate | null;
  expiry: ParsedDate | null;
  possession: ParsedDate | null;
};
type RuleResult = { documentType: string; path: string; valid: boolean; reason: string };
type DocumentRule = { matches: (context: RuleContext) => boolean; validate: (context: RuleContext) => RuleResult };

const documentRules: Record<string, DocumentRule> = {
  pollution: {
    matches: ({ text }) => /consent\s+to\s+establish/i.test(text) && /(?:mpcb|gpcb)/i.test(text),
    validate: ({ text, name, address, applicantName, expiry }) => {
      const meaningful = identifyingInfo(text, name, address, applicantName);
      const futureIfPresent = !expiry || expiry.parsed >= today();
      return {
        documentType: 'Pollution consent',
        path: 'pollution-consent',
        valid: meaningful && futureIfPresent,
        reason: !meaningful ? 'Query raised — OCR did not find meaningful identifying information.' : !futureIfPresent ? `Query raised — validity date ${expiry?.raw} is before today.` : 'Pollution consent to establish matched MPCB/GPCB; no expiry date is required.',
      };
    },
  },
  fire: {
    matches: ({ text }) => /fire\s*(?:safety\s*)?(?:noc|certificate)|fire\s+prevention/i.test(text),
    validate: ({ text, expected, state, name, address, applicantName, issue, expiry }) => {
      const years = /maharashtra|mh\b/i.test(`${state} ${expected}`) ? 1 : 3;
      const meaningful = identifyingInfo(text, name, address, applicantName);
      const future = Boolean(expiry && expiry.parsed >= today());
      const withinCycle = !issue || !expiry || expiry.parsed <= addYears(issue.parsed, years);
      return {
        documentType: 'Fire NOC',
        path: years === 1 ? 'fire-noc-maharashtra-1-year' : 'fire-noc-gujarat-3-year',
        valid: meaningful && future && withinCycle,
        reason: !meaningful ? 'Query raised — OCR did not find meaningful identifying information.' : !expiry ? `Query raised — Fire NOC requires a real expiry date for the ${years}-year renewal cycle.` : !future ? `Query raised — expiry date ${expiry.raw} is before today.` : !withinCycle ? `Query raised — expiry exceeds the ${years}-year Fire NOC renewal window.` : `Fire NOC matched; expiry is future-dated within the ${years}-year renewal cycle.`,
      };
    },
  },
  midc: {
    matches: ({ text }) => /midc|cidco|industrial\s+(?:plot|land)|land\s+allotment/i.test(text),
    validate: ({ name, address, applicantName, possession, text }) => {
      const correctAuthority = /midc/i.test(text);
      const plotDetails = /plot|survey|industrial\s+area|hectare|sq\.?\s*(?:m|ft)/i.test(text);
      return {
        documentType: 'MIDC plot / land allotment',
        path: 'midc-possession-and-plot-details',
        valid: Boolean(correctAuthority && possession && plotDetails && identifyingInfo(text, name, address, applicantName)),
        reason: !correctAuthority ? 'Query raised — document is for the wrong authority or purpose; expected an MIDC industrial plot/land allotment document.' : !possession ? 'Query raised — MIDC allotment requires a possession/allotment date.' : !plotDetails ? 'Query raised — OCR did not find plot or survey details.' : !identifyingInfo(text, name, address, applicantName) ? 'Query raised — OCR did not find meaningful identifying information.' : 'MIDC allotment matched; possession date and plot details are present. No expiry date is required.',
      };
    },
  },
  labour: {
    matches: ({ text }) => /factories?\s+act|directorate\s+of\s+industrial\s+safety|inspector\s+of\s+factories|labou?r\s+department|shops?\s+and\s+establishments?/i.test(text),
    validate: ({ text, sector, name, address, applicantName, issue, expiry }) => {
      const manufacturing = /manufacturing|factory|chemical|food processing/i.test(sector);
      const future = Boolean(expiry && expiry.parsed >= today());
      const calendarYearEnd = !manufacturing || (expiry?.parsed.getUTCMonth() === 11 && expiry.parsed.getUTCDate() === 31);
      const withinTenYears = !issue || !expiry || expiry.parsed <= addYears(issue.parsed, 10);
      const path = manufacturing ? 'factory-licence-calendar-year' : 'shops-and-establishment-up-to-10-years';
      return {
        documentType: 'Labour licence',
        path,
        valid: Boolean(identifyingInfo(text, name, address, applicantName) && future && calendarYearEnd && withinTenYears),
        reason: !identifyingInfo(text, name, address, applicantName) ? 'Query raised — OCR did not find meaningful identifying information.' : !expiry ? `Query raised — ${manufacturing ? 'Factory licence' : 'Shops & Establishment registration'} requires a future validity/renewal date.` : !future ? `Query raised — validity date ${expiry.raw} is before today.` : !calendarYearEnd ? 'Query raised — Factory licence validity must end at calendar year-end.' : !withinTenYears ? 'Query raised — Shops & Establishment validity exceeds the 10-year maximum.' : `Labour licence matched the ${manufacturing ? 'Factory licence' : 'Shops & Establishment'} path; validity date is future-dated.`,
      };
    },
  },
};

function ruleKey(expected: string) {
  const value = expected.toLowerCase();
  if (value.includes('fire')) return 'fire';
  if (value.includes('midc') || value.includes('land allotment')) return 'midc';
  if (value.includes('labour') || value.includes('labor')) return 'labour';
  if (value.includes('pollution') || value.includes('mpcb') || value.includes('gpcb') || value.includes('consent')) return 'pollution';
  return '';
}

function classify(text: string, expected: string, sector: string, state = '', expectedApplicantName = ''): Fields {
  const key = ruleKey(expected);
  const rule = documentRules[key];
  const name = applicantName(text);
  const address = field(text, ['address', 'location', 'registered office']);
  const issue = nearbyDate(text, ['issue', 'issued', 'date of issue']);
  const expiry = nearbyDate(text, ['expiry', 'valid until', 'validity', 'renewal', 'renewed up to']);
  const possession = nearbyDate(text, ['possession', 'allotment']);
  const context = { text, expected, sector, state, applicantName: expectedApplicantName, name, address, issue, expiry, possession };
  const matches = Boolean(rule && rule.matches(context));
  const decision = rule && matches ? rule.validate(context) : { documentType: '', path: key || 'unknown', valid: false, reason: !text.trim() ? 'Query raised — OCR returned no readable text.' : !rule ? `Query raised — no validation rule exists for ${expected}.` : `Query raised — OCR does not contain evidence for ${expected}.` };
  return { document_type: decision.documentType, name, address, issue_date: issue?.raw || '', expiry_date: expiry?.raw || '', possession_date: possession?.raw || '', valid: decision.valid, confidence: decision.valid ? 90 : matches ? 35 : 10, validity_path: decision.path, reason: decision.reason };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const expected = String(form.get('expectedDocumentType') || 'the requested approval document');
    const sector = String(form.get('sector') || '');
    const state = String(form.get('state') || '');
    const applicantName = String(form.get('applicantName') || '');
    if (!(file instanceof File) || file.size < 256 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return Response.json({ ai: false, debug: result('structural_validation_failed') });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!signature(file.type, bytes)) return Response.json({ ai: false, debug: result('structural_validation_failed', { reason: 'file_signature_mismatch' }) });
    if (file.type === 'application/pdf') return Response.json({ ai: false, debug: result('pdf_ocr_unavailable', { reason: 'PDF text extraction is unavailable without a PDF conversion dependency; retaining structural approval instead of rejecting the document.' }) });
    let text: string;
    try {
      text = await ocr(bytes, file.type === 'image/png' ? 'png' : 'jpg');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ ai: false, debug: result('ocr_failed', { error: message.slice(0, 240) }) });
    }

    const fields = classify(text, expected, sector, state, applicantName);
    console.info('[ApprovalOS validation]', result(fields.valid ? 'deterministic_valid' : 'deterministic_query', { expected, sector, state, validityPath: fields.validity_path, confidence: fields.confidence, reason: fields.reason, rawOcr: text }));
    return Response.json({ ai: true, fields, debug: result(fields.valid ? 'deterministic_valid' : 'deterministic_query', { reason: fields.reason, confidence: fields.confidence, validityPath: fields.validity_path }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ApprovalOS validation]', result('route_error', { error: message.slice(0, 240) }));
    return Response.json({ ai: false, debug: result('route_error', { error: message.slice(0, 240) }) });
  }
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Fixture runner is available only in development.', { status: 404 });
  }
  const fixtureDir = join(process.cwd(), 'data', 'fixtures');
  const expectedByFile: Record<string, { type: string; expected: boolean; sector: string; state: string }> = {
    'fire-noc-gujarat.txt': { type: 'Fire NOC', expected: true, sector: 'Chemicals', state: 'Gujarat' },
    'fire-noc-maharashtra.txt': { type: 'Fire NOC', expected: true, sector: 'Manufacturing', state: 'Maharashtra' },
    'labour-licence-mh.txt': { type: 'Labour licence', expected: true, sector: 'Manufacturing', state: 'Maharashtra' },
    'midc-allotment.txt': { type: 'MIDC plot / land allotment', expected: true, sector: 'Manufacturing', state: 'Maharashtra' },
    'midc-cidco-negative.txt': { type: 'MIDC plot / land allotment', expected: false, sector: 'Manufacturing', state: 'Maharashtra' },
    'pollution-consent-gj.txt': { type: 'Pollution consent', expected: true, sector: 'Manufacturing', state: 'Gujarat' },
    'pollution-consent-mh.txt': { type: 'Pollution consent', expected: true, sector: 'Manufacturing', state: 'Maharashtra' },
    'random-garbled-negative.txt': { type: 'MIDC plot / land allotment', expected: false, sector: 'Manufacturing', state: 'Maharashtra' },
  };
  const files = (await readdir(fixtureDir)).filter(file => /\.(txt|md)$/i.test(file)).sort();
  const rows = await Promise.all(files.map(async filename => {
    const text = await readFile(join(fixtureDir, filename), 'utf8');
    const metadata = expectedByFile[filename] || { type: 'Unmapped fixture', expected: false, sector: '', state: '' };
    const fields = classify(text, metadata.type, metadata.sector, metadata.state);
    const datesFound = dates(text).map(date => `${date.raw} -> ${date.parsed.toISOString().slice(0, 10)}`).join('; ') || 'none';
    const identifyingInfo = fields.name || fields.address ? 'Y' : 'N';
    const pass = fields.valid === metadata.expected;
    return {
      filename,
      expectedDocumentType: metadata.type,
      ocrTextLength: text.length,
      dateFound: datesFound,
      identifyingInfo,
      actualResult: fields.valid ? 'Approved' : 'Query raised',
      reason: fields.reason,
      expectedResult: metadata.expected ? 'Approved' : 'Query raised',
      pass: pass ? 'PASS' : 'FAIL',
    };
  }));
  return Response.json({ rows });
}
