"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Btn } from "./ui";

/**
 * A confirmation dialog that requires the user to type a password before the
 * destructive action is allowed to run. Used to gate the irreversible
 * permanent-delete of an SOP.
 */
export function PasswordConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete permanently",
  cancelLabel = "Cancel",
  loading = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field whenever the dialog (re)opens, and focus it for quick entry.
  useEffect(() => {
    if (open) {
      setPassword("");
      // Defer focus until after the dialog has painted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    if (!password || loading) return;
    onConfirm(password);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-red-700">{title}</h3>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-xs text-slate-600">{message}</p>
          <div className="space-y-1">
            <label htmlFor="delete-password" className="block text-[11px] font-semibold text-slate-700">
              Enter password to confirm
            </label>
            <input
              id="delete-password"
              ref={inputRef}
              type="password"
              autoComplete="off"
              value={password}
              disabled={loading}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Password"
            />
            {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Btn variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Btn>
          <Btn
            variant="danger"
            className="border-red-600 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            onClick={submit}
            disabled={loading || !password}
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
