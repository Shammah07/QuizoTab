import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QuizEditor } from "@/components/quiz/editor";
import { QuizFrame } from "@/components/quiz/frame";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New quiz" };

// Build a new live quiz (was quiz/edit.php without an id)
export default async function NewQuizPage() {
  if (!(await getSession())) redirect("/login?notice=quiz-login&next=/quiz/new");
  return (
    <QuizFrame links={[{ href: "/quiz", label: "All quizzes" }]}>
      <QuizEditor quizId={null} />
    </QuizFrame>
  );
}
