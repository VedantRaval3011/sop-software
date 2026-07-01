/**
 * ═══════════════════════════════════════════════════════════════════════
 * Compliance Finding Validator
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Enforce strict data quality standards for compliance findings.
 * Prevent generic, incomplete, or hallucinated AI responses from being stored.
 * 
 * VALIDATION RULES:
 * 1. All required fields must be present and non-empty
 * 2. No generic phrases allowed ("not found", "not specified", etc.)
 * 3. References must be traceable and specific
 * 4. Suggestions must be actionable and specific
 * 5. Confidence scores must be reasonable (0-100)
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedData?: any;
}

export interface ComplianceFindingInput {
  findingId?: string;
  guidelineId: string;
  guidelineName: string;
  folderName: string;
  pdfName: string;
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  regulatoryReference?: string;
  sopSectionNumber: string;
  sopSectionTitle: string;
  sopTextSnippet: string;
  complianceLevel: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'unable-to-determine';
  matchConfidence: number;
  issueType: string;
  issueSeverity: string;
  specificGap: string;
  guidelineRequirement: string;
  sopCurrentState: string;
  suggestedAction: string;
  suggestedText: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  priority: number;
  analyzedAt?: Date;
  aiModelUsed?: string;
  analysisMethod?: string;
  isClauseApplicable?: boolean;
  applicabilityReason?: string;
}

// Prohibited generic phrases that indicate low-quality AI output
const PROHIBITED_PHRASES = [
  'no regulatory requirement found',
  'not specified',
  'not found',
  'general compliance',
  'not applicable',
  'n/a',
  'not addressed',
  'no specific requirement',
  'review required',
  'manual review required',
  'unable to determine',
  'analysis required',
  'not determined',
  'no information',
  'not mentioned',
  'not clear',
  'unclear',
];

// Minimum length requirements for text fields
const MIN_LENGTHS = {
  specificGap: 20,
  guidelineRequirement: 15,
  sopCurrentState: 15,
  suggestedAction: 20,
  suggestedText: 20,
  sopTextSnippet: 10,
};

/**
 * Validate a single compliance finding - STRICT MODE
 */
export function validateFinding(finding: ComplianceFindingInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required fields check
  const requiredFields: (keyof ComplianceFindingInput)[] = [
    'guidelineId',
    'guidelineName',
    'clauseNumber',
    'sopSectionNumber',
    'complianceLevel',
    'specificGap',
    'guidelineRequirement',
    'sopCurrentState',
    'suggestedAction',
    'suggestedText',
  ];

  for (const field of requiredFields) {
    if (!finding[field] || String(finding[field]).trim().length === 0) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // 2. STRICT: Check for generic/prohibited phrases
  const textFields = ['specificGap', 'guidelineRequirement', 'sopCurrentState', 'suggestedAction', 'suggestedText'];
  
  for (const field of textFields) {
    const value = String(finding[field as keyof ComplianceFindingInput] || '').toLowerCase();
    
    for (const phrase of PROHIBITED_PHRASES) {
      if (value.includes(phrase.toLowerCase())) {
        errors.push(`REJECTED: Field "${field}" contains prohibited phrase: "${phrase}"`);
      }
    }
    
    // Additional strict checks
    if (field === 'specificGap') {
      // Gap must be specific and measurable
      if (value.length < 30) {
        errors.push(`Gap too vague (${value.length} chars). Must be specific and measurable (min 30 chars)`);
      }
      if (value.includes('missing') && !value.includes('does not')) {
        warnings.push('Gap uses "missing" - prefer "does not include/specify" for clarity');
      }
    }
    
    if (field === 'sopCurrentState') {
      // Must look like a quote (should contain quotation marks or specific text)
      if (!value.includes('"') && !value.includes("'") && !value.includes('states') && !value.includes('specifies')) {
        warnings.push('sopCurrentState should be an exact quote or clearly reference SOP text');
      }
    }
    
    if (field === 'suggestedText') {
      // Must be substantial (not just "update this")
      if (value.length < 50) {
        errors.push(`Suggested text too short (${value.length} chars). Must provide EXACT text to implement (min 50 chars)`);
      }
    }
  }

  // 3. Confidence score validation
  if (finding.matchConfidence < 0 || finding.matchConfidence > 100) {
    errors.push(`Invalid confidence score: ${finding.matchConfidence} (must be 0-100)`);
  }

  // 4. Priority validation
  if (finding.priority < 1 || finding.priority > 5) {
    errors.push(`Invalid priority: ${finding.priority} (must be 1-5)`);
  }

  // 5. Validate reference is traceable
  if (finding.guidelineName && finding.clauseNumber) {
    const refValidation = validateReference(finding);
    errors.push(...refValidation.errors);
    warnings.push(...refValidation.warnings);
  }

  // 6. Validate suggestion is actionable
  if (finding.suggestedAction && finding.suggestedText) {
    const suggestionValidation = validateSuggestion(finding);
    errors.push(...suggestionValidation.errors);
    warnings.push(...suggestionValidation.warnings);
  }

  // 7. STRICT: Validate SOP section reference
  if (finding.sopSectionNumber === 'N/A' && finding.complianceLevel !== 'not-applicable') {
    warnings.push('SOP section not identified for applicable finding - may indicate incomplete analysis');
  }

  // 8. Validate compliance level matches issue type
  if (finding.complianceLevel === 'compliant' && finding.issueType !== 'no-issue') {
    warnings.push(`Compliance level is "compliant" but issue type is "${finding.issueType}"`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that references are traceable and specific
 */
export function validateReference(finding: ComplianceFindingInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check clause number format
  if (!finding.clauseNumber || finding.clauseNumber.trim() === '') {
    errors.push('Clause number is empty');
  }

  // Check that we have a complete citation path
  if (!finding.folderName || finding.folderName.trim() === '') {
    errors.push('Folder name is missing');
  }

  if (!finding.pdfName || finding.pdfName.trim() === '') {
    errors.push('PDF name is missing');
  }

  // Validate regulatory reference format
  const regulatoryRef = finding.regulatoryReference || '';
  if (regulatoryRef.length > 0) {
    // Should contain guideline type and clause number
    if (!regulatoryRef.includes(finding.clauseNumber)) {
      warnings.push('Regulatory reference does not include clause number');
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate that suggestions are actionable and specific
 */
export function validateSuggestion(finding: ComplianceFindingInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const action = finding.suggestedAction?.toLowerCase() || '';
  const text = finding.suggestedText?.toLowerCase() || '';

  // Check for vague action verbs
  const vagueVerbs = ['improve', 'enhance', 'update', 'review', 'consider', 'ensure'];
  const hasVagueVerb = vagueVerbs.some(verb => action.startsWith(verb) && action.split(' ').length < 5);
  
  if (hasVagueVerb) {
    warnings.push('Suggestion may be too vague. Should include specific implementation steps.');
  }

  // Suggested text should be concrete
  if (text.includes('review') || text.includes('update this section')) {
    warnings.push('Suggested text is not specific enough. Should provide exact wording.');
  }

  // Check that suggestion references the SOP section
  if (!action.includes('section') && !action.includes(finding.sopSectionNumber)) {
    warnings.push('Suggestion does not reference specific SOP section');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Sanitize AI output by removing generic phrases and normalizing data
 */
export function sanitizeAIOutput(rawOutput: any): ComplianceFindingInput {
  const sanitized = { ...rawOutput };

  // Replace generic phrases with more specific placeholders
  const genericReplacements: Record<string, string> = {
    'No regulatory requirement found': 'Specific requirement not identified in this clause',
    'Not specified': 'Details not provided in SOP',
    'Review required': 'Requires detailed review and specific implementation',
    'Manual review required': 'Requires expert review for accurate assessment',
  };

  const textFields: (keyof ComplianceFindingInput)[] = [
    'specificGap',
    'guidelineRequirement',
    'sopCurrentState',
    'suggestedAction',
    'suggestedText',
    'sopTextSnippet',
  ];

  for (const field of textFields) {
    let value = sanitized[field]?.toString() || '';
    
    for (const [generic, replacement] of Object.entries(genericReplacements)) {
      value = value.replace(new RegExp(generic, 'gi'), replacement);
    }
    
    sanitized[field] = value.trim();
  }

  // Normalize confidence score
  if (sanitized.matchConfidence) {
    sanitized.matchConfidence = Math.min(100, Math.max(0, Number(sanitized.matchConfidence)));
  }

  // Normalize priority
  if (sanitized.priority) {
    sanitized.priority = Math.min(5, Math.max(1, Number(sanitized.priority)));
  }

  // Generate finding ID if missing
  if (!sanitized.findingId) {
    sanitized.findingId = `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Set timestamps
  if (!sanitized.analyzedAt) {
    sanitized.analyzedAt = new Date();
  }

  return sanitized;
}

/**
 * Batch validate multiple findings
 */
export function validateFindings(findings: ComplianceFindingInput[]): {
  validFindings: ComplianceFindingInput[];
  invalidFindings: Array<{ finding: ComplianceFindingInput; validation: ValidationResult }>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
  };
} {
  const validFindings: ComplianceFindingInput[] = [];
  const invalidFindings: Array<{ finding: ComplianceFindingInput; validation: ValidationResult }> = [];
  let totalWarnings = 0;

  for (const finding of findings) {
    const validation = validateFinding(finding);
    
    if (validation.isValid) {
      validFindings.push(finding);
      totalWarnings += validation.warnings.length;
    } else {
      invalidFindings.push({ finding, validation });
    }
  }

  return {
    validFindings,
    invalidFindings,
    summary: {
      total: findings.length,
      valid: validFindings.length,
      invalid: invalidFindings.length,
      warnings: totalWarnings,
    },
  };
}

/**
 * Check if a finding contains hallucinated data
 */
export function detectHallucination(finding: ComplianceFindingInput): {
  isHallucinated: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // Check for suspiciously high confidence with generic content
  if (finding.matchConfidence > 80) {
    const hasGeneric = PROHIBITED_PHRASES.some(phrase => 
      finding.specificGap?.toLowerCase().includes(phrase) ||
      finding.sopCurrentState?.toLowerCase().includes(phrase)
    );
    
    if (hasGeneric) {
      reasons.push('High confidence score with generic content suggests hallucination');
    }
  }

  // Check for contradictions
  if (finding.complianceLevel === 'compliant' && finding.specificGap.length > 50) {
    reasons.push('Marked as compliant but has detailed gap description');
  }

  if (finding.complianceLevel === 'non-compliant' && finding.specificGap.length < 20) {
    reasons.push('Marked as non-compliant but gap description is too brief');
  }

  // Check for placeholder text
  const placeholderPatterns = [
    /\[.*?\]/,  // [placeholder]
    /\{.*?\}/,  // {placeholder}
    /xxx/i,
    /tbd/i,
    /todo/i,
  ];

  const allText = [
    finding.specificGap,
    finding.sopCurrentState,
    finding.suggestedAction,
    finding.suggestedText,
  ].join(' ');

  for (const pattern of placeholderPatterns) {
    if (pattern.test(allText)) {
      reasons.push('Contains placeholder text');
      break;
    }
  }

  return {
    isHallucinated: reasons.length > 0,
    reasons,
  };
}
