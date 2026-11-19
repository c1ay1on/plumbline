import React from 'react';
import { PlayCircle } from 'lucide-react';
import { openDemoTour } from './demoTourEvents';

/** Compact "Watch demo" launcher sized for the header's top status bar. */
export const WatchDemoButton: React.FC = () => (
  <button
    type="button"
    data-tour="watch-demo"
    onClick={openDemoTour}
    title="Watch the Plumbline demo walkthrough"
    aria-label="Watch the Plumbline demo walkthrough"
    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-[#167A58] text-white border border-emerald-500/70 hover:bg-[#126150]"
  >
    <PlayCircle className="w-3 h-3" />
    <span className="hidden sm:inline">Watch demo</span>
  </button>
);
