import React, { useState } from 'react';
import { CitationList } from '../../components/rag/CitationList';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  ShieldAlert,
  Send,
  MessageSquare,
  FileText,
  User,
  History,
  Info,
  Check,
  X,
  Lock,
  Edit3,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Platform, AuditFinding } from '../../types';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { BrandRiskScore } from '../../components/common/BrandRiskScore';
import { checkedVersion, isOutdatedCheck } from '../../services/governance/versioning';

export const ReviewDetailPage: React.FC = () => {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const { currentUser, currentRole } = useAuth();
  const {
    posts,
    guidelines,
    approvePost,
    requestChanges,
    publishPost,
    updateFindingStatus,
    disputeFinding,
    recheckPosts,
    updatePost
  } = useWorkspace();

  // Find post or fallback to first post
  const post = posts.find(p => p.id === submissionId) || posts[0];

  const [activePlatform, setActivePlatform] = useState<Platform>(
    (post?.platforms?.[0] as Platform) || 'linkedin'
  );
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  // Modals
  const [requestChangesModalOpen, setRequestChangesModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState(
    'Please review the requested changes and align the content with the active brand guidelines.'
  );

  const [contestModalOpen, setContestModalOpen] = useState(false);
  const [contestFindingId, setContestFindingId] = useState<string>('');
  const [contestReason, setContestReason] = useState('');

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approvalNote, setApprovalNote] = useState(
    'Reviewed against the active brand guidelines.'
  );

  if (!post) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center">
        <h2 className="text-lg font-bold">Submission not found</h2>
        <button
          onClick={() => navigate('/app/review')}
          className="mt-4 px-4 py-2 bg-[#0A4A3D] text-white rounded-xl text-xs"
        >
          Return to Queue
        </button>
      </div>
    );
  }

  const currentVariant = post.platformVariants[activePlatform] || {
    platform: activePlatform,
    title: post.title,
    description: post.originalDescription,
    targetTone: 'Standard Brand Tone',
    suggestions: []
  };

  const openFindings = post.findings.filter(f => f.status === 'open' || f.status === 'contested');

  const handleApplyFix = (finding: AuditFinding) => {
    // 1. Mark finding as accepted / fixed
    updateFindingStatus(post.id, finding.id, 'accepted');

    // 2. Replace the text in the platform variant
    if (finding.suggestedCorrection && currentVariant.description.includes(finding.affectedContent)) {
      const updatedDesc = currentVariant.description.replace(
        finding.affectedContent,
        finding.suggestedCorrection
      );

      updatePost({
        ...post,
        platformVariants: {
          ...post.platformVariants,
          [activePlatform]: {
            ...currentVariant,
            description: updatedDesc
          }
        }
      });
    }
  };

  const openContestDialog = (findingId: string) => {
    setContestFindingId(findingId);
    setContestReason('');
    setContestModalOpen(true);
  };

  const handleContestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    disputeFinding(post.id, contestFindingId, contestReason);
    setContestModalOpen(false);
  };

  const reviewVersion = checkedVersion(post);
  const outdated = isOutdatedCheck(post, guidelines.version);
  const lockedHistory = (post.status === 'approved' || post.status === 'published') && reviewVersion !== guidelines.version;

  const handleRecheck = () => {
    if (!confirm(`Re-check this post against guidelines ${guidelines.version}? The ${reviewVersion} results stay in the audit history.`)) return;
    recheckPosts([post.id]);
  };

  const handleRequestChangesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requestChanges(post.id, requestReason);
    setRequestChangesModalOpen(false);
    navigate('/app/review');
  };

  const handleApproveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    approvePost(post.id, approvalNote);
    setApproveModalOpen(false);
    navigate('/app/review');
  };

  const [isPublishing, setIsPublishing] = useState(false);
  const handlePublishNow = async () => {
    setIsPublishing(true);
    try {
      const result = await publishPost(post.id);
      if (result.failed > 0) {
        alert(`Publishing completed with ${result.succeeded} successful and ${result.failed} failed.\n\n${result.errors.join('\n')}`);
      } else if (result.succeeded > 0) {
        alert(`Successfully published to ${result.succeeded} selected platform(s).`);
        navigate('/app/home');
      } else {
        alert(result.errors.join('\n') || 'No new platforms were published.');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Publishing failed.');
    } finally {
      setIsPublishing(false);
    }
  };

  // Helper to render copy with clickable highlight markers for open findings
  const renderInteractiveCopy = (text: string) => {
    let elements: React.ReactNode[] = [text];

    openFindings.forEach(f => {
      if (!f.affectedContent || f.status === 'accepted' || f.status === 'rejected') return;

      const target = f.affectedContent;
      const nextElements: React.ReactNode[] = [];

      elements.forEach(el => {
        if (typeof el === 'string' && el.includes(target)) {
          const parts = el.split(target);
          parts.forEach((part, idx) => {
            if (part) nextElements.push(part);
            if (idx < parts.length - 1) {
              const highlightClass =
                f.severity === 'critical'
                  ? 'highlight-finding-critical'
                  : f.severity === 'warning'
                  ? 'highlight-finding-warning'
                  : 'highlight-finding-suggestion';

              nextElements.push(
                <span
                  key={`${f.id}-${idx}`}
                  onClick={() => setSelectedFindingId(f.id)}
                  className={`${highlightClass} ${
                    selectedFindingId === f.id ? 'ring-2 ring-[#0A4A3D]' : ''
                  }`}
                  title={`[${f.severity.toUpperCase()}] ${f.issueTitle} - Click to inspect finding`}
                >
                  {target}
                </span>
              );
            }
          });
        } else {
          nextElements.push(el);
        }
      });

      elements = nextElements;
    });

    return elements;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate('/app/review')}
          className="text-xs font-semibold text-stone-600 hover:text-[#12201C] flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Review Queue
        </button>
      </div>

      {/* A. Review Header */}
      <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#0A4A3D] bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              Campaign: {post.campaign}
            </span>
            <span className="text-stone-300">•</span>
            <h1 className="text-lg font-bold text-[#12201C]">{post.title}</h1>
            <Badge
              variant={
                post.status === 'approved'
                  ? 'success'
                  : post.status === 'in_review'
                  ? 'warning'
                  : 'danger'
              }
            >
              {post.status.replace('_', ' ')} — {post.version}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-[#68756F]">
            <span>Creator: <strong className="text-[#12201C]">{post.creatorName}</strong> ({post.creatorRole})</span>
            <span>•</span>
            <span>Current Reviewer: <strong className="text-[#12201C]">{post.assignedReviewer || 'Workspace reviewer'}</strong></span>
            <span>•</span>
            <span className="font-semibold text-amber-700">
              {openFindings.length} unresolved brand findings
            </span>
            <span>•</span>
            <span
              className="font-semibold text-[#0A4A3D] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"
              title={post.checkedAt ? `Checked ${new Date(post.checkedAt).toLocaleString()}` : undefined}
            >
              Checked against guidelines {reviewVersion}
            </span>
          </div>
        </div>

        {/* Manager Review Actions */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {currentRole !== 'employee' && post.status !== 'approved' && post.status !== 'published' && (
            <>
              <button
                type="button"
                onClick={() => setRequestChangesModalOpen(true)}
                className="px-4 py-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 shadow-xs"
              >
                Request changes
              </button>
              <button
                type="button"
                onClick={() => setApproveModalOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold shadow-xs flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Approve for publishing
              </button>
            </>
          )}

          {post.status === 'approved' && (
            <button
              type="button"
              onClick={handlePublishNow}
              disabled={currentRole === 'employee' || isPublishing}
              className="px-5 py-2.5 rounded-xl bg-[#167A58] hover:bg-[#126146] text-white text-xs font-semibold shadow-xs flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Publish to Connected Channels
            </button>
          )}

          {currentRole === 'employee' && (
            <div className="text-xs text-[#68756F] italic bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200">
              Creator View: Apply corrections below or dispute flagged rules.
            </div>
          )}
        </div>
      </div>

      {outdated && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-[#B45309] flex-shrink-0" />
            <span className="text-amber-900">
              The active guidelines are <strong>{guidelines.version}</strong>. This review still shows its <strong>{reviewVersion}</strong> results
              until it is re-checked. The current results move to the audit history, nothing is deleted.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRecheck}
            className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-2 self-start sm:self-auto whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            Re-check against {guidelines.version}
          </button>
        </div>
      )}

      {lockedHistory && (
        <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-600 flex items-center gap-2">
          <Lock className="w-4 h-4 text-stone-500" />
          This {post.status} review is kept exactly as it was checked against guidelines {reviewVersion}. Later guideline changes do not alter it.
        </div>
      )}

      {/* B. Platform Tabs */}
      <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
        <span className="text-xs font-semibold text-[#68756F] mr-2">Platform variant:</span>
        {post.platforms.map(p => (
          <button
            key={p}
            onClick={() => setActivePlatform(p)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${
              activePlatform === p
                ? 'bg-[#0A4A3D] text-white shadow-xs'
                : 'bg-white hover:bg-stone-100 text-stone-600 border border-stone-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Two-Column Review Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* C. Content Preview (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#0A4A3D]" />
                Content Preview ({activePlatform.toUpperCase()})
              </h2>
              <span className="text-[10px] text-[#68756F] bg-stone-100 px-2.5 py-0.5 rounded border border-stone-200">
                Click highlighted text to inspect finding
              </span>
            </div>

            {/* Creative Artwork Preview */}
            {post.mediaUrls[0] && (
              <div className="rounded-2xl overflow-hidden border border-stone-200 bg-stone-900 relative">
                <img
                  src={post.mediaUrls[0]}
                  alt="Post Creative Artwork"
                  className="w-full max-h-80 object-cover"
                />
                <div className="p-3 bg-stone-900/90 text-stone-200 text-xs flex items-center justify-between">
                  <span className="text-emerald-400 font-medium">Media attached</span>
                  <span className="text-stone-400 text-[11px]">{post.mediaUrls[0]}</span>
                </div>
              </div>
            )}

            {/* Platform Headline */}
            <div>
              <div className="text-[11px] font-semibold text-[#68756F] uppercase tracking-wider mb-1">
                Headline / Title
              </div>
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-bold text-[#12201C]">
                {currentVariant.title}
              </div>
            </div>

            {/* Body Copy with Interactive Highlighting */}
            <div>
              <div className="text-[11px] font-semibold text-[#68756F] uppercase tracking-wider mb-1">
                Post Copy (Audit Annotated)
              </div>
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-xs text-[#12201C] leading-relaxed whitespace-pre-wrap">
                {renderInteractiveCopy(currentVariant.description)}
              </div>
            </div>

            {/* Original Master Copy Comparison */}
            <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200 text-xs space-y-1">
              <span className="font-semibold text-amber-900 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-amber-700" />
                Original Master Copy (Preserved):
              </span>
              <p className="text-stone-600 italic">
                "{post.originalDescription}"
              </p>
            </div>
          </div>

          {/* E. Review Trail / Version Timeline */}
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <h3 className="text-sm font-bold text-[#12201C] flex items-center gap-2">
              <History className="w-4 h-4 text-[#0A4A3D]" />
              Audit Trail & Revision History
            </h3>

            <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-stone-200">
              {post.reviewTrail.map((item, idx) => (
                <div key={item.id} className="relative flex items-start gap-3 pl-6">
                  <div className="absolute left-1.5 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white bg-[#0A4A3D] shadow-xs" />
                  <div className="flex-1 p-3 rounded-xl bg-stone-50/80 border border-stone-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#12201C]">{item.action}</span>
                      <span className="text-[10px] text-stone-400 font-mono">
                        {item.version} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#68756F]">
                      By <strong>{item.userName}</strong> ({item.userRole})
                    </div>
                    {item.comment && (
                      <p className="text-stone-700 pt-1 border-t border-stone-200/60 mt-1 italic">
                        "{item.comment}"
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {(post.auditHistory?.length || 0) > 0 && (
            <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-3">
              <h3 className="text-sm font-bold text-[#12201C] flex items-center gap-2">
                <History className="w-4 h-4 text-[#0A4A3D]" />
                Earlier checks
              </h3>
              <p className="text-[11px] text-[#68756F]">Results from before this post was re-checked. Kept unchanged for the audit record.</p>
              {[...(post.auditHistory || [])].reverse().map(item => (
                <details key={`${item.guidelineVersion}-${item.checkedAt}`} className="p-3 rounded-xl bg-stone-50/80 border border-stone-200 text-xs">
                  <summary className="cursor-pointer font-semibold text-[#12201C]">
                    Guidelines {item.guidelineVersion} · {new Date(item.checkedAt).toLocaleString()} · {item.findings.length} finding(s), risk {item.brandRiskScore.overallScore}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {item.findings.map(finding => (
                      <li key={finding.id} className="text-[11px] text-stone-700">
                        <strong>{finding.issueTitle}</strong> ({finding.status}){finding.contestedReason ? ` - disputed: "${finding.contestedReason}"` : ''}
                      </li>
                    ))}
                    {item.findings.length === 0 && <li className="text-[11px] text-stone-500">No findings.</li>}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </div>

        {/* D. AI Findings Panel & Risk Score (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <BrandRiskScore score={post.brandRiskScore} />

          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div>
                <h3 className="text-sm font-bold text-[#12201C] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  AI Findings ({post.findings.length})
                </h3>
                <p className="text-xs text-[#68756F]">
                  Click "Apply fix", or "Dispute this flag" if the rule does not fit.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {post.findings.map(finding => {
                const isSelected = selectedFindingId === finding.id;

                const severityStyle = {
                  critical: {
                    badge: 'danger',
                    border: 'border-red-300',
                    bg: 'bg-red-50/30'
                  },
                  warning: {
                    badge: 'warning',
                    border: 'border-amber-300',
                    bg: 'bg-amber-50/30'
                  },
                  suggestion: {
                    badge: 'primary',
                    border: 'border-emerald-300',
                    bg: 'bg-emerald-50/30'
                  }
                }[finding.severity] as { badge: 'danger' | 'warning' | 'primary'; border: string; bg: string };

                return (
                  <div
                    key={finding.id}
                    id={`finding-${finding.id}`}
                    className={`p-4 rounded-xl border transition-all text-xs space-y-2.5 ${
                      isSelected
                        ? 'border-[#0A4A3D] ring-2 ring-[#0A4A3D]/20 shadow-md bg-white'
                        : `${severityStyle.border} ${severityStyle.bg}`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={severityStyle.badge} size="sm">
                            {finding.severity}
                          </Badge>
                          <span className="font-bold text-[#12201C]">{finding.issueTitle}</span>
                        </div>
                        <div className="text-[10px] text-[#68756F]">
                          Confidence: {(finding.confidence * 100).toFixed(0)}% • Version {finding.guidelineVersion}
                        </div>
                      </div>

                      <Badge
                        variant={
                          finding.status === 'accepted'
                            ? 'success'
                            : finding.status === 'contested'
                            ? 'warning'
                            : 'neutral'
                        }
                        size="sm"
                      >
                        {finding.status}
                      </Badge>
                    </div>

                    {/* Flagged copy snippet */}
                    <div className="p-2 rounded bg-white border border-stone-200 text-[11px] font-mono text-red-900">
                      Flagged: "{finding.affectedContent}"
                    </div>

                    {/* Explanation */}
                    <p className="text-stone-700 leading-relaxed text-[11px]">
                      {finding.description}
                    </p>

                    {/* Source reference citation */}
                    <div className="text-[10px] text-stone-500 font-mono">
                      Source: <strong>{finding.sourceReference}</strong>
                      {finding.ruleLabel && <> · Rule: <strong>{finding.ruleLabel}</strong></>}
                    </div>
                    <CitationList citations={finding.citations} />

                    {/* Contested reason if present */}
                    {finding.contestedReason && (
                      <div className="p-2 rounded bg-amber-100/60 border border-amber-300 text-[11px] text-amber-900">
                        <strong>Disputed{finding.disputedBy ? ` by ${finding.disputedBy}` : ''}:</strong> "{finding.contestedReason}"
                      </div>
                    )}

                    {finding.status === 'contested' && !finding.contestedReason && (
                      <div className="p-2 rounded bg-amber-100/60 border border-amber-300 text-[11px] text-amber-900">
                        <strong>Disputed{finding.disputedBy ? ` by ${finding.disputedBy}` : ''}</strong> (no reason given)
                      </div>
                    )}

                    {/* Suggested Correction */}
                    {finding.suggestedCorrection && (
                      <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] space-y-1">
                        <span className="font-bold text-[#167A58]">Suggested correction:</span>
                        <div className="text-[#12201C] font-medium">"{finding.suggestedCorrection}"</div>
                      </div>
                    )}

                    {/* Action buttons on finding */}
                    {finding.status === 'open' && (
                      <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-200/50">
                        <button
                          type="button"
                          onClick={() => openContestDialog(finding.id)}
                          className="px-2.5 py-1 rounded-lg border border-stone-200 hover:bg-stone-100 text-[11px] font-medium text-stone-600"
                        >
                          Dispute this flag
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyFix(finding)}
                          className="px-3 py-1 rounded-lg bg-[#0A4A3D] text-white hover:bg-[#063028] text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                        >
                          <Check className="w-3 h-3" />
                          Apply fix
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Contest Finding Modal */}
      <Modal
        isOpen={contestModalOpen}
        onClose={() => setContestModalOpen(false)}
        title="Dispute this flag"
        subtitle="Disputes are counted per rule. Rules that are disputed often are sent to the guideline owner to clarify."
      >
        <form onSubmit={handleContestSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">
              Reason (optional)
            </label>
            <textarea
              rows={4}
              value={contestReason}
              onChange={e => setContestReason(e.target.value)}
              placeholder="e.g. This is a direct quote from a student, so the term should be allowed here."
              className="w-full p-3 text-xs rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setContestModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold"
            >
              Dispute flag
            </button>
          </div>
        </form>
      </Modal>

      {/* Request Changes Modal */}
      <Modal
        isOpen={requestChangesModalOpen}
        onClose={() => setRequestChangesModalOpen(false)}
        title="Request Revisions from Creator"
        subtitle="Explain what modifications the creator must make before approval."
      >
        <form onSubmit={handleRequestChangesSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">
              Feedback / Modification Notes
            </label>
            <textarea
              rows={4}
              required
              value={requestReason}
              onChange={e => setRequestReason(e.target.value)}
              className="w-full p-3 text-xs rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRequestChangesModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#C2413B] text-white text-xs font-semibold"
            >
              Request Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Approve Modal */}
      <Modal
        isOpen={approveModalOpen}
        onClose={() => setApproveModalOpen(false)}
        title="Approve for Publishing"
        subtitle="Sign off on this submission to permit social distribution."
      >
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">
              Compliance Sign-Off Note
            </label>
            <textarea
              rows={3}
              value={approvalNote}
              onChange={e => setApprovalNote(e.target.value)}
              className="w-full p-3 text-xs rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
            />
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-[#0A4A3D]">
            Approving this post will transition its status to <strong>Ready to Publish</strong> across connected channels.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setApproveModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold"
            >
              Confirm Approval
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
