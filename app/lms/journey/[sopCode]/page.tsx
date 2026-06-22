'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, PlayCircle,
  FileText, BookOpen, ClipboardList, Lock, Loader2, AlertCircle,
  Volume2, Trophy, X, Award, RefreshCw, Clock,
  Maximize2, ExternalLink, Download,
} from 'lucide-react';
import type { JourneyStep } from '@/app/api/lms/journey/[sopCode]/route';
import { buildOfficeOnlineEmbedUrl } from '@/lib/file-urls';
import {
  invalidateLmsClientFields,
  lmsClientFields,
  LMS_CLIENT_FRESH_MS,
  readLmsClientCache,
  writeLmsClientCache,
} from '@/lib/lmsCache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MCQQuestion {
  _id: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

interface DisplayOption { label: 'A' | 'B' | 'C' | 'D'; text: string; }
interface PreparedQuestion extends MCQQuestion { displayOptions: DisplayOption[]; }

interface QuizSettings {
  passingScore: number;
  timeLimitMinutes: number;
  shuffleOptions: boolean;
  showAnswersAfterTrial: boolean;
  maxAttempts: number;       // total exam attempts before answers are revealed (0 = unlimited)
  examQuestionCount: number; // full-exam question count, used to pace the timer
}

interface JourneyData {
  sop: { name: string; identifier: string; department: string } | null;
  progress: { overallPercentage: number; status: string; steps: Record<string, unknown> } | null;
  steps: JourneyStep[];
  availableSteps: string[];
}

// ─── Step icon mapping ────────────────────────────────────────────────────────

function StepIcon({ type, size = 4 }: { type: string; size?: number }) {
  const cls = `h-${size} w-${size}`;
  if (type === 'video')  return <PlayCircle className={cls} />;
  if (type === 'slides') return <FileText className={cls} />;
  if (type === 'pdf')    return <BookOpen className={cls} />;
  if (type === 'quiz')   return <ClipboardList className={cls} />;
  return <FileText className={cls} />;
}

// ─── Video step ───────────────────────────────────────────────────────────────

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function VideoStep({
  step,
  onProgress,
  onComplete,
}: {
  step: JourneyStep;
  onProgress: (pct: number, ts: number) => void;
  onComplete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReported = useRef(step.percentage ?? 0);
  const nearEndFired = useRef(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const urls = step.urls || [];

  // Reset near-end guard when video src changes
  useEffect(() => { nearEndFired.current = false; }, [currentIdx]);

  const handleSpeedChange = (s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  };

  // Restore position on first load
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !step.lastTimestamp) return;
    v.currentTime = step.lastTimestamp;
  }, [currentIdx, step.lastTimestamp]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || isNaN(v.duration) || v.duration === 0) return;

    // Stop playback 2 s before end and treat as finished (hides watermark outro)
    if (!nearEndFired.current && v.duration > 4 && v.currentTime >= v.duration - 2) {
      nearEndFired.current = true;
      v.pause();
      if (currentIdx < urls.length - 1) {
        nearEndFired.current = false;
        setCurrentIdx((i) => i + 1);
      } else {
        onProgress(100, 0);
        onComplete();
      }
      return;
    }

    const pct = Math.round((v.currentTime / v.duration) * 100);
    if (pct >= lastReported.current + 5) {
      lastReported.current = pct;
      onProgress(pct, Math.round(v.currentTime));
    }
  };

  // Prevent seeking into the last 2 seconds
  const handleSeeked = () => {
    const v = videoRef.current;
    if (!v || isNaN(v.duration) || v.duration === 0) return;
    if (v.currentTime > v.duration - 2) {
      v.currentTime = Math.max(0, v.duration - 2);
    }
  };

  if (urls.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <p className="text-sm">No video available for this step.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {urls.length > 1 && (
        <div className="flex items-center gap-2">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                i === currentIdx ? 'bg-purple-600 text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              Part {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Video container — overflow:hidden clips any branding that extends outside */}
      <div className="relative overflow-hidden rounded-xl bg-black shadow-lg select-none">
        <video
          ref={videoRef}
          key={urls[currentIdx]}
          src={urls[currentIdx]}
          controls
          controlsList="nodownload nofullscreen"
          disablePictureInPicture
          className="w-full"
          style={{ maxHeight: '60vh' }}
          onTimeUpdate={handleTimeUpdate}
          onSeeked={handleSeeked}
          onContextMenu={(e) => e.preventDefault()}
        >
          Your browser does not support HTML5 video.
        </video>
        {/* Overlay that covers the third-party watermark in the bottom-right corner */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-10 right-0 h-7 w-36 bg-black"
        />
      </div>

      {/* Speed controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400 shrink-0">Speed:</span>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                speed === s
                  ? 'bg-purple-600 text-white'
                  : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Volume2 className="h-3.5 w-3.5" /> Audio controls in player</span>
        </span>
      </div>
      {step.completed ? (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          <Check className="h-3.5 w-3.5" /> Marked as watched. You may re-watch anytime.
        </div>
      ) : (
        <button
          onClick={() => { onProgress(100, 0); onComplete(); }}
          className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <Check className="h-4 w-4 text-green-500" /> Mark as Watched
        </button>
      )}
    </div>
  );
}

// ─── Slides step ──────────────────────────────────────────────────────────────

function SlidesStep({
  step,
  onComplete,
}: {
  step: JourneyStep;
  onComplete: () => void;
}) {
  const urls = step.urls || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [acknowledged, setAcknowledged] = useState(step.completed);

  if (urls.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <p className="text-sm">No slides available for this step.</p>
      </div>
    );
  }

  const isLast = currentIdx === urls.length - 1;

  return (
    <div className="flex flex-1 flex-col gap-3">
      {urls.length > 1 && (
        <div className="flex items-center gap-2">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                i === currentIdx ? 'bg-purple-600 text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              Deck {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden rounded-xl border border-gray-200 shadow-sm" style={{ minHeight: '55vh' }}>
        <iframe
          src={urls[currentIdx]}
          className="h-full w-full"
          style={{ minHeight: '55vh' }}
          title={`${step.label} - Deck ${currentIdx + 1}`}
        />
      </div>
      {!acknowledged && isLast && (
        <button
          onClick={() => { setAcknowledged(true); onComplete(); }}
          className="flex items-center justify-center gap-2 rounded-lg bg-purple-600 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          <Check className="h-4 w-4" /> Mark Slides as Viewed
        </button>
      )}
      {(acknowledged || step.completed) && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          <Check className="h-3.5 w-3.5" /> Slides reviewed. You can revisit them anytime.
        </div>
      )}
    </div>
  );
}

// ─── PDF step ─────────────────────────────────────────────────────────────────

function PdfStep({
  step,
  onComplete,
}: {
  step: JourneyStep;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(step.completed);

  // While the immersive reader is open, lock background scroll and allow ESC to exit.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  if (!step.url) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <p className="text-sm">SOP document not available.</p>
      </div>
    );
  }

  const isDocx = step.fileType === 'docx' || step.url.toLowerCase().endsWith('.docx');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // PDFs render through the same preview route the dashboard uses, so the inline
  // and full-screen previews look identical to the dashboard. DOCX uses Office Online.
  const viewerSrc = isDocx
    ? buildOfficeOnlineEmbedUrl(step.url, origin)
    : `/api/sops/preview?path=${encodeURIComponent(step.url)}&type=pdf`;

  const reviewed = acknowledged || step.completed;
  const markReviewed = () => { setAcknowledged(true); onComplete(); };

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Landing card — prevents auto-download on page load */}
      {!open && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl border border-gray-200 bg-linear-to-b from-gray-50 to-white py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-gray-100">
            <BookOpen className="h-8 w-8 text-purple-500" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-700">SOP Document</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {isDocx ? 'Word document' : 'PDF'} · Read it in the viewer or fullscreen
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-purple-700"
            >
              <BookOpen className="h-4 w-4" /> View Document
            </button>
            <button
              onClick={() => { setOpen(true); setFullscreen(true); }}
              className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm font-medium text-purple-700 hover:bg-purple-100"
            >
              <Maximize2 className="h-4 w-4" /> Read Fullscreen
            </button>
            <a
              href={step.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <ExternalLink className="h-4 w-4" /> Open in new tab
            </a>
          </div>
          {step.completed ? (
            <span className="flex items-center gap-1.5 text-xs text-green-600">
              <Check className="h-3.5 w-3.5" /> Already marked as read
            </span>
          ) : (
            <button
              onClick={markReviewed}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-green-600"
            >
              <Check className="h-3.5 w-3.5" /> Mark as Read (without opening)
            </button>
          )}
        </div>
      )}

      {open && (
        <>
          {/* Inline viewer toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Hide document
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFullscreen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
              </button>
              <a
                href={step.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
              <a
                href={step.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" /> New tab
              </a>
            </div>
          </div>

          {/* Inline viewer — clean white frame, edge-to-edge like the dashboard preview */}
          <div className="flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm h-[70vh] sm:h-[76vh] lg:h-[80vh]">
            <iframe
              src={viewerSrc}
              className="h-full w-full border-0"
              title="SOP Document"
            />
          </div>

          {!reviewed ? (
            <button
              onClick={markReviewed}
              className="flex items-center justify-center gap-2 rounded-lg bg-purple-600 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
            >
              <Check className="h-4 w-4" /> Confirm I have read this document
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
              <Check className="h-3.5 w-3.5" /> Document reviewed. You can re-open it anytime.
            </div>
          )}
        </>
      )}

      {/* Immersive full-screen reader */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#e5e7eb]">
          {/* Header chrome */}
          <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2 shadow-sm sm:px-4">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-700">
              <FileText className="h-4 w-4 shrink-0 text-purple-600" />
              <span className="truncate">{step.label || 'SOP Document'}</span>
            </span>
            <div className="flex items-center gap-2">
              {!reviewed && (
                <button
                  onClick={markReviewed}
                  className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                >
                  <Check className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Mark as read</span>
                </button>
              )}
              <a
                href={step.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Download</span>
              </a>
              <button
                onClick={() => setFullscreen(false)}
                className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Document fills the rest of the screen, centered like the dashboard */}
          <div className="min-h-0 flex-1 p-2 sm:p-3">
            <iframe
              src={viewerSrc}
              className="mx-auto h-full min-h-[480px] w-full max-w-[1200px] rounded-lg border border-gray-200 bg-white shadow-md"
              title="SOP Document (full screen)"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quiz step ────────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepareQuestions(qs: MCQQuestion[], shuffleOpts: boolean): PreparedQuestion[] {
  return qs.map((q) => {
    let opts: DisplayOption[] = [
      { label: 'A', text: q.optionA },
      { label: 'B', text: q.optionB },
      { label: 'C', text: q.optionC },
      { label: 'D', text: q.optionD },
    ];
    if (shuffleOpts) opts = shuffleArray(opts);
    return { ...q, displayOptions: opts };
  });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const MAX_TAB_VIOLATIONS = 2; // warnings before auto-submit

// Default pacing when no admin time limit is set — the exam timer is always on.
const SECONDS_PER_QUESTION = 45;

/** Seconds allotted for a quiz of `questionCount` questions. Honors an explicit
 *  admin time limit (scaled per-question so retests get proportional time), else
 *  falls back to the per-question default so every test is timed. */
function timerSecondsFor(settings: QuizSettings | null, questionCount: number): number {
  if (questionCount <= 0) return 0;
  const configured = settings?.timeLimitMinutes ?? 0;
  if (configured > 0) {
    const fullCount = settings?.examQuestionCount && settings.examQuestionCount > 0
      ? settings.examQuestionCount
      : questionCount;
    const perQuestion = (configured * 60) / fullCount;
    return Math.max(30, Math.ceil(perQuestion * questionCount));
  }
  return questionCount * SECONDS_PER_QUESTION;
}

function QuizStep({
  sopCode,
  step,
  onComplete,
  onExamActive,
}: {
  sopCode: string;
  step: JourneyStep;
  onComplete: (score: number, passed: boolean, isTrial: boolean, newAttempts: number) => void;
  onExamActive: (active: boolean) => void;
}) {
  const [localAttempts, setLocalAttempts] = useState(step.attempts ?? 0);
  const [mode, setMode] = useState<'trial' | 'exam'>(step.attempts === 0 ? 'trial' : 'exam');
  const [phase, setPhase] = useState<'loading' | 'answering' | 'review'>('loading');
  const [questions, setQuestions] = useState<PreparedQuestion[]>([]);
  const [settings, setSettings] = useState<QuizSettings | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [error, setError] = useState('');
  const submitRef = useRef<(() => void) | null>(null);

  // Retest: after a failed exam the learner re-attempts ONLY the questions they
  // missed, and must answer all of them correctly (100%) to pass.
  const [isRetest, setIsRetest] = useState(false);
  const [retestQueue, setRetestQueue] = useState<PreparedQuestion[]>([]);
  // Exam/retest attempts used this session — drives the attempt allocation and
  // gates when correct answers are finally revealed. (Demo attempts don't count.)
  const [examAttempts, setExamAttempts] = useState(0);

  // Tab-switch violation tracking (exam only)
  const violationsRef = useRef(0);
  const [violations, setViolations] = useState(0);
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const lastViolationTs = useRef(0);

  const fetchQuestions = useCallback(async (m: 'trial' | 'exam') => {
    setPhase('loading');
    setAnswers({});
    setScore(0);
    setError('');
    setIsRetest(false);
    setRetestQueue([]);
    setExamAttempts(0);
    try {
      const res = await fetch(`/api/lms/quiz/${sopCode}?mode=${m}`);
      const data = await res.json() as {
        questions?: MCQQuestion[];
        settings?: QuizSettings;
        error?: string;
      };
      if (!data.questions?.length) { setError(data.error || 'No questions available.'); setPhase('review'); return; }
      setSettings(data.settings ?? null);
      setQuestions(prepareQuestions(data.questions, data.settings?.shuffleOptions ?? false));
      setPhase('answering');
    } catch {
      setError('Failed to load quiz. Please try again.');
      setPhase('review');
    }
  }, [sopCode]);

  useEffect(() => { fetchQuestions(mode); }, [fetchQuestions, mode]);

  // Countdown timer — always enabled for exams and retests (paced per question).
  useEffect(() => {
    if (mode !== 'exam' || phase !== 'answering' || questions.length === 0) {
      setTimeLeft(null);
      return;
    }
    const secs = timerSecondsFor(settings, questions.length);
    if (secs <= 0) { setTimeLeft(null); return; }
    setTimeLeft(secs);
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          submitRef.current?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, phase, settings, questions.length]);

  // Notify parent when exam is active (to lock sidebar navigation)
  useEffect(() => {
    const examIsRunning = mode === 'exam' && phase === 'answering';
    onExamActive(examIsRunning);
    return () => { if (examIsRunning) onExamActive(false); };
  }, [mode, phase, onExamActive]);

  // Tab-switch / focus-loss detection during exam
  useEffect(() => {
    if (mode !== 'exam' || phase !== 'answering') return;

    const fireViolation = () => {
      const now = Date.now();
      if (now - lastViolationTs.current < 800) return; // debounce
      lastViolationTs.current = now;

      violationsRef.current += 1;
      const v = violationsRef.current;
      setViolations(v);

      if (v > MAX_TAB_VIOLATIONS) {
        // Already past limit — auto-submit
        submitRef.current?.();
      } else {
        setShowViolationWarning(true);
      }
    };

    const onVisibilityChange = () => { if (document.hidden) fireViolation(); };
    const onBlur = () => fireViolation();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [mode, phase]);

  const handleSubmit = useCallback(() => {
    let correct = 0;
    const wrong: PreparedQuestion[] = [];
    for (const q of questions) {
      if (answers[q._id] === q.correctAnswer) correct++;
      else wrong.push(q);
    }
    const pct = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const newAttempts = localAttempts + 1;
    setScore(pct);
    setLocalAttempts(newAttempts);
    setRetestQueue(wrong);
    setPhase('review');

    if (mode === 'trial') {
      onComplete(pct, false, true, newAttempts);
    } else {
      // A retest must be answered perfectly; the main exam uses the configured score.
      const required = isRetest ? 100 : (settings?.passingScore ?? 80);
      const passed = pct >= required;
      setExamAttempts((n) => n + 1);
      onComplete(pct, passed, false, newAttempts);
    }
  }, [questions, answers, localAttempts, mode, isRetest, settings, onComplete]);

  // Keep ref in sync so timer can auto-submit
  useEffect(() => { submitRef.current = handleSubmit; }, [handleSubmit]);

  const [showExamConfirm, setShowExamConfirm] = useState(false);

  const startExam = () => {
    setMode('exam');
    fetchQuestions('exam');
  };

  // Re-attempt only the questions missed in the previous attempt. Each retest
  // narrows to whatever is still wrong, and requires every answer to be correct.
  const startRetest = () => {
    setQuestions(retestQueue);
    setAnswers({});
    setScore(0);
    setError('');
    setIsRetest(true);
    setPhase('answering');
  };

  // ── Already passed (step.completed) — show summary ──────────────────────────
  if (step.completed && phase === 'loading' && localAttempts === (step.attempts ?? 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <Trophy className="h-8 w-8 text-green-600" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-gray-800">Assessment completed</p>
          <p className="mt-1 text-sm text-gray-500">
            You passed with {step.percentage ?? '—'}%. Retake anytime below.
          </p>
        </div>
        <button
          onClick={() => { setMode('exam'); fetchQuestions('exam'); }}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retake Assessment
        </button>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'review' && error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </div>
    );
  }

  // ── Review after trial ─────────────────────────────────────────────────────
  if (phase === 'review' && mode === 'trial') {
    const showAnswers = settings?.showAnswersAfterTrial ?? true;
    return (
      <div className="flex flex-1 flex-col gap-5 py-4">
        {/* Trial result banner */}
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
            <ClipboardList className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-800">Demo Assessment Complete — {score}%</p>
            <p className="text-xs text-blue-600">
              {questions.filter((q) => answers[q._id] === q.correctAnswer).length} of {questions.length} correct ·
              This was a demo — no pass/fail pressure
            </p>
          </div>
        </div>

        {/* Answer review */}
        {showAnswers && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Demo Answer Review</p>
            {questions.map((q, i) => {
              const given = answers[q._id];
              const isRight = given === q.correctAnswer;
              const correctText = q.displayOptions.find((o) => o.label === q.correctAnswer)?.text ?? q.correctAnswer;
              const givenText = q.displayOptions.find((o) => o.label === given)?.text;
              return (
                <div
                  key={q._id}
                  className={`rounded-xl border p-3 text-sm ${isRight ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
                >
                  <p className="font-medium text-gray-800">{i + 1}. {q.question}</p>
                  <p className={`mt-1 text-xs ${isRight ? 'text-green-700' : 'text-red-700'}`}>
                    {isRight
                      ? `Correct: ${correctText}`
                      : <>Your answer: {givenText || '—'} · Correct: {correctText}</>
                    }
                  </p>
                  {!isRight && q.explanation && (
                    <p className="mt-1 text-xs text-gray-500">{q.explanation}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Start exam CTA */}
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
          <p className="text-sm font-bold text-purple-800">Ready to take the exam?</p>
          <p className="mt-0.5 text-xs text-purple-600">
            The exam has {settings ? `${settings.passingScore}% passing score` : 'a passing score'}
            {settings?.timeLimitMinutes ? ` and a ${settings.timeLimitMinutes}-minute time limit` : ''}.
            Your demo score does not count.
          </p>
          <button
            onClick={() => setShowExamConfirm(true)}
            className="mt-3 flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-purple-700"
          >
            <ClipboardList className="h-4 w-4" /> Start Main Exam
          </button>

          {/* Exam start confirmation modal */}
          {showExamConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
                  <ClipboardList className="h-7 w-7 text-purple-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-800">Starting Main Exam</h3>
                <p className="mt-2 text-sm text-gray-600">
                  You are about to begin the <strong>official exam</strong>. Please note:
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-purple-100 text-center text-[10px] font-bold leading-4 text-purple-700">1</span>
                    Do <strong>not</strong> switch tabs or windows during the exam.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-purple-100 text-center text-[10px] font-bold leading-4 text-purple-700">2</span>
                    You have <strong>{MAX_TAB_VIOLATIONS} warnings</strong> before your exam is auto-submitted.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-purple-100 text-center text-[10px] font-bold leading-4 text-purple-700">3</span>
                    The exam is <strong>timed</strong> — you have about{' '}
                    <strong>
                      {Math.max(1, Math.round(timerSecondsFor(settings, settings?.examQuestionCount ?? 20) / 60))} minutes
                    </strong>{' '}
                    to complete it.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-purple-100 text-center text-[10px] font-bold leading-4 text-purple-700">4</span>
                    You must score the required passing marks to complete this training.
                  </li>
                </ul>
                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setShowExamConfirm(false)}
                    className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Not Yet
                  </button>
                  <button
                    onClick={() => { setShowExamConfirm(false); startExam(); }}
                    className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
                  >
                    Yes, Start Exam
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Review after exam ──────────────────────────────────────────────────────
  if (phase === 'review' && mode === 'exam') {
    const passingScore = isRetest ? 100 : (settings?.passingScore ?? 80);
    const passed = score >= passingScore;
    const missedCount = retestQueue.length;
    const maxAttempts = settings?.maxAttempts ?? 0;          // 0 = unlimited
    const attemptsExhausted = maxAttempts > 0 && examAttempts >= maxAttempts;
    const attemptsLeft = maxAttempts > 0 ? Math.max(0, maxAttempts - examAttempts) : null;
    const canRetest = !passed && missedCount > 0 && !attemptsExhausted;
    // Correct answers stay hidden through every retry — revealed only once the
    // learner passes or has used up all allocated attempts without passing.
    const revealAnswers = passed || attemptsExhausted;
    return (
      <div className="flex flex-1 flex-col items-center gap-5 py-6">
        {/* Prominent score hero */}
        <div className={`flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border px-8 py-10 text-center shadow-sm ${
          passed
            ? 'border-green-200 bg-linear-to-b from-green-50 to-white'
            : 'border-red-200 bg-linear-to-b from-red-50 to-white'
        }`}>
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${passed ? 'bg-green-100' : 'bg-red-100'}`}>
            {passed
              ? <Trophy className="h-8 w-8 text-green-600" />
              : <X className="h-8 w-8 text-red-500" />}
          </div>
          <p className={`flex items-start justify-center font-black leading-none tracking-tight tabular-nums ${passed ? 'text-green-600' : 'text-red-600'}`}>
            <span className="text-7xl sm:text-8xl">{score}</span>
            <span className="mt-1 text-3xl font-extrabold sm:text-4xl">%</span>
          </p>
          <p className={`text-base font-bold ${passed ? 'text-green-700' : 'text-red-700'}`}>
            {passed
              ? 'Congratulations — you passed!'
              : isRetest
              ? 'Retest not complete — every question must be correct'
              : `Did not pass — minimum is ${passingScore}%`}
          </p>
          <span className="inline-flex items-center rounded-full bg-white px-3.5 py-1 text-xs font-semibold text-gray-600 shadow-sm ring-1 ring-inset ring-gray-200">
            {questions.filter((q) => answers[q._id] === q.correctAnswer).length} of {questions.length} correct
          </span>
        </div>

        {/* Answers stay hidden while retries remain */}
        {!revealAnswers && (
          <div className="flex w-full max-w-md items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <p className="text-xs text-gray-500">
              The correct answers stay hidden while you still have attempts left, so your retest
              is a fair test of what you&apos;ve learned. They&apos;ll be shown only if you use all
              attempts without passing.
            </p>
          </div>
        )}

        {/* Answer review — only once revealed */}
        {revealAnswers && (
          <div className="w-full max-w-2xl space-y-3">
            {questions.map((q, i) => {
              const given = answers[q._id];
              const isRight = given === q.correctAnswer;
              const correctText = q.displayOptions.find((o) => o.label === q.correctAnswer)?.text ?? q.correctAnswer;
              const givenText = q.displayOptions.find((o) => o.label === given)?.text;
              return (
                <div
                  key={q._id}
                  className={`rounded-xl border p-3 text-sm ${isRight ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
                >
                  <p className="font-medium text-gray-800">{i + 1}. {q.question}</p>
                  <p className={`mt-1 text-xs ${isRight ? 'text-green-700' : 'text-red-700'}`}>
                    {isRight
                      ? `Correct: ${correctText}`
                      : <>Your answer: {givenText || '—'} · Correct: {correctText}</>
                    }
                  </p>
                  {!isRight && q.explanation && (
                    <p className="mt-1 text-xs text-gray-500">{q.explanation}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canRetest && (
          <div className="flex w-full max-w-2xl flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-semibold text-amber-800">
              {isRetest
                ? `Almost there — ${missedCount} question${missedCount !== 1 ? 's' : ''} still need a correct answer.`
                : `No need to redo the whole exam — just the ${missedCount} question${missedCount !== 1 ? 's' : ''} you missed.`}
            </p>
            <p className="text-xs text-amber-700">
              This retest includes <strong>only your incorrect questions</strong> and requires
              <strong> 100%</strong> — answer them all correctly to complete the assessment.
            </p>
            <button
              onClick={startRetest}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-purple-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Start Retest · {missedCount} question{missedCount !== 1 ? 's' : ''}
            </button>
            {attemptsLeft !== null && (
              <p className="text-[11px] font-medium text-amber-600">
                {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining
              </p>
            )}
          </div>
        )}

        {attemptsExhausted && !passed && (
          <div className="flex w-full max-w-2xl flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-semibold text-red-800">
              You&apos;ve used all {maxAttempts} attempt{maxAttempts !== 1 ? 's' : ''}.
            </p>
            <p className="text-xs text-red-700">
              The correct answers and explanations for the questions you missed are shown above.
              Please review them and contact your trainer to be re-assigned this assessment.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Answering phase ────────────────────────────────────────────────────────
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q._id]);
  const passingScore = isRetest ? 100 : (settings?.passingScore ?? 80);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Violation warning overlay */}
      {showViolationWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-base font-bold text-gray-800">Tab Switch Detected</h3>
            <p className="mt-1 text-sm text-gray-600">
              You left the exam window. This has been recorded.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Warning {violations} of {MAX_TAB_VIOLATIONS} — {MAX_TAB_VIOLATIONS - violations} remaining before auto-submit
            </div>
            <button
              onClick={() => setShowViolationWarning(false)}
              className="mt-4 w-full rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Return to Exam
            </button>
          </div>
        </div>
      )}

      {/* Mode banner */}
      <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium ${
        mode === 'trial'
          ? 'border border-blue-200 bg-blue-50 text-blue-700'
          : isRetest
          ? 'border border-amber-200 bg-amber-50 text-amber-700'
          : 'border border-purple-200 bg-purple-50 text-purple-700'
      }`}>
        <span>
          {mode === 'trial'
            ? `Demo Assessment — ${questions.length} sample questions · No pass/fail`
            : isRetest
            ? `Retest — ${questions.length} missed question${questions.length !== 1 ? 's' : ''} · Must answer all correctly (100%)`
            : `Exam — ${questions.length} questions · Pass: ${passingScore}%`}
        </span>
        <div className="flex items-center gap-3">
          {violations > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
              ⚠ {violations}/{MAX_TAB_VIOLATIONS} warnings
            </span>
          )}
          {mode === 'exam' && timeLeft !== null && (
            <span className={`flex items-center gap-1 font-bold tabular-nums ${timeLeft < 60 ? 'text-red-600' : ''}`}>
              <Clock className="h-3.5 w-3.5" /> {formatTime(timeLeft)}
            </span>
          )}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-5">
        {questions.map((q, i) => (
          <div key={q._id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-800">{i + 1}. {q.question}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {q.displayOptions.map((opt) => {
                const selected = answers[q._id] === opt.label;
                return (
                  <button
                    key={opt.label}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q._id]: opt.label }))}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                      selected
                        ? 'border-purple-400 bg-purple-50 font-medium text-purple-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-purple-200 hover:bg-purple-50/50'
                    }`}
                  >
                    <span className="mr-2 font-semibold">{opt.label}.</span>{opt.text}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="flex items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 text-sm font-medium text-white shadow hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ClipboardList className="h-4 w-4" />
        {mode === 'trial' ? 'Submit Demo' : isRetest ? 'Submit Retest' : 'Submit Exam'}
      </button>
    </div>
  );
}

// ─── Main journey page ────────────────────────────────────────────────────────

export default function JourneyPage() {
  const params = useParams<{ sopCode: string }>();
  const router = useRouter();
  const sopCode = params.sopCode;

  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [localSteps, setLocalSteps] = useState<JourneyStep[]>([]);
  const [overallPct, setOverallPct] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [hasCert, setHasCert] = useState(false);
  const [examActive, setExamActive] = useState(false);
  const [showLockedAlert, setShowLockedAlert] = useState(false);
  const [showAssessmentIntro, setShowAssessmentIntro] = useState(false);
  const [pendingQuizIdx, setPendingQuizIdx] = useState<number | null>(null);

  const applyJourneyData = useCallback((json: JourneyData) => {
    setData(json);
    setLocalSteps(json.steps);
    const pct = json.progress?.overallPercentage ?? 0;
    setOverallPct(pct);
    const firstIncomplete = json.steps.findIndex((s) => !s.completed);
    setCurrentStep(firstIncomplete >= 0 ? firstIncomplete : 0);
  }, []);

  const load = useCallback(async (force = false) => {
    const field = lmsClientFields.journey(sopCode);
    const cached = !force ? readLmsClientCache<JourneyData>(field) : null;
    if (cached?.value) {
      applyJourneyData(cached.value);
      setLoading(false);
      if (Date.now() - cached.cachedAt <= LMS_CLIENT_FRESH_MS) {
        const pct = cached.value.progress?.overallPercentage ?? 0;
        if (pct >= 100) {
          const certCached = readLmsClientCache<{ certificate: unknown }>(lmsClientFields.certificate(sopCode));
          if (certCached?.value?.certificate) setHasCert(true);
        }
        return;
      }
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/lms/journey/${sopCode}`);
      if (res.status === 401) { router.push('/lms'); return; }
      const json = await res.json() as JourneyData;
      applyJourneyData(json);
      writeLmsClientCache(field, json);
      const pct = json.progress?.overallPercentage ?? 0;
      if (pct >= 100) {
        const certRes = await fetch(`/api/lms/certificate/${sopCode}`);
        const certData = await certRes.json();
        if (certData.certificate) {
          setHasCert(true);
          writeLmsClientCache(lmsClientFields.certificate(sopCode), certData);
        }
      }
    } catch {
      setError('Failed to load training.');
    } finally {
      setLoading(false);
    }
  }, [sopCode, router, applyJourneyData]);

  useEffect(() => { load(); }, [load]);

  const updateProgress = useCallback(async (stepId: string, payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/lms/progress/${sopCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepId, availableSteps: data?.availableSteps, ...payload }),
      });
      const json = await res.json();
      if (json.progress) {
        const newPct = json.progress.overallPercentage ?? 0;
        setOverallPct(newPct);
        invalidateLmsClientFields(
          lmsClientFields.journey(sopCode),
          lmsClientFields.dashboard,
          lmsClientFields.certificate(sopCode),
        );
        if (newPct >= 100 && !hasCert) {
          const certRes = await fetch(`/api/lms/certificate/${sopCode}`);
          const certData = await certRes.json();
          if (certData.certificate) setHasCert(true);
        }
      }
    } catch { /* non-critical */ }
  }, [sopCode, data?.availableSteps, hasCert]);

  const markStepComplete = useCallback((stepId: string) => {
    setLocalSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, completed: true } : s)),
    );
    updateProgress(stepId, { completed: true });
  }, [updateProgress]);

  const handleVideoProgress = useCallback((stepId: string, pct: number, ts: number) => {
    updateProgress(stepId, { percentage: pct, lastTimestamp: ts });
  }, [updateProgress]);

  const handleQuizComplete = useCallback((
    stepId: string,
    score: number,
    passed: boolean,
    isTrial: boolean,
    newAttempts: number,
  ) => {
    if (isTrial) {
      // Trial done — update attempts count only, step not yet complete
      setLocalSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, attempts: newAttempts } : s)),
      );
      updateProgress(stepId, { completed: false, score, attempts: newAttempts });
    } else {
      // Never un-complete: if they already passed and retake fails, keep completed=true
      setLocalSteps((prev) =>
        prev.map((s) => {
          if (s.id !== stepId) return s;
          return { ...s, completed: passed || s.completed, attempts: newAttempts };
        }),
      );
      updateProgress(stepId, { completed: passed, passed, score, attempts: newAttempts });

      // Trigger celebration and certificate ONLY when the exam is passed in this session
      if (passed) {
        setShowCelebration(true);
        fetch(`/api/lms/certificate/${sopCode}`, { method: 'POST' })
          .then((r) => r.json())
          .then((d) => { if (d.certificate) setHasCert(true); })
          .catch(() => {});
      }
    }
  }, [updateProgress, sopCode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-gray-600">{error}</p>
        <button onClick={() => router.push('/lms')} className="text-sm text-purple-600 hover:underline">
          Back to My Training
        </button>
      </div>
    );
  }

  const sopName = data?.sop?.name || sopCode;
  const activeStep = localSteps[currentStep];

  const quizStep = localSteps.find((s) => s.type === 'quiz');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">

      {/* ── Locked-navigation alert (exam in progress) ─────────────── */}
      {showLockedAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <Lock className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-base font-bold text-gray-800">Exam in Progress</h3>
            <p className="mt-2 text-sm text-gray-600">
              You cannot navigate to other sections while the exam is running.
              Complete or submit the exam first.
            </p>
            <button
              onClick={() => setShowLockedAlert(false)}
              className="mt-5 w-full rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Return to Exam
            </button>
          </div>
        </div>
      )}

      {/* ── Assessment intro popup ──────────────────────────────────── */}
      {showAssessmentIntro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
              <ClipboardList className="h-7 w-7 text-purple-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800">Assessment</h3>
            <p className="mt-1 text-sm text-gray-500">{sopName}</p>
            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2">
                <span className="mt-0.5 shrink-0 text-blue-500">①</span>
                <span><strong>Demo Assessment first</strong> — {quizStep?.attempts === 0
                  ? 'You have not taken the demo yet. It has a few sample questions to help you prepare.'
                  : 'You have already completed the demo assessment.'}</span>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-purple-50 px-3 py-2">
                <span className="mt-0.5 shrink-0 text-purple-500">②</span>
                <span><strong>Main Exam follows</strong> — the actual graded exam. Do not switch browser tabs once it starts.</span>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setShowAssessmentIntro(false); setPendingQuizIdx(null); }}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowAssessmentIntro(false);
                  if (pendingQuizIdx !== null) setCurrentStep(pendingQuizIdx);
                  setPendingQuizIdx(null);
                }}
                className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
              >
                Go to Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Training complete / certificate celebration ─────────── */}
      {showCelebration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-green-200 bg-white p-8 shadow-2xl text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                <Trophy className="h-10 w-10 text-green-600" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-gray-800">Training Complete!</h3>
            <p className="mt-2 text-sm text-gray-500">{sopName}</p>
            <p className="mt-3 text-sm text-gray-600">
              You have successfully passed the assessment and are now
              <strong className="text-green-700"> certified as trained</strong> for this SOP.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => { setShowCelebration(false); router.push(`/lms/certificate/${sopCode}`); }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white shadow hover:bg-green-700"
              >
                <Award className="h-4 w-4" /> View Your Certificate
              </button>
              <button
                onClick={() => setShowCelebration(false)}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button
            onClick={() => router.push('/lms')}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> My Training
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="flex-1 truncate text-sm font-bold text-gray-800" title={sopName}>
            {sopCode} — {sopName}
          </h1>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-500"
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <span className="w-10 text-right font-semibold text-purple-700">{overallPct}%</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-2xl flex-1 gap-0 px-4 py-6 sm:px-6 lg:px-8">
        {/* Sidebar */}
        <aside className="mr-6 w-64 shrink-0 xl:w-72">
          <div className="sticky top-20 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Learning Steps</p>
              {examActive && (
                <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-red-600">
                  <Lock className="h-3 w-3" /> Locked — exam in progress
                </p>
              )}
            </div>
            <nav className="divide-y divide-gray-100">
              {localSteps.map((step, idx) => {
                const isActive = idx === currentStep;
                const isCompleted = step.completed;
                return (
                  <button
                    key={step.id}
                    onClick={() => {
                      if (examActive && !isActive) {
                        setShowLockedAlert(true);
                        return;
                      }
                      if (!examActive && step.type === 'quiz' && !isActive) {
                        setShowAssessmentIntro(true);
                        // store the idx so we can navigate after confirm
                        setPendingQuizIdx(idx);
                        return;
                      }
                      setCurrentStep(idx);
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left text-xs transition ${
                      examActive && !isActive ? 'cursor-not-allowed opacity-40' :
                      isActive
                        ? 'bg-purple-50 text-purple-800'
                        : isCompleted
                        ? 'text-gray-500 hover:bg-gray-50'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isCompleted
                          ? 'bg-green-500 text-white'
                          : isActive
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {isCompleted ? <Check className="h-3 w-3" /> : idx + 1}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      <span className={`truncate font-medium leading-tight ${isActive ? 'text-purple-800' : 'text-gray-700'}`}>
                        {step.label}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-gray-400">
                        <StepIcon type={step.type} size={3} />
                        {step.type === 'quiz'
                          ? (isCompleted ? 'Passed ✓' : 'Required')
                          : (step.type === 'video' && (step.percentage ?? 0) > 0
                            ? `${step.percentage}% watched · Optional`
                            : `Optional${isCompleted ? ' · Done' : ''}`)}
                      </span>
                    </div>
                  </button>
                );
              })}
              {localSteps.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <Lock className="mx-auto mb-2 h-5 w-5 text-gray-300" />
                  <p className="text-xs text-gray-400">No content available yet.</p>
                </div>
              )}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Step header */}
          {activeStep && (
            <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                activeStep.completed ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600'
              }`}>
                <StepIcon type={activeStep.type} size={4} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-800">{activeStep.label}</h2>
                <p className="text-[11px] text-gray-400">
                  Step {currentStep + 1} of {localSteps.length}
                  {activeStep.completed && ' · Completed'}
                </p>
              </div>
              {activeStep.completed && (
                <span className="ml-auto flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
                  <Check className="h-3 w-3" /> Done
                </span>
              )}
            </div>
          )}

          {/* Step content */}
          <div className="flex flex-1 flex-col overflow-y-auto p-5">
            {!activeStep && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-50">
                  <Trophy className="h-7 w-7 text-purple-500" />
                </div>
                <p className="font-semibold text-gray-700">No learning steps available</p>
                <p className="text-sm text-gray-400">Content for this SOP has not been uploaded yet.</p>
              </div>
            )}
            {activeStep?.type === 'video' && (
              <VideoStep
                key={activeStep.id}
                step={activeStep}
                onProgress={(pct, ts) => handleVideoProgress(activeStep.id, pct, ts)}
                onComplete={() => markStepComplete(activeStep.id)}
              />
            )}
            {activeStep?.type === 'slides' && (
              <SlidesStep
                key={activeStep.id}
                step={activeStep}
                onComplete={() => markStepComplete(activeStep.id)}
              />
            )}
            {activeStep?.type === 'pdf' && (
              <PdfStep
                key={activeStep.id}
                step={activeStep}
                onComplete={() => markStepComplete(activeStep.id)}
              />
            )}
            {activeStep?.type === 'quiz' && (
              <QuizStep
                key={activeStep.id}
                sopCode={sopCode}
                step={activeStep}
                onComplete={(score, passed, isTrial, newAttempts) =>
                  handleQuizComplete(activeStep.id, score, passed, isTrial, newAttempts)
                }
                onExamActive={setExamActive}
              />
            )}
          </div>

          {/* Navigation footer */}
          {localSteps.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <button
                onClick={() => setCurrentStep((i) => Math.max(0, i - 1))}
                disabled={currentStep === 0 || examActive}
                title={examActive ? 'Navigation locked during exam' : undefined}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>

              <span className="text-[11px] text-gray-400">
                {localSteps.filter((s) => s.completed).length} of {localSteps.length} completed
              </span>

              {currentStep < localSteps.length - 1 ? (
                <button
                  onClick={() => setCurrentStep((i) => Math.min(localSteps.length - 1, i + 1))}
                  disabled={examActive}
                  title={examActive ? 'Navigation locked during exam' : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => router.push('/lms')}
                  disabled={overallPct < 100}
                  className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
                >
                  <Trophy className="h-3.5 w-3.5" /> Finish Training
                </button>
              )}
            </div>
          )}

          {/* ── Post-completion panel ─────────────────────────── */}
          {overallPct >= 100 && (
            <div className="border-t border-dashed border-green-200 bg-green-50/60 px-5 py-5">
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-green-600" />
                <p className="text-sm font-bold text-green-800">Training Complete!</p>
              </div>

              <div className="flex flex-wrap gap-3">
                {/* Certificate */}
                <button
                  onClick={() => router.push(`/lms/certificate/${sopCode}`)}
                  className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-purple-700"
                >
                  <Award className="h-4 w-4" />
                  {hasCert ? 'View Certificate' : 'Get Certificate'}
                </button>

              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
