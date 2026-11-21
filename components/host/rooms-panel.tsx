"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/quiz/api";
import type { RoomCommand, RoomSetup } from "@/lib/tournament/room-management";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Judge, Room } from "@/lib/tournament/rules";
import { EmptyNote, Field, fieldClass, iconButtonClass, panelClass, Select } from "./bits";

// The Rooms tab: each room gets a host chair judge and panelists; a judge sits in one room only

export function RoomsPanel({ endpoint, judges, onSaved }: { endpoint: string; judges: Judge[]; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<RoomSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    api<RoomSetup>(endpoint).then(result => {
      if (!active) return;
      if (result.ok) setSetup(result);
      else setError(result.error);
    });
    return () => { active = false; };
  }, [endpoint, refresh]);
  const rooms = setup?.rooms ?? [];

  async function save(command: RoomCommand) {
    if (!setup || busy) return;
    setBusy(true);
    const result = await api<RoomSetup>(endpoint, { body: { revision: setup.revision, command } });
    if (result.ok) {
      setSetup(result);
      setError("");
      if (command.action === "create") setName("");
      onSaved();
    } else {
      setError(result.error);
      if (result.status === 409) setRefresh(v => v + 1);
    }
    setBusy(false);
  }

  function addRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void save({ action: "create", name: name.trim() });
  }

  const assignedElsewhere = (roomId: string) => new Set(rooms.filter((room) => room.id !== roomId).flatMap((room) => [room.judgeId, ...room.panelistIds]).filter(Boolean));
  const update = (roomId: string, changes: (room: Room) => Room) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    const { judgeId, panelistIds } = changes(room);
    void save({ action: "panel", roomId, judgeId, panelistIds });
  };

  if (!setup) return error
    ? <div><Alert type="error">{error}</Alert><Button onClick={() => setRefresh(v => v + 1)}>Retry</Button></div>
    : <p>Loading room assignments…</p>;

  return (
    <fieldset disabled={busy} className="flex flex-col gap-5">
      <form onSubmit={addRoom} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name or number" aria-label="Room name" maxLength={80} className={fieldClass} />
        <Button type="submit" size="sm" className="h-12 shrink-0">
          <Plus aria-hidden="true" className="mr-2 size-4" /> Add room
        </Button>
      </form>
      {error && <Alert type="error">{error}</Alert>}
      {judges.length === 0 && <p className="text-sm text-muted">Add judges first, then give each room its host chair judge and panelists.</p>}
      {rooms.length === 0 && <EmptyNote>No rooms yet. Rooms are optional: the draw shows which room each match plays in.</EmptyNote>}

      <ul className="flex flex-col gap-3">
        {rooms.map((room) => {
          const taken = assignedElsewhere(room.id);
          return (
            <li key={room.id} className={cn(panelClass, "flex flex-col gap-4 p-4")}>
              <form key={room.name} className="flex flex-wrap gap-2" onSubmit={event => {
                event.preventDefault();
                void save({ action: "rename", roomId: room.id, name: String(new FormData(event.currentTarget).get("name")) });
              }}>
                <input aria-label={`Rename ${room.name}`} className={fieldClass} name="name" defaultValue={room.name} maxLength={80} required />
                <Button type="submit" size="sm">Rename room</Button>
              </form>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white [font-stretch:100%]">{room.name}</h3>
                <button type="button" onClick={() => save({ action: "delete", roomId: room.id })} title="Remove room" aria-label={`Remove ${room.name}`} className={cn(iconButtonClass, "hover:text-bad")}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </div>
              <Select label="Host chair judge" value={room.judgeId} onChange={(e) => update(room.id, (r) => ({ ...r, judgeId: e.target.value, panelistIds: r.panelistIds.filter((id) => id !== e.target.value) }))}>
                <option value="">Assign host chair judge</option>
                {judges
                  .filter((judge) => judge.id === room.judgeId || !taken.has(judge.id))
                  .map((judge) => (
                    <option key={judge.id} value={judge.id}>
                      {judge.name}
                    </option>
                  ))}
              </Select>
              <Field label="Panelists">
                <div className="flex flex-col gap-2">
                  {room.panelistIds.map((panelistId, index) => {
                    const elsewhere = new Set([...taken, ...room.panelistIds.filter((_, i) => i !== index), room.judgeId].filter(Boolean));
                    return (
                      <div key={`${room.id}-${index}`} className="flex gap-2">
                        <select value={panelistId} aria-label={`Panelist ${index + 1}`} onChange={(e) => update(room.id, (r) => ({ ...r, panelistIds: r.panelistIds.map((id, i) => (i === index ? e.target.value : id)) }))} className={cn(fieldClass, "h-10 text-sm")}>
                          <option value="">Assign panelist</option>
                          {judges
                            .filter((judge) => judge.id === panelistId || !elsewhere.has(judge.id))
                            .map((judge) => (
                              <option key={judge.id} value={judge.id}>
                                {judge.name}
                              </option>
                            ))}
                        </select>
                        <button type="button" onClick={() => update(room.id, (r) => ({ ...r, panelistIds: r.panelistIds.filter((_, i) => i !== index) }))} title="Remove panelist" aria-label={`Remove panelist ${index + 1}`} className={cn(iconButtonClass, "hover:text-bad")}>
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                  <Button variant="line" size="sm" className="self-start" onClick={() => update(room.id, (r) => ({ ...r, panelistIds: [...r.panelistIds, ""] }))}>
                    <Plus aria-hidden="true" className="mr-2 size-4" /> Add panelist
                  </Button>
                </div>
              </Field>
              <Field label="Account-bound room staff">
                <p className="text-sm text-muted">These accounts are assigned for room scoring when it becomes available. The chair and panelist labels above appear on the legacy draw.</p>
                {setup?.assignments.filter(a => a.roomId === room.id).map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2">
                    <span>{a.role === "judge" ? "Judge" : "Room host"} · {a.name} ({a.email})</span>
                    <Button size="sm" variant="line" onClick={() => save({ action: "revoke", roomId: room.id, assignmentId: a.id })}>Revoke</Button>
                  </div>
                ))}
                <form className="flex flex-wrap gap-2" onSubmit={event => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  void save({ action: "assign", roomId: room.id, email: String(fields.get("email")), role: fields.get("role") === "room_host" ? "room_host" : "judge" });
                }}>
                  <input aria-label="Verified account email" name="email" type="email" required placeholder="Verified account email" className={fieldClass} />
                  <select aria-label="Room staff role" name="role" className={fieldClass}><option value="judge">Add judge</option><option value="room_host">Assign or replace room host</option></select>
                  <Button size="sm" type="submit">Assign account</Button>
                </form>
              </Field>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
