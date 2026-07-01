import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ComplianceAnalysisJob Model - Real-Time Analysis Tracking
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Track compliance analysis jobs in real-time with progress updates
 * Separate from ComplianceReport to avoid data corruption during analysis
 * 
 * WORKFLOW:
 * 1. User triggers analysis → Create Job (status: 'queued')
 * 2. Start processing → Update (status: 'processing')
 * 3. For each step → Update progress
 * 4. On completion → Update (status: 'completed') + Create ComplianceReport
 * 5. On failure → Update (status: 'failed') + Log error
 * 
 * BENEFITS:
 * - Real-time progress tracking in UI
 * - Clear error visibility (no silent failures)
 * - Job queue management (prevent concurrent analyses)
 * - Retry capability
 * - Full audit trail of what happened
 */

export interface IComplianceAnalysisJob extends Document {
  // ═════════════════════════════════════════════════════════════════════
  // 1. JOB IDENTIFICATION
  // ═════════════════════════════════════════════════════════════════════
  jobId: string;  // Unique job identifier (e.g., "job-1234567890")
  sopId: mongoose.Types.ObjectId;
  sopIdentifier: string;
  sopName: string;
  department: string;
  
  // ═════════════════════════════════════════════════════════════════════
  // 2. JOB STATUS
  // ═════════════════════════════════════════════════════════════════════
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  currentStep: 'initializing' | 'fetching-sop' | 'fetching-guidelines' | 'analyzing-clauses' | 'calculating-score' | 'saving-report' | 'completed' | 'failed';
  progress: number;  // 0-100%
  
  // ═════════════════════════════════════════════════════════════════════
  // 3. PROGRESS TRACKING
  // ═════════════════════════════════════════════════════════════════════
  totalClauses: number;
  clausesAnalyzed: number;
  clausesFailed: number;
  
  currentClause?: {
    clauseNumber: string;
    clauseTitle: string;
    startedAt: Date;
  };
  
  // ═════════════════════════════════════════════════════════════════════
  // 4. STEP COMPLETION STATUS
  // ═════════════════════════════════════════════════════════════════════
  steps: {
    sopFetch: {
      status: 'pending' | 'in-progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
      sopContentLength?: number;
    };
    guidelineFetch: {
      status: 'pending' | 'in-progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
      guidelinesFound?: number;
      clausesFound?: number;
    };
    clauseAnalysis: {
      status: 'pending' | 'in-progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
      clausesAnalyzed?: number;
      clausesFailed?: number;
    };
    scoreCalculation: {
      status: 'pending' | 'in-progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
      overallScore?: number;
      complianceStatus?: string;
    };
    reportSave: {
      status: 'pending' | 'in-progress' | 'completed' | 'failed';
      startedAt?: Date;
      completedAt?: Date;
      error?: string;
      reportId?: mongoose.Types.ObjectId;
    };
  };
  
  // ═════════════════════════════════════════════════════════════════════
  // 5. ERROR TRACKING
  // ═════════════════════════════════════════════════════════════════════
  jobErrors: {
    errorType: 'sop-not-found' | 'no-guidelines' | 'ai-timeout' | 'api-error' | 'validation-error' | 'other';
    errorMessage: string;
    errorStack?: string;
    affectedStep: string;
    timestamp: Date;
    recoverable: boolean;  // Can this be retried?
  }[];
  
  // ═════════════════════════════════════════════════════════════════════
  // 6. RESULT
  // ═════════════════════════════════════════════════════════════════════
  complianceReportId?: mongoose.Types.ObjectId;  // Final report (if completed)
  overallScore?: number;
  complianceStatus?: string;
  
  // ═════════════════════════════════════════════════════════════════════
  // 7. TIMING
  // ═════════════════════════════════════════════════════════════════════
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  processingTimeMs: number;
  estimatedTimeRemainingMs?: number;
  
  // ═════════════════════════════════════════════════════════════════════
  // 8. CONFIGURATION
  // ═════════════════════════════════════════════════════════════════════
  config: {
    aiModel: string;
    maxClausesToAnalyze: number;
    guidelineFilters?: {
      folderName?: string;
      category?: string;
      guidelineType?: string;
    };
    retryOnFailure: boolean;
    retryCount: number;
    maxRetries: number;
  };
  
  // ═════════════════════════════════════════════════════════════════════
  // 9. USER CONTEXT
  // ═════════════════════════════════════════════════════════════════════
  triggeredBy: mongoose.Types.ObjectId;
  userEmail?: string;
  userRole?: string;
  
  // ═════════════════════════════════════════════════════════════════════
  // 10. METADATA
  // ═════════════════════════════════════════════════════════════════════
  isActive: boolean;  // Is this job still running?
  canRetry: boolean;  // Can user retry this job?
  lastHeartbeat?: Date;  // Last activity (for stuck job detection)
  
  createdAt: Date;
  updatedAt: Date;
}

const ComplianceAnalysisJobSchema = new Schema<IComplianceAnalysisJob>({
  // 1. JOB IDENTIFICATION
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  sopId: {
    type: Schema.Types.ObjectId,
    ref: 'SOP',
    required: true,
    index: true,
  },
  sopIdentifier: {
    type: String,
    required: true,
  },
  sopName: {
    type: String,
    required: true,
  },
  department: {
    type: String,
    required: true,
    index: true,
  },
  
  // 2. JOB STATUS
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    required: true,
    index: true,
  },
  currentStep: {
    type: String,
    enum: ['initializing', 'fetching-sop', 'fetching-guidelines', 'analyzing-clauses', 'calculating-score', 'saving-report', 'completed', 'failed'],
    default: 'initializing',
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  
  // 3. PROGRESS TRACKING
  totalClauses: {
    type: Number,
    default: 0,
  },
  clausesAnalyzed: {
    type: Number,
    default: 0,
  },
  clausesFailed: {
    type: Number,
    default: 0,
  },
  currentClause: {
    clauseNumber: { type: String },
    clauseTitle: { type: String },
    startedAt: { type: Date },
  },
  
  // 4. STEP COMPLETION STATUS
  steps: {
    sopFetch: {
      status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String },
      sopContentLength: { type: Number },
    },
    guidelineFetch: {
      status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String },
      guidelinesFound: { type: Number },
      clausesFound: { type: Number },
    },
    clauseAnalysis: {
      status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String },
      clausesAnalyzed: { type: Number },
      clausesFailed: { type: Number },
    },
    scoreCalculation: {
      status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String },
      overallScore: { type: Number },
      complianceStatus: { type: String },
    },
    reportSave: {
      status: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String },
      reportId: { type: Schema.Types.ObjectId, ref: 'ComplianceReport' },
    },
  },
  
  // 5. ERROR TRACKING
  jobErrors: [{
    errorType: {
      type: String,
      enum: ['sop-not-found', 'no-guidelines', 'ai-timeout', 'api-error', 'validation-error', 'other'],
      required: true,
    },
    errorMessage: { type: String, required: true },
    errorStack: { type: String },
    affectedStep: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    recoverable: { type: Boolean, default: true },
  }],
  
  // 6. RESULT
  complianceReportId: {
    type: Schema.Types.ObjectId,
    ref: 'ComplianceReport',
    index: true,
  },
  overallScore: { type: Number, min: 0, max: 10 },
  complianceStatus: { type: String },
  
  // 7. TIMING
  queuedAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
  startedAt: { type: Date },
  completedAt: { type: Date },
  processingTimeMs: {
    type: Number,
    default: 0,
  },
  estimatedTimeRemainingMs: { type: Number },
  
  // 8. CONFIGURATION
  config: {
    aiModel: { type: String, default: 'gemini-3-pro-preview' },
    maxClausesToAnalyze: { type: Number, default: 50 },
    guidelineFilters: {
      folderName: { type: String },
      category: { type: String },
      guidelineType: { type: String },
    },
    retryOnFailure: { type: Boolean, default: true },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
  },
  
  // 9. USER CONTEXT
  triggeredBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  userEmail: { type: String },
  userRole: { type: String },
  
  // 10. METADATA
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  canRetry: {
    type: Boolean,
    default: true,
  },
  lastHeartbeat: { type: Date },
}, {
  timestamps: true,
});

// Indexes
ComplianceAnalysisJobSchema.index({ status: 1, queuedAt: -1 });
ComplianceAnalysisJobSchema.index({ sopId: 1, createdAt: -1 });
ComplianceAnalysisJobSchema.index({ triggeredBy: 1, createdAt: -1 });
ComplianceAnalysisJobSchema.index({ isActive: 1 });

// TTL Index: Auto-delete completed/failed jobs after 30 days
ComplianceAnalysisJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const ComplianceAnalysisJob: Model<IComplianceAnalysisJob> = mongoose.models.ComplianceAnalysisJob || mongoose.model<IComplianceAnalysisJob>('ComplianceAnalysisJob', ComplianceAnalysisJobSchema);

export default ComplianceAnalysisJob;
