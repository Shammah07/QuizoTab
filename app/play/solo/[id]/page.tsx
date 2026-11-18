import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SoloPlay } from "@/components/quiz/solo-play";

export const metadata: Metadata = { title: "Play a quiz" };

// Play a public quiz on your own: timer, scoring, results and a leaderboard (was play/solo.php)
export default async function SoloPage({ params }: PageProps<"/play/solo/[id]">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <SoloPlay quizId={Number(id)} />;
}
