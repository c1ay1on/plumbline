export type UserRole =
  | 'admin'
  | 'manager'
  | 'approver'
  | 'employee'
  | 'owner';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  workspaceId: string;
  avatar?: string;
  employeeId?: string;
  dateOfBirth?: string;
  department?: string;
  createdAt: string;
  lastLogin: string;
}

export interface Workspace {
  id: string;
  name: string;
  organization: string;
  type: 'manager_workspace' | 'independent';
  ownerId: string;
  memberCount: number;
}

export type Platform =
  | 'linkedin'
  | 'instagram'
  | 'x'
  | 'facebook'
  | 'threads'
  | 'youtube';

export interface BrandVoice {
  tones: string[];
  customToneDescription: string;
  examplePositive: string;
  exampleNegative: string;
  platformRules: Record<Platform, string>;
}

export interface TerminologyRule {
  id: string;
  context: string;
  preferredTerm: string;
  bannedTerm: string;
  explanation: string;
  platforms: Platform[] | ['all'];
}

export interface ApprovedFact {
  id: string;
  fact: string;
  source: string;
  category: string;
  approvalStatus: 'approved' | 'outdated' | 'pending';
  approvalOwner: string;
  version: string;
  lastUpdated: string;
  validUntil?: string;
}

export interface BrandAsset {
  id: string;
  name: string;
  type: 'logo' | 'template' | 'graphic';
  variant: 'primary' | 'monochrome' | 'light' | 'dark';
  url: string;
  size: string;
  updatedAt: string;
}

export interface GuidelineVersionHistory {
  version: string;
  editor: string;
  timestamp: string;
  summary: string;
  changesCount: number;
  // Added with guideline versioning; older history entries may not have them.
  id?: string;
  snapshot?: GuidelineRulesSnapshot;
  ruleChanges?: RuleChange[];
}

// The parts of the guidelines that audits read, frozen at a point in time.
export interface GuidelineRulesSnapshot {
  terminology: TerminologyRule[];
  facts: Pick<ApprovedFact, 'id' | 'fact' | 'source' | 'category' | 'approvalStatus'>[];
  voice: Pick<BrandVoice, 'tones' | 'customToneDescription' | 'platformRules'>;
}

export type RuleKind = 'terminology' | 'fact' | 'voice' | 'check';

export interface RuleChange {
  ruleId: string;
  kind: RuleKind;
  label: string;
  changeType: 'added' | 'modified' | 'removed';
  fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ImpactedReview {
  postId: string;
  title: string;
  status: PostStatus;
  checkedVersion: string;
  reasons: string[];
}

export interface ChangeImpact {
  version: string;
  affected: ImpactedReview[];
  affectedCount: number;
  lockedHistoryCount: number;
  summary: string;
}

export interface BrandGuidelines {
  id: string;
  version: string;
  lastUpdated: string;
  updatedBy: string;
  voice: BrandVoice;
  terminology: TerminologyRule[];
  facts: ApprovedFact[];
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  assets: BrandAsset[];
  rulebookDocuments: {
    id: string;
    filename: string;
    size: string;
    uploadedAt: string;
  }[];
}

export type FindingSeverity = 'critical' | 'warning' | 'suggestion';

export type FindingStatus =
  | 'open'
  | 'accepted'
  | 'rejected'
  | 'contested'
  | 'fixed'
  | 'resolved';

export type FindingCategory =
  | 'unsupported_claim'
  | 'outdated_info'
  | 'tone_mismatch'
  | 'terminology'
  | 'incorrect_messaging'
  | 'visual_mismatch'
  | 'wrong_logo'
  | 'incorrect_colours'
  | 'accessibility'
  | 'alt_text_missing';

export interface AuditFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  issueTitle: string;
  description: string;
  affectedContent: string;
  sourceReference: string;
  guidelineVersion: string;
  suggestedCorrection: string;
  confidence: number;
  status: FindingStatus;
  userAction?: 'accepted' | 'rejected' | 'contested';
  contestedReason?: string;
  /** ISO time the status last changed. Used by Governance Insights to tell
   *  fixes made before review from fixes made after. */
  statusUpdatedAt?: string;
  ruleId?: string;
  ruleLabel?: string;
  disputedAt?: string;
  disputedBy?: string;
  /** Where the finding came from: deterministic rules, the grounded AI audit, or both. */
  origin?: 'rules' | 'ai' | 'rules+ai';
  /** Exact rule passages this finding is based on (snapshot kept with the review). */
  citations?: RuleCitation[];
}

export interface RuleCitation {
  id: string;
  label: string;
  text: string;
  source: 'Uploaded rulebook' | 'Brand Knowledge' | 'Plumbline baseline' | string;
  filename?: string;
  page?: number;
}

export interface RulebookDocument {
  id: string;
  filename: string;
  fileType: 'pdf' | 'markdown' | 'text';
  sizeBytes: number;
  pages?: number | null;
  chunkCount: number;
  embedded: boolean;
  uploadedBy: string;
  uploadedAt: string;
  warning?: string | null;
}

export interface GroundedAuditMeta {
  provider: string | null;
  aiError: string | null;
  retrieval: string;
  store: string;
  chunks: number;
  documentChunks: number;
  dropped: number;
  guidelineVersion: string;
  ms: number;
}

export interface BrandRiskScore {
  overallScore: number; // 0 - 100
  riskCategory: 'low' | 'medium' | 'high';
  breakdown: {
    unsupportedClaims: number;
    visualAssets: number;
    messagingViolations: number;
    terminology: number;
    accessibility: number;
    toneInconsistencies: number;
  };
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
}

export interface AISuggestionItem {
  id: string;
  original: string;
  suggestion: string;
  explanation: string;
  sourceRef: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface PostPlatformVariant {
  platform: Platform;
  title: string;
  description: string;
  targetTone: string;
  suggestions: AISuggestionItem[];
}

export type PostStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'published';

export interface ReviewTrailItem {
  id: string;
  version: string;
  timestamp: string;
  userName: string;
  userRole: string;
  action: string;
  comment?: string;
  changesSummary?: string;
  /** Finding counts frozen at the moment a draft is submitted. */
  findingsSnapshot?: { total: number; open: number; resolved: number; critical: number };
}

export interface Post {
  id: string;
  campaign: string;
  title: string;
  originalDescription: string;
  creatorId: string;
  creatorName: string;
  creatorRole: string;
  platforms: Platform[];
  mediaUrls: string[];
  mediaType: 'image' | 'video';
  platformVariants: Partial<Record<Platform, PostPlatformVariant>>;
  status: PostStatus;
  brandRiskScore: BrandRiskScore;
  findings: AuditFinding[];
  reviewTrail: ReviewTrailItem[];
  version: string;
  assignedReviewer?: string;
  dispatches?: PostPublicationDispatch[];
  // Guideline version this post's current findings were checked against.
  guidelineVersion?: string;
  guidelineVersionId?: string;
  guidelineSnapshot?: GuidelineRulesSnapshot;
  checkedAt?: string;
  // Earlier checks are kept here when a pending post is re-checked.
  auditHistory?: AuditSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditSnapshot {
  guidelineVersion: string;
  guidelineVersionId?: string;
  checkedAt: string;
  findings: AuditFinding[];
  brandRiskScore: BrandRiskScore;
}

export interface CommentItem {
  id: string;
  platform: Platform;
  sourceAccountId?: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  text: string;
  timeReceived: string;
  likes: number;
  replyCount: number;
  status: 'new' | 'needs_reply' | 'flagged' | 'replied';
  suggestedReply: string;
  suggestedReplySource: string;
  replyDraft?: string;
  moderationReason?: string;
}

export interface PostPublicationDispatch {
  platform: Platform;
  status: 'published' | 'queued' | 'failed';
  timestamp: string;
  targetAccount: string;
  dispatchId: string;
  liveUrl?: string;
}

export interface GroqConfig {
  apiKey: string;
  model: string;
  isActive: boolean;
}

export interface ChannelConnection {
  id: string;
  platform: Platform;
  accountId?: string;
  name: string;
  status:
    | 'connected'
    | 'not_connected'
    | 'expired'
    | 'permission_required'
    | 'extension_required';
  accountName: string;
  accountHandle: string;
  lastSync: string;
  capabilities: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  status: 'active' | 'pending' | 'deactivated';
  draftCount: number;
  pendingSubmissions: number;
  lastActive: string;
}

export interface GrowthMetrics {
  reach: number;
  engagementRate: number;
  followerGrowth: number;
  bestPostTitle: string;
  bestPostPlatform: Platform;
  bestPostReach: number;
  bestPostEngagement: number;
}

export interface GovernanceMetrics {
  draftsChecked: number;
  issuesFixedBeforeReview: number;
  avgApprovalTimeHours: number;
  contestedFlags: number;
  repeatViolations: number;
  mostViolatedRules: { rule: string; count: number }[];
  errorRateByTeam: { team: string; rate: number }[];
  ambiguousRule: {
    ruleTitle: string;
    timesContested: number;
    description: string;
  };
}

// ---------------------------------------------------------------------------
// Governance Insights (GET /api/analytics/governance)
// ---------------------------------------------------------------------------
export interface ViolatedRuleRow {
  rule: string;
  /** Same id the Ambiguous Rule Alerts and the rule editor use. */
  ruleId: string;
  category: string;
  count: number;
  postsAffected: number;
  critical: number;
  warning: number;
  suggestion: number;
  contested: number;
}

export interface TeamErrorRow {
  team: string;
  posts: number;
  postsWithErrors: number;
  rate: number;
  avgSeriousFindingsPerPost: number;
}

export interface GovernanceInsights {
  generatedAt: string;
  postsInScope: number;
  available: { teams: string[]; platforms: Platform[]; creators: { id: string; name: string }[] };
  summary: {
    draftsChecked: number;
    totalFindings: number;
    contestedFlags: number;
    rejectedFlags: number;
    revisionRequests: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
  };
  mostViolatedRules: ViolatedRuleRow[];
  errorRateByTeam: TeamErrorRow[];
  fixedBeforeReview: {
    submittedDrafts: number;
    draftsFixedBeforeReview: number;
    rate: number | null;
    findingsFixedBeforeReview: number;
    findingsRaised: number;
  };
  approvalTime: {
    approvedPosts: number;
    avgHours: number | null;
    medianHours: number | null;
    fastestHours: number | null;
    slowestHours: number | null;
  };
  weeklyTrend: { weekStart: string; posts: number; findings: number; critical: number; approved: number }[];
}

export interface InsightFilters {
  days?: number;
  team?: string;
  platform?: Platform;
  creatorId?: string;
}

export interface ApprovalTimeStats {
  approvedCount: number;
  decisionCount: number;
  meanApprovalHours: number | null;
  medianApprovalHours: number | null;
  meanDecisionHours: number | null;
  medianDecisionHours: number | null;
  pendingCount: number;
}

export interface ClarificationSuggestion {
  source: 'groq' | 'rules';
  summary: string;
  proposedText: string;
  notes: string[];
  vagueTerms: string[];
}

export interface AmbiguousRuleAlert {
  ruleId: string;
  kind: RuleKind;
  label: string;
  text: string;
  context: string;
  editorTab: 'terminology' | 'facts' | 'voice';
  bannedTerm: string;
  preferredTerm: string;
  removed?: boolean;
  flagCount: number;
  disputeCount: number;
  disputeRate: number;
  topReasons: { reason: string; count: number }[];
  status: 'open' | 'dismissed' | 'resolved';
  reopened: boolean;
  closedAt?: string | null;
  resolvedVersion?: string | null;
  suggestion?: ClarificationSuggestion | null;
}
