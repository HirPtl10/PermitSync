import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = 'gemini-3.1-flash-lite';
const FALLBACK = (step: string, daysUsed: string, department: string) => `Currently at ${step}, ${daysUsed} SLA days used, with ${department}.`;

type Context = {
  step?: string;
  department?: string;
  daysUsed?: string;
  status?: string;
  clusteredInspection?: boolean;
};

function fallbackResponse(context: Context, code: string) {
  const answer = FALLBACK(
    context.step || 'the current approval step',
    context.daysUsed || 'an unknown number of',
    context.department || 'the responsible department'
  );
  console.info('[Permit Sync stuck explanation]', { path: 'fallback', code, model: MODEL_NAME });
  return Response.json({ answer, fallback: true, debug: { code, model: MODEL_NAME } });
}

function isCleanShortText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const answer = value.trim();
  if (!answer || answer.length > 600 || answer.includes('\n') || answer.includes('```') || /<think>|<\/think>|\{\s*["']/.test(answer)) return false;
  return answer.split(/[.!?]+/).filter(Boolean).length <= 3;
}

export async function POST(req: Request) {
  let context: Context;
  try {
    context = await req.json();
  } catch {
    return fallbackResponse({}, 'invalid_context');
  }

  if (!process.env.GEMINI_API_KEY) return fallbackResponse(context, 'missing_api_key');

  const prompt = [
    `Current step: ${context.step || 'unknown'}`,
    `Department: ${context.department || 'unknown'}`,
    `SLA days elapsed vs total: ${context.daysUsed || 'unknown'}`,
    `Application status: ${context.status || 'unknown'}`,
    `Part of a clustered inspection: ${context.clusteredInspection ? 'yes' : 'no'}`,
  ].join('\n');

  try {
    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(
      `Given this application's current status, explain in 2-3 plain sentences why this step may be taking time and what typically happens next. Do not invent information not present in the provided data. If it's genuinely on track, say so plainly.\n\nAPPLICATION DATA:\n${prompt}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const answer = result.response.text();
    if (!isCleanShortText(answer)) return fallbackResponse(context, 'invalid_gemini_text');
    console.info('[Permit Sync stuck explanation]', { path: 'gemini', code: 'gemini_success', model: MODEL_NAME });
    return Response.json({ answer: answer.trim(), fallback: false, debug: { code: 'gemini_success', model: MODEL_NAME } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Permit Sync stuck explanation]', { path: 'fallback', code: 'gemini_error', model: MODEL_NAME, error: message.slice(0, 240) });
    return fallbackResponse(context, 'gemini_error');
  }
}
