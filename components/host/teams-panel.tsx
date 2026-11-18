"use client";

import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { Team } from "@/lib/tournament/rules";
import { EmptyNote, fieldClass, iconButtonClass, panelClass } from "./bits";

// The teams list. The host can add, rename and remove teams; judges see the list only.

export type TeamFields = { name: string; category: string; members: string };
type Props = {
  teams: Team[];
  // Each resolves with an error message, or null when done. Leave them out for a read-only list.
  onAdd?: (fields: TeamFields) => Promise<string | null>;
  onUpdate?: (id: string, fields: TeamFields) => Promise<string | null>;
  onDelete?: (id: string) => Promise<string | null>;
};

const blank = (): TeamFields => ({ name: "", category: "", members: "" });

export function TeamsPanel({ teams, onAdd, onUpdate, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TeamFields>(blank());
  const [error, setError] = useState("");
  const editable = Boolean(onUpdate && onDelete);
  const q = query.toLowerCase();
  const filtered = teams.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));

  function startEditing(team: Team) {
    setEditingId(team.id);
    setDraft({ name: team.name, category: team.category, members: team.members });
    setError("");
  }

  async function saveEdit() {
    if (!editingId || !onUpdate) return;
    if (!draft.name.trim()) return setError("Enter the team's name.");
    const failed = await onUpdate(editingId, draft);
    if (failed) return setError(failed);
    setEditingId(null);
    setError("");
  }

  async function remove(team: Team) {
    if (!onDelete || !confirm(`Remove ${team.name}? Its scores are removed too.`)) return;
    const failed = await onDelete(team.id);
    if (failed) setError(failed);
  }

  return (
    <div className="flex flex-col gap-5">
      {onAdd && <AddTeamForm onAdd={onAdd} label="Add team" />}

      {error && <Alert type="error">{error}</Alert>}

      <div className="relative">
        <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search teams" aria-label="Search teams" className={cn(fieldClass, "pl-10")} />
      </div>

      {filtered.length === 0 && <EmptyNote>{teams.length === 0 ? "No teams yet." : "No teams match."}</EmptyNote>}

      <ul className="flex flex-col gap-2">
        {filtered.map((team) => (
          <li key={team.id} className={cn(panelClass, "flex items-start justify-between gap-3 p-4")}>
            {editingId === team.id ? (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Team name" aria-label="Team name" maxLength={120} className={cn(fieldClass, "h-10")} />
                <div className="grid grid-cols-2 gap-2">
                  <input value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} placeholder="Category" aria-label="Category" maxLength={80} className={cn(fieldClass, "h-10")} />
                  <input value={draft.members} onChange={(e) => setDraft((d) => ({ ...d, members: e.target.value }))} placeholder="Members" aria-label="Members" maxLength={500} className={cn(fieldClass, "h-10")} />
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="font-semibold text-white">{team.name}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {team.category || "No category"} · {team.members || "—"} members · registered by {team.registeredBy || "the host"}
                </p>
              </div>
            )}
            {editable && (
              <div className="flex shrink-0">
                {editingId === team.id ? (
                  <>
                    <button type="button" onClick={saveEdit} title="Save" aria-label={`Save ${team.name}`} className={cn(iconButtonClass, "text-good")}>
                      <Check aria-hidden="true" className="size-4" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} title="Cancel" aria-label="Cancel editing" className={iconButtonClass}>
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => startEditing(team)} title="Edit" aria-label={`Edit ${team.name}`} className={iconButtonClass}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </button>
                    <button type="button" onClick={() => remove(team)} title="Remove" aria-label={`Remove ${team.name}`} className={cn(iconButtonClass, "hover:text-bad")}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Used by the host (Teams tab) and by judges (Register team tab)
export function AddTeamForm({ onAdd, label }: { onAdd: (fields: TeamFields) => Promise<string | null>; label: string }) {
  const [fields, setFields] = useState<TeamFields>(blank());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.name.trim()) return setError("Enter the team's name.");
    setError("");
    setSaving(true);
    const failed = await onAdd({ name: fields.name.trim(), category: fields.category.trim(), members: fields.members.trim() });
    setSaving(false);
    if (failed) return setError(failed);
    setFields(blank());
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <form onSubmit={submit} className={cn(panelClass, "flex flex-col gap-4 p-4")}>
      {error && <Alert type="error">{error}</Alert>}
      {saved && <Alert type="success">Team registered.</Alert>}
      <Input label="Team name" value={fields.name} maxLength={120} onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. The Quiz Wizards" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Category" value={fields.category} maxLength={80} onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Ages 10–12" hint="Optional: an age group or school" />
        <Input label="Members" value={fields.members} maxLength={500} onChange={(e) => setFields((f) => ({ ...f, members: e.target.value }))} placeholder="e.g. 4" hint="Optional" />
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={saving}>
        {saving ? "Saving…" : label}
      </Button>
    </form>
  );
}
