"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect, useId } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  // Close on Escape key (only if dismissible)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
    }
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose, dismissible]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-[2px] dark:bg-black/50 animate-in fade-in duration-200"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white border border-slate-200/80 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden text-slate-800 dark:bg-slate-900 dark:border-slate-700/70 dark:text-slate-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <h2
            id={titleId}
            className="text-[15px] font-bold text-slate-800 dark:text-slate-100 tracking-tight"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("modal.close")}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 text-slate-600 dark:text-slate-300 text-sm leading-relaxed overflow-y-auto flex-1 min-h-0">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
