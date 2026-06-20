const DEPT_NAMES = ['QA', 'QC', 'Microbiology', 'Production', 'Store', 'Engineering', 'Personnel'] as const;

export interface DeptCellColors {
  text: string;
  bg: string;
}

const DEPT_CELL_COLORS: Record<string, DeptCellColors> = {
  QA: { text: 'text-indigo-700', bg: 'bg-indigo-50' },
  QC: { text: 'text-blue-700', bg: 'bg-blue-50' },
  Microbiology: { text: 'text-emerald-700', bg: 'bg-emerald-50' },
  Production: { text: 'text-amber-700', bg: 'bg-amber-50' },
  Store: { text: 'text-orange-700', bg: 'bg-orange-50' },
  Engineering: { text: 'text-cyan-700', bg: 'bg-cyan-50' },
  Personnel: { text: 'text-pink-700', bg: 'bg-pink-50' },
  Unknown: { text: 'text-purple-700', bg: 'bg-purple-50' },
};

export function normalizeDepartment(dept: string): string {
  const t = (dept || '').trim();
  if (!t) return 'Unknown';
  for (const name of DEPT_NAMES) {
    if (t.toLowerCase().startsWith(name.toLowerCase())) return name;
  }
  if (/engineer|maint/i.test(t)) return 'Engineering';
  if (/micro/i.test(t)) return 'Microbiology';
  if (/prod/i.test(t)) return 'Production';
  if (/person|hr/i.test(t)) return 'Personnel';
  return t;
}

export function getDeptCellColors(dept: string): DeptCellColors {
  const normalized = normalizeDepartment(dept);
  return DEPT_CELL_COLORS[normalized] ?? DEPT_CELL_COLORS.Unknown;
}

export function getDeptLabelClasses(dept: string): string {
  const { text, bg } = getDeptCellColors(dept);
  return `${bg} ${text}`;
}
