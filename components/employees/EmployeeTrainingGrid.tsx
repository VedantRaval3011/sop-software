'use client';

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, ChevronsUpDown, CheckCircle2, Circle, FileText,
  ListChecks, Loader2, MinusCircle, Presentation, Search, Video, X, Eye, EyeOff,
} from 'lucide-react';
import { colPct, employeeGridColWidths } from '@/components/lms/trainingGridLayout';
import { DeptFieldCell } from '@/components/lms/DeptFieldCell';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ROW_BATCH = 50;

type ComponentStatus = 'completed' | 'partial' | 'not_completed' | 'na';
type SopStatus = 'completed' | 'partial' | 'not_completed';
type ComponentKey = 'videos' | 'slides' | 'sopDoc' | 'mcq';

export interface SopBreakdown {
  sopCode: string;
  sopName: string;
  status: SopStatus;
  months: number[];
  hasExam: boolean;
  components: Record<ComponentKey, ComponentStatus>;
}

export interface MonthBreakdown {
  completed: number;
  partial: number;
  notCompleted: number;
}

export interface EmployeeGridRow {
  employeeId: string;
  employeeName: string;
  designation: string;
  department: string;
  isActive: boolean;
  totalSops: number;
  completedSops: number;
  partialSops: number;
  notCompletedSops: number;
  overallPct: number;
  monthlyBreakdown: MonthBreakdown[];
  sops: SopBreakdown[];
  trainingLoaded: boolean;
}

const EMPTY_MONTHLY_BREAKDOWN: MonthBreakdown[] = Array.from({ length: 12 }, () => ({
  completed: 0,
  partial: 0,
  notCompleted: 0,
}));

export function buildMonthlyBreakdown(sops: SopBreakdown[]): MonthBreakdown[] {
  const breakdown: MonthBreakdown[] = Array.from({ length: 12 }, () => ({
    completed: 0,
    partial: 0,
    notCompleted: 0,
  }));
  for (const sop of sops) {
    for (const m of sop.months) {
      const idx = m - 1;
      if (idx < 0 || idx > 11) continue;
      if (sop.status === 'completed') breakdown[idx].completed++;
      else if (sop.status === 'partial') breakdown[idx].partial++;
      else breakdown[idx].notCompleted++;
    }
  }
  return breakdown;
}

function monthTotal(b: MonthBreakdown): number {
  return b.completed + b.partial + b.notCompleted;
}

type SortDir = 'asc' | 'desc';
interface SortState { key: string; dir: SortDir; }

type EmpStatus = 'completed' | 'in_progress' | 'not_started';

function nextSort(prev: SortState, key: string, defaultDir: SortDir = 'asc'): SortState {
  if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: defaultDir };
}

function employeeStatus(r: EmployeeGridRow): EmpStatus {
  if (r.totalSops > 0 && r.completedSops === r.totalSops) return 'completed';
  if (r.completedSops === 0 && r.partialSops === 0) return 'not_started';
  return 'in_progress';
}

const MONTH_STATUS_SUBS = [
  { suffix: 'completed', label: '✓', title: 'Completed', tone: 'text-green-600' },
  { suffix: 'partial', label: '◐', title: 'Partially completed', tone: 'text-amber-600' },
  { suffix: 'notCompleted', label: '○', title: 'Not completed', tone: 'text-gray-500' },
] as const;

const MONTH_SUB_CELL = 'px-0 py-1 text-center align-middle';

function monthSortValue(breakdown: MonthBreakdown | undefined, sub: typeof MONTH_STATUS_SUBS[number]['suffix'] | 'total'): number {
  if (!breakdown) return 0;
  if (sub === 'total') return monthTotal(breakdown);
  if (sub === 'completed') return breakdown.completed;
  if (sub === 'partial') return breakdown.partial;
  return breakdown.notCompleted;
}

function MonthSortHeader({
  label, title, tone, sortKey, sort, onSort, isFirst, isFuture,
}: {
  label: string;
  title: string;
  tone: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  isFirst?: boolean;
  isFuture?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={`${title} — click to sort`}
      className={`${MONTH_SUB_CELL} ${isFirst ? 'border-l border-gray-200' : ''} cursor-pointer select-none bg-gray-50 transition hover:text-gray-700 ${isFuture ? 'bg-gray-100/90 text-gray-300' : active ? 'text-gray-700' : 'text-gray-500'}`}
    >
      <span className={`inline-flex flex-col items-center gap-px leading-none ${tone}`}>
        <span className="text-[9px] font-bold">{label}</span>
        {active && (sort.dir === 'asc'
          ? <ArrowUp className="h-2 w-2 shrink-0" />
          : <ArrowDown className="h-2 w-2 shrink-0" />)}
      </span>
    </th>
  );
}
function parseMonthSortKey(key: string): { monthIndex: number; sub: typeof MONTH_STATUS_SUBS[number]['suffix'] | 'total' } | null {
  const match = key.match(/^m(\d+)(?:_(completed|partial|notCompleted))?$/);
  if (!match) return null;
  return {
    monthIndex: Number(match[1]),
    sub: (match[2] as typeof MONTH_STATUS_SUBS[number]['suffix'] | undefined) ?? 'total',
  };
}

function SortHeader({
  label, sortKey, sort, onSort, align = 'left', cls = 'px-3 py-2.5', stickyCls = '', rowSpan,
}: {
  label: ReactNode;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'center';
  cls?: string;
  stickyCls?: string;
  rowSpan?: number;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      rowSpan={rowSpan}
      onClick={() => onSort(sortKey)}
      className={`${cls} ${stickyCls} cursor-pointer select-none whitespace-nowrap bg-gray-50 text-[11px] font-semibold uppercase tracking-wider transition hover:text-gray-700 ${active ? 'text-gray-700' : 'text-gray-500'}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === 'center' ? 'w-full justify-center' : ''}`}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUp className="h-2.5 w-2.5 shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 shrink-0" />)
          : <ChevronsUpDown className="h-2.5 w-2.5 shrink-0 opacity-30" />}
      </span>
    </th>
  );
}

function StatSkeleton({ compact }: { compact?: boolean }) {
  return <span className={`inline-block animate-pulse rounded bg-gray-200 ${compact ? 'h-3 w-3' : 'h-5 w-7'}`} />;
}

function CountCell({
  count, tone, onClick, loading,
}: {
  count: number;
  tone: 'green' | 'amber' | 'gray';
  onClick: () => void;
  loading?: boolean;
}) {
  if (loading) return <StatSkeleton />;
  if (count === 0) return <span className="text-sm text-gray-300">0</span>;
  const toneCls =
    tone === 'green' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
    tone === 'amber' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
    'bg-gray-100 text-gray-600 hover:bg-gray-200';
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold transition ${toneCls}`}
      title="View SOP details"
    >
      {count}
    </button>
  );
}

function MiniMonthCount({
  count,
  tone,
  loading,
  onClick,
}: {
  count: number;
  tone: 'green' | 'amber' | 'gray';
  loading?: boolean;
  onClick?: () => void;
}) {
  if (loading) return null;
  const toneCls =
    tone === 'green' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
    tone === 'amber' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
    'bg-gray-100 text-gray-600 hover:bg-gray-200';
  const body = (
    <span className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] font-bold leading-none ${count === 0 ? 'text-gray-200' : toneCls}`}>
      {count === 0 ? '·' : count}
    </span>
  );
  if (count === 0 || !onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded transition"
      title="View SOP details"
    >
      {body}
    </button>
  );
}

function OverallProgressCell({ pct, complete }: { pct: number; complete: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-purple-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-gray-700">{pct}%</span>
    </div>
  );
}

function MonthStatusCell({
  count,
  monthIndex,
  status,
  loading,
  onDrill,
  extraClass,
}: {
  count: number;
  monthIndex: number;
  status: SopStatus;
  loading: boolean;
  onDrill: (status: SopStatus) => void;
  extraClass?: string;
}) {
  const currentMonth = new Date().getMonth();
  const isFuture = monthIndex > currentMonth;
  const tone: 'green' | 'amber' | 'gray' =
    status === 'completed' ? 'green' : status === 'partial' ? 'amber' : 'gray';

  const cellCls = extraClass ? `${MONTH_SUB_CELL} ${extraClass}` : MONTH_SUB_CELL;

  if (isFuture) {
    return (
      <td className={`${cellCls} bg-gray-50/90`}>
        <span className="text-[9px] text-gray-300">—</span>
      </td>
    );
  }

  if (loading) {
    return (
      <td className={cellCls}>
        <StatSkeleton />
      </td>
    );
  }

  return (
    <td className={cellCls}>
      <MiniMonthCount
        count={count}
        tone={tone}
        onClick={count > 0 ? () => onDrill(status) : undefined}
      />
    </td>
  );
}

const COMPONENT_META: { key: ComponentKey; label: string; Icon: typeof Video }[] = [
  { key: 'videos', label: 'Videos',        Icon: Video },
  { key: 'slides', label: 'Slides / PPTs', Icon: Presentation },
  { key: 'sopDoc', label: 'SOP Document',  Icon: FileText },
  { key: 'mcq',    label: 'MCQs',          Icon: ListChecks },
];

const SOP_STATUS_META: Record<SopStatus, { label: string; chip: string }> = {
  completed:     { label: 'Completed',           chip: 'bg-green-100 text-green-700' },
  partial:       { label: 'Partially Completed', chip: 'bg-amber-100 text-amber-700' },
  not_completed: { label: 'Not Completed',       chip: 'bg-gray-100 text-gray-600' },
};

const SOP_STATUS_RANK: Record<SopStatus, number> = { not_completed: 0, partial: 1, completed: 2 };
const COMP_STATUS_RANK: Record<ComponentStatus, number> = { na: 0, not_completed: 1, partial: 2, completed: 3 };

function ComponentMini({ status, title }: { status: ComponentStatus; title: string }) {
  if (status === 'na') {
    return <span className="text-[10px] text-gray-300" title={`${title}: N/A`}>—</span>;
  }
  if (status === 'completed') {
    return <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-green-600" title={`${title}: Completed`} />;
  }
  if (status === 'partial') {
    return <MinusCircle className="mx-auto h-3.5 w-3.5 text-amber-600" title={`${title}: Partial`} />;
  }
  return <Circle className="mx-auto h-3.5 w-3.5 text-gray-400" title={`${title}: Pending`} />;
}

function sopSortValue(s: SopBreakdown, key: string): string | number {
  if (key === 'sopName') return s.sopName.toLowerCase();
  if (key === 'status') return SOP_STATUS_RANK[s.status];
  return COMP_STATUS_RANK[s.components[key as ComponentKey]];
}

type DrillState =
  | { kind: 'all';    record: EmployeeGridRow }
  | { kind: 'status'; record: EmployeeGridRow; status: SopStatus }
  | { kind: 'month';  record: EmployeeGridRow; month: number; status?: SopStatus };

function formatScheduledMonths(months: number[]): string {
  if (months.length === 0) return '—';
  return months.map((m) => MONTHS[m - 1] || `M${m}`).join(', ');
}

function DrillDownModal({ drill, onClose }: { drill: DrillState; onClose: () => void }) {
  const { record } = drill;
  const [query, setQuery] = useState('');
  const [sort, setSort]   = useState<SortState>({ key: 'sopName', dir: 'asc' });
  const onSort = (key: string) => setSort((prev) => nextSort(prev, key, key === 'sopName' ? 'asc' : 'desc'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sops = useMemo(() => {
    if (drill.kind === 'all') return record.sops;
    if (drill.kind === 'status') return record.sops.filter((s) => s.status === drill.status);
    return record.sops.filter((s) => {
      if (!s.months.includes(drill.month)) return false;
      if (drill.status) return s.status === drill.status;
      return true;
    });
  }, [drill, record]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sops.filter((s) => `${s.sopName} ${s.sopCode}`.toLowerCase().includes(q))
      : sops;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sopSortValue(a, sort.key);
      const vb = sopSortValue(b, sort.key);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.sopName.localeCompare(b.sopName);
    });
  }, [sops, query, sort]);

  const title =
    drill.kind === 'all'
      ? 'All Assigned SOPs'
      : drill.kind === 'status'
        ? SOP_STATUS_META[drill.status].label
        : drill.status
          ? `${MONTHS_FULL[drill.month - 1]} — ${SOP_STATUS_META[drill.status].label}`
          : `${MONTHS_FULL[drill.month - 1]} — Scheduled SOPs`;
  const titleChip =
    drill.kind === 'all'
      ? 'bg-purple-100 text-purple-700'
      : drill.kind === 'status'
        ? SOP_STATUS_META[drill.status].chip
        : drill.status
          ? SOP_STATUS_META[drill.status].chip
          : 'bg-blue-100 text-blue-700';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-bold text-gray-900">{record.employeeName}</h2>
            <span className="text-xs text-gray-400">{record.designation} · {record.department}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${titleChip}`}>
              {title} · {sops.length}
            </span>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sops.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SOP name or number…"
                className="w-full rounded-md border border-gray-200 py-1.5 pl-7 pr-7 text-xs focus:border-purple-300 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <span className="text-[11px] text-gray-400">{rows.length} of {sops.length}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {sops.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No SOPs in this category.</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No SOPs match your search.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
                <tr>
                  <SortHeader label="SOP Name" sortKey="sopName" sort={sort} onSort={onSort} cls="px-3 py-2 min-w-[140px]" />
                  <th className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">SOP No.</th>
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} cls="px-2 py-2" />
                  <th className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Sched.</th>
                  {COMPONENT_META.map(({ key, label, Icon }) => (
                    <th key={key} className="px-1.5 py-2 text-center" title={label}>
                      <Icon className="mx-auto h-3.5 w-3.5 text-gray-400" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr key={s.sopCode} className="hover:bg-gray-50/80">
                    <td className="px-3 py-1.5 align-middle">
                      <p className="font-medium text-gray-900 leading-tight line-clamp-2" title={s.sopName || s.sopCode}>
                        {s.sopName || s.sopCode}
                        {s.hasExam && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-purple-50 px-1 py-px text-[9px] font-semibold text-purple-600 align-middle">
                            <ListChecks className="h-2.5 w-2.5" /> Exam
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gray-700">
                        {s.sopCode}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold ${SOP_STATUS_META[s.status].chip}`}>
                        {s.status === 'not_completed' ? 'Pending' : s.status === 'partial' ? 'Partial' : 'Done'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-[11px] text-gray-500 whitespace-nowrap">
                      {formatScheduledMonths(s.months)}
                    </td>
                    {COMPONENT_META.map(({ key, label }) => (
                      <td key={key} className="px-1.5 py-1.5 text-center align-middle">
                        <ComponentMini status={s.components[key]} title={label} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const EmployeeTrainingRow = memo(function EmployeeTrainingRow({
  row,
  statLoading,
  visibleMonthIndices,
  lastVisibleMonth,
  showActions,
  stickyEmpCell,
  stickyActCell,
  onDrill,
  renderActions,
}: {
  row: EmployeeGridRow;
  statLoading: boolean;
  visibleMonthIndices: number[];
  lastVisibleMonth: number;
  showActions: boolean;
  stickyEmpCell: string;
  stickyActCell: string;
  onDrill: (drill: DrillState) => void;
  renderActions?: (row: EmployeeGridRow) => ReactNode;
}) {
  const empStatus = employeeStatus(row);

  return (
    <tr className={`group hover:bg-gray-50 ${!row.isActive ? 'opacity-60' : ''}`}>
      <td className={`${stickyEmpCell} px-2 py-1.5`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${row.isActive ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>
            {row.employeeName.charAt(0)}
          </div>
          <p className="min-w-0 font-semibold text-gray-900 leading-tight text-xs line-clamp-2" title={row.employeeName}>
            {row.employeeName}
            {!row.isActive && (
              <span className="ml-1 rounded-full bg-red-100 px-1 py-px text-[9px] font-semibold text-red-600">Left</span>
            )}
          </p>
        </div>
      </td>
      <DeptFieldCell value={row.designation} department={row.department} />
      <DeptFieldCell value={row.department} department={row.department} />
      <td className="px-0.5 py-1.5 text-center">
        {statLoading ? (
          <StatSkeleton />
        ) : row.totalSops > 0 ? (
          <button
            type="button"
            onClick={() => onDrill({ kind: 'all', record: row })}
            className="font-semibold text-gray-700 underline-offset-2 transition hover:text-purple-700 hover:underline"
            title="View all assigned SOPs"
          >
            {row.totalSops}
          </button>
        ) : (
          <span className="font-semibold text-gray-300">0</span>
        )}
      </td>
      <td className="px-0.5 py-1.5 text-center">
        <CountCell
          count={row.completedSops}
          tone="green"
          loading={statLoading}
          onClick={() => !statLoading && row.completedSops > 0 && onDrill({ kind: 'status', record: row, status: 'completed' })}
        />
      </td>
      <td className="px-0.5 py-1.5 text-center">
        <CountCell
          count={row.partialSops}
          tone="amber"
          loading={statLoading}
          onClick={() => !statLoading && row.partialSops > 0 && onDrill({ kind: 'status', record: row, status: 'partial' })}
        />
      </td>
      <td className="px-0.5 py-1.5 text-center">
        <CountCell
          count={row.notCompletedSops}
          tone="gray"
          loading={statLoading}
          onClick={() => !statLoading && row.notCompletedSops > 0 && onDrill({ kind: 'status', record: row, status: 'not_completed' })}
        />
      </td>
      {visibleMonthIndices.map((i) => {
        const b = row.monthlyBreakdown[i];
        return (
          <Fragment key={i}>
            <MonthStatusCell
              count={b.completed}
              monthIndex={i}
              status="completed"
              loading={statLoading}
              onDrill={(status) => onDrill({ kind: 'month', record: row, month: i + 1, status })}
            />
            <MonthStatusCell
              count={b.partial}
              monthIndex={i}
              status="partial"
              loading={statLoading}
              onDrill={(status) => onDrill({ kind: 'month', record: row, month: i + 1, status })}
            />
            <MonthStatusCell
              count={b.notCompleted}
              monthIndex={i}
              status="not_completed"
              loading={statLoading}
              onDrill={(status) => onDrill({ kind: 'month', record: row, month: i + 1, status })}
              extraClass={i === lastVisibleMonth ? 'pr-2' : undefined}
            />
          </Fragment>
        );
      })}
      <td className="overflow-hidden border-l border-gray-200 pl-3 pr-2 py-1.5">
        {statLoading ? (
          <StatSkeleton />
        ) : row.totalSops === 0 ? (
          <span className="text-[10px] text-gray-400 italic">No SOPs</span>
        ) : (
          <OverallProgressCell pct={row.overallPct} complete={empStatus === 'completed'} />
        )}
      </td>
      {showActions && (
        <td className={`${stickyActCell} px-1 py-1.5`}>
          {renderActions?.(row)}
        </td>
      )}
    </tr>
  );
});

export function EmployeeTrainingGrid({
  rows,
  trainingLoading,
  rosterLoading,
  renderActions,
  showActions = true,
}: {
  rows: EmployeeGridRow[];
  trainingLoading: boolean;
  rosterLoading: boolean;
  renderActions?: (row: EmployeeGridRow) => ReactNode;
  showActions?: boolean;
}) {
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [hideFutureMonths, setHideFutureMonths] = useState(true);
  const [visibleCount, setVisibleCount] = useState(ROW_BATCH);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  const onSort = useCallback((key: string) => {
    setSort((prev) => nextSort(prev, key, key === 'name' || key === 'designation' || key === 'department' ? 'asc' : 'desc'));
  }, []);

  const onDrill = useCallback((next: DrillState) => setDrill(next), []);

  const currentMonthIndex = new Date().getMonth();
  const visibleMonthIndices = useMemo(
    () => MONTHS.map((_, i) => i).filter((i) => !hideFutureMonths || i <= currentMonthIndex),
    [hideFutureMonths, currentMonthIndex],
  );
  const hiddenMonthCount = 12 - visibleMonthIndices.length;
  const cols = useMemo(
    () => employeeGridColWidths(visibleMonthIndices.length, showActions),
    [visibleMonthIndices.length, showActions],
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (r: EmployeeGridRow): string | number => {
      switch (sort.key) {
        case 'name':             return r.employeeName.toLowerCase();
        case 'designation':      return (r.designation || '').toLowerCase();
        case 'department':       return (r.department || '').toLowerCase();
        case 'totalSops':        return r.totalSops;
        case 'completedSops':    return r.completedSops;
        case 'partialSops':      return r.partialSops;
        case 'notCompletedSops': return r.notCompletedSops;
        case 'overallPct':       return r.overallPct;
        default: {
          const monthSort = parseMonthSortKey(sort.key);
          if (monthSort) {
            return monthSortValue(r.monthlyBreakdown[monthSort.monthIndex], monthSort.sub);
          }
          return 0;
        }
      }
    };
    return [...rows].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [rows, sort]);

  useEffect(() => {
    setVisibleCount(ROW_BATCH);
  }, [rows.length, sort.key, sort.dir]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + ROW_BATCH, sorted.length));
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [sorted.length, visibleCount]);

  const displayed = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;
  const lastVisibleMonth = visibleMonthIndices[visibleMonthIndices.length - 1];

  if (rosterLoading) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white py-20">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white py-20">
        <p className="text-sm font-medium text-gray-500">No employees found</p>
      </div>
    );
  }

  const stickyHead = 'sticky top-0 z-20 bg-gray-50';
  const stickyEmpHead = 'sticky left-0 z-30 bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]';
  const stickyActHead = 'sticky right-0 z-30 bg-gray-50 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]';
  const stickyEmpCell = 'sticky left-0 z-10 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-gray-50';
  const stickyActCell = 'sticky right-0 z-10 bg-white shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-gray-50';
  const tableColSpan = 7 + visibleMonthIndices.length * 3 + 1 + (showActions ? 1 : 0);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-4 py-2 text-[11px] text-gray-500">
          <span className="font-medium text-gray-600">Month columns:</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-green-50 px-1 text-[10px] font-bold text-green-700">✓</span> Completed</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-amber-50 px-1 text-[10px] font-bold text-amber-700">◐</span> Partially completed</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-gray-100 px-1 text-[10px] font-bold text-gray-600">○</span> Not completed</span>
          <span className="text-gray-400">· click sub-headers to sort</span>
          <button
            type="button"
            onClick={() => setHideFutureMonths((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
            title={hideFutureMonths ? 'Show upcoming months' : 'Hide upcoming months'}
          >
            {hideFutureMonths ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {hideFutureMonths
              ? `Show future months${hiddenMonthCount > 0 ? ` (${hiddenMonthCount})` : ''}`
              : 'Hide future months'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col style={colPct(cols.primary)} />
              <col style={colPct(cols.secondary)} />
              <col style={colPct(cols.dept)} />
              <col style={colPct(cols.stat)} />
              <col style={colPct(cols.stat)} />
              <col style={colPct(cols.stat)} />
              <col style={colPct(cols.stat)} />
              {visibleMonthIndices.flatMap((i) =>
                MONTH_STATUS_SUBS.map((sub) => (
                  <col key={`${i}-${sub.suffix}`} style={colPct(cols.monthSub)} />
                )),
              )}
              <col style={colPct(cols.overall)} />
              {showActions && <col style={colPct(cols.actions)} />}
            </colgroup>
            <thead className={`border-b border-gray-200 ${stickyHead}`}>
              <tr>
                <SortHeader label="Employee" sortKey="name" sort={sort} onSort={onSort} cls="px-2 py-1.5 text-[10px]" stickyCls={stickyEmpHead} rowSpan={2} />
                <SortHeader label="Desig." sortKey="designation" sort={sort} onSort={onSort} cls="px-2 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                <SortHeader label="Dept." sortKey="department" sort={sort} onSort={onSort} cls="px-2 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                <SortHeader label="Total" sortKey="totalSops" sort={sort} onSort={onSort} align="center" cls="px-0.5 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                <SortHeader label="Done" sortKey="completedSops" sort={sort} onSort={onSort} align="center" cls="px-0.5 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                <SortHeader label="Part" sortKey="partialSops" sort={sort} onSort={onSort} align="center" cls="px-0.5 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                <SortHeader label="Not" sortKey="notCompletedSops" sort={sort} onSort={onSort} align="center" cls="px-0.5 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                {visibleMonthIndices.map((i) => {
                  const m = MONTHS[i];
                  const isFuture = i > currentMonthIndex;
                  const monthTotalActive = sort.key === `m${i}` || sort.key.startsWith(`m${i}_`);
                  return (
                    <th
                      key={`${m}-group`}
                      colSpan={3}
                      className={`${stickyHead} border-l border-gray-200 px-0 py-0.5 text-center text-[9px] font-semibold uppercase tracking-tight ${isFuture ? 'bg-gray-100/90 text-gray-300' : monthTotalActive ? 'text-gray-700' : 'text-gray-500'}`}
                    >
                      {m.toUpperCase()}
                    </th>
                  );
                })}
                <SortHeader label="Overall" sortKey="overallPct" sort={sort} onSort={onSort} cls="border-l border-gray-200 pl-3 pr-2 py-1.5 text-[10px]" stickyCls={stickyHead} rowSpan={2} />
                {showActions && (
                  <th rowSpan={2} className={`${stickyActHead} px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap`}>
                    Actions
                  </th>
                )}
              </tr>
              <tr>
                {visibleMonthIndices.map((i) => {
                  const isFuture = i > currentMonthIndex;
                  return MONTH_STATUS_SUBS.map(({ suffix, label, title, tone }, subIdx) => (
                    <MonthSortHeader
                      key={`m${i}-${suffix}`}
                      label={label}
                      title={title}
                      tone={tone}
                      sortKey={`m${i}_${suffix}`}
                      sort={sort}
                      onSort={onSort}
                      isFirst={subIdx === 0}
                      isFuture={isFuture}
                    />
                  ));
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map((r) => (
                <EmployeeTrainingRow
                  key={r.employeeId}
                  row={r}
                  statLoading={trainingLoading || !r.trainingLoaded}
                  visibleMonthIndices={visibleMonthIndices}
                  lastVisibleMonth={lastVisibleMonth}
                  showActions={showActions}
                  stickyEmpCell={stickyEmpCell}
                  stickyActCell={stickyActCell}
                  onDrill={onDrill}
                  renderActions={renderActions}
                />
              ))}
              {hasMore && (
                <tr ref={sentinelRef}>
                  <td colSpan={tableColSpan} className="px-4 py-4 text-center">
                    <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading more rows… ({visibleCount} of {sorted.length})
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {trainingLoading && (
          <div className="flex items-center gap-2 border-t border-gray-100 bg-purple-50/50 px-4 py-2 text-xs text-purple-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading training stats…
          </div>
        )}
      </div>

      {drill && <DrillDownModal drill={drill} onClose={() => setDrill(null)} />}
    </>
  );
}
