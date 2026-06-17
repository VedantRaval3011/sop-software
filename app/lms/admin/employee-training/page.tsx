'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, RefreshCw, Search, ChevronDown, X,
  CheckCircle2, MinusCircle, Circle, Video, Presentation,
  FileText, ListChecks, Minus, ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react';
import {
  lmsClientFields,
  LMS_CLIENT_FRESH_MS,
  readLmsClientCache,
  writeLmsClientCache,
} from '@/lib/lmsCache';

const DEPARTMENTS = ['All', 'QA', 'QC', 'Microbiology', 'Production', 'Store', 'Engineering', 'Personnel'];

type ComponentStatus = 'completed' | 'partial' | 'not_completed' | 'na';
type SopStatus = 'completed' | 'partial' | 'not_completed';
type ComponentKey = 'videos' | 'slides' | 'sopDoc' | 'mcq';

interface SopBreakdown {
  sopCode: string;
  sopName: string;
  status: SopStatus;
  months: number[];
  hasExam: boolean;
  components: Record<ComponentKey, ComponentStatus>;
}

interface EmployeeTrainingRecord {
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
  monthlyCounts: number[];
  sops: SopBreakdown[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type SortDir = 'asc' | 'desc';
interface SortState { key: string; dir: SortDir; }

function nextSort(prev: SortState, key: string, defaultDir: SortDir = 'asc'): SortState {
  if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: defaultDir };
}

/** Sortable table header cell with a direction indicator. */
function SortHeader({
  label, sortKey, sort, onSort, align = 'left', cls = 'px-4 py-3',
}: {
  label: ReactNode;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'center';
  cls?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`${cls} cursor-pointer select-none text-xs font-semibold uppercase tracking-wider transition hover:text-gray-700 ${active ? 'text-gray-700' : 'text-gray-500'}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'center' ? 'w-full justify-center' : ''}`}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  );
}

type EmpStatus = 'completed' | 'in_progress' | 'not_started';

function employeeStatus(r: EmployeeTrainingRecord): EmpStatus {
  if (r.totalSops > 0 && r.completedSops === r.totalSops) return 'completed';
  if (r.completedSops === 0 && r.partialSops === 0) return 'not_started';
  return 'in_progress';
}

const COMPONENT_META: { key: ComponentKey; label: string; Icon: typeof Video }[] = [
  { key: 'videos', label: 'Videos',        Icon: Video },
  { key: 'slides', label: 'Slides / PPTs', Icon: Presentation },
  { key: 'sopDoc', label: 'SOP Document',  Icon: FileText },
  { key: 'mcq',    label: 'MCQs',          Icon: ListChecks },
];

function ComponentBadge({ status }: { status: ComponentStatus }) {
  if (status === 'na') {
    return <span className="inline-flex items-center gap-1 text-xs text-gray-300"><Minus className="h-3.5 w-3.5" /> N/A</span>;
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Completed
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <MinusCircle className="h-3.5 w-3.5" /> Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
      <Circle className="h-3.5 w-3.5" /> Pending
    </span>
  );
}

const SOP_STATUS_META: Record<SopStatus, { label: string; chip: string }> = {
  completed:     { label: 'Completed',           chip: 'bg-green-100 text-green-700' },
  partial:       { label: 'Partially Completed', chip: 'bg-amber-100 text-amber-700' },
  not_completed: { label: 'Not Completed',       chip: 'bg-gray-100 text-gray-600' },
};

const SOP_STATUS_RANK: Record<SopStatus, number> = { not_completed: 0, partial: 1, completed: 2 };
const COMP_STATUS_RANK: Record<ComponentStatus, number> = { na: 0, not_completed: 1, partial: 2, completed: 3 };

function sopSortValue(s: SopBreakdown, key: string): string | number {
  if (key === 'sopName') return s.sopName.toLowerCase();
  if (key === 'status') return SOP_STATUS_RANK[s.status];
  return COMP_STATUS_RANK[s.components[key as ComponentKey]];
}

// ─── Drill-down modal ────────────────────────────────────────────────────────

type DrillState =
  | { kind: 'status'; record: EmployeeTrainingRecord; status: SopStatus }
  | { kind: 'month';  record: EmployeeTrainingRecord; month: number };

function StatPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {value} {label}
    </span>
  );
}

function DrillDownModal({ drill, onClose }: { drill: DrillState; onClose: () => void }) {
  const { record } = drill;
  const [query, setQuery] = useState('');
  const [sort, setSort]   = useState<SortState>({ key: 'sopName', dir: 'asc' });
  const onSort = (key: string) => setSort((prev) => nextSort(prev, key, key === 'sopName' ? 'asc' : 'desc'));

  const sops = useMemo(() =>
    drill.kind === 'status'
      ? record.sops.filter((s) => s.status === drill.status)
      : record.sops.filter((s) => s.months.includes(drill.month)),
    [drill, record],
  );

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
    drill.kind === 'status'
      ? SOP_STATUS_META[drill.status].label
      : `${MONTHS_FULL[drill.month - 1]} — Scheduled SOPs`;
  const titleChip =
    drill.kind === 'status' ? SOP_STATUS_META[drill.status].chip : 'bg-blue-100 text-blue-700';

  // Summary tallies for the SOPs in view.
  const examCount      = sops.filter((s) => s.hasExam).length;
  const completedCount = sops.filter((s) => s.status === 'completed').length;
  const partialCount   = sops.filter((s) => s.status === 'partial').length;
  const pendingCount   = sops.filter((s) => s.status === 'not_completed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">{record.employeeName}</h2>
            <p className="mt-0.5 text-xs text-gray-400">{record.designation} · {record.department}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${titleChip}`}>
                {title} · {sops.length} SOP{sops.length !== 1 ? 's' : ''}
              </span>
              {drill.kind === 'month' && (
                <>
                  {completedCount > 0 && <StatPill label="completed" value={completedCount} tone="bg-green-100 text-green-700" />}
                  {partialCount   > 0 && <StatPill label="partial"   value={partialCount}   tone="bg-amber-100 text-amber-700" />}
                  {pendingCount   > 0 && <StatPill label="pending"   value={pendingCount}   tone="bg-gray-100 text-gray-600" />}
                </>
              )}
              {examCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700">
                  <ListChecks className="h-3.5 w-3.5" /> {examCount} with exam
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search within the drill-down */}
        {sops.length > 0 && (
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2.5">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SOP name or code…"
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-xs focus:border-purple-300 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="text-xs text-gray-400">{rows.length} of {sops.length}</span>
          </div>
        )}

        <div className="overflow-auto">
          {sops.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No SOPs in this category.</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No SOPs match your search.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <SortHeader label="SOP" sortKey="sopName" sort={sort} onSort={onSort} cls="px-4 py-2.5" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} cls="px-4 py-2.5" />
                  {COMPONENT_META.map(({ key, label, Icon }) => (
                    <SortHeader
                      key={key}
                      sortKey={key}
                      sort={sort}
                      onSort={onSort}
                      cls="px-4 py-2.5"
                      label={<span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" /> {label}</span>}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr key={s.sopCode} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold text-gray-900 leading-tight">{s.sopName}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-400">{s.sopCode}</span>
                        {s.hasExam && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
                            <ListChecks className="h-3 w-3" /> Exam
                          </span>
                        )}
                        {drill.kind === 'status' && s.months.length > 0 && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                            {s.months.map((m) => MONTHS[m - 1]).join(', ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SOP_STATUS_META[s.status].chip}`}>
                        {SOP_STATUS_META[s.status].label}
                      </span>
                    </td>
                    {COMPONENT_META.map(({ key }) => (
                      <td key={key} className="px-4 py-3 align-top">
                        <ComponentBadge status={s.components[key]} />
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EmployeeTrainingDashboardPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();

  const [records, setRecords] = useState<EmployeeTrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dept,    setDept]    = useState('All');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState<'all' | EmpStatus>('all');
  const [sort,    setSort]    = useState<SortState>({ key: 'name', dir: 'asc' });
  const [drill,   setDrill]   = useState<DrillState | null>(null);

  const onSort = (key: string) => setSort((prev) => nextSort(prev, key, key === 'name' || key === 'designation' || key === 'department' ? 'asc' : 'desc'));

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login');
  }, [authStatus, router]);

  const load = useCallback(async (force = false) => {
    const field = lmsClientFields.adminEmployeeTraining(dept);
    const cached = !force ? readLmsClientCache<{ records: EmployeeTrainingRecord[] }>(field) : null;
    if (cached?.value) {
      setRecords(cached.value.records || []);
      setLoading(false);
      if (Date.now() - cached.cachedAt <= LMS_CLIENT_FRESH_MS) return;
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      if (dept !== 'All') params.set('department', dept);
      const res  = await fetch(`/api/lms/admin/employee-training?${params}`);
      const json = await res.json();
      const recs = json.records || [];
      setRecords(recs);
      writeLmsClientCache(field, { records: recs });
    } finally {
      setLoading(false);
    }
  }, [dept]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = records.filter((r) => {
      if (q && !`${r.employeeName} ${r.designation} ${r.department}`.toLowerCase().includes(q)) return false;
      if (filter !== 'all') return employeeStatus(r) === filter;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (r: EmployeeTrainingRecord): string | number => {
      switch (sort.key) {
        case 'name':             return r.employeeName.toLowerCase();
        case 'designation':      return (r.designation || '').toLowerCase();
        case 'department':       return (r.department || '').toLowerCase();
        case 'totalSops':        return r.totalSops;
        case 'completedSops':    return r.completedSops;
        case 'partialSops':      return r.partialSops;
        case 'notCompletedSops': return r.notCompletedSops;
        case 'overallPct':       return r.overallPct;
        default:
          if (sort.key.startsWith('m')) return r.monthlyCounts[Number(sort.key.slice(1))] ?? 0;
          return 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [records, search, filter, sort]);

  const counts = useMemo(() => ({
    completed:   records.filter((r) => employeeStatus(r) === 'completed').length,
    in_progress: records.filter((r) => employeeStatus(r) === 'in_progress').length,
    not_started: records.filter((r) => employeeStatus(r) === 'not_started').length,
  }), [records]);

  if (authStatus === 'loading') {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-purple-400" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/lms/admin" className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
              <ArrowLeft className="h-3.5 w-3.5" /> Training Status
            </Link>
            <div className="h-4 w-px bg-gray-200" />
            <h1 className="text-sm font-bold tracking-tight">Employee Training Dashboard</h1>
          </div>
          <button onClick={() => load(true)} disabled={loading} className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
        {/* Clickable summary cards */}
        {!loading && records.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
            {([
              { key: 'completed',   label: 'Fully Trained', count: counts.completed,   activeColor: 'bg-green-600 border-green-600 text-white', idleColor: 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100' },
              { key: 'in_progress', label: 'In Progress',   count: counts.in_progress, activeColor: 'bg-blue-500 border-blue-500 text-white',   idleColor: 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100' },
              { key: 'not_started', label: 'Not Started',   count: counts.not_started, activeColor: 'bg-gray-500 border-gray-500 text-white',   idleColor: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
            ] as const).map(({ key, label, count, activeColor, idleColor }) => (
              <button
                key={key}
                onClick={() => setFilter((prev) => (prev === key ? 'all' : key))}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${filter === key ? activeColor : idleColor}`}
              >
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs font-medium opacity-90">{label}</p>
              </button>
            ))}
          </div>
        )}

        {/* Search + department + clear */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-52 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, designation, department…"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-xs focus:border-purple-300 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-7 text-xs font-medium text-gray-600 focus:outline-none"
            >
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>

          {(filter !== 'all' || search || dept !== 'All') && (
            <button
              onClick={() => { setFilter('all'); setSearch(''); setDept('All'); }}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}

          <span className="ml-auto text-xs text-gray-400">{visible.length} employee{visible.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center">
            <p className="text-sm font-medium text-gray-500">No records found</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <SortHeader label="Employee"      sortKey="name"             sort={sort} onSort={onSort} />
                  <SortHeader label="Designation"   sortKey="designation"      sort={sort} onSort={onSort} />
                  <SortHeader label="Department"    sortKey="department"       sort={sort} onSort={onSort} />
                  <SortHeader label="Total SOPs"    sortKey="totalSops"        sort={sort} onSort={onSort} align="center" />
                  <SortHeader label="Completed"     sortKey="completedSops"    sort={sort} onSort={onSort} align="center" />
                  <SortHeader label="Partial"       sortKey="partialSops"      sort={sort} onSort={onSort} align="center" />
                  <SortHeader label="Not Completed" sortKey="notCompletedSops" sort={sort} onSort={onSort} align="center" />
                  {MONTHS.map((m, i) => (
                    <SortHeader key={m} label={m} sortKey={`m${i}`} sort={sort} onSort={onSort} align="center" cls="px-2 py-3" />
                  ))}
                  <SortHeader label="Overall %"     sortKey="overallPct"       sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((r) => {
                  const empStatus = employeeStatus(r);
                  return (
                    <tr key={r.employeeId} className={`hover:bg-gray-50 ${!r.isActive ? 'opacity-60' : ''}`}>
                      {/* Employee */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${r.isActive ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>
                            {r.employeeName.charAt(0)}
                          </div>
                          <p className="font-semibold text-gray-900 leading-tight">
                            {r.employeeName}
                            {!r.isActive && (
                              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Left</span>
                            )}
                          </p>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-gray-600">{r.designation || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.department || '—'}</td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-700">{r.totalSops}</td>

                      {/* Clickable counts */}
                      <td className="px-4 py-3 text-center">
                        <CountCell
                          count={r.completedSops}
                          tone="green"
                          onClick={() => r.completedSops > 0 && setDrill({ kind: 'status', record: r, status: 'completed' })}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CountCell
                          count={r.partialSops}
                          tone="amber"
                          onClick={() => r.partialSops > 0 && setDrill({ kind: 'status', record: r, status: 'partial' })}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CountCell
                          count={r.notCompletedSops}
                          tone="gray"
                          onClick={() => r.notCompletedSops > 0 && setDrill({ kind: 'status', record: r, status: 'not_completed' })}
                        />
                      </td>

                      {/* Per-month assigned SOP counts */}
                      {r.monthlyCounts.map((c, i) => (
                        <td key={i} className="px-2 py-3 text-center">
                          {c > 0 ? (
                            <button
                              onClick={() => setDrill({ kind: 'month', record: r, month: i + 1 })}
                              title={`View SOPs scheduled in ${MONTHS_FULL[i]}`}
                              className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-blue-50 px-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              {c}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-200">·</span>
                          )}
                        </td>
                      ))}

                      {/* Overall % */}
                      <td className="px-4 py-3">
                        {r.totalSops === 0 ? (
                          <span className="text-xs text-gray-400 italic">No SOPs</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className={`h-full rounded-full transition-all ${empStatus === 'completed' ? 'bg-green-500' : 'bg-purple-500'}`}
                                style={{ width: `${r.overallPct}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700">{r.overallPct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {drill && (
        <DrillDownModal drill={drill} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

function CountCell({
  count,
  tone,
  onClick,
}: {
  count: number;
  tone: 'green' | 'amber' | 'gray';
  onClick: () => void;
}) {
  if (count === 0) {
    return <span className="text-sm text-gray-300">0</span>;
  }
  const toneCls =
    tone === 'green' ? 'bg-green-50 text-green-700 hover:bg-green-100' :
    tone === 'amber' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
    'bg-gray-100 text-gray-600 hover:bg-gray-200';
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold transition ${toneCls}`}
      title="View component breakdown"
    >
      {count}
    </button>
  );
}
