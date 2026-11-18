import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QuizFrame } from "@/components/quiz/frame";
import { MyQuizzes } from "@/components/quiz/my-quizzes";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Live quizzes" };

// The host's live quizzes: build, edit and launch them on the big screen (was quiz/index.php)
export default async function QuizzesPage() {
  if (!(await getSession())) redirect("/login?notice=quiz-login&next=/quiz");
  const joinLabel = `${site.url.replace(/^https?:\/\//, "")}/play`;

  return (
    <QuizFrame
      links={[
        { href: "/quiz/explore", label: "Public quizzes" },
        { href: "/", label: "Back to QuizoTab" },
      ]}
    >
      <h1 className="text-[clamp(34px,5vw,52px)] leading-[1.05] font-extrabold text-white">Live quizzes</h1>
      <p className="mt-4 mb-8 max-w-[62ch] text-[17px] leading-relaxed text-muted">
        Build a quiz, show it on the big screen, and players answer on their phones after typing the game PIN. Joining is free for players. Run it on its own, or as a tournament round where each
        team plays on one phone and the results go into your standings.
      </p>
      <ButtonLink href="/quiz/new">New quiz</ButtonLink>
      <MyQuizzes joinLabel={joinLabel} />
    </QuizFrame>
  );
}
