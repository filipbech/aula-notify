import { env } from './config.ts';
import type { Category } from './db.ts';

export const PROMPT_VERSION = 'v2';

const STALE_MS = 24 * 60 * 60 * 1000;

const SAFETY_NET_KEYWORDS = [
  'ring til mig',
  'ring mig op',
  'kontakt mig venligst',
  'kontakt mig snarest',
  'kontaktbog',
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
  familyChildren: string[];
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

function capStaleImmediate(result: ClassifyResult, receivedAt: Date): ClassifyResult {
  if (result.category !== 'immediate') return result;
  const ageMs = Date.now() - receivedAt.getTime();
  if (ageMs <= STALE_MS) return result;
  return {
    category: 'daily',
    reason: `downgraded from immediate: item is ${Math.round(ageMs / 3_600_000)}h old, any real-time deadline has passed. Original reason: ${result.reason}`,
  };
}

const SYSTEM_PROMPT = `You classify a single item from Aula (a Danish school communication platform) into exactly one urgency category for a parent's notification system. Respond with strict JSON only: {"category": "...", "reason": "..."}.

The family's own children are named in the request below — only they count as "this family's children". A thread can contain replies from unrelated parents about their OWN unrelated children (e.g. someone else's kid missing a bus) — that does NOT make the thread relevant or urgent to this family. Judge relevance and urgency from the thread's actual substantive topic (what it's officially about), not from an off-topic aside buried in it.

Categories:
- "immediate": same-day operational disruption (bus/class cancelled, early closure, weather closure) affecting this family's children; safety/serious incident (whole-school scope); a parent-teacher booking slot that's open and unbooked; a "Kontaktbog" (contact book) entry — these are always a teacher writing directly and privately about one specific child, treat as immediate regardless of tone. A deadline-based item only counts as immediate if it falls due before the next daily digest time given below — not simply "due tomorrow".
- "daily": relevant to this family's specific children, their classes, or their activities — including something organized BY one of this family's own children (e.g. a child hosting a get-together), even if informal. Not urgent.
- "weekly_only": whole-school or whole-class, not urgent. This includes greetings, farewells, or general updates written BY school staff (a teacher, "Team X", or the headmaster) even when they contain no action items — a genuine message from staff is still worth knowing, not noise.
- "ignore": genuinely irrelevant to this family — other classes'/grades' business not involving this family's children, an off-topic aside from an unrelated parent about their own child, expired sign-up threads, or pure platform noise (e.g. routine new-photo-in-album notifications).

When genuinely unsure between two tiers, prefer the more urgent one — a false positive (an extra email) is far cheaper than a missed item.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['immediate', 'daily', 'weekly_only', 'ignore'] },
    reason: { type: 'string' },
  },
  required: ['category', 'reason'],
};

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const matched = safetyNetMatch(input.text);
  if (matched) {
    return capStaleImmediate(
      { category: 'immediate', reason: `safety-net keyword match: "${matched}"` },
      input.receivedAt,
    );
  }

  if (!env.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const userPrompt = `This family's children: ${input.familyChildren.join(', ')}
Next daily digest fires at: ${input.nextDigestAt.toISOString()}
Item received at: ${input.receivedAt.toISOString()}
Source: ${input.source}
Child (if known from metadata): ${input.child ?? '(not tagged / whole school)'}
Text:
${input.text}`;

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`classify: Gemini API returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as Partial<ClassifyResult>;

  const category = parsed.category as Category | undefined;
  if (!category || !['immediate', 'daily', 'weekly_only', 'ignore'].includes(category)) {
    return { category: 'immediate', reason: `unparseable classifier output, defaulting safe: ${text}` };
  }

  return capStaleImmediate({ category, reason: parsed.reason ?? '(no reason given)' }, input.receivedAt);
}
