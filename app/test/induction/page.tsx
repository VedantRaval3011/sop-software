'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useSession } from 'next-auth/react';
import QuestionBasisSelection from '@/components/QuestionBasisSelection';
import TestRunner from '@/components/TestRunner';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';

type Step = 'selection' | 'criteria' | 'testing';

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Any'] as const;
const MAX_DEPTS = 2;

export default function InductionTestPage() {
  useAuthGuard();
  const router = useRouter();
  const { data: session } = useSession();

  const [step, setStep] = useState<Step>('selection');
  const [basis, setBasis] = useState<'ai' | 'manual'>('ai');
  const [difficulty, setDifficulty] = useState<string>('Any');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(20);
  const [departments, setDepartments] = useState<string[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/departments')
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments || []))
      .catch(() => {});
  }, []);

  const handleBasisSelect = (type: 'ai' | 'manual') => {
    setBasis(type);
    setStep('criteria');
  };

  const toggleDept = (dept: string) => {
    setSelectedDepts((prev) => {
      if (prev.includes(dept)) return prev.filter((d) => d !== dept);
      if (prev.length >= MAX_DEPTS) {
        alert(`Maximum ${MAX_DEPTS} departments allowed for induction tests.`);
        return prev;
      }
      return [...prev, dept];
    });
  };

  const generate = async () => {
    if (selectedDepts.length === 0) {
      setError('Please select at least one department.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/test/induction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: basis,
          difficulty: basis === 'manual' ? difficulty : undefined,
          departments: selectedDepts,
          questionCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate questions');
      setQuestions(data.questions || []);
      setStep('testing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (score: number, total: number, answers?: Record<number, string>, timeTaken?: number) => {
    if (!session?.user || !questions.length) return;
    const bankId = questions[0]?.mcqBankId;
    if (!bankId) return;
    try {
      await fetch('/api/mcq-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: (session.user as any).id || session.user.email,
          username: (session.user as any).username || session.user.email,
          userFullName: session.user.name,
          mcqBankId: bankId,
          answers: Object.entries(answers || {}).map(([qi, ans]) => ({
            questionIndex: parseInt(qi),
            selectedAnswer: ans,
          })),
          timeTaken: timeTaken || 0,
          startedAt: new Date(Date.now() - (timeTaken || 0) * 1000).toISOString(),
          testName: 'Induction Training Test',
        }),
      });
    } catch { /* non-fatal */ }
  };

  if (step === 'testing') {
    return (
      <TestRunner
        questions={questions}
        title="Induction Training Test"
        onExit={() => setStep('selection')}
        onComplete={handleComplete}
      />
    );
  }

  if (step === 'selection') {
    return (
      <QuestionBasisSelection
        onSelect={handleBasisSelect}
        onBack={() => router.push('/test')}
        title="Induction Training Test — Choose Question Basis"
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

        <h2 className="text-2xl font-bold text-white mb-2">Configure Induction Test</h2>
        <p className="text-slate-400 text-sm mb-6">
          Select up to {MAX_DEPTS} departments for this induction assessment.
        </p>

        <div className="space-y-5">
          {/* Department selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-medium text-sm">Departments</span>
              <span className="text-slate-400 text-xs">
                {selectedDepts.length}/{MAX_DEPTS} selected
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {departments.map((dept) => {
                const selected = selectedDepts.includes(dept);
                const disabled = !selected && selectedDepts.length >= MAX_DEPTS;
                return (
                  <button
                    key={dept}
                    onClick={() => toggleDept(dept)}
                    disabled={disabled}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-all ${
                      selected
                        ? 'bg-purple-600/30 border-purple-400 text-purple-200'
                        : disabled
                          ? 'bg-white/5 border-white/10 text-slate-600 cursor-not-allowed'
                          : 'bg-white/5 border-white/20 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Difficulty (manual mode only) */}
          {basis === 'manual' && (
            <div>
              <span className="text-white font-medium text-sm block mb-3">Difficulty</span>
              <div className="grid grid-cols-4 gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                      difficulty === d
                        ? 'bg-purple-600/30 border-purple-400 text-purple-200'
                        : 'bg-white/5 border-white/20 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question count */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white font-medium text-sm">Number of Questions</span>
              <span className="text-purple-300 font-bold">{questionCount}</span>
            </div>
            <input
              type="range" min={5} max={50} step={5} value={questionCount}
              onChange={(e) => setQuestionCount(parseInt(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>5</span><span>50</span>
            </div>
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-400/30 rounded-xl p-3 text-rose-300 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={generate}
            disabled={loading || selectedDepts.length === 0}
            className="w-full py-3.5 rounded-2xl bg-linear-to-r from-purple-600 to-pink-600 text-white font-semibold hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Generating…</>
            ) : (
              <>Generate {questionCount} Questions<ChevronRight className="w-5 h-5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
