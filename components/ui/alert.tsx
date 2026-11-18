import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones = {
  success: { box: "border-good/50 bg-good/10", icon: "text-good", Icon: CheckCircle2 },
  error: { box: "border-bad/50 bg-bad/10", icon: "text-bad", Icon: CircleAlert },
  info: { box: "border-live/50 bg-live/10", icon: "text-live", Icon: Info },
} as const;

export function Alert({ type = "info", children, className }: { type?: keyof typeof tones; children: ReactNode; className?: string }) {
  const { box, icon, Icon } = tones[type];
  return (
    // Errors interrupt screen readers; other messages wait their turn
    <div role={type === "error" ? "alert" : "status"} className={cn("flex items-start gap-3 border px-4 py-3 text-sm text-text", box, className)}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", icon)} />
      <div>{children}</div>
    </div>
  );
}
