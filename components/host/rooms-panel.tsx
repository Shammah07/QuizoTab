"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { uid, type Judge, type Room } from "@/lib/tournament/rules";
import { EmptyNote, Field, fieldClass, iconButtonClass, panelClass, Select } from "./bits";

// The Rooms tab: each room gets a host chair judge and panelists; a judge sits in one room only

export function RoomsPanel({ rooms, judges, onChange }: { rooms: Room[]; judges: Judge[]; onChange: (rooms: Room[]) => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function save(next: Room[]) {
    const failed = await onChange(next);
    setError(failed ?? "");
  }

  function addRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save([...rooms, { id: uid(), name: name.trim(), judgeId: "", panelistIds: [] }]);
    setName("");
  }

  const assignedElsewhere = (roomId: string) => new Set(rooms.filter((room) => room.id !== roomId).flatMap((room) => [room.judgeId, ...room.panelistIds]).filter(Boolean));
  const update = (roomId: string, changes: (room: Room) => Room) => save(rooms.map((room) => (room.id === roomId ? changes(room) : room)));

  return (
    <div className="flex flex-col gap-5">
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
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-white [font-stretch:100%]">{room.name}</h3>
                <button type="button" onClick={() => save(rooms.filter((item) => item.id !== room.id))} title="Remove room" aria-label={`Remove ${room.name}`} className={cn(iconButtonClass, "hover:text-bad")}>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
