import type { ReactNode } from "react";
import { QuizFrame } from "@/components/quiz/frame";

// The frame around the tournament pages: the logo, a few links out, one column of content

export function HostFrame({ children, links, wide }: { children: ReactNode; links?: Array<{ href: string; label: string }>; wide?: boolean }) {
  return (
    <QuizFrame
      links={
        links ?? [
          { href: "/host", label: "My tournaments" },
          { href: "/quiz", label: "Live quizzes" },
          { href: "/", label: "Back to QuizoTab" },
        ]
      }
      width={wide ? "max-w-[1100px]" : "max-w-[920px]"}
    >
      {children}
    </QuizFrame>
  );
}
