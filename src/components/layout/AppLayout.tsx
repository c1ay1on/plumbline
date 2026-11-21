import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../common/Header';
import { JudgeDemoNotice } from '../demo/JudgeDemoNotice';

export const AppLayout: React.FC = () => (
  <div className="min-h-screen bg-[#F2F5F3] flex flex-col font-sans">
    <Header />
    <JudgeDemoNotice />
    <main className="flex-1"><Outlet /></main>
    <footer className="bg-white border-t border-stone-200 py-6 px-4 text-center text-xs text-[#68756F]">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="font-bold text-[#12201C]">Plumbline</span><span>—</span><span>Every post, true to your brand, before it goes live.</span></div>
        <div className="text-[11px] text-stone-500">Human-reviewed brand governance · Connected platform APIs</div>
      </div>
    </footer>
  </div>
);
