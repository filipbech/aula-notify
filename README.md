# aula-notify

A personal notification & digest system for [Aula](https://aula.dk), the Danish
school communication platform. Aula's own notifications are noisy and easy to
miss — this polls messages, posts, and notifications, classifies each one by
urgency with an LLM, and emails at the right cadence: immediately for things
that actually need same-day attention, once a day for everything else, and
Fridays it folds in a whole-school weekly roundup too.

## How it works

Every 20 minutes, `poll.ts`:

1. Fetches new threads, posts, and notifications via [`aula-mcp`](https://github.com/Casperjuel/aula-mcp)
   (used as a plain TypeScript dependency, not run as an MCP server).
2. Skips anything already seen — deduplication is by checking a local
   append-only SQLite log, not Aula's own unread flag (which doesn't survive
   someone reading a message on their phone before the poller sees it).
3. Classifies each new item into one of four tiers (below) using Gemini
   Flash-Lite, with a small set of deterministic rules that bypass the LLM
   entirely for known-important patterns.
4. Logs the decision and, if it's urgent enough, sends an email right away.

`digest.ts` runs once a day (17:00 Europe/Copenhagen) and queries the log
fresh each time — no fragile "pending send" state, just a watermark
timestamp. On Fridays it also folds in the week's whole-school items and a
recap, in one email instead of two.

### Urgency taxonomy

| Category | Meaning | Delivery |
|---|---|---|
| `immediate` | Same-day disruption, safety incident, a `Kontaktbog` (teacher contact-book) entry, or anything with a deadline in the next 1-3 days | Sent right away |
| `daily` | Relevant to this family's children/classes/activities, not urgent | Daily digest |
| `weekly_only` | Whole-school, or genuine staff-authored content (even about a different class) | Friday digest |
| `ignore` | No connection to this family and no school-staff origin — off-topic asides, private chatter, platform noise | Not sent, but listed at the bottom of the Friday digest for a while so misclassifications are easy to catch |

A few deterministic rules sit in front of the LLM call:

- **Safety-net keywords** (`kontaktbog`, "ring til mig", lockdown/evacuation
  terms, etc.) force `immediate` regardless of what the classifier would say.
- **Staleness cap**: nothing older than 24h can be `immediate` — any real
  deadline has already passed, so it gets downgraded to `daily` instead of
  firing a pointless alert.
- **Cross-grade downgrade**: an otherwise-`immediate` item that's confidently
  about a class that isn't one of this family's known classes gets downgraded
  to `daily` (still worth a mention, not an interruption).

## Architecture

| File | Responsibility |
|---|---|
| `src/aula.ts` | Token store + `AulaClient` bootstrap. Also runs the `getProfilesByLogin` → `getProfileContext` handshake Aula requires before any other read succeeds. |
| `src/classify.ts` | The urgency classifier: safety-net keywords, staleness/cross-grade downgrades, and the Gemini Flash-Lite call. `PROMPT_VERSION` is bumped on every meaningful prompt change. |
| `src/db.ts` | SQLite (via `bun:sqlite`): the classification log, digest watermarks, and a `booking_alerts_sent` table reserved for future booking-slot alerts. |
| `src/poll.ts` | The 20-minute loop: fetch → dedupe → classify → log → immediate email. |
| `src/digest.ts` | Daily (+ Friday weekly) digest, computed fresh from the log. |
| `src/email.ts` / `src/email-template.ts` | Resend sending (or a local dry-run log file) and the HTML email template. |
| `src/digest-time.ts` | The digest-to-digest day boundary (17:00 Europe/Copenhagen), used to decide whether a deadline counts as "before the next digest". |
| `aula-mcp/` | Git submodule, pinned to a specific commit of upstream `Casperjuel/aula-mcp` for reproducibility. |

## Setup

Requires [Bun](https://bun.sh) ≥1.3 and [pnpm](https://pnpm.io) ≥10.

```bash
git clone --recurse-submodules https://github.com/filipbech/aula-notify.git
cd aula-notify
(cd aula-mcp && pnpm install)
pnpm install
cp config.example.json config.json   # fill in your own guardianId/children/notifyEmail
```

Environment variables (`.env`, not committed):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Classifier — [free tier via Google AI Studio](https://aistudio.google.com/apikey), no card needed at this volume |
| `RESEND_API_KEY` | Email sending |
| `FROM_EMAIL` | Sender address, e.g. `Aula Notify <notify@yourdomain>` — defaults to Resend's shared sandbox sender if unset |
| `DRY_RUN` | `false` to send real emails; anything else (or unset) logs to `dry-run-emails.log` instead |
| `SHOW_IGNORED_IN_WEEKLY` | `false` to drop the ignored-items review section once you trust the classifier |
| `SKIP_EMPTY_DIGESTS` | `true` to stop sending a digest when there's nothing new |
| `HEALTHCHECK_URL` | Optional dead-man's-switch ping (e.g. healthchecks.io) on every successful poll |

`aula-mcp` itself needs a one-time interactive login:

```bash
cd aula-mcp && pnpm aula login
```

**Important**: MitID login is blocked by Aula/STIL's bot protection from
datacenter/cloud IPs — this has to run from a home network. Token *refresh*
afterwards works fine from a cloud VM (confirmed empirically over several
days), since it talks directly to `login.aula.dk` and never touches the
login broker. Log in at home, then `pnpm aula tokens export ./bundle` and
copy `tokens.json` + `.key` to wherever this actually runs.

## Deployment

Runs on a small always-on VM via cron:

```
*/20 * * * *  poll.ts
0 15 * * *    digest.ts daily   # 17:00 Europe/Copenhagen; Fridays also fold in the weekly section
```

## Known limitations

- Doesn't clear Aula's unread badge yet — mark-as-read (`messaging.setLastReadMessage`)
  exists in `aula-mcp` but isn't wired in.
- No booking-slot (parent-teacher conference) alerts yet — `aula-mcp` has no
  booking support at all; this needs reverse-engineering from Aula's own web
  client.
- `getNotifications()` returns an untyped envelope upstream; extraction is
  best-effort and logs a warning if the shape doesn't match what's expected.
