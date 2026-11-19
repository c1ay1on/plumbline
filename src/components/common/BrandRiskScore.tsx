import React from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { BrandRiskScore as IBrandRiskScore } from '../../types';

interface BrandRiskScoreProps {
  score: IBrandRiskScore;
  compact?: boolean;
}

export const BrandRiskScore: React.FC<BrandRiskScoreProps> = ({ score, compact = false }) => {
  // Older or imported posts can carry a partial score; fall back to safe defaults instead of crashing.
  const overallScore = score?.overallScore ?? 0;
  const riskCategory: IBrandRiskScore['riskCategory'] =
    score?.riskCategory ?? (overallScore > 50 ? 'high' : overallScore > 20 ? 'medium' : 'low');
  const breakdown = score?.breakdown ?? {
    unsupportedClaims: 0, visualAssets: 0, messagingViolations: 0, terminology: 0, accessibility: 0, toneInconsistencies: 0
  };
  const criticalCount = score?.criticalCount ?? 0;
  const warningCount = score?.warningCount ?? 0;
  const suggestionCount = score?.suggestionCount ?? 0;

  const getRiskColor = (cat: 'low' | 'medium' | 'high') => {
    switch (cat) {
      case 'low':
        return {
          text: 'text-[#167A58]',
          bg: 'bg-[#D1FAE5]',
          border: 'border-[#167A58]/20',
          bar: 'bg-[#167A58]',
          label: 'Low Risk'
        };
      case 'medium':
        return {
          text: 'text-[#B45309]',
          bg: 'bg-[#FEF3C7]',
          border: 'border-[#B45309]/20',
          bar: 'bg-[#B45309]',
          label: 'Medium Risk'
        };
      case 'high':
        return {
          text: 'text-[#C2413B]',
          bg: 'bg-[#FEE2E2]',
          border: 'border-[#C2413B]/20',
          bar: 'bg-[#C2413B]',
          label: 'High Risk'
        };
    }
  };

  const theme = getRiskColor(riskCategory);

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.border} ${theme.bg}`}>
        {riskCategory === 'low' ? (
          <ShieldCheck className={`w-4 h-4 ${theme.text}`} />
        ) : (
          <ShieldAlert className={`w-4 h-4 ${theme.text}`} />
        )}
        <span className={`text-xs font-semibold ${theme.text}`}>
          Risk Score: {overallScore}/100 ({theme.label})
        </span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-plumb-subtle">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold text-[#12201C] flex items-center gap-2">
            Brand Governance Risk Score
            <span className="group relative cursor-pointer">
              <Info className="w-4 h-4 text-[#68756F]" />
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-[#12201C] text-white text-xs rounded-lg shadow-xl z-30">
                0–100 scale weighted by severity: Unverified claims (30pts), Visual mismatches (25pts), Messaging (20pts), Terminology (10pts), Accessibility (10pts), Tone (5pts).
              </div>
            </span>
          </h4>
          <p className="text-xs text-[#68756F]">Objective calculation based on active guideline checks</p>
        </div>

        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${theme.border} ${theme.bg}`}>
          {riskCategory === 'low' ? (
            <ShieldCheck className={`w-4 h-4 ${theme.text}`} />
          ) : (
            <ShieldAlert className={`w-4 h-4 ${theme.text}`} />
          )}
          <span className={`text-xs font-bold ${theme.text}`}>
            {overallScore} / 100 • {theme.label}
          </span>
        </div>
      </div>

      {/* Progress Bar Gauge */}
      <div className="w-full bg-stone-100 rounded-full h-2.5 mb-4 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${theme.bar}`}
          style={{ width: `${Math.max(overallScore, 4)}%` }}
        />
      </div>

      {/* Findings Count Pills */}
      <div className="grid grid-cols-3 gap-2 py-3 border-y border-stone-100 text-center mb-4">
        <div className="p-2 rounded-lg bg-red-50/60">
          <div className="text-base font-bold text-[#C2413B]">{criticalCount}</div>
          <div className="text-[11px] font-medium text-stone-600">Critical</div>
        </div>
        <div className="p-2 rounded-lg bg-amber-50/60">
          <div className="text-base font-bold text-[#B45309]">{warningCount}</div>
          <div className="text-[11px] font-medium text-stone-600">Warnings</div>
        </div>
        <div className="p-2 rounded-lg bg-emerald-50/60">
          <div className="text-base font-bold text-[#167A58]">{suggestionCount}</div>
          <div className="text-[11px] font-medium text-stone-600">Suggestions</div>
        </div>
      </div>

      {/* Breakdown Contributions */}
      <div className="space-y-1.5 text-xs text-[#68756F]">
        <div className="flex justify-between items-center">
          <span>Unsupported claims & facts:</span>
          <span className="font-semibold text-[#12201C]">{breakdown.unsupportedClaims} pts</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Terminology violations:</span>
          <span className="font-semibold text-[#12201C]">{breakdown.terminology} pts</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Accessibility requirements:</span>
          <span className="font-semibold text-[#12201C]">{breakdown.accessibility} pts</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Channel tone mismatches:</span>
          <span className="font-semibold text-[#12201C]">{breakdown.toneInconsistencies} pts</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-stone-100 text-[11px] text-[#68756F] italic flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <span>"AI flags and suggests. Your reviewers decide. Nothing is rewritten silently."</span>
      </div>
    </div>
  );
};
