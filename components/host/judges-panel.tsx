"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { Judge } from "@/lib/tournament/rules";
import { CopyButton, EmptyNote, iconButtonClass, LinkBox, panelClass } from "./bits";

// The Judges tab: each judge gets a QuizoTab login tied to this tournament. The host sends them the
// judge link with their email and password, and they sign in from any phone.

export type JudgeFields = { name: string; email: string; password: string };
type Created = { name: string; email: string; password: string | null };

type Props = {
  judges: Judge[];
  judgeUrl: string;
  onAdd: (fields: JudgeFields) => Promise<{ error: string } | { existing: boolean }>;
  onRemove: (judge: Judge) => Promise<string | null>;
};

function makePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function JudgesPanel({ judges, judgeUrl, onAdd, onRemove }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The details to hand to the judge, shown once
  const [created, setCreated] = useState<Created | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return setError("Enter the judge's name and email.");
    if (judges.some((judge) => judge.email.toLowerCase() === email.trim().toLowerCase())) return setError("This judge is already on the list.");
    const chosen = password || makePassword();
    setError("");
    setSaving(true);
    const result = await onAdd({ name: name.trim(), email: email.trim(), password: chosen });
    setSaving(false);
    if ("error" in result) return setError(result.error);
    setCreated({ name: name.trim(), email: email.trim().toLowerCase(), password: result.existing ? null : chosen });
    setName("");
    setEmail("");
    setPassword("");
  }

  async function remove(judge: Judge) {
    if (!confirm(`Remove ${judge.name}? They won't be able to judge this tournament anymore.`)) return;
    const failed = await onRemove(judge);
    if (failed) setError(failed);
  }

  const message =
    created &&
    [`Hi ${created.name}, you're a judge for this tournament on QuizoTab.`, `Open: ${judgeUrl}`, `Email: ${created.email}`, created.password ? `Password: ${created.password}` : "Password: the one you already use for QuizoTab judging"].join("\n");

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Each judge gets their own login for this tournament. Send them the judge link with their email and password, and they can sign in from any phone. You can also open the judge portal yourself.</p>

      <LinkBox label="Judge link" href={judgeUrl} />

      <form onSubmit={add} className={cn(panelClass, "flex flex-col gap-4 p-4")}>
        {error && <Alert type="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Judge name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Neema K." autoComplete="off" />
          <Input label="Judge email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="judge@example.com" autoComplete="off" />
        </div>
        <Input label="Password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} placeholder="Leave empty to make one up" hint="At least 8 characters. Left empty, a strong one is made for you and shown once." autoComplete="new-password" />
        <Button type="submit" size="sm" className="self-start" disabled={saving}>
          {saving ? "Creating login…" : "Create judge login"}
        </Button>
      </form>

      {created && message && (
        <div className="border border-good/50 bg-good/10 p-4">
          <p className="font-semibold text-good">Login ready for {created.name}</p>
          <p className="mt-1 mb-3 text-sm text-muted">{created.password ? "Send these details now. The password is only shown this once." : "This judge already had a login, so their password stays the same."}</p>
          <pre className="mb-3 border border-line bg-studio p-3 font-mono text-sm whitespace-pre-wrap text-text">{message}</pre>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={message} label="Copy message" variant="neon" />
            <Button variant="line" size="sm" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {judges.length === 0 && <EmptyNote>No judges yet. You can enter scores yourself in the Scores tab, or add judges here.</EmptyNote>}

      <ul className="flex flex-col gap-2">
        {judges.map((judge) => (
          <li key={judge.id} className={cn(panelClass, "flex items-center justify-between gap-3 p-4")}>
            <div className="min-w-0">
              <p className="font-semibold text-white">{judge.name}</p>
              <p className="truncate text-sm text-muted">
                {judge.email || "No email recorded"} · {judge.hasLogin ? "can sign in" : "name only, no login"}
              </p>
            </div>
            <button type="button" onClick={() => remove(judge)} title="Remove judge" aria-label={`Remove ${judge.name}`} className={cn(iconButtonClass, "hover:text-bad")}>
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
