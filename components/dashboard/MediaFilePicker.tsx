"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";

export function MediaFilePicker({
  label,
  hint,
  buttonLabel,
  icon: Icon,
  files,
  onFilesChange,
  accept,
  multiple = true,
  emptyLabel,
  disabled,
}: {
  label: string;
  hint?: string;
  buttonLabel: string;
  icon: LucideIcon;
  files: File[];
  onFilesChange: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const statusText =
    files.length === 0
      ? emptyLabel
      : files.length === 1
        ? files[0].name
        : `${files.length} files selected`;

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-semibold text-slate-800">{label}</p>
        {hint ? <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{hint}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon className="h-3.5 w-3.5" />
          {buttonLabel}
        </button>
        <span className="text-[11px] text-slate-500">{statusText}</span>
      </div>

      {files.length > 1 ? (
        <ul className="space-y-0.5 pl-1 text-[10px] text-slate-500">
          {files.map((file) => (
            <li key={`${file.name}-${file.lastModified}`} className="truncate">
              {file.name}
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          onFilesChange(multiple ? [...files, ...selected] : selected);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function ExistingMediaList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((url) => (
          <li key={url} className="truncate text-[10px] text-slate-600">
            {url.split("/").pop() ?? url}
          </li>
        ))}
      </ul>
    </div>
  );
}
