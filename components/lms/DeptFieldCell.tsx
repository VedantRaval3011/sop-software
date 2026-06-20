import { getDeptLabelClasses } from '@/lib/department-colors';

export function DeptFieldCell({ value, department }: { value: string; department: string }) {
  const labelCls = getDeptLabelClasses(department);
  const display = value.trim() || '—';
  return (
    <td className="px-2 py-1.5 align-middle">
      <span
        className={`block rounded px-1.5 py-0.5 text-xs font-semibold leading-snug line-clamp-2 ${labelCls}`}
        title={value.trim() || undefined}
      >
        {display}
      </span>
    </td>
  );
}
