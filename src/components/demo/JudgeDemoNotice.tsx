import React, { useEffect, useState } from 'react';
import { Info, X, FlaskConical } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const DEMO_EMAIL = ((import.meta.env.VITE_DEMO_EMAIL as string | undefined) || 'judge@demo.com').toLowerCase();
const SEEN_KEY = 'plumbline_judge_notice_seen';

/** Shown only to the judge demo account: explains the test-account setup once per session, then stays as a slim bar. */
export const JudgeDemoNotice: React.FC = () => {
  const { currentUser } = useAuth();
  const isJudge = (currentUser.email || '').toLowerCase() === DEMO_EMAIL;
  const [modalOpen, setModalOpen] = useState(false);
  const [barHidden, setBarHidden] = useState(false);

  useEffect(() => {
    if (isJudge && !sessionStorage.getItem(SEEN_KEY)) setModalOpen(true);
  }, [isJudge]);

  if (!isJudge) return null;

  const close = () => { sessionStorage.setItem(SEEN_KEY, '1'); setModalOpen(false); };

  return (
    <>
      {!barHidden && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center justify-center gap-2 text-center">
          <FlaskConical className="w-3.5 h-3.5 shrink-0" />
          <span><strong>Judge demo account.</strong> Connected social accounts are team-owned test accounts. Connecting your own account won't work yet: platform app review is pending.</span>
          <button onClick={() => setModalOpen(true)} className="underline font-semibold shrink-0">Why?</button>
          <button onClick={() => setBarHidden(true)} aria-label="Hide" className="ml-1 shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-[#12201C] flex items-center gap-2"><Info className="w-5 h-5 text-[#0A4A3D]" /> Welcome, judges</h2>
              <button onClick={close} aria-label="Close"><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="text-sm text-stone-700 space-y-3 leading-relaxed">
              <p>This workspace is already connected to <strong>test accounts our team owns</strong> (YouTube, a Facebook Page, a linked Instagram professional account and Threads). Everything you see in Comments and Channels is live data from those accounts.</p>
              <p><strong>Please don't connect your own social accounts.</strong> Meta and Google only let an app access accounts that are registered as testers until the app passes their review. Our review request was rejected for now, so we added our accounts as testers instead. A personal account will be refused at the consent screen.</p>
              <p>Nothing you do here posts publicly. Create Post saves internal drafts only. <strong>Account Lookup</strong> works on any public YouTube channel or Instagram business account, no connection needed, so that's the best place to try your own examples.</p>
            </div>
            <button onClick={close} className="w-full py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white font-semibold text-sm">Got it, explore the demo</button>
          </div>
        </div>
      )}
    </>
  );
};
