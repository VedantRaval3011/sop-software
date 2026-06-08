"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "green" | "amber" | "red" | "gray" | "blue" | "purple";
  className?: string;
}) {
  const variants = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-800 border-emerald-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    red: "bg-red-50 text-red-800 border-red-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
    blue: "bg-sky-50 text-sky-800 border-sky-200",
    purple: "bg-violet-50 text-violet-800 border-violet-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Btn({
  children,
  variant = "default",
  size = "sm",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost" | "outline";
  size?: "xs" | "sm" | "md";
}) {
  const variants = {
    default: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
    primary: "bg-sky-600 border border-sky-700 text-white hover:bg-sky-700",
    danger: "bg-white border border-red-300 text-red-700 hover:bg-red-50",
    ghost: "bg-transparent border border-transparent text-slate-600 hover:bg-slate-100",
    outline: "bg-white border border-slate-300 text-slate-700 hover:border-sky-400",
  };
  const sizes = {
    xs: "px-2 py-0.5 text-[10px]",
    sm: "px-2.5 py-1 text-[11px]",
    md: "px-3 py-1.5 text-xs",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center gap-1 rounded font-medium transition-colors disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function MetricBtn({
  label,
  value,
  tone = "default",
  onClick,
  className,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "green" | "amber" | "red" | "blue";
  onClick?: () => void;
  className?: string;
}) {
  const tones = {
    default: "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100",
    green: "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100",
    amber: "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100",
    red: "bg-red-50 border-red-200 text-red-800 hover:bg-red-100",
    blue: "bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-[52px] flex-col items-center rounded border px-1 py-0.5 text-center transition-colors",
        tones[tone],
        className,
      )}
    >
      <span className="text-[9px] uppercase leading-none opacity-80">{label}</span>
      <span className="text-xs font-bold leading-tight">{value}</span>
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={cn(
          "max-h-[90vh] overflow-auto rounded-lg bg-white shadow-xl",
          wide ? "w-full max-w-3xl" : "w-full max-w-xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
