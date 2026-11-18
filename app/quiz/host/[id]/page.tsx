import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BigScreen } from "@/components/quiz/big-screen";
import { getSession } from "@/lib/auth/session";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Live quiz" };

// The big screen for a live quiz: lobby with the PIN, questions, answers, leaderboard and podium (was quiz/host.php)
export default async function HostGamePage({ params }: PageProps<"/quiz/host/[id]">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  if (!(await getSession())) redirect("/login?notice=quiz-login&next=/quiz");
  const joinUrl = `${site.url}/play`;
  return <BigScreen gameId={Number(id)} joinUrl={joinUrl} joinLabel={joinUrl.replace(/^https?:\/\//, "")} />;
}
