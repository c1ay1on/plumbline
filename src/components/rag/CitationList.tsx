import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import type { RuleCitation } from '../../types';

const sourceStyle: Record<string, string> = {
  'Uploaded rulebook': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  'Brand Knowledge': 'bg-emerald-50 text-[#167A58] border-emerald-200',
  'Plumbline baseline': 'bg-stone-100 text-stone-700 border-stone-200'
};

/** Shows the exact rule passages a finding cites. Collapsed by default so lists stay short. */
export const CitationList: React.FC<{ citations?: RuleCitation[]; defaultOpen?: boolean }> = ({ citations, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (!citations || citations.length === 0) return null;
  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 font-semibold text-[#0A4A3D] hover:underline"
        aria-expanded={open}
      >
        <BookOpen className="w-3 h-3" />
        {open ? 'Hide' : 'Show'} cited rule{citations.length > 1 ? 's' : ''} ({citations.length})
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {citations.map(c => (
            <div key={c.id} className="rounded-lg border border-stone-200 bg-stone-50 p-2">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${sourceStyle[c.source] || sourceStyle['Plumbline baseline']}`}>{c.source}</span>
                <span className="font-semibold text-[#12201C]">{c.label}</span>
                {c.page ? <span className="text-stone-500">page {c.page}</span> : null}
              </div>
              <blockquote className="text-stone-700 leading-relaxed border-l-2 border-[#0A4A3D]/40 pl-2 whitespace-pre-wrap break-words">{c.text}</blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
