/** Employees who joined within this many months must complete induction training. */
export const INDUCTION_WINDOW_MONTHS = 6;

/** Whole calendar months between two dates (joining month = 0). */
export function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

export function isWithinInductionWindow(
  dateOfJoining: Date | string | null | undefined,
  today = new Date(),
): boolean {
  if (!dateOfJoining) return false;
  const doj = dateOfJoining instanceof Date ? dateOfJoining : new Date(dateOfJoining);
  if (Number.isNaN(doj.getTime())) return false;
  const elapsed = monthsBetween(doj, today);
  return elapsed >= 0 && elapsed < INDUCTION_WINDOW_MONTHS;
}

/** Tenure rule wins when DOJ is inside the 6-month window. */
export function resolveInductionTrainingRequired(
  dateOfJoining: Date | string | null | undefined,
  manualValue?: boolean,
  today = new Date(),
): boolean {
  if (isWithinInductionWindow(dateOfJoining, today)) return true;
  return !!manualValue;
}

export function parseDateOfJoining(raw: unknown): Date | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export function formatDateOfJoiningInput(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
