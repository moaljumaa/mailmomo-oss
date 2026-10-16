# Mailmomo — Plan

A self-hosted, browser-based, keyboard-first email client for custom IMAP/SMTP
domains, with AI at the core. Superhuman speed, Notion calm.

## 1. Principles
1. **Local-first feel.** The browser never waits on IMAP. SQLite is the read
   model; IMAP is the source of truth, synced in the background. Writes are
   optimistic and go through a durable `pending_ops` queue (retry, offline-safe).
2. **One service layer.** `server/mail/service.ts` is the only place that reads
   or mutates mail. REST routes, the AI agent and the MCP server all call it —
   so "everything the UI can do, the assistant can do".
3. **AI is a first-class citizen, never a gate.** Triage (category, labels,
   priority, summary, needs-reply) runs on ingest in a throttled queue. Every
   feature degrades gracefully without an API key.
4. **Minimal surface.** One list, one reader, one compose window, one command
   palette. Everything else is a shortcut away.
5. **Secure by default.** Self-hosted but treated as internet-facing.

## 2. Stack
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind 4, CSS variables, light/dark |
| Auth | **better-auth** (email+password, first-run owner setup, signup closed after) |
| DB | SQLite (built-in node:sqlite, WAL) + FTS5 for search |
| Cache / bus | Redis *optional* (pub/sub across processes, rate limits). In-memory fallback |
| IMAP / SMTP | imapflow (IDLE, CONDSTORE), mailparser, nodemailer (works with SES SMTP) |
| Client data | TanStack Query (stale-while-revalidate, optimistic mutations, localStorage persist) + SSE push |
| Composer | Tiptap |
| AI | Anthropic SDK (model configurable via env) |
| Assistant API | MCP server (Streamable HTTP at `/api/mcp`, bearer tokens with scopes) |
| Tests | vitest (unit + integration against real Dovecot + local SMTP sink), Playwright e2e |

## 3. Data model (SQLite)
- `user/session/account/verification` — better-auth.
- `mail_accounts` — IMAP/SMTP config, secrets encrypted AES-256-GCM (key from `MASTER_KEY`).
- `folders` — per account: path, special-use, uidvalidity, uidnext, highestmodseq, counts, `sync_enabled`.
- `messages` — one row per (folder, uid): headers, thread_id, flags, snippet, text/html body,
  AI fields (`category`, `priority`, `summary`, `needs_reply`), `snoozed_until`, `done`.
- `messages_fts` — FTS5 external-content index (subject, from, to, body).
- `attachments` — metadata; bytes streamed from IMAP on demand.
- `labels`, `message_labels` — local labels (user-defined, AI-assignable).
- `rules` — conditions + actions JSON, created manually or from natural language.
- `drafts` — autosaved locally, with scheduled-send time.
- `pending_ops` — durable queue of IMAP mutations (flag, move, delete, append, send).
- `contacts` — harvested from mail for autocomplete / frequency ranking.
- `api_tokens` — MCP tokens (sha256 hashed, scopes: read | write | send).
- `settings` — per-user preferences (AI toggles, split inbox, signature, undo-send delay).

## 4. Sync engine
- One `AccountSync` per account, started from `instrumentation.ts` (Node runtime).
- Connect → LIST folders (special-use flags) → per folder: UIDVALIDITY check
  (reset on change) → fetch new UIDs > last (batched, newest first, initial
  window = last N days, then background backfill) → flag reconcile (CONDSTORE
  `CHANGEDSINCE` when available, else flags sweep of the recent window) →
  expunge detection (UID SEARCH diff).
- IDLE on INBOX for push; poll other folders on a timer; exponential reconnect backoff.
- Drain `pending_ops` first each cycle so local intent wins over stale server state.
- Threading: Message-ID / In-Reply-To / References graph, normalized-subject fallback.
- On ingest: rules → AI triage queue → SSE event to browsers.
- Sent mail: after SES SMTP success, APPEND to the IMAP Sent folder (SES does not store).

## 5. Search
FTS5 + operator parser: `from: to: subject: label: category: in: has:attachment
is:unread|starred|snoozed|done before: after:` + free text. AI "ask" converts
natural language ("invoices from AWS last month") into this syntax.

## 6. AI features
Triage on ingest · thread summary · smart reply drafts (3 tones) · compose from
a one-line prompt · rewrite/shorten/fix tone · natural-language search ·
natural-language → rule · inbox cleanup suggestions (bulk archive newsletters) ·
agent in the command bar with tool use over the same service layer as MCP.

## 7. MCP tools
`list_accounts, list_folders, list_messages, search_messages, get_message,
get_thread, send_email, create_draft, reply, forward, mark_read, star, archive,
move, trash, label/unlabel, list_labels, create_label, list_rules, create_rule,
summarize_thread, triage_message, draft_reply, snooze, inbox_stats`.
Write/send gated by token scope. Sending additionally requires scope `send`.

## 8. Security
- better-auth sessions (httpOnly, sameSite), closed signup, login rate limiting.
- Every API route requires a session or a scoped bearer token; all queries
  scoped by `user_id` (no cross-tenant reads even if multi-user).
- Credentials encrypted at rest; never serialized to the client.
- HTML mail: server-side sanitize + rendered in a sandboxed iframe with strict
  CSP; remote images blocked by default (tracking-pixel protection) with
  per-sender "always load".
- Security headers (CSP, frame-ancestors, nosniff, referrer-policy).
- MCP tokens hashed, shown once, revocable, scoped, last-used tracked.
- Input validated with zod at every boundary; FTS queries parameterized.

## 9. UX
- Split inbox tabs by AI category (Important · Other · News · Receipts · Social … configurable).
- Superhuman-style shortcuts: `j/k` move, `enter` open, `e` done/archive, `#` trash,
  `r` reply, `a` reply all, `f` forward, `c` compose, `s` star, `u` unread,
  `h` snooze, `l` label, `/` search, `⌘K` palette, `g i / g s / g d` navigate, `z` undo.
- Compose as a bottom-right window; ⌘Enter send; undo-send toast; send later.
- Command palette doubles as the AI prompt ("archive all newsletters older than a week").
- Triage "Inbox Zero" empty state; unified inbox across all accounts.

## 10. Phases
1. Foundation: scaffold, DB, auth, crypto, config.
2. Mail core: IMAP sync, SMTP send, threading, FTS, ops queue, service layer.
3. API + SSE.
4. AI layer + rules.
5. MCP server.
6. UI: shell, list, reader, compose, palette, settings.
7. Tests: unit, Dovecot integration, MCP, Playwright e2e.
8. Docs, hardening, deploy (Dockerfile + compose with Redis).
