'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  Flag,
  CheckCircle2,
  Clock,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface QuestionSnapshot {
  aiIcon: string;
  question: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  difficultyStars: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  sopReference: string;
}

interface ReviewItem {
  _id: string;
  sopName: string;
  sopIdentifier: string;
  originalQuestion: QuestionSnapshot;
  editedQuestion?: QuestionSnapshot;
  reviewStatus: 'pending' | 'done';
  flaggedBy?: string;
  flaggedAt: string;
  reviewNotes?: string;
  markedDoneBy?: string;
  markedDoneAt?: string;
  editedBy?: string;
  editedAt?: string;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  Medium: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  Hard: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReviewCard({
  item,
  onMarkDone,
  onDelete,
  markingId,
  deletingId,
}: {
  item: ReviewItem;
  onMarkDone: (id: string) => void;
  onDelete: (id: string) => void;
  markingId: string | null;
  deletingId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const q = item.editedQuestion || item.originalQuestion;
  const isDone = item.reviewStatus === 'done';

  return (
    <div
      className={`bg-white/5 border rounded-2xl overflow-hidden transition-all ${
        isDone ? 'border-emerald-500/20 opacity-70' : 'border-white/15 hover:border-white/25'
      }`}
    >
      {/* Card header */}
      <div className="p-4 flex items-start gap-3">
        <div
          className={`mt-0.5 shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
            isDone ? 'bg-emerald-500/20' : 'bg-rose-500/20'
          }`}
        >
          {isDone ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Flag className="w-4 h-4 text-rose-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-white font-semibold text-sm truncate">
              {item.sopIdentifier} — {item.sopName}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs border ${DIFFICULTY_COLORS[q.difficulty] || 'text-slate-400 bg-white/5 border-white/10'}`}
            >
              {q.difficultyStars} {q.difficulty}
            </span>
            {isDone && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                Reviewed
              </span>
            )}
          </div>

          <p className="text-slate-300 text-sm leading-snug line-clamp-2 mb-2">{q.question}</p>

          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Flagged {formatDate(item.flaggedAt)}
            </span>
            {item.flaggedBy && (
              <span>by <span className="text-slate-400">{item.flaggedBy}</span></span>
            )}
            {isDone && item.markedDoneAt && (
              <span className="text-emerald-600">
                Reviewed {formatDate(item.markedDoneAt)}
                {item.markedDoneBy && ` by ${item.markedDoneBy}`}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/10 pt-4 space-y-4">
          {/* Options */}
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const isCorrect = opt === q.correctAnswer;
              return (
                <div
                  key={i}
                  className={`px-3 py-2 rounded-xl text-sm flex items-start gap-2 ${
                    isCorrect
                      ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-200'
                      : 'bg-white/5 border border-white/10 text-slate-300'
                  }`}
                >
                  <span className="font-semibold text-slate-500 shrink-0">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  {isCorrect && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />}
                  {opt}
                </div>
              );
            })}
          </div>

          {/* Explanation */}
          {q.explanation && (
            <div className="bg-blue-500/10 border border-blue-400/20 rounded-xl p-3 text-sm text-blue-200">
              <BookOpen className="inline w-3.5 h-3.5 mr-1.5 mb-0.5" />
              {q.explanation}
            </div>
          )}

          {/* SOP Reference */}
          {q.sopReference && (
            <p className="text-xs text-slate-500">Ref: {q.sopReference}</p>
          )}

          {/* Review notes */}
          {item.reviewNotes && (
            <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-3 text-sm text-amber-200">
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5 mb-0.5" />
              Note: {item.reviewNotes}
            </div>
          )}

          {/* Was edited indicator */}
          {item.editedQuestion && (
            <p className="text-xs text-purple-400">
              Question was edited by {item.editedBy || 'reviewer'}{' '}
              {item.editedAt ? `on ${formatDate(item.editedAt)}` : ''}
            </p>
          )}

          {/* Actions */}
          {!isDone && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onMarkDone(item._id)}
                disabled={markingId === item._id}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {markingId === item._id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Mark as Reviewed
              </button>
              <button
                onClick={() => onDelete(item._id)}
                disabled={deletingId === item._id}
                className="px-3 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30 text-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingId === item._id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type FilterTab = 'all' | 'pending' | 'done';

export default function MCQReviewPage() {
  useAuthGuard();
  const router = useRouter();
  const { data: session } = useSession();

  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>('pending');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcq-review');
      const data = await res.json();
      if (data.success) setReviews(data.reviews || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const handleMarkDone = async (id: string) => {
    setMarkingId(id);
    try {
      const by = (session?.user as any)?.username || session?.user?.email || 'reviewer';
      await fetch(`/api/mcq-review/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: 'done', markedDoneBy: by }),
      });
      setReviews((prev) =>
        prev.map((r) =>
          r._id === id
            ? { ...r, reviewStatus: 'done', markedDoneBy: by, markedDoneAt: new Date().toISOString() }
            : r,
        ),
      );
    } catch {
      /* non-fatal */
    } finally {
      setMarkingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this review flag? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/mcq-review/${id}`, { method: 'DELETE' });
      setReviews((prev) => prev.filter((r) => r._id !== id));
    } catch {
      /* non-fatal */
    } finally {
      setDeletingId(null);
    }
  };

  const pendingCount = reviews.filter((r) => r.reviewStatus === 'pending').length;
  const doneCount = reviews.filter((r) => r.reviewStatus === 'done').length;

  const filtered = reviews.filter((r) => {
    if (tab === 'pending') return r.reviewStatus === 'pending';
    if (tab === 'done') return r.reviewStatus === 'done';
    return true;
  });

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pendingCount },
    { key: 'done', label: 'Reviewed', count: doneCount },
    { key: 'all', label: 'All', count: reviews.length },
  ];

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <button
            onClick={() => router.push('/test')}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Test Center
          </button>
          <button
            onClick={fetchReviews}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-slate-300 hover:bg-white/20 transition-all text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-1">MCQ Review Center</h1>
          <p className="text-slate-400 text-sm">
            Questions flagged by test-takers for quality review. Mark them as reviewed once checked.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Pending Review', value: pendingCount, color: 'text-rose-400' },
            { label: 'Reviewed', value: doneCount, color: 'text-emerald-400' },
            { label: 'Total Flagged', value: reviews.length, color: 'text-blue-400' },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center"
            >
              <div className={`text-3xl font-bold ${s.color} mb-1`}>{s.value}</div>
              <div className="text-slate-400 text-xs">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                tab === t.key
                  ? 'bg-white/15 border border-white/30 text-white'
                  : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {t.label}
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  tab === t.key ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-500'
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50" />
            <p className="text-slate-400 text-sm">
              {tab === 'pending'
                ? 'No questions pending review. All caught up!'
                : 'No items in this category.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <ReviewCard
                key={item._id}
                item={item}
                onMarkDone={handleMarkDone}
                onDelete={handleDelete}
                markingId={markingId}
                deletingId={deletingId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
