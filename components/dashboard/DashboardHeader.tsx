"use client";

import {
  BarChart3,
  Bell,
  ChevronDown,
  LogOut,
  Trash2,
  User,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import type { DashboardStats } from "@/lib/types";
import type { AppRole } from "@/lib/auth";

interface DashboardHeaderProps {
  stats: DashboardStats | null;
  onExpiryFilter: (tier: string) => void;
}

export function DashboardHeader({ stats, onExpiryFilter }: DashboardHeaderProps) {
  const { data: session } = useSession();
  const username = session?.user?.name ?? "User";
  const role = (session?.user?.role ?? "viewer") as AppRole;
  const expired = stats?.expired ?? 0;
  const nearExpiry = stats?.nearExpiry ?? 0;
  const total = stats?.totalSops ?? 0;

  return (
    <header className="border-b border-indigo-950 bg-linear-to-r from-indigo-950 via-violet-950 to-indigo-950 text-white shadow-lg">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between px-4 py-2">

        {/* ── Left: Logo + Title ── */}
        <div className="flex items-center gap-3">
          {/* App logo */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-700/60 ring-1 ring-violet-400/30">
            <BarChart3 className="h-4 w-4 text-violet-200" />
          </div>

          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              SOP Control — Master Dashboard
            </h1>
            <p className="text-[11px] text-violet-300">
              Welcome,{" "}
              <span className="font-semibold text-white">{username}</span>
              {total > 0 && (
                <span className="ml-3 rounded bg-white/10 px-2 py-0.5 text-[10px] text-violet-200">
                  {total} SOPs
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Right: alerts + user controls ── */}
        <div className="flex items-center gap-2">
          {/* Expiry alerts */}
          <div className="hidden items-center gap-2 md:flex">
            {expired > 0 ? (
              <button
                type="button"
                onClick={() => onExpiryFilter("Expired")}
                className="rounded border border-red-400/40 bg-red-500/80 px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-600"
              >
                {expired} SOPs Expired
              </button>
            ) : nearExpiry > 0 ? (
              <button
                type="button"
                onClick={() => onExpiryFilter("Near")}
                className="rounded border border-amber-400/40 bg-amber-400/80 px-2.5 py-0.5 text-[10px] font-semibold text-amber-950 hover:bg-amber-500"
              >
                {nearExpiry} near expiry
              </button>
            ) : total > 0 ? (
              <span className="rounded border border-emerald-500/30 bg-emerald-600/50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                All within review cycle
              </span>
            ) : null}
          </div>

          {/* User info chip */}
          <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1">
            <User className="h-3.5 w-3.5 text-violet-200" />
            <span className="text-xs font-medium text-white">{username}</span>
            <span className="rounded bg-amber-400 px-1.5 py-px text-[9px] font-bold uppercase text-amber-950">
              {role}
            </span>
            <ChevronDown className="h-3 w-3 text-violet-300 opacity-70" />
          </div>

          {/* Icon buttons */}
          <button
            type="button"
            className="rounded p-1.5 text-violet-200 hover:bg-white/10 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-violet-200 hover:bg-white/10 hover:text-white"
            aria-label="Deleted items"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-violet-200 hover:bg-white/10 hover:text-white"
            aria-label="Logout"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function SummaryCards({
  stats,
  onFilter,
}: {
  stats: DashboardStats | null;
  onFilter: (patch: Record<string, string | boolean>) => void;
}) {
  if (!stats) return null;
  return null; // Hidden from layout — kept for potential future use
}
