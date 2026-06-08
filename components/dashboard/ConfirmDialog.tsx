"use client";

import { Loader2 } from "lucide-react";
import { Btn } from "./ui";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <div className="px-4 py-3 text-xs text-slate-600">{message}</div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Btn variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Btn>
          <Btn
            variant={variant === "danger" ? "danger" : "primary"}
            className={
              variant === "danger"
                ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
                : undefined
            }
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
