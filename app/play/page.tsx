import type { Metadata } from "next";
import { PlayScreen } from "@/components/quiz/play-screen";

export const metadata: Metadata = { title: "Join a live quiz" };

// Players join a live quiz here with the game PIN. Free, no account needed. (Was play/index.php.)
export default async function PlayPage({ searchParams }: PageProps<"/play">) {
  const { pin } = await searchParams;
  return <PlayScreen pin={typeof pin === "string" && /^\d{6}$/.test(pin) ? pin : ""} />;
}
