import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Info,
  Puzzle
} from 'lucide-react';

export const ChannelAvailabilityNotice: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="border-l-4 border-[#0A4A3D] px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0A4A3D]">
            <Info className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0A4A3D]">
                Hackathon demo
              </span>
              <span className="text-[10px] font-medium text-stone-500">
                Current integration status
              </span>
            </div>
            <h3 className="text-base font-bold text-[#12201C] sm:text-lg">
              Channel availability & integration notice
            </h3>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-stone-600">
              Some social platforms require additional API access or developer-account verification.
              Here is the status of the integrations for this demonstration.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#12201C]">LinkedIn</h4>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                Integrated
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-700">
              Successfully integrated and functional.
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#12201C]">X (Twitter)</h4>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                <AlertCircle className="h-3 w-3" />
                Partial access
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-700">
              Partially functional. Full API access requires a $5 API credit purchase.
              We have deferred this expense until Round 3.
            </p>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#12201C]">Meta, Instagram, Threads & YouTube</h4>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-stone-700 ring-1 ring-stone-200">
                <Clock3 className="h-3 w-3" />
                Verification pending
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-700">
              These integrations require evaluator accounts to be added as tester accounts to our
              developer applications. We do not have access to those accounts, so this verification
              cannot currently be completed.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-stone-200 bg-[#F8FAF9] p-4">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#0A4A3D]" />
          <div>
            <h4 className="text-xs font-bold text-[#12201C]">
              Why haven't the applications been published?
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-stone-600">
              Public application approval and publishing can take anywhere from several days to weeks,
              which falls outside the available hackathon timeline.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-[#0A4A3D] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-100">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">
              Try Plumbline while browsing social media
            </h4>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-emerald-50/90">
              The Plumbline Chrome extension provides another way to experience brand-checking
              functionality on supported websites. Install it using the setup guide on your dashboard.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/app/home')}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-[#0A4A3D] transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0A4A3D]"
        >
          View setup instructions
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
};
