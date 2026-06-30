'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useSession } from 'next-auth/react';
import QuestionBasisSelection from '@/components/QuestionBasisSelection';
import { formatSOPDisplayName } from '@/lib/sopLibraryHelper';
import { ArrowLeft, ChevronRight, Loader2, Search } from 'lucide-react';

type Step = 'selection' | 'configure';

export default function SpecificTrainingTestPage() {
  useAuthGuard();
  const router = useRouter();
  const { data: session } = useSession();

  const [step, setStep] = useState<Step>('selection');
  const [basis, setBasis] = useState<'ai' | 'manual'>('ai');
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const userId = (session?.user as any)?.id || session?.user?.email;
    const url = userId ? `/api/mcq-tests?userId=${encodeURIComponent(userId)}` : '/api/mcq-tests';
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((d) => { if (d.success) setBanks(d.mcqBanks || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  const handleBasisSelect = (type: 'ai' | 'manual') => {
    setBasis(type);
    if (type === 'ai') {
      // AI: use the first bank available
      if (banks.length > 0) {
        const id = banks[0]._id?.toString() || banks[0]._id;
        router.push(`/test/specific/${id}`);
      }
    } else {
      setStep('configure');
    }
  };

  const handleStart = () => {
    if (selectedIds.length === 0) return;
    router.push(`/test/specific/${selectedIds.join(',')}`);
  };

  const filteredBanks = banks.filter(
    (b) =>
      b.sopName?.toLowerCase().includes(search.toLowerCase()) ||
      b.sopIdentifier?.toLowerCase().includes(search.toLowerCase()),
  );

  if (step === 'selection') {
    return (
      <QuestionBasisSelection
        onSelect={handleBasisSelect}
        onBack={() => router.push('/test')}
        title="Specific Training Test — Choose Question Basis"
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => setStep('selection')}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-2xl font-bold text-white mb-2">Select SOPs</h2>
        <p className="text-slate-400 text-sm mb-6">
          Select one or more SOP banks. Questions will be filtered to Medium/Hard difficulty for
          targeted assessment.
        </p>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SOPs…"
              className="w-full bg-white/10 border border-white/20 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-yellow-400"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-2">
              {filteredBanks.map((bank) => {
                const id = bank._id?.toString() || bank._id;
                const selected = selectedIds.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() =>
                      setSelectedIds((prev) =>
                        selected ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                      selected
                        ? 'bg-yellow-600/20 border-yellow-400 text-yellow-200'
                        : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                          selected ? 'border-yellow-400 bg-yellow-500' : 'border-slate-500'
                        }`}
                      >
                        {selected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                            <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {bank.language && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${bank.language.toLowerCase() === 'gujarati' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>
                              {bank.language.toLowerCase() === 'gujarati' ? 'GU' : 'EN'}
                            </span>
                          )}
                          <span className="truncate">{formatSOPDisplayName(bank.sopName, bank.sopIdentifier)}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>{bank.totalQuestions} questions</span>
                          <span>·</span>
                          <span>{bank.department}</span>
                          {bank.bestScore !== null && (
                            <>
                              <span>·</span>
                              <span className="text-yellow-400">Best: {bank.bestScore}%</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredBanks.length === 0 && !loading && (
                <p className="text-center text-slate-500 py-6 text-sm">No banks found.</p>
              )}
            </div>
          )}

          {selectedIds.length > 0 && (
            <div className="text-xs text-slate-400">
              {selectedIds.length} SOP{selectedIds.length > 1 ? 's' : ''} selected
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={selectedIds.length === 0}
            className="w-full py-3.5 rounded-2xl bg-linear-to-r from-yellow-600 to-orange-600 text-white font-semibold hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            Start Specific Test
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
