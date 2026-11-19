import React from 'react';
import { Timer } from 'lucide-react';
import { Post } from '../../types';
import { computeApprovalTime, formatDuration } from '../../services/governance/approvalMetrics';

interface ApprovalTimeCardProps {
  posts: Post[];
}

export const ApprovalTimeCard: React.FC<ApprovalTimeCardProps> = ({ posts }) => {
  const stats = computeApprovalTime(posts);
  const hasData = stats.approvedCount > 0;

  return (
    <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4 h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
            <Timer className="w-5 h-5 text-[#0A4A3D]" />
            Average approval time
          </h2>
          <p className="text-xs text-[#68756F]">From submission to reviewer approval.</p>
        </div>
      </div>

      {hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <div className="text-[11px] font-semibold text-[#68756F]">Mean</div>
              <div className="text-2xl font-bold text-[#0A4A3D]">{formatDuration(stats.meanApprovalHours)}</div>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <div className="text-[11px] font-semibold text-[#68756F]">Median</div>
              <div className="text-2xl font-bold text-[#12201C]">{formatDuration(stats.medianApprovalHours)}</div>
            </div>
          </div>
          <div className="text-[11px] text-[#68756F] space-y-1">
            <div>Based on <strong className="text-[#12201C]">{stats.approvedCount}</strong> approval{stats.approvedCount === 1 ? '' : 's'}.</div>
            <div>
              Time to any decision (approve or request changes): <strong className="text-[#12201C]">{formatDuration(stats.meanDecisionHours)}</strong> mean
              across {stats.decisionCount} decision{stats.decisionCount === 1 ? '' : 's'}.
            </div>
            <div>{stats.pendingCount} submission{stats.pendingCount === 1 ? '' : 's'} waiting right now.</div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-xs text-stone-600">
          No approvals yet. Submit a post for review and approve it to start measuring.
          {stats.pendingCount > 0 && <> {stats.pendingCount} submission{stats.pendingCount === 1 ? ' is' : 's are'} waiting now.</>}
        </div>
      )}
    </div>
  );
};
