"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Sharing } from "@/lib/tournament/rules";
import { CopyButton, Field, LinkBox, panelClass, Textarea } from "./bits";

// The Share tab: the audience link, the guest code visitors enter, and what the host shares

type Props = {
  sharing: Sharing;
  code: string;
  audienceUrl: string;
  onSave: (sharing: Sharing) => Promise<string | null>;
  onNewCode: () => Promise<string | null>;
};

const Icon = ({ on }: { on: boolean }) => (on ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-live" /> : <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />);

export function SharePanel({ sharing: saved, code, audienceUrl, onSave, onNewCode }: Props) {
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (changes: Partial<Sharing>) => setDraft((d) => ({ ...d, ...changes }));

  async function save() {
    setError("");
    setNotice("");
    setSaving(true);
    const failed = await onSave(draft);
    setSaving(false);
    if (failed) return setError(failed);
    setNotice(draft.listed ? "Saved. Your tournament is listed on QuizoTab." : "Saved. Your tournament is not listed.");
  }

  async function newCode() {
    if (!confirm("Create a new code? Guests using the old code will need the new one.")) return;
    setError("");
    const failed = await onNewCode();
    if (failed) return setError(failed);
    setNotice("New guest code created. The old one no longer works.");
  }

  const toggle = (on: boolean) => cn("flex cursor-pointer items-start gap-3 border p-4 text-left transition-colors", on ? "border-live bg-live/10" : "border-line bg-panel hover:border-text");

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type="success">{notice}</Alert>}

      <LinkBox label="Audience link" href={audienceUrl} hint="Anyone with this link can watch the standings and the released draw. No sign-in needed." />

      <div className={cn(panelClass, "p-6 text-center")}>
        <p className="text-sm text-muted">Guest code</p>
        <p className="wide my-2 font-display text-5xl font-extrabold tracking-[0.25em] text-amber">{code}</p>
        <p className="mx-auto mb-4 max-w-[48ch] text-sm text-muted">
          {draft.listed ? "This code is shown next to your tournament in QuizoTab's public list, so guests can copy it and watch." : "Share this code with people you want to watch. Once you list the tournament, it's also shown publicly."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <CopyButton text={code} label="Copy code" variant="neon" />
          <Button variant="line" size="sm" onClick={newCode}>
            New code
          </Button>
        </div>
      </div>

      <button type="button" onClick={() => update({ listed: !draft.listed })} aria-pressed={draft.listed} className={toggle(draft.listed)}>
        <Icon on={draft.listed} />
        <span>
          <span className="block font-semibold text-white">List this tournament on QuizoTab</span>
          <span className="mt-1 block text-sm text-muted">Anyone visiting QuizoTab can see its name, dates, description and guest code, and watch what you share below.</span>
        </span>
      </button>

      <Field label="What guests can watch">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["showStandings", "Live standings", "Rankings that update as scores are approved"],
              ["showDraw", "Draw and rounds", "Who plays whom, in which room, each round"],
            ] as const
          ).map(([field, title, text]) => (
            <button key={field} type="button" onClick={() => update({ [field]: !draft[field] })} aria-pressed={draft[field]} className={toggle(draft[field])}>
              <Icon on={draft[field]} />
              <span>
                <span className="block font-semibold text-white">{title}</span>
                <span className="mt-1 block text-sm text-muted">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Textarea label="Short description" value={draft.about} maxLength={280} rows={3} onChange={(e) => update({ about: e.target.value })} placeholder="e.g. Six schools from the Lake Zone compete over three days. Finals on Saturday." hint={`Shown in the public list. ${280 - draft.about.length} characters left.`} />

      <Button onClick={save} disabled={saving} className="self-start">
        {saving ? "Saving…" : "Save sharing settings"}
      </Button>
    </div>
  );
}
