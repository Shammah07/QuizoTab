import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { QuizEditor } from "@/components/quiz/editor";
import { QuizFrame } from "@/components/quiz/frame";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Edit quiz" };

// Edit one of the host's quizzes (was quiz/edit.php?id=...)
export default async function EditQuizPage({ params }: PageProps<"/quiz/[id]/edit">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  if (!(await getSession())) redirect(`/login?notice=quiz-login&next=/quiz/${id}/edit`);
  return (
    <QuizFrame links={[{ href: "/quiz", label: "All quizzes" }]}>
      <QuizEditor quizId={Number(id)} />
    </QuizFrame>
  );
}
