import type { ChildProcess } from "child_process";
import { spawn } from "child_process";

export class ComplianceAnalysisCancelledError extends Error {
  constructor(message = "Compliance analysis cancelled") {
    super(message);
    this.name = "ComplianceAnalysisCancelledError";
  }
}

export function isComplianceAnalysisCancelledError(error: unknown): boolean {
  return error instanceof ComplianceAnalysisCancelledError;
}

type ComplianceRunStore = {
  stopEpoch: number;
  cancelledKeys: Set<string>;
  subprocessProcs: Map<string, ChildProcess>;
  runControllers: Map<string, AbortController>;
  /** Per-run epoch captured at beginComplianceRun — survives dev-server HMR. */
  runEpochs: Map<string, number>;
};

function store(): ComplianceRunStore {
  const g = globalThis as typeof globalThis & { __complianceRunStore?: ComplianceRunStore };
  if (!g.__complianceRunStore) {
    g.__complianceRunStore = {
      stopEpoch: 0,
      cancelledKeys: new Set(),
      subprocessProcs: new Map(),
      runControllers: new Map(),
      runEpochs: new Map(),
    };
  }
  return g.__complianceRunStore;
}

function key(sopId: string): string {
  return sopId.trim();
}

export type ComplianceRunHandle = {
  controller: AbortController;
  runEpoch: number;
};

/** Start tracking a compliance run. Returns epoch — pass to isComplianceRunCancelled. */
export function beginComplianceRun(sopId: string): ComplianceRunHandle {
  const s = store();
  const k = key(sopId);

  for (const activeId of listActiveComplianceRunIds()) {
    if (activeId !== k) requestComplianceRunStop(activeId);
  }

  s.cancelledKeys.delete(k);
  s.runControllers.get(k)?.abort();
  const ac = new AbortController();
  s.runControllers.set(k, ac);
  const runEpoch = s.stopEpoch;
  s.runEpochs.set(k, runEpoch);
  return { controller: ac, runEpoch };
}

export function endComplianceRun(sopId: string): void {
  const s = store();
  const k = key(sopId);
  s.cancelledKeys.delete(k);
  s.runControllers.delete(k);
  s.runEpochs.delete(k);
  const proc = s.subprocessProcs.get(k);
  if (proc) killProcTree(proc);
  s.subprocessProcs.delete(k);
}

/** True when Stop was pressed after this run started. */
export function isComplianceRunCancelled(runEpoch: number): boolean {
  return store().stopEpoch > runEpoch;
}

/** Stop in-process compliance analysis and kill any active CLI subprocess. */
export function requestComplianceRunStop(sopId: string): boolean {
  const s = store();
  const k = key(sopId);
  const hadRun =
    s.runControllers.has(k) || s.subprocessProcs.has(k) || s.cancelledKeys.has(k);
  s.stopEpoch++;
  s.cancelledKeys.add(k);
  s.runControllers.get(k)?.abort();
  const proc = s.subprocessProcs.get(k);
  if (proc) killProcTree(proc);
  return hadRun;
}

export function isComplianceRunStopRequested(sopId: string): boolean {
  const s = store();
  const k = key(sopId);
  const runEpoch = s.runEpochs.get(k);
  if (runEpoch !== undefined && isComplianceRunCancelled(runEpoch)) return true;
  return s.cancelledKeys.has(k);
}

export function getComplianceRunSignal(sopId: string): AbortSignal | undefined {
  return store().runControllers.get(key(sopId))?.signal;
}

export function assertComplianceRunActive(sopId: string, runEpoch?: number): void {
  if (runEpoch !== undefined && isComplianceRunCancelled(runEpoch)) {
    throw new ComplianceAnalysisCancelledError();
  }
  if (isComplianceRunStopRequested(sopId)) {
    throw new ComplianceAnalysisCancelledError();
  }
}

export function registerComplianceSubprocess(sopId: string, proc: ChildProcess): void {
  store().subprocessProcs.set(key(sopId), proc);
}

export function unregisterComplianceSubprocess(sopId: string): void {
  store().subprocessProcs.delete(key(sopId));
}

export function isComplianceRunActiveInProcess(sopId: string): boolean {
  return store().runControllers.has(key(sopId));
}

function killProcTree(proc: ChildProcess): void {
  if (proc.killed) return;
  try {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { shell: true, stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

/** Emergency: stop every in-process compliance run (dev server). */
export function requestStopAllComplianceRuns(): number {
  const s = store();
  s.stopEpoch++;
  const keys = new Set([
    ...s.runControllers.keys(),
    ...s.subprocessProcs.keys(),
    ...s.cancelledKeys,
    ...s.runEpochs.keys(),
  ]);
  for (const k of keys) {
    s.cancelledKeys.add(k);
    s.runControllers.get(k)?.abort();
    const proc = s.subprocessProcs.get(k);
    if (proc) killProcTree(proc);
  }
  return keys.size;
}

export function listActiveComplianceRunIds(): string[] {
  const s = store();
  return [...new Set([...s.runControllers.keys(), ...s.subprocessProcs.keys(), ...s.runEpochs.keys()])];
}
