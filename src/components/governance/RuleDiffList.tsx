import React from 'react';
import { RuleChange } from '../../types';

const FIELD_NAMES: Record<string, string> = {
  context: 'Context', preferredTerm: 'Preferred term', bannedTerm: 'Banned term', explanation: 'Explanation',
  platforms: 'Platforms', fact: 'Fact', source: 'Source', category: 'Category', approvalStatus: 'Status',
  tones: 'Tones', customToneDescription: 'Voice statement', platformRules: 'Platform tone rules'
};

const KIND_NAMES: Record<RuleChange['kind'], string> = {
  terminology: 'Terminology', fact: 'Approved fact', voice: 'Voice', check: 'Check'
};

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (Array.isArray(value)) return value.join(', ') || '(empty)';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).filter(([, item]) => item).map(([key, item]) => `${key}: ${item}`).join(' | ') || '(empty)';
  }
  return String(value);
};

export const RuleDiffList: React.FC<{ changes: RuleChange[] }> = ({ changes }) => {
  if (changes.length === 0) {
    return <p className="text-xs text-stone-500">No rule changes in this version (colours, fonts or assets only, or a baseline snapshot).</p>;
  }
  return (
    <div className="space-y-2">
      {changes.map(change => (
        <div key={`${change.kind}-${change.ruleId}-${change.changeType}`} className="p-3 rounded-xl border border-stone-200 bg-stone-50/60 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              change.changeType === 'added' ? 'bg-emerald-100 text-[#167A58]'
                : change.changeType === 'removed' ? 'bg-red-100 text-[#C2413B]'
                : 'bg-amber-100 text-[#B45309]'
            }`}>
              {change.changeType}
            </span>
            <span className="text-[10px] text-stone-500">{KIND_NAMES[change.kind]}</span>
            <span className="font-semibold text-[#12201C]">{change.label}</span>
          </div>
          {change.changeType === 'modified' && change.fields.map(field => (
            <div key={field} className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-1 text-[11px]">
              <span className="font-semibold text-[#68756F]">{FIELD_NAMES[field] || field}</span>
              <span>
                <span className="text-[#C2413B] line-through mr-2">{show(change.before?.[field])}</span>
                <span className="text-[#167A58]">{show(change.after?.[field])}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
