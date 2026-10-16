"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, KeyRound, LogOut, Palette, Plus, Shield, SlidersHorizontal, Sparkles, Tag, Trash2, User, Workflow, Play } from "lucide-react";
import { api } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth";
import { keys, useAccounts, useLabels, useRules, useSettings } from "@/lib/client/queries";
import { useUI } from "@/lib/client/store";
import { CATEGORIES, type AccountDTO, type RuleDTO, type Settings } from "@/lib/types";
import { Button, cx, Field, inputCls, Spinner, Toggle } from "./ui";
import { AccountForm } from "./account-form";
import { ThemeSync } from "./theme-sync";
import { clearPersistedCache } from "./providers";
import { formatDistanceToNowStrict } from "date-fns";

const SECTIONS = [
  { id: "accounts", label: "Accounts", icon: User },
  { id: "general", label: "Inbox & AI", icon: SlidersHorizontal },
  { id: "ai", label: "AI model & usage", icon: Sparkles },
  { id: "rules", label: "Rules", icon: Workflow },
  { id: "labels", label: "Labels", icon: Tag },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "api", label: "API & MCP", icon: KeyRound },
  { id: "security", label: "Security", icon: Shield },
] as const;

export function SettingsApp() {
  const params = useParams<{ section?: string[] }>();
  const section = params.section?.[0] ?? "accounts";
  return (
    <div className="flex h-dvh w-full bg-bg" data-testid="settings">
      <ThemeSync />
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface p-2">
        <Link href="/mail/inbox" className="mb-2 flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg"><ArrowLeft size={14} /> Back to mail</Link>
        <div className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint">Settings</div>
        {SECTIONS.map((s) => (
          <Link key={s.id} href={`/settings/${s.id}`} className={cx("flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13.5px]", section === s.id ? "bg-active font-medium" : "text-muted hover:bg-hover hover:text-fg")}>
            <s.icon size={15} className="text-faint" /> {s.label}
          </Link>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-8 py-10 anim-fade">
          {section === "accounts" && <AccountsSection />}
          {section === "general" && <GeneralSection />}
          {section === "ai" && <AiSection />}
          {section === "rules" && <RulesSection />}
          {section === "labels" && <LabelsSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "api" && <ApiSection />}
          {section === "security" && <SecuritySection />}
        </div>
      </main>
    </div>
  );
}

const H = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-6"><h1 className="text-[20px] font-semibold tracking-[-0.01em]">{children}</h1>{sub && <p className="mt-1 text-[13.5px] text-muted">{sub}</p>}</div>
);
const Row = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-6 border-b border-line py-3.5"><div className="min-w-0"><div className="text-[13.5px] font-medium">{title}</div>{hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}</div><div className="shrink-0">{children}</div></div>
);

/* ------------------------------------------------ accounts ------------------------------------------------ */
function AccountRow({ a }: { a: AccountDTO }) {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(a.name);
  const [sig, setSig] = useState(a.signature);
  const [pass, setPass] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/accounts/${a.id}`, { method: "PATCH", body: { name, signature: sig, ...(pass ? { imapPass: pass, smtpPass: pass } : {}) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.accounts }); setEdit(false); toast({ text: "Account saved" }); },
    onError: (e) => toast({ text: (e as Error).message, kind: "error" }),
  });
  const del = useMutation({
    mutationFn: () => api(`/accounts/${a.id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries(); toast({ text: "Account removed" }); },
  });
  return (
    <div className="rounded-lg border border-line p-3.5" data-testid="account-row">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{a.name}</div>
          <div className="truncate text-[12.5px] text-muted">{a.email} · {a.imapHost} · {a.smtpHost}</div>
        </div>
        <span className={cx("text-[12px]", a.syncState === "error" ? "text-danger" : "text-faint")}>
          {a.syncState === "syncing" ? "Syncing…" : a.syncState === "error" ? "Error" : a.lastSyncedAt ? `Synced ${formatDistanceToNowStrict(new Date(a.lastSyncedAt * 1000), { addSuffix: true })}` : "Waiting"}
        </span>
        <Button size="sm" variant="outline" onClick={() => setEdit((v) => !v)}>{edit ? "Close" : "Edit"}</Button>
      </div>
      {a.syncError && <div className="mt-2 rounded-md bg-hover px-2.5 py-1.5 text-[12px] text-danger">{a.syncError}</div>}
      {edit && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <Field label="Display name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Signature" hint="Added to new messages and replies."><textarea className="min-h-20 w-full rounded-md border border-line bg-bg p-2.5 text-[13px] focus:border-accent" value={sig} onChange={(e) => setSig(e.target.value)} /></Field>
          <Field label="New password" hint="Leave empty to keep the current IMAP/SMTP passwords. Setting it replaces both."><input className={inputCls} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
          <div className="flex justify-between">
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button variant="ghost" className="text-danger" onClick={() => { if (confirm(`Remove ${a.email}? Mail stays on your server; the local cache is deleted.`)) del.mutate(); }}><Trash2 size={13} /> Remove</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountsSection() {
  const accounts = useAccounts();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <H sub="Connect any IMAP mailbox and SMTP relay (e.g. your own server + AWS SES).">Accounts</H>
      <div className="space-y-2.5">
        {accounts.isLoading && <Spinner />}
        {accounts.data?.map((a) => <AccountRow key={a.id} a={a} />)}
      </div>
      <div className="mt-5">
        {adding ? <div className="rounded-lg border border-line p-4"><AccountForm onDone={() => setAdding(false)} compact /></div> : <Button variant="outline" onClick={() => setAdding(true)} data-testid="add-account"><Plus size={14} /> Add account</Button>}
      </div>
    </>
  );
}

/* ------------------------------------------------ general ------------------------------------------------ */
function useSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Partial<Settings>) => api("/settings", { method: "PATCH", body: p }),
    onMutate: async (p) => { await qc.cancelQueries({ queryKey: keys.settings }); const prev = qc.getQueryData(keys.settings); qc.setQueryData(keys.settings, (o: Settings | undefined) => (o ? { ...o, ...p } : o)); return { prev }; },
    onError: (_e, _p, c) => qc.setQueryData(keys.settings, c?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

function GeneralSection() {
  const { data: s } = useSettings();
  const accounts = useAccounts();
  const save = useSave();
  if (!s) return <Spinner />;
  const tabs = new Set(s.splitTabs);
  return (
    <>
      <H sub="How your inbox is organized, and what the AI is allowed to do.">Inbox & AI</H>
      <Row title="AI features" hint={s._ai ? "Summaries, smart replies, natural-language search and the assistant." : "Not configured: set LLM_API_KEY on the server."}><Toggle checked={s.aiEnabled} onChange={(v) => save.mutate({ aiEnabled: v })} label="AI features" /></Row>
      <Row title="Auto-triage new mail" hint="Categorize, label and summarize incoming messages (last 14 days only)."><Toggle checked={s.autoTriage} onChange={(v) => save.mutate({ autoTriage: v })} label="Auto-triage" /></Row>
      <Row title="Undo send" hint="Delay before a message is actually sent."><select className={cx(inputCls, "w-28")} value={s.undoSendSeconds} onChange={(e) => save.mutate({ undoSendSeconds: Number(e.target.value) })}>{[0, 5, 10, 20, 30].map((n) => <option key={n} value={n}>{n ? `${n} seconds` : "Off"}</option>)}</select></Row>
      <Row title="Default sending account"><select className={cx(inputCls, "w-56")} value={s.defaultAccountId ?? ""} onChange={(e) => save.mutate({ defaultAccountId: e.target.value || null })}><option value="">First account</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select></Row>
      <Row title="Load remote images" hint="Off protects you from tracking pixels. You can still allow trusted senders."><Toggle checked={s.loadRemoteImages} onChange={(v) => save.mutate({ loadRemoteImages: v })} label="Load remote images" /></Row>
      <div className="py-3.5">
        <div className="text-[13.5px] font-medium">Inbox tabs</div>
        <div className="mb-2 mt-0.5 text-[12.5px] text-muted">Which AI categories appear as tabs above your inbox.</div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => { const next = new Set(tabs); if (next.has(c)) next.delete(c); else next.add(c); save.mutate({ splitTabs: CATEGORIES.filter((x) => next.has(x)) }); }} className={cx("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] capitalize", tabs.has(c) ? "border-accent bg-accent-soft" : "border-line text-muted")}>
              {tabs.has(c) && <Check size={12} />}{c}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------ AI model & usage ------------------------------------------------ */
type ModelInfo = { id: string; lab: string; inputPerM: number | null; outputPerM: number | null; context: number | null; geo: string | null; retention: boolean | null; training: boolean | null };
type Usage = { days: number; byModel: { model: string; requests: number; input: number; output: number; cost: number }[]; byDay: { day: string; requests: number; cost: number }[] };
const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const price = (n: number | null) => (n == null ? "–" : n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0));

function AiSection() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");
  const [days, setDays] = useState(30);
  const models = useQuery({ queryKey: ["ai-models"], queryFn: () => api<{ active: string; models: ModelInfo[] }>("/ai/models"), retry: false, staleTime: 60_000 });
  const usage = useQuery({ queryKey: ["ai-usage", days], queryFn: () => api<Usage>(`/ai/usage?days=${days}`) });
  const pick = useMutation({
    mutationFn: (model: string) => api("/ai/model", { method: "PATCH", body: { model } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ai-models"] }); toast({ text: "Model updated" }); },
    onError: (e) => toast({ text: (e as Error).message, kind: "error" }),
  });
  const all = models.data?.models ?? [];
  const safe = all.filter((m) => m.training === false);
  const shown = safe.filter((m) => m.id.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const total = usage.data?.byModel.reduce((a, r) => ({ cost: a.cost + r.cost, requests: a.requests + r.requests, tokens: a.tokens + r.input + r.output }), { cost: 0, requests: 0, tokens: 0 });
  return (
    <>
      <H sub="Pick the model that powers every AI feature, and see what it costs.">AI model & usage</H>
      <div className="mb-2 text-[13.5px] font-medium">Model</div>
      {models.isLoading && <Spinner />}
      {models.error && <div className="rounded-md bg-hover px-2.5 py-1.5 text-[12.5px] text-danger">{(models.error as Error).message}</div>}
      {models.data && (
        <>
          <div className="mb-2 text-[12.5px] text-muted">Active: <code className="rounded bg-active px-1">{models.data.active}</code>. Only models whose provider does not train on your data are listed ({safe.length} of {all.length}).</div>
          <input className={cx(inputCls, "mb-2 w-full")} placeholder="Filter models…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="model-filter" />
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line" data-testid="model-list">
            {shown.map((m) => (
              <button key={m.id} onClick={() => pick.mutate(m.id)} className={cx("flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover", m.id === models.data.active && "bg-accent-soft")}>
                <span className="min-w-0 flex-1 truncate text-[13px]">{m.id}</span>
                <span className="shrink-0 text-[11.5px] text-faint">{m.retention === false ? "no retention · " : ""}${price(m.inputPerM)} / ${price(m.outputPerM)} per 1M</span>
                {m.id === models.data.active && <Check size={13} />}
              </button>
            ))}
            {!shown.length && <div className="px-3 py-4 text-[13px] text-muted">No matching models.</div>}
          </div>
        </>
      )}

      <div className="mb-2 mt-8 flex items-center justify-between">
        <div className="text-[13.5px] font-medium">Usage & cost</div>
        <select className={cx(inputCls, "w-32")} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
      </div>
      {usage.isLoading && <Spinner />}
      {total && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[["Cost", usd(total.cost)], ["Requests", String(total.requests)], ["Tokens", total.tokens.toLocaleString()]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line p-3"><div className="text-[18px] font-semibold">{v}</div><div className="text-[12px] text-muted">{k}</div></div>
          ))}
        </div>
      )}
      {usage.data && (
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-line text-left text-[12px] text-faint"><th className="py-1.5 font-medium">Model</th><th className="font-medium">Requests</th><th className="font-medium">Tokens in / out</th><th className="text-right font-medium">Cost</th></tr></thead>
          <tbody>
            {usage.data.byModel.map((r) => <tr key={r.model} className="border-b border-line"><td className="max-w-[240px] truncate py-1.5">{r.model}</td><td>{r.requests}</td><td>{r.input.toLocaleString()} / {r.output.toLocaleString()}</td><td className="text-right">{usd(r.cost)}</td></tr>)}
            {!usage.data.byModel.length && <tr><td colSpan={4} className="py-4 text-muted">No AI requests yet.</td></tr>}
          </tbody>
        </table>
      )}
      <p className="mt-6 text-[12.5px] text-muted">
        Costs are recorded by this server per request. For account-wide spend see the <a className="underline" href="https://app.requesty.ai" target="_blank" rel="noreferrer">Requesty dashboard</a>.
        Requesty stores prompts and outputs for 30 days by default: turn <b>logging off</b> on this server&apos;s API key there (or ask Requesty for org-wide zero data retention) so nothing is kept.
      </p>
    </>
  );
}

/* ------------------------------------------------ appearance ------------------------------------------------ */
function AppearanceSection() {
  const { data: s } = useSettings();
  const save = useSave();
  if (!s) return <Spinner />;
  return (
    <>
      <H>Appearance</H>
      <Row title="Theme"><div className="flex gap-1">{(["system", "light", "dark"] as const).map((t) => <Button key={t} size="sm" variant={s.theme === t ? "primary" : "outline"} className="capitalize" onClick={() => save.mutate({ theme: t })}>{t}</Button>)}</div></Row>
      <Row title="Density" hint="Compact hides previews for more rows."><div className="flex gap-1">{(["comfortable", "compact"] as const).map((t) => <Button key={t} size="sm" variant={s.density === t ? "primary" : "outline"} className="capitalize" onClick={() => save.mutate({ density: t })}>{t}</Button>)}</div></Row>
    </>
  );
}

/* ------------------------------------------------ labels ------------------------------------------------ */
function LabelsSection() {
  const labels = useLabels();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({ mutationFn: () => api("/labels", { body: { name } }), onSuccess: () => { setName(""); void qc.invalidateQueries({ queryKey: keys.labels }); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/labels/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: keys.labels }) });
  const recolor = useMutation({ mutationFn: (v: { id: string; color: string }) => api(`/labels/${v.id}`, { method: "PATCH", body: { color: v.color } }), onSuccess: () => qc.invalidateQueries({ queryKey: keys.labels }) });
  return (
    <>
      <H sub="Labels are shared across accounts. The AI adds them automatically when auto-triage is on.">Labels</H>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="New label…" aria-label="New label" />
        <Button type="submit" variant="outline">Add</Button>
      </form>
      {labels.data?.map((l) => (
        <div key={l.id} className="flex items-center gap-3 border-b border-line py-2.5">
          <input type="color" value={l.color.length === 7 ? l.color : "#94a3b8"} onChange={(e) => recolor.mutate({ id: l.id, color: e.target.value })} aria-label={`Color for ${l.name}`} className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0" />
          <span className="flex-1 text-[13.5px]">{l.name}</span>
          <span className="text-[12px] text-faint">{l.count} conversation{l.count === 1 ? "" : "s"}</span>
          <button aria-label={`Delete ${l.name}`} className="text-faint hover:text-danger" onClick={() => del.mutate(l.id)}><Trash2 size={14} /></button>
        </div>
      ))}
      {labels.data?.length === 0 && <p className="text-[13px] text-muted">No labels yet.</p>}
    </>
  );
}

/* ------------------------------------------------ rules ------------------------------------------------ */
const FIELD_LABEL: Record<string, string> = { from: "From", to: "To", subject: "Subject", body: "Body", category: "Category", has_attachment: "Has attachment", list: "Is a mailing list", account: "Account" };
function describeRule(r: Pick<RuleDTO, "conditions" | "actions" | "matchAll">) {
  const c = r.conditions.map((x) => (x.field === "has_attachment" || x.field === "list" ? FIELD_LABEL[x.field] : `${FIELD_LABEL[x.field]} ${x.op === "equals" ? "is" : x.op === "not_contains" ? "doesn't contain" : "contains"} “${x.value}”`)).join(r.matchAll ? " and " : " or ");
  const a = r.actions.map((x) => (x.type === "label" ? `label “${x.value}”` : x.type === "move" ? `move to ${x.value}` : x.type === "set_category" ? `set category ${x.value}` : x.type.replace("_", " "))).join(", ");
  return `When ${c} → ${a}`;
}

function RulesSection() {
  const rules = useRules();
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Omit<RuleDTO, "id" | "hits"> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.rules });
  const gen = useMutation({ mutationFn: () => api<Omit<RuleDTO, "id" | "hits">>("/ai/rule", { body: { text } }), onSuccess: (r) => setDraft(r), onError: (e) => toast({ text: (e as Error).message, kind: "error" }) });
  const create = useMutation({ mutationFn: (r: unknown) => api("/rules", { body: r }), onSuccess: () => { setDraft(null); setText(""); void refresh(); toast({ text: "Rule created" }); }, onError: (e) => toast({ text: (e as Error).message, kind: "error" }) });
  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => api(`/rules/${v.id}`, { method: "PATCH", body: { enabled: v.enabled } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/rules/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const run = useMutation({ mutationFn: (id: string) => api<{ matched: number }>(`/rules/${id}/run`, { body: {} }), onSuccess: (r) => { toast({ text: `Applied to ${r.matched} message${r.matched === 1 ? "" : "s"}` }); void qc.invalidateQueries(); } });
  const [manual, setManual] = useState({ field: "from", value: "", action: "archive", label: "" });

  return (
    <>
      <H sub="Rules run on every new message that lands in your inbox.">Rules & automation</H>
      <div className="mb-6 rounded-lg border border-line p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><Sparkles size={13} className="text-ai" /> Describe a rule</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) gen.mutate(); }}>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} disabled={!settings.data?._ai} placeholder={settings.data?._ai ? "e.g. archive anything from github.com and label it Dev" : "Set LLM_API_KEY to describe rules in plain English"} data-testid="rule-nl" />
          <Button type="submit" variant="outline" loading={gen.isPending} disabled={!settings.data?._ai}>Create</Button>
        </form>
        {draft && (
          <div className="mt-3 rounded-md bg-ai-soft p-3 text-[13px]" data-testid="rule-preview">
            <div className="mb-2">{describeRule(draft)}</div>
            <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => create.mutate(draft)}>Save rule</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button></div>
          </div>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] text-muted">Or build one manually</summary>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: `${FIELD_LABEL[manual.field]} ${manual.value}`, conditions: [{ field: manual.field, op: "contains", value: manual.value }], actions: [manual.action === "label" ? { type: "label", value: manual.label } : { type: manual.action }] }); }}>
            <Field label="If"><select className={cx(inputCls, "w-28")} value={manual.field} onChange={(e) => setManual({ ...manual, field: e.target.value })}>{["from", "to", "subject", "body"].map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}</select></Field>
            <Field label="contains"><input className={cx(inputCls, "w-44")} required value={manual.value} onChange={(e) => setManual({ ...manual, value: e.target.value })} data-testid="rule-value" /></Field>
            <Field label="then"><select className={cx(inputCls, "w-32")} value={manual.action} onChange={(e) => setManual({ ...manual, action: e.target.value })}>{[["archive", "Archive"], ["mark_read", "Mark read"], ["star", "Star"], ["trash", "Trash"], ["label", "Add label"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            {manual.action === "label" && <Field label="label"><input className={cx(inputCls, "w-32")} required value={manual.label} onChange={(e) => setManual({ ...manual, label: e.target.value })} /></Field>}
            <Button type="submit" variant="outline" data-testid="rule-add">Add</Button>
          </form>
        </details>
      </div>
      {rules.data?.map((r) => (
        <div key={r.id} className="flex items-center gap-3 border-b border-line py-3" data-testid="rule-row">
          <Toggle checked={r.enabled} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} label={`Enable ${r.name}`} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{r.name}</div><div className="truncate text-[12.5px] text-muted">{describeRule(r)}</div></div>
          <span className="text-[12px] text-faint">{r.hits} hit{r.hits === 1 ? "" : "s"}</span>
          <button title="Apply to existing inbox" aria-label="Apply now" className="text-faint hover:text-fg" onClick={() => run.mutate(r.id)}><Play size={14} /></button>
          <button aria-label="Delete rule" className="text-faint hover:text-danger" onClick={() => del.mutate(r.id)}><Trash2 size={14} /></button>
        </div>
      ))}
      {rules.data?.length === 0 && <p className="text-[13px] text-muted">No rules yet.</p>}
    </>
  );
}

/* ------------------------------------------------ API / MCP ------------------------------------------------ */
type Tok = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: number | null; createdAt: number };
function ApiSection() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<Tok[]>("/tokens") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<{ actor: string; action: string; detail: string | null; at: number }[]>("/audit") });
  const [name, setName] = useState("My AI assistant");
  const [scope, setScope] = useState<"read" | "write" | "send">("write");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("/tokens", { body: { name, scopes: [scope] } }),
    onSuccess: (r) => { setFresh(r.token); void qc.invalidateQueries({ queryKey: ["tokens"] }); },
    onError: (e) => toast({ text: (e as Error).message, kind: "error" }),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/tokens/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }) });
  const cmd = `claude mcp add --transport http mailmomo ${origin}/api/mcp --header "Authorization: Bearer ${fresh ?? "<token>"}"`;
  return (
    <>
      <H sub="Let your own AI assistant (Claude, etc.) read, organize and draft mail through the Model Context Protocol.">API & MCP</H>
      <div className="mb-6 rounded-lg border border-line p-4">
        <div className="mb-3 text-[13.5px] font-medium">Create a token</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name"><input className={cx(inputCls, "w-52")} value={name} onChange={(e) => setName(e.target.value)} data-testid="token-name" /></Field>
          <Field label="Access">
            <select className={cx(inputCls, "w-64")} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} data-testid="token-scope">
              <option value="read">Read only — search & read</option>
              <option value="write">Organize — also label, archive, draft</option>
              <option value="send">Full — also send email</option>
            </select>
          </Field>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} data-testid="token-create">Create token</Button>
        </div>
        {fresh && (
          <div className="mt-4 rounded-md bg-hover p-3" data-testid="token-fresh">
            <div className="mb-1.5 text-[12.5px] font-medium">Copy it now — it won’t be shown again.</div>
            <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 text-[12px]" data-testid="token-value">{fresh}</code><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={13} /> : <Copy size={13} />} Copy</Button></div>
            <div className="mt-3 text-[12.5px] text-muted">Add it to Claude Code:</div>
            <pre className="mt-1 overflow-x-auto rounded bg-bg p-2 text-[11.5px]">{cmd}</pre>
          </div>
        )}
        {!fresh && <p className="mt-3 text-[12.5px] text-muted">Endpoint: <code className="rounded bg-hover px-1">{origin}/api/mcp</code> (Streamable HTTP, <code className="rounded bg-hover px-1">Authorization: Bearer mm_…</code>)</p>}
      </div>
      <div className="mb-8">
        {tokens.data?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line py-2.5" data-testid="token-row">
            <KeyRound size={14} className="text-faint" />
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{t.name}</div><div className="text-[12px] text-muted">{t.prefix}… · {t.scopes.includes("send") ? "full access" : t.scopes.includes("write") ? "organize" : "read only"} · {t.lastUsedAt ? `used ${formatDistanceToNowStrict(new Date(t.lastUsedAt * 1000), { addSuffix: true })}` : "never used"}</div></div>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke.mutate(t.id)}>Revoke</Button>
          </div>
        ))}
      </div>
      <h2 className="mb-2 text-[14px] font-semibold">Activity</h2>
      <p className="mb-2 text-[12.5px] text-muted">Everything an assistant or the AI changed (reads are not logged).</p>
      <div className="space-y-px text-[12.5px]">
        {audit.data?.slice(0, 20).map((a, i) => <div key={i} className="flex gap-3 border-b border-line py-1.5"><span className="w-28 shrink-0 truncate text-faint">{formatDistanceToNowStrict(new Date(a.at * 1000), { addSuffix: true })}</span><span className="w-32 shrink-0 truncate text-muted">{a.actor}</span><span className="font-medium">{a.action}</span><span className="min-w-0 flex-1 truncate text-faint">{a.detail}</span></div>)}
        {audit.data?.length === 0 && <p className="text-muted">Nothing yet.</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------ security ------------------------------------------------ */
function SecuritySection() {
  const router = useRouter();
  const toast = useUI((s) => s.toast);
  const session = authClient.useSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: async () => (await authClient.listSessions()).data ?? [] });
  const qc = useQueryClient();
  const change = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = await authClient.changePassword({ currentPassword: cur, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (r.error) toast({ text: r.error.message || "Could not change password", kind: "error" });
    else { toast({ text: "Password changed" }); setCur(""); setNext(""); }
  };
  const signOut = async () => { clearPersistedCache(); qc.clear(); await authClient.signOut(); router.push("/login"); router.refresh(); };
  return (
    <>
      <H sub={session.data?.user.email}>Security</H>
      <form onSubmit={change} className="mb-8 max-w-sm space-y-3">
        <div className="text-[13.5px] font-medium">Change password</div>
        <Field label="Current password"><input className={inputCls} type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label="New password" hint="At least 10 characters. Other sessions will be signed out."><input className={inputCls} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} /></Field>
        <Button type="submit" variant="outline" loading={busy}>Update password</Button>
      </form>
      <div className="mb-8">
        <div className="mb-2 text-[13.5px] font-medium">Active sessions</div>
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line py-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-muted">{s.userAgent?.slice(0, 70) || "Unknown device"} · {s.ipAddress || ""}</span>
            {s.token === session.data?.session.token ? <span className="text-ok">This device</span> : <button className="text-danger hover:underline" onClick={async () => { await authClient.revokeSession({ token: s.token }); void sessions.refetch(); }}>Revoke</button>}
          </div>
        ))}
      </div>
      <Button variant="outline" onClick={() => void signOut()} data-testid="signout"><LogOut size={14} /> Sign out</Button>
    </>
  );
}
