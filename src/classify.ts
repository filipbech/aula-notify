import { env } from './config.ts';
import type { Category } from './db.ts';

export const PROMPT_VERSION = 'v1';

const SAFETY_NET_KEYWORDS = [
  'ring til mig',
  'ring mig op',
  'kontakt mig venligst',
  'kontakt mig snarest',
  'lockdown',
  'nedlukning',
  'evakuering',
  'politiet',
  'kriminel',
  'hjemsendt',
  'hjemsendes',
];

export interface ClassifyInput {
  source: string;
  child: string | null;
  text: string;
  receivedAt: Date;
  nextDigestAt: Date;
}

export interface ClassifyResult {
  category: Category;
  reason: string;
}

function safetyNetMatch(text: string): string | null {
  const lower = text.toLowerCase();
  return SAFETY_NET_KEYWORDS.find((kw) => lower.includes(kw)) ?? null;
}

const SYSTEM_PROMPT = `You classify a single item from Aula (a Danish school communication platform) into exactly one urgency category for a parent's notification system. Respond with strict JSON only: {"category": "...", "reason": "..."}.

Categories:
- "immediate": same-day operational disruption (bus/class cancelled, early closure, weather closure); safety/serious incident (whole-school scope); a parent-teacher booking slot that's open and unbooked; a child-specific item needing a response or reaction (missed homework, misbehavior, "please call me"). Purely positive/neutral personal mentions do NOT qualify. A deadline-based item only counts as immediate if it falls due before the next daily digest time given below — not simply "due tomorrow".
- "daily": relevant to this family's specific children/classes, not urgent.
- "weekly_only": whole-school, not class-specific, not urgent, but worth knowing.
- "ignore": irrelevant to this family (other classes/grades, pure noise).

When genuinely unsure between two tiers, prefer the more urgent one — a false positive (an extra email) is far cheaper than a missed item.`;

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const matched = safetyNetMatch(input.text);
  if (matched) {
    return { category: 'immediate', reason: `safety-net keyword match: "${matched}"` };
  }

  if (!env.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const userPrompt = `Next daily digest fires at: ${input.nextDigestAt.toISOString()}
Item received at: ${input.receivedAt.toISOString()}
Source: ${input.source}
Child: ${input.child ?? '(not child-specific / whole school)'}
Text:
${input.text}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`classify: Anthropic API returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text) as Partial<ClassifyResult>;

  const category = parsed.category as Category | undefined;
  if (!category || !['immediate', 'daily', 'weekly_only', 'ignore'].includes(category)) {
    return { category: 'immediate', reason: `unparseable classifier output, defaulting safe: ${text}` };
  }

  return { category, reason: parsed.reason ?? '(no reason given)' };
}
