import type { ReactNode } from "react";
import { Logo } from "@/components/site/logo";

// The frame around the account pages: logo on top, one centred card (was auth_layout.php)
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid flex-1 place-items-center bg-studio px-5 py-12">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-8">
        <Logo />
        <div className="w-full border border-line bg-panel p-7 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
