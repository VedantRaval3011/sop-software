/** Percent widths for table-fixed training grids (must sum to 100%). */

export interface TrainingGridColWidths {
  primary: number;
  secondary: number;
  dept: number;
  stat: number;
  overall: number;
  monthSub: number;
  actions: number;
}

export function employeeGridColWidths(monthCount: number, showActions: boolean): TrainingGridColWidths {
  const monthSubs = monthCount * 3;
  const actions = showActions ? 3.5 : 0;
  const primary = 14;
  const secondary = 7.5;
  const dept = 6.5;
  const stat = 3.25;
  const overall = 10;
  const fixed = primary + secondary + dept + stat * 4 + overall + actions;
  const monthSub = monthSubs > 0 ? (100 - fixed) / monthSubs : 0;
  return { primary, secondary, dept, stat, overall, monthSub, actions };
}

export function sopGridColWidths(monthCount: number): TrainingGridColWidths {
  const monthSubs = monthCount * 3;
  const primary = 16;
  const secondary = 0;
  const dept = 6.5;
  const stat = 3.25;
  const overall = 10;
  const actions = 0;
  const fixed = primary + dept + stat * 4 + overall;
  const monthSub = monthSubs > 0 ? (100 - fixed) / monthSubs : 0;
  return { primary, secondary, dept, stat, overall, monthSub, actions };
}

export function colPct(pct: number): { width: string } {
  return { width: `${pct}%` };
}
