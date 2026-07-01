/**
 * ═══════════════════════════════════════════════════════════════════════
 * Data Synchronization Validator
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Ensure data consistency across UI, database, and calculations.
 * Prevent mismatches between counts, scores, and actual findings.
 */

export interface SyncValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  autoFixable: boolean;
  fixedData?: any;
}

export interface ComplianceReportData {
  overallScore: number;
  complianceStatus: string;
  compliancePercentage: number;
  scoreBreakdown: {
    totalChecks: number;
    compliantCount: number;
    partialCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;
    skippedCount: number;
  };
  findings: Array<{
    complianceLevel: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'unable-to-determine';
    matchConfidence: number;
  }>;
  totalGuidelinesChecked?: number;
  compliantCount?: number;
  partialCount?: number;
  nonCompliantCount?: number;
}

/**
 * Validate that all counts and scores are synchronized
 */
export function validateDataSync(report: ComplianceReportData): SyncValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate findings count matches scoreBreakdown.totalChecks
  const actualTotalFindings = report.findings.length;
  const reportedTotalChecks = report.scoreBreakdown.totalChecks;

  if (actualTotalFindings !== reportedTotalChecks) {
    errors.push(
      `Finding count mismatch: ${actualTotalFindings} findings but scoreBreakdown.totalChecks = ${reportedTotalChecks}`
    );
  }

  // 2. Count actual findings by compliance level
  const actualCounts = {
    compliant: report.findings.filter(f => f.complianceLevel === 'compliant').length,
    partial: report.findings.filter(f => f.complianceLevel === 'partial').length,
    nonCompliant: report.findings.filter(f => f.complianceLevel === 'non-compliant').length,
    notApplicable: report.findings.filter(f => f.complianceLevel === 'not-applicable').length,
    unableToDetermine: report.findings.filter(f => f.complianceLevel === 'unable-to-determine').length,
  };

  // 3. Validate scoreBreakdown counts match actual findings
  if (actualCounts.compliant !== report.scoreBreakdown.compliantCount) {
    errors.push(
      `Compliant count mismatch: ${actualCounts.compliant} actual vs ${report.scoreBreakdown.compliantCount} reported`
    );
  }

  if (actualCounts.partial !== report.scoreBreakdown.partialCount) {
    errors.push(
      `Partial count mismatch: ${actualCounts.partial} actual vs ${report.scoreBreakdown.partialCount} reported`
    );
  }

  if (actualCounts.nonCompliant !== report.scoreBreakdown.nonCompliantCount) {
    errors.push(
      `Non-compliant count mismatch: ${actualCounts.nonCompliant} actual vs ${report.scoreBreakdown.nonCompliantCount} reported`
    );
  }

  if (actualCounts.notApplicable !== report.scoreBreakdown.notApplicableCount) {
    errors.push(
      `Not-applicable count mismatch: ${actualCounts.notApplicable} actual vs ${report.scoreBreakdown.notApplicableCount} reported`
    );
  }

  // 4. Validate legacy fields match scoreBreakdown (if present)
  if (report.compliantCount !== undefined && report.compliantCount !== report.scoreBreakdown.compliantCount) {
    warnings.push('Legacy compliantCount field does not match scoreBreakdown.compliantCount');
  }

  if (report.partialCount !== undefined && report.partialCount !== report.scoreBreakdown.partialCount) {
    warnings.push('Legacy partialCount field does not match scoreBreakdown.partialCount');
  }

  if (report.nonCompliantCount !== undefined && report.nonCompliantCount !== report.scoreBreakdown.nonCompliantCount) {
    warnings.push('Legacy nonCompliantCount field does not match scoreBreakdown.nonCompliantCount');
  }

  // 5. Validate score calculation
  const applicableFindings = actualTotalFindings - actualCounts.notApplicable - actualCounts.unableToDetermine;
  
  if (applicableFindings > 0) {
    // Weighted score: compliant=10, partial=5, non-compliant=0
    const expectedScore = (actualCounts.compliant * 10 + actualCounts.partial * 5) / applicableFindings;
    const roundedExpectedScore = Math.round(expectedScore * 10) / 10;

    if (Math.abs(report.overallScore - roundedExpectedScore) > 0.1) {
      errors.push(
        `Score calculation mismatch: expected ${roundedExpectedScore} but got ${report.overallScore}`
      );
    }

    // Validate compliance percentage
    const expectedPercentage = Math.round((actualCounts.compliant / applicableFindings) * 100);
    if (Math.abs(report.compliancePercentage - expectedPercentage) > 1) {
      errors.push(
        `Compliance percentage mismatch: expected ${expectedPercentage}% but got ${report.compliancePercentage}%`
      );
    }
  }

  // 6. Validate compliance status matches score
  const expectedStatus = getExpectedStatus(report.overallScore);
  if (report.complianceStatus !== expectedStatus) {
    warnings.push(
      `Compliance status may be incorrect: score ${report.overallScore} suggests "${expectedStatus}" but status is "${report.complianceStatus}"`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    autoFixable: errors.length > 0 && canAutoFix(errors),
  };
}

/**
 * Auto-fix data synchronization issues
 */
export function autoFixDataSync(report: ComplianceReportData): ComplianceReportData {
  const fixed = { ...report };

  // Recalculate all counts from actual findings
  const actualCounts = {
    compliant: report.findings.filter(f => f.complianceLevel === 'compliant').length,
    partial: report.findings.filter(f => f.complianceLevel === 'partial').length,
    nonCompliant: report.findings.filter(f => f.complianceLevel === 'non-compliant').length,
    notApplicable: report.findings.filter(f => f.complianceLevel === 'not-applicable').length,
    unableToDetermine: report.findings.filter(f => f.complianceLevel === 'unable-to-determine').length,
  };

  // Fix scoreBreakdown
  fixed.scoreBreakdown = {
    totalChecks: report.findings.length,
    compliantCount: actualCounts.compliant,
    partialCount: actualCounts.partial,
    nonCompliantCount: actualCounts.nonCompliant,
    notApplicableCount: actualCounts.notApplicable,
    skippedCount: actualCounts.unableToDetermine,
  };

  // Fix legacy fields
  fixed.totalGuidelinesChecked = report.findings.length;
  fixed.compliantCount = actualCounts.compliant;
  fixed.partialCount = actualCounts.partial;
  fixed.nonCompliantCount = actualCounts.nonCompliant;

  // Recalculate score
  const applicableFindings = report.findings.length - actualCounts.notApplicable - actualCounts.unableToDetermine;
  
  if (applicableFindings > 0) {
    const weightedScore = (actualCounts.compliant * 10 + actualCounts.partial * 5) / applicableFindings;
    fixed.overallScore = Math.round(weightedScore * 10) / 10;
    fixed.compliancePercentage = Math.round((actualCounts.compliant / applicableFindings) * 100);
    fixed.complianceStatus = getExpectedStatus(fixed.overallScore);
  } else {
    fixed.overallScore = 0;
    fixed.compliancePercentage = 0;
    fixed.complianceStatus = 'Analysis Pending';
  }

  return fixed;
}

/**
 * Batch validate multiple reports
 */
export function validateMultipleReports(reports: ComplianceReportData[]): {
  validReports: ComplianceReportData[];
  invalidReports: Array<{ report: ComplianceReportData; validation: SyncValidationResult }>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    autoFixable: number;
  };
} {
  const validReports: ComplianceReportData[] = [];
  const invalidReports: Array<{ report: ComplianceReportData; validation: SyncValidationResult }> = [];
  let autoFixableCount = 0;

  for (const report of reports) {
    const validation = validateDataSync(report);
    
    if (validation.isValid) {
      validReports.push(report);
    } else {
      invalidReports.push({ report, validation });
      if (validation.autoFixable) {
        autoFixableCount++;
      }
    }
  }

  return {
    validReports,
    invalidReports,
    summary: {
      total: reports.length,
      valid: validReports.length,
      invalid: invalidReports.length,
      autoFixable: autoFixableCount,
    },
  };
}

/**
 * Get expected compliance status based on score
 */
function getExpectedStatus(score: number): string {
  if (score >= 8.5) return 'Fully Compliant';
  if (score >= 5.0) return 'Partially Compliant';
  if (score > 0) return 'Non-Compliant';
  return 'Analysis Pending';
}

/**
 * Check if errors can be auto-fixed
 */
function canAutoFix(errors: string[]): boolean {
  // We can auto-fix count mismatches and score calculation errors
  // We cannot auto-fix missing findings or corrupted data
  const fixablePatterns = [
    'count mismatch',
    'Score calculation mismatch',
    'Compliance percentage mismatch',
  ];

  return errors.every(error => 
    fixablePatterns.some(pattern => error.includes(pattern))
  );
}

/**
 * Generate a sync validation report
 */
export function generateSyncReport(validation: SyncValidationResult): string {
  const lines: string[] = [];
  
  lines.push('# Data Synchronization Validation Report');
  lines.push('');
  lines.push(`**Status:** ${validation.isValid ? '✅ Valid' : '❌ Invalid'}`);
  lines.push(`**Auto-fixable:** ${validation.autoFixable ? 'Yes' : 'No'}`);
  lines.push('');

  if (validation.errors.length > 0) {
    lines.push('## Errors');
    validation.errors.forEach((error, idx) => {
      lines.push(`${idx + 1}. ${error}`);
    });
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('## Warnings');
    validation.warnings.forEach((warning, idx) => {
      lines.push(`${idx + 1}. ${warning}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
