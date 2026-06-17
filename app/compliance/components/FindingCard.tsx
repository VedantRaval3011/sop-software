'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle,
  BookOpen,
  FileText,
  AlertTriangle,
  Target,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import {
  formatConfidence,
  getComplianceLevelBadge,
  getComplianceLevelBorder,
  getComplianceStatusColor,
  getScoreColorClass,
  getSeverityBadge,
  buildImpactAnalysis,
} from '@/lib/complianceFormatter';
import { cleanFindingText, buildProposedVerbiage } from '@/lib/ComplianceFindingValidator';

export interface FindingCardProps {
  finding: {
    _id?: string;
    guidelineName: string;
    folderName?: string;
    pdfName?: string;
    clauseNumber: string;
    clauseTitle: string;
    clauseText?: string;
    complianceLevel: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'analysis-failed';
    matchConfidence: number;
    issueSeverity?: 'critical' | 'major' | 'minor' | 'informational';
    issueType?: string;
    sopSectionAffected?: string;
    mismatchExplanation?: string;
    highlightedIssue?: string;
    impactAnalysis?: string;
    sopTextSnippet?: string;
    guidelineRequirement?: string;
    suggestedAction?: string;
    suggestedText?: string;
    estimatedEffort?: 'low' | 'medium' | 'high';
    priority?: number;
    reviewStatus?: 'pending' | 'accepted' | 'disputed' | 'implemented';
  };
  reportContext?: {
    sopIdentifier: string;
    sopName: string;
    department: string;
    overallScore: number;
    complianceStatus: string;
  };
  index?: number;
  isSelected?: boolean;
  onToggleSelect?: (idx: number) => void;
  onToggleApplicable?: (id: string, checked: boolean) => void;
  isApplicable?: boolean;
  onReviewStatusChange?: (id: string, status: 'pending' | 'accepted' | 'disputed' | 'implemented') => void;
  showCheckbox?: boolean;
  defaultExpanded?: boolean;
}

function findingId(finding: FindingCardProps['finding'], index?: number): string {
  return finding._id ?? `finding-${index ?? finding.clauseNumber}`;
}

function extractSectionNumber(section?: string): string {
  if (!section?.trim()) return '';
  const m = section.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : section.trim();
}

export default function FindingCard({
  finding,
  reportContext,
  index,
  isSelected,
  onToggleSelect,
  onToggleApplicable,
  isApplicable,
  onReviewStatusChange,
  showCheckbox = false,
  defaultExpanded = false,
}: FindingCardProps) {
  const isActionable =
    finding.complianceLevel === 'partial' || finding.complianceLevel === 'non-compliant';

  const [expanded, setExpanded] = useState(defaultExpanded || isActionable);
  const [copied, setCopied] = useState(false);

  const levelBadge = getComplianceLevelBadge(finding.complianceLevel);
  const severityBadge = getSeverityBadge(finding.issueSeverity ?? 'informational');
  const levelBorder = getComplianceLevelBorder(finding.complianceLevel);
  const confidence = formatConfidence(finding.matchConfidence);
  const id = findingId(finding, index);

  const guidelineTag = finding.folderName || finding.guidelineName;
  const requirement =
    finding.guidelineRequirement?.trim() ||
    finding.clauseText?.trim() ||
    '';
  const gapText =
    finding.mismatchExplanation?.trim() ||
    finding.highlightedIssue?.trim() ||
    '';
  const impactText =
    finding.impactAnalysis?.trim() ||
    (isActionable && requirement
      ? buildImpactAnalysis(finding, requirement)
      : '');
  const sectionRaw = finding.sopSectionAffected?.trim() || '';
  const sectionNum = extractSectionNumber(sectionRaw);
  const sopSnippet = cleanFindingText(finding.sopTextSnippet);
  const proposedVerbiage =
    cleanFindingText(finding.suggestedText) ||
    (isActionable
      ? buildProposedVerbiage({
          suggestedAction: cleanFindingText(finding.suggestedAction) || finding.suggestedAction || '',
          sopTextSnippet: sopSnippet,
          sopSectionAffected: sectionRaw,
          gap: gapText,
          clauseTitle: finding.clauseTitle,
          clauseNumber: finding.clauseNumber,
          guidelineName: finding.guidelineName,
        })
      : '');

  const handleCopyVerbiage = () => {
    const text = proposedVerbiage || cleanFindingText(finding.suggestedAction) || '';
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scoreColor = reportContext ? getScoreColorClass(reportContext.overallScore) : '';
  const statusColor = reportContext ? getComplianceStatusColor(reportContext.complianceStatus) : '';

  return (
    <div
      className={`rounded-2xl border-l-4 overflow-hidden bg-white shadow-sm transition-all ${levelBorder} ${
        isSelected ? 'ring-2 ring-purple-400 border-purple-200' : 'border border-gray-200'
      }`}
    >
      {/* Collapsed summary row */}
      <div className="px-4 py-3 flex items-start gap-3">
        {showCheckbox && index !== undefined && onToggleSelect && (
          <input
            type="checkbox"
            checked={isSelected ?? false}
            onChange={() => onToggleSelect(index)}
            className="mt-1 h-4 w-4 text-purple-600 rounded cursor-pointer shrink-0"
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${levelBadge.className}`}>
              {levelBadge.label}
            </span>
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${severityBadge.className}`}>
              {severityBadge.label}
            </span>
            {guidelineTag && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] font-bold text-blue-700">
                <BookOpen className="h-2.5 w-2.5" />
                {guidelineTag}
              </span>
            )}
            <span className="text-[10px] text-gray-400 font-medium">
              Clause {finding.clauseNumber}
              {confidence > 0 && ` · ${confidence}% confidence`}
            </span>
          </div>

          <p className="text-sm font-semibold text-gray-800 leading-tight">{finding.clauseTitle}</p>

          {sectionRaw && sectionRaw !== 'Not Found' && (
            <p className="text-xs text-purple-600 mt-1 flex items-center gap-1 font-medium">
              <FileText className="h-3 w-3 shrink-0" />
              {sectionRaw}
            </p>
          )}

          {!expanded && gapText && isActionable && (
            <p className="text-xs text-gray-600 mt-2 leading-relaxed line-clamp-2">{gapText}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isActionable && onToggleApplicable && (
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isApplicable ?? false}
                onChange={(e) => onToggleApplicable(id, e.target.checked)}
                className="h-3.5 w-3.5 text-purple-600 rounded"
              />
              <span className="text-[10px] text-gray-500 font-medium">Applicable</span>
            </label>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors rounded"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded — reference detail panel */}
      {expanded && (
        <div className="border-t border-gray-100 bg-white">
          {reportContext && (
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-4">
              <div
                className={`shrink-0 w-[72px] h-[72px] rounded-full border-[3px] flex flex-col items-center justify-center ${
                  reportContext.overallScore >= 8
                    ? 'border-emerald-200 bg-emerald-50'
                    : reportContext.overallScore >= 5
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-rose-200 bg-rose-50'
                }`}
              >
                <span className={`text-xl font-black leading-none ${scoreColor}`}>
                  {reportContext.overallScore.toFixed(1)}
                </span>
                <span className="text-[9px] text-gray-400 font-semibold">/ 10</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest mb-1">
                  {reportContext.department}
                </p>
                <p className="text-sm font-bold text-gray-900 leading-snug truncate">
                  {reportContext.sopIdentifier}_{reportContext.sopName}
                </p>
                <span className={`inline-block mt-2 px-3 py-1 rounded-full border text-xs font-bold ${statusColor}`}>
                  {reportContext.complianceStatus}
                </span>
              </div>
              <button
                type="button"
                className="shrink-0 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                title="Copy finding summary"
                onClick={handleCopyVerbiage}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="px-5 py-5 space-y-5">
            {requirement && (
              <section>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" />
                  Guideline Requirement
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed">{requirement}</p>
              </section>
            )}

            {(sopSnippet || sectionRaw) && (
              <section className="rounded-xl border-2 border-purple-200 bg-purple-50/50 p-4">
                <h4 className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Current SOP Content
                </h4>
                {sopSnippet ? (
                  <p className="text-sm text-gray-800 leading-relaxed italic">
                    &ldquo;{sopSnippet}&rdquo;
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 italic">No matching SOP text found for this requirement.</p>
                )}
                {sectionNum && (
                  <p className="text-[10px] font-black text-purple-600 mt-3 uppercase tracking-widest">
                    Section: {sectionNum}
                  </p>
                )}
              </section>
            )}

            {isActionable && (gapText || impactText) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                  <h4 className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Gap Identified
                  </h4>
                  <p className="text-sm text-gray-800 leading-relaxed">{gapText}</p>
                </section>
                <section className="rounded-xl border border-orange-200 bg-orange-50/80 p-4">
                  <h4 className="text-[10px] font-black text-orange-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5" />
                    Impact Analysis
                  </h4>
                  <p className="text-sm text-gray-800 leading-relaxed">{impactText}</p>
                </section>
              </div>
            )}

            {isActionable && finding.suggestedAction && (
              <section className="rounded-xl border-2 border-emerald-200 bg-emerald-50/60 p-4">
                <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Suggested Action
                </h4>
                <p className="text-sm font-semibold text-gray-900 leading-relaxed mb-3">
                  {finding.suggestedAction}
                </p>
                {proposedVerbiage && (
                  <div className="rounded-lg border border-emerald-300 bg-white p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
                        Proposed Verbiage
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyVerbiage}
                        className="flex items-center gap-1 text-[10px] font-black text-emerald-700 hover:text-emerald-900 uppercase tracking-wide"
                      >
                        {copied ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        Copy
                      </button>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {proposedVerbiage}
                    </p>
                  </div>
                )}
              </section>
            )}

            {finding.complianceLevel === 'compliant' && (
              <p className="text-sm text-gray-600 bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
                SOP section{' '}
                <span className="font-semibold text-purple-700">{sectionRaw || 'referenced'}</span>{' '}
                adequately addresses this guideline requirement.
              </p>
            )}

            {onReviewStatusChange && (
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100">
                <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Review:</span>
                {(['pending', 'accepted', 'disputed', 'implemented'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onReviewStatusChange(id, s)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all capitalize ${
                      finding.reviewStatus === s
                        ? 'bg-purple-600 text-white border-purple-500'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
