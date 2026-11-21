import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { transactionDb } from "@/lib/db";
import { spectatorView, type Section } from "@/lib/tournament/spectator";
import { HostFrame } from "./frame";
import { Spectator } from "./public-views";

export async function SpectatorPage({ accessKey, section, room }: { accessKey: string; section: Section; room?: string | string[] }) {
  if (Array.isArray(room)) notFound();
  const initial = await spectatorView(transactionDb(), accessKey, section, room).catch(error => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  return <HostFrame links={[{ href: "/host/t", label: "Tournament directory" }]}>
    <Spectator key={JSON.stringify([accessKey,section,room])} {...{ initial, accessKey, section, room }} />
  </HostFrame>;
}
