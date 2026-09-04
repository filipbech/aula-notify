import { env } from './config.ts';
import type { Category } from './db.ts';

export const PROMPT_VERSION = 'v5';

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

export interface FamilyChild {
  name: string;
  class?: string;
}

export interface ClassifyInput {
  source: string;
  child: string | null;
  familyChildren: FamilyChild[];
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
- "daily": relevant to this family's specific children, their classes, or their activities — including social/informal events specific to this family's children or their classmates (a birthday party, a get-together), whether organized BY one of this family's own children, BY another family, or BY the class/school. Not urgent.
- "weekly_only": whole-school, OR any genuine message written BY school staff (a named teacher, a class "Team", SFO staff, or the headmaster) — even when it's about a different class than this family's own, and even when it's purely a greeting/farewell with no action items. Staff-authored content is always at least weekly_only, never "ignore" — it's legitimate school communication, just not urgent or actionable.
- "ignore": reserved for things with no genuine school-staff origin and no connection to this family's children or their classmates — an off-topic aside from an unrelated parent about their own unrelated child, private/informal parent-to-parent chatter not involving this family's children/classmates or school staff, a thread explicitly noted by a participant as expired/spam, or pure platform-generated noise (e.g. routine new-photo-in-album notifications).

If a thread mixes a genuine staff-authored message with off-topic replies from other parents about their own unrelated children, classify based on the staff content (always at least weekly_only) — don't let an off-topic reply drag the whole thread down to "ignore".

Never classify something "weekly_only" if it names a SPECIFIC deadline within roughly the next 1-3 days (e.g. "tomorrow", "by Friday" when today is Wednesday) — a weekly digest would report it too late to be useful, regardless of whose class it concerns. Use "daily" (or "immediate", per the criteria above) instead. This is narrow: a general term/year calendar, a routine policy update, or an open-ended request for interest/volunteers with no imminent closing date is NOT a near-term deadline and stays weekly_only if it's otherwise non-urgent staff content — don't let "mentions a future date" or "eventually needs a reply" alone push something out of weekly_only.

Some of this family's children have a known class (given below); others don't. If an item would otherwise be "immediate" but is confidently and *exclusively* about a specific class/grade that is NOT any of this family's known classes, downgrade it to "daily" instead — still worth a mention, just not an interruption for a class that isn't theirs. Only apply this downgrade using a child whose class is actually known below; never use it to dismiss something involving a child whose class is unlisted (you can't rule them out).

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

  const childrenDesc = input.familyChildren
    .map((c) => (c.class ? `${c.name} (class ${c.class})` : `${c.name} (class unknown)`))
    .join(', ');

  const userPrompt = `This family's children: ${childrenDesc}
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
