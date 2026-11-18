"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
};

// Built on the browser's own <dialog>, which already traps focus, closes on Escape
// and returns focus to the button that opened it.
export function Modal({ open, onClose, title, closeLabel = "Close", children, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the dimmed area outside the box lands on the dialog element itself
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(92vw,460px)] border border-line bg-panel p-0 text-text",
        "backdrop:bg-studio-deep/85 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="p-7">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="grid size-9 place-items-center text-muted hover:bg-white/10 hover:text-text">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
