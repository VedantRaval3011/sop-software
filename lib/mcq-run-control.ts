import type { ChildProcess } from "child_process";
import { normalizeSopIdentifierKey } from "@/lib/sopIdentifierNormalize";

const cancelledKeys = new Set<string>();
/** Child processes spawned by local CLI providers (e.g. Claude Code) — killed on cancel. */
const subprocessProcs = new Map<string, ChildProcess>();
const runControllers = new Map<string, AbortController>();

/** Canonical key so PRCL17-05 and PRCL17-5 share one run/cancel slot. */
export function mcqRunKey(identifier: string): string {
  return normalizeSopIdentifierKey(identifier.trim());
}

export function beginMcqRun(identifier: string): AbortController {
  const key = mcqRunKey(identifier);
  cancelledKeys.delete(key);
  runControllers.get(key)?.abort();
  const ac = new AbortController();
  runControllers.set(key, ac);
  return ac;
}

export function endMcqRun(identifier: string): void {
  const key = mcqRunKey(identifier);
  cancelledKeys.delete(key);
  runControllers.delete(key);
  const proc = subprocessProcs.get(key);
  if (proc && !proc.killed) proc.kill();
  subprocessProcs.delete(key);
}

/** In-process stop: flag + abort signal + kill CLI subprocess if running. */
export function requestMcqRunStop(identifier: string): void {
  const key = mcqRunKey(identifier);
  cancelledKeys.add(key);
  runControllers.get(key)?.abort();
  const proc = subprocessProcs.get(key);
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

export function isMcqRunStopRequested(identifier: string): boolean {
  return cancelledKeys.has(mcqRunKey(identifier));
}

export function getMcqRunSignal(identifier: string): AbortSignal | undefined {
  return runControllers.get(mcqRunKey(identifier))?.signal;
}

/** True while this identifier has an active in-process MCQ run (not just a DB row). */
export function isMcqRunActiveInProcess(identifier: string): boolean {
  return runControllers.has(mcqRunKey(identifier));
}

export function registerMcqSubprocess(identifier: string, proc: ChildProcess): void {
  subprocessProcs.set(mcqRunKey(identifier), proc);
}

export function unregisterMcqSubprocess(identifier: string): void {
  subprocessProcs.delete(mcqRunKey(identifier));
}

/** @deprecated Use registerMcqSubprocess */
export const registerMcqClaudeProc = registerMcqSubprocess;
/** @deprecated Use unregisterMcqSubprocess */
export const unregisterMcqClaudeProc = unregisterMcqSubprocess;

/** Emergency: stop every in-process MCQ run (dev server). */
export function requestStopAllMcqRuns(): void {
  for (const key of new Set([...runControllers.keys(), ...subprocessProcs.keys(), ...cancelledKeys])) {
    requestMcqRunStop(key);
  }
}
