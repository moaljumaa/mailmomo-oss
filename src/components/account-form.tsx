"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { keys } from "@/lib/client/queries";
import { Button, Field, inputCls, Toggle } from "./ui";

type Form = {
  name: string; email: string; imapHost: string; imapPort: number; imapSecure: boolean; imapUser: string; imapPass: string;
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string; smtpPass: string; allowSelfSigned: boolean;
};
const empty: Form = { name: "", email: "", imapHost: "", imapPort: 993, imapSecure: true, imapUser: "", imapPass: "", smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpPass: "", allowSelfSigned: false };

function Row({ ok, err, label }: { ok: boolean; err: string | null; label: string }) {
  return (
    <div className={`flex items-start gap-2 text-[12.5px] ${ok ? "text-ok" : "text-danger"}`}>{ok ? <CheckCircle2 size={14} className="mt-px" /> : <XCircle size={14} className="mt-px" />}<span>{label}: {ok ? "connected" : err}</span></div>
  );
}

export function AccountForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ imap: string | null; smtp: string | null } | null>(null);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const qc = useQueryClient();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const onEmail = (email: string) => {
    setF((x) => {
      const domain = email.split("@")[1] ?? "";
      return { ...x, email, imapUser: x.imapUser === x.email || !x.imapUser ? email : x.imapUser, imapHost: x.imapHost || (domain ? `imap.${domain}` : ""), name: x.name || (email.split("@")[0] ?? "") };
    });
  };
  const payload = () => ({ ...f, name: f.name || f.email });
  const ready = f.email && f.imapHost && f.imapUser && f.imapPass && f.smtpHost && f.smtpUser && f.smtpPass;

  const test = async () => {
    setBusy("test"); setResult(null); setError("");
    try { setResult(await api("/accounts/test", { body: payload() })); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setError("");
    try {
      await api("/accounts", { body: payload() });
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: keys.folders });
      setF(empty);
      onDone?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="account-form">
      <div className={compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
        <Field label="Display name"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Work" data-testid="acc-name" /></Field>
        <Field label="Email address"><input className={inputCls} type="email" value={f.email} onChange={(e) => onEmail(e.target.value)} placeholder="you@yourdomain.com" data-testid="acc-email" autoComplete="off" /></Field>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-line p-3.5">
        <legend className="px-1 text-[12px] font-medium text-muted">Incoming · IMAP</legend>
        <div className="grid grid-cols-[1fr_96px_120px] gap-3">
          <Field label="Server"><input className={inputCls} value={f.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.yourdomain.com" data-testid="imap-host" /></Field>
          <Field label="Port"><input className={inputCls} type="number" value={f.imapPort} onChange={(e) => set("imapPort", Number(e.target.value))} data-testid="imap-port" /></Field>
          <Field label="Security">
            <select className={inputCls} value={f.imapSecure ? "ssl" : "starttls"} onChange={(e) => { const ssl = e.target.value === "ssl"; setF((x) => ({ ...x, imapSecure: ssl, imapPort: ssl ? 993 : 143 })); }}>
              <option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username"><input className={inputCls} value={f.imapUser} onChange={(e) => set("imapUser", e.target.value)} autoComplete="off" data-testid="imap-user" /></Field>
          <Field label="Password"><input className={inputCls} type="password" value={f.imapPass} onChange={(e) => set("imapPass", e.target.value)} autoComplete="new-password" data-testid="imap-pass" /></Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line p-3.5">
        <legend className="px-1 text-[12px] font-medium text-muted">Outgoing · SMTP</legend>
        <div className="grid grid-cols-[1fr_96px_120px] gap-3">
          <Field label="Server" hint="AWS SES: email-smtp.<region>.amazonaws.com"><input className={inputCls} value={f.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="email-smtp.eu-central-1.amazonaws.com" data-testid="smtp-host" /></Field>
          <Field label="Port"><input className={inputCls} type="number" value={f.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} data-testid="smtp-port" /></Field>
          <Field label="Security">
            <select className={inputCls} value={f.smtpSecure ? "ssl" : "starttls"} onChange={(e) => { const ssl = e.target.value === "ssl"; setF((x) => ({ ...x, smtpSecure: ssl, smtpPort: ssl ? 465 : 587 })); }}>
              <option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" hint="SES: your SMTP access key id"><input className={inputCls} value={f.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" data-testid="smtp-user" /></Field>
          <Field label="Password" hint="SES: SMTP password (not the IAM secret)"><input className={inputCls} type="password" value={f.smtpPass} onChange={(e) => set("smtpPass", e.target.value)} autoComplete="new-password" data-testid="smtp-pass" /></Field>
        </div>
      </fieldset>

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ChevronDown size={13} className={advanced ? "rotate-180" : ""} /> Advanced</button>
      {advanced && (
        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <div><div className="text-[13px] font-medium">Allow self-signed certificates / plain SMTP</div><div className="text-[12px] text-muted">Only for servers on a trusted network. Disables certificate checks.</div></div>
          <Toggle checked={f.allowSelfSigned} onChange={(v) => set("allowSelfSigned", v)} label="Allow self-signed" />
        </div>
      )}

      {result && <div className="space-y-1"><Row ok={!result.imap} err={result.imap} label="IMAP" /><Row ok={!result.smtp} err={result.smtp} label="SMTP" /></div>}
      {error && <div className="text-[12.5px] text-danger" role="alert" data-testid="account-error">{error}</div>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={!ready} loading={busy === "test"} onClick={() => void test()} data-testid="test-conn">Test connection</Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={busy === "save"} data-testid="save-account">Add account</Button>
      </div>
    </form>
  );
}
