"use client";

const pulse = "animate-pulse bg-gray-200 rounded";

export function DeptCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`${pulse} h-9 w-9 rounded-lg`} />
        <div className="flex-1 space-y-1.5">
          <div className={`${pulse} h-3 w-28`} />
          <div className={`${pulse} h-2 w-16`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={`${pulse} h-12 rounded-lg`} />
        <div className={`${pulse} h-12 rounded-lg`} />
      </div>
      <div className="flex gap-2">
        <div className={`${pulse} h-6 flex-1 rounded-full`} />
        <div className={`${pulse} h-6 flex-1 rounded-full`} />
      </div>
    </div>
  );
}

export function DeptGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <DeptCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function SOPTableRowSkeleton() {
  return (
    <tr className="border-b border-gray-100">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <div className={`${pulse} h-7 w-7 rounded-lg shrink-0`} />
          <div className={`${pulse} h-3 w-24`} />
        </div>
      </td>
      <td className="p-3"><div className={`${pulse} h-3 w-48`} /></td>
      <td className="p-3"><div className={`${pulse} h-3 w-10`} /></td>
      <td className="p-3"><div className={`${pulse} h-3 w-10`} /></td>
      <td className="p-3"><div className={`${pulse} h-3 w-10`} /></td>
      <td className="p-3"><div className={`${pulse} h-3 w-10`} /></td>
      <td className="p-3"><div className={`${pulse} h-3 w-6`} /></td>
    </tr>
  );
}

export function SOPTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SOPTableRowSkeleton key={i} />
      ))}
    </>
  );
}

export function MCQCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center gap-2">
        <div className={`${pulse} h-5 w-20 rounded-lg`} />
        <div className={`${pulse} h-5 w-14 rounded-lg`} />
      </div>
      <div className="space-y-2">
        <div className={`${pulse} h-4 w-full`} />
        <div className={`${pulse} h-4 w-5/6`} />
        <div className={`${pulse} h-4 w-3/4`} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${pulse} h-12 rounded-2xl`} />
        ))}
      </div>
    </div>
  );
}

export function MCQListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <MCQCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function InlineSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-500 font-medium animate-pulse">
      <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce" />
      {label}
    </span>
  );
}
