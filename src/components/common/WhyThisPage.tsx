import React, { useState } from 'react';
import { Lightbulb, ChevronDown } from 'lucide-react';

/** Short, collapsible "why and when to use this page" note shown under a page title. */
export const WhyThisPage: React.FC<{ why: string; when: string[] }> = ({ why, when }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-[#0A4A3D]"><Lightbulb className="w-4 h-4" /> Why use this page</span>
        <ChevronDown className={`w-4 h-4 text-[#0A4A3D] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs sm:text-sm leading-relaxed text-emerald-950">{why}</p>
          <ul className="text-xs leading-relaxed text-emerald-900 list-disc pl-5 space-y-1">
            {when.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
};
