import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, RefreshCw, X } from 'lucide-react';
import { ChangeImpact } from '../../types';

interface ChangeImpactPanelProps {
  impact: ChangeImpact;
  onRecheck: (postIds: string[]) => void;
  onClose?: () => void;
}

export const ChangeImpactPanel: React.FC<ChangeImpactPanelProps> = ({ impact, onRecheck, onClose }) => {
  const navigate = useNavigate();
  const hasImpact = impact.affectedCount > 0;

  return (
    <div className={`p-4 rounded-2xl border text-xs space-y-3 ${hasImpact ? 'bg-amber-50/70 border-amber-300' : 'bg-emerald-50/60 border-emerald-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {hasImpact
            ? <AlertTriangle className="w-5 h-5 text-[#B45309] flex-shrink-0" />
            : <CheckCircle className="w-5 h-5 text-[#167A58] flex-shrink-0" />}
          <div>
            <div className="font-bold text-[#12201C]">Saved guidelines {impact.version}. {impact.summary}</div>
            <div className="text-[11px] text-[#68756F] mt-0.5">
              Approved and published reviews keep the results of the version they were checked against
              {impact.lockedHistoryCount > 0 && ` (${impact.lockedHistoryCount} touched by this change, left unchanged)`}.
            </div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700" title="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {hasImpact && (
        <>
          <div className="divide-y divide-amber-200/70 bg-white/70 rounded-xl border border-amber-200">
            {impact.affected.map(item => (
              <div key={item.postId} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <button onClick={() => navigate(`/app/review/${item.postId}`)} className="font-semibold text-[#0A4A3D] hover:underline text-left">
                    {item.title}
                  </button>
                  <span className="text-[10px] text-stone-500 ml-2">{item.status.replace('_', ' ')} · checked under {item.checkedVersion}</span>
                  <div className="text-[11px] text-stone-600">{item.reasons.join('; ')}</div>
                </div>
                <button
                  onClick={() => onRecheck([item.postId])}
                  className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-semibold text-stone-700 self-start sm:self-auto"
                >
                  Re-check
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => onRecheck(impact.affected.map(item => item.postId))}
            className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Re-check {impact.affectedCount} pending review{impact.affectedCount === 1 ? '' : 's'} against {impact.version}
          </button>
        </>
      )}
    </div>
  );
};
