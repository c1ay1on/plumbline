import { ApprovalTimeStats, Post } from '../../types';

// Same rules as backend/app/services/metrics.py.

const SUBMIT_ACTION = 'submitted for approval';
const APPROVE_ACTION = 'approved for publishing';
const CHANGES_ACTION = 'requested revisions';

interface ReviewCycle {
  postId: string;
  decision: 'approved' | 'changes_requested';
  hours: number;
}

export function reviewCycles(post: Post): ReviewCycle[] {
  const trail = [...(post.reviewTrail || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cycles: ReviewCycle[] = [];
  let submittedAt: number | null = null;
  let seenSubmit = false;
  for (const item of trail) {
    const action = (item.action || '').toLocaleLowerCase();
    const when = Date.parse(item.timestamp);
    if (Number.isNaN(when)) continue;
    if (action.startsWith(SUBMIT_ACTION)) {
      submittedAt = when;
      seenSubmit = true;
    } else if (action.startsWith(APPROVE_ACTION) || action.startsWith(CHANGES_ACTION)) {
      // Older posts created straight into review have no submit step, so creation time stands in for it.
      const start = submittedAt ?? (seenSubmit ? null : Date.parse(post.createdAt));
      if (start !== null && !Number.isNaN(start) && when >= start) {
        cycles.push({ postId: post.id, decision: action.startsWith(APPROVE_ACTION) ? 'approved' : 'changes_requested', hours: (when - start) / 3_600_000 });
      }
      submittedAt = null;
    }
  }
  return cycles;
}

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeApprovalTime(posts: Post[]): ApprovalTimeStats {
  const cycles = posts.flatMap(reviewCycles);
  const approvals = cycles.filter(cycle => cycle.decision === 'approved').map(cycle => cycle.hours);
  const decisions = cycles.map(cycle => cycle.hours);
  return {
    approvedCount: approvals.length,
    decisionCount: decisions.length,
    meanApprovalHours: approvals.length ? mean(approvals) : null,
    medianApprovalHours: approvals.length ? median(approvals) : null,
    meanDecisionHours: decisions.length ? mean(decisions) : null,
    medianDecisionHours: decisions.length ? median(decisions) : null,
    pendingCount: posts.filter(post => post.status === 'in_review').length
  };
}

export function formatDuration(hours: number | null): string {
  if (hours === null || Number.isNaN(hours)) return '--';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}
