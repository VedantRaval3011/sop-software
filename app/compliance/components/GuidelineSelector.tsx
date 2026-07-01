'use client';

import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

export interface GuidelineSelectItem {
  _id: string;
  name: string;
  folder: string;
  clauses?: { number: string; title: string; text: string }[];
}

export interface GuidelineSelectFolder {
  folderName: string;
  guidelineCount: number;
  totalClauses: number;
}

type GuidelineStat = {
  totalFindings: number;
  compliantCount: number;
  partialCount: number;
  nonCompliantCount: number;
  sopCount: number;
};

interface GuidelineSelectorProps {
  guidelines: GuidelineSelectItem[];
  folders: GuidelineSelectFolder[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  guidelineStats?: Record<string, GuidelineStat>;
  onDelete?: (id: string, name: string, e: React.MouseEvent) => void;
  maxHeight?: string;
}

export function GuidelineSelector({
  guidelines,
  folders,
  selectedIds,
  onSelectionChange,
  guidelineStats,
  onDelete,
  maxHeight = 'max-h-[520px]',
}: GuidelineSelectorProps) {
  const [search, setSearch] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(folders.map((f) => f.folderName)));
  const [expandedClauses, setExpandedClauses] = useState<string | null>(null);

  const filteredByFolder = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, GuidelineSelectItem[]>();
    for (const folder of folders) {
      const items = guidelines
        .filter((g) => g.folder === folder.folderName)
        .filter(
          (g) =>
            !q ||
            g.name.toLowerCase().includes(q) ||
            g.folder.toLowerCase().includes(q),
        );
      if (items.length) map.set(folder.folderName, items);
    }
    return map;
  }, [guidelines, folders, search]);

  const selectedClauseCount = useMemo(
    () =>
      guidelines
        .filter((g) => selectedIds.has(g._id))
        .reduce((sum, g) => sum + (g.clauses?.length ?? 0), 0),
    [guidelines, selectedIds],
  );

  const toggleGuideline = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const setFolderSelection = (folderName: string, selected: boolean) => {
    const next = new Set(selectedIds);
    const items = guidelines.filter((g) => g.folder === folderName);
    for (const g of items) {
      if (selected) next.add(g._id);
      else next.delete(g._id);
    }
    onSelectionChange(next);
  };

  const setAllSelection = (selected: boolean) => {
    onSelectionChange(
      selected ? new Set(guidelines.map((g) => g._id)) : new Set(),
    );
  };

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const folderSelectedCount = (folderName: string) =>
    guidelines.filter((g) => g.folder === folderName && selectedIds.has(g._id)).length;

  const folderTotalCount = (folderName: string) =>
    guidelines.filter((g) => g.folder === folderName).length;

  const allSelected = guidelines.length > 0 && guidelines.every((g) => selectedIds.has(g._id));
  const someSelected = guidelines.some((g) => selectedIds.has(g._id)) && !allSelected;

  return (
    <div className="rounded-2xl border border-purple-200 bg-gradient-to-b from-purple-50/80 to-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-purple-100 bg-white/80">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-700">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Guidelines for compliance check</h3>
              <p className="text-xs text-gray-500">
                {selectedIds.size} of {guidelines.length} selected · {selectedClauseCount} clauses
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllSelection(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setAllSelection(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guidelines by name or category..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/25 focus:border-purple-300"
          />
        </div>

        {/* Master checkbox */}
        <label className="mt-3 flex items-center gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => setAllSelection(e.target.checked)}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-xs font-semibold text-gray-600 group-hover:text-purple-700">
            All guidelines ({guidelines.length})
          </span>
        </label>
      </div>

      {/* Folder groups */}
      <div className={`overflow-y-auto ${maxHeight} divide-y divide-gray-100`}>
        {filteredByFolder.size === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500">
            {guidelines.length === 0 ? 'No guidelines uploaded yet.' : 'No guidelines match your search.'}
          </p>
        ) : (
          [...filteredByFolder.entries()].map(([folderName, items]) => {
            const expanded = expandedFolders.has(folderName);
            const fSelected = folderSelectedCount(folderName);
            const fTotal = folderTotalCount(folderName);
            const folderAll = fTotal > 0 && fSelected === fTotal;
            const folderSome = fSelected > 0 && fSelected < fTotal;

            return (
              <div key={folderName} className="bg-white">
                <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-gray-50/95 border-b border-gray-100 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folderName)}
                    className="p-1 rounded-lg text-gray-500 hover:bg-white hover:text-purple-700"
                    aria-expanded={expanded}
                  >
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <input
                    type="checkbox"
                    checked={folderAll}
                    ref={(el) => {
                      if (el) el.indeterminate = folderSome;
                    }}
                    onChange={(e) => setFolderSelection(folderName, e.target.checked)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    title={`Select all in ${folderName}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleFolder(folderName)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">
                      {folderName}
                    </span>
                    <span className="ml-2 text-[10px] font-medium text-gray-400">
                      {fSelected}/{fTotal} selected
                    </span>
                  </button>
                </div>

                {expanded && (
                  <ul className="divide-y divide-gray-50">
                    {items.map((g) => {
                      const checked = selectedIds.has(g._id);
                      const stat = guidelineStats?.[g.name];
                      const clausesOpen = expandedClauses === g._id;

                      return (
                        <li
                          key={g._id}
                          className={`transition-colors ${checked ? 'bg-purple-50/60' : 'hover:bg-gray-50/80'}`}
                        >
                          <div className="flex items-start gap-3 px-4 py-3.5 pl-11">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGuideline(g._id)}
                              className="mt-1 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={`text-sm font-semibold leading-snug ${checked ? 'text-purple-900' : 'text-gray-800'}`}>
                                  {g.name}
                                </p>
                                <span className="px-2 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] font-bold text-gray-500">
                                  {g.clauses?.length ?? 0} clauses
                                </span>
                                {stat && stat.sopCount > 0 && (
                                  <span className="px-2 py-0.5 rounded-md bg-purple-100 border border-purple-200 text-[10px] font-bold text-purple-700">
                                    {stat.sopCount} SOPs audited
                                  </span>
                                )}
                              </div>
                              {(g.clauses?.length ?? 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedClauses(clausesOpen ? null : g._id)}
                                  className="mt-1 text-[11px] font-semibold text-purple-600 hover:text-purple-800"
                                >
                                  {clausesOpen ? 'Hide clauses' : 'Preview clauses'}
                                </button>
                              )}
                              {clausesOpen && (
                                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-purple-100 bg-white p-2">
                                  {(g.clauses ?? []).slice(0, 12).map((c, idx) => (
                                    <div key={idx} className="flex gap-2 text-[11px]">
                                      <span className="font-mono font-bold text-purple-600 flex-shrink-0">{c.number}</span>
                                      <span className="text-gray-600 truncate">{c.title}</span>
                                    </div>
                                  ))}
                                  {(g.clauses?.length ?? 0) > 12 && (
                                    <p className="text-[10px] text-gray-400 pl-6">
                                      +{(g.clauses?.length ?? 0) - 12} more clauses
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            {onDelete && (
                              <button
                                type="button"
                                onClick={(e) => onDelete(g._id, g.name, e)}
                                className="p-1.5 text-gray-300 hover:text-rose-500 rounded-lg hover:bg-rose-50 flex-shrink-0"
                                title="Delete guideline"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
