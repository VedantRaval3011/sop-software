'use client';

import { BrainCircuit, FileEdit, Sparkles, ListChecks } from 'lucide-react';

import { ArrowLeft } from 'lucide-react';

interface QuestionBasisSelectionProps {
  onSelect: (type: 'ai' | 'manual') => void;
  onBack?: () => void;
  title?: string;
}

export default function QuestionBasisSelection({
  onSelect,
  onBack,
  title = 'Choose Question Basis',
}: QuestionBasisSelectionProps) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}
        <h2 className="text-3xl font-bold text-white text-center mb-2">{title}</h2>
        <p className="text-slate-400 text-center mb-10">
          Select how you want your test questions to be sourced.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* AI Based */}
          <button
            onClick={() => onSelect('ai')}
            className="group relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 text-left hover:bg-white/15 hover:border-purple-400/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/20"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <BrainCircuit className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">AI Based Questions</h3>
                <p className="text-purple-300 text-sm">Smart adaptive selection</p>
              </div>
            </div>

            <ul className="space-y-2 mb-6">
              {[
                'Questions selected from all available banks',
                'Balanced difficulty distribution',
                'No manual filtering required',
                'Broad SOP coverage',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-slate-300 text-sm">
                  <Sparkles className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>

            <div className="w-full py-3 rounded-2xl bg-linear-to-r from-purple-600 to-pink-600 text-white font-semibold text-center group-hover:from-purple-500 group-hover:to-pink-500 transition-all">
              Start AI Test
            </div>
          </button>

          {/* Manual */}
          <button
            onClick={() => onSelect('manual')}
            className="group relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 text-left hover:bg-white/15 hover:border-emerald-400/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-emerald-500/20"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg">
                <FileEdit className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Manual Question Set</h3>
                <p className="text-emerald-300 text-sm">Targeted custom selection</p>
              </div>
            </div>

            <ul className="space-y-2 mb-6">
              {[
                'Filter by specific SOPs or departments',
                'Choose difficulty level (Easy/Medium/Hard)',
                'Control question count',
                'Focused topic coverage',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-slate-300 text-sm">
                  <ListChecks className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>

            <div className="w-full py-3 rounded-2xl bg-linear-to-r from-emerald-600 to-teal-600 text-white font-semibold text-center group-hover:from-emerald-500 group-hover:to-teal-500 transition-all">
              Configure Manual Test
            </div>
          </button>
        </div>

        <div className="mt-8 bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <p className="text-slate-400 text-sm">
            <span className="text-amber-400 font-semibold">Pro Tip:</span> Use AI mode for broad
            knowledge checks and Manual mode when preparing for specific SOP topics or assessments.
          </p>
        </div>
      </div>
    </div>
  );
}
