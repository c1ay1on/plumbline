import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Download,
  FolderOpen,
  KeyRound,
  Puzzle,
  RefreshCw
} from 'lucide-react';

// Add the ZIP at public/plumbline-extension.zip, then change this to true.
// Vite serves files in /public from the site root.
const EXTENSION_DOWNLOAD_READY = true;
const EXTENSION_ZIP_PATH = '/plumbline-extension.zip';

export const ExtensionSetupCard: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section className="bg-white rounded-2xl border border-emerald-200 shadow-plumb-subtle overflow-hidden">
      <div className="bg-[#EAF4EF] px-6 py-5 sm:px-7 border-b border-emerald-100">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#0A4A3D] text-white flex items-center justify-center flex-shrink-0">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[#0A4A3D] bg-white/80 border border-emerald-200 px-2 py-1 rounded-full">
                  Browser extension
                </span>
                <span className="text-[10px] font-semibold text-emerald-800">Hackathon demo build</span>
              </div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#12201C]">
                Take Plumbline into your browser
              </h2>
              <p className="text-xs sm:text-sm text-[#52645C] mt-1 max-w-2xl leading-relaxed">
                Use Plumbline's browser extension to review content on supported websites,
                including sites that are not connected directly to the dashboard.
              </p>
            </div>
          </div>

          <div className="lg:max-w-xs lg:text-right">
            {EXTENSION_DOWNLOAD_READY ? (
              <a
                href={EXTENSION_ZIP_PATH}
                download
                className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-bold"
              >
                <Download className="w-4 h-4" />
                Download extension ZIP
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Add public/plumbline-extension.zip and enable the download in ExtensionSetupCard.tsx."
                className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-300 text-stone-600 text-xs font-bold cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Extension ZIP not uploaded
              </button>
            )}
            <p className="text-[10px] text-[#68756F] mt-2 leading-relaxed">
              {EXTENSION_DOWNLOAD_READY
                ? 'Download, extract, and load the folder in Chrome.'
                : 'The download activates after the extension package is added to the website.'}
            </p>
          </div>
        </div>
        <p className="mt-4 pt-3 border-t border-emerald-200/80 text-[11px] text-[#52645C] leading-relaxed">
          <strong className="text-[#12201C]">Why Developer mode?</strong>{' '}
          Chrome Web Store developer registration has a one-time US$5 fee.
          For this hackathon demo, we are distributing the extension directly instead.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        <div className="p-6 sm:p-7 lg:border-r border-stone-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-stone-100 text-[#0A4A3D] flex items-center justify-center text-[11px] font-extrabold">01</div>
            <h3 className="text-sm font-bold text-[#12201C]">Install the extension in Chrome</h3>
          </div>
          <ol className="space-y-3.5">
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                <strong className="text-[#12201C]">Download and unzip</strong> the Plumbline extension package.
                Keep the extracted folder somewhere easy to find.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Open Google Chrome and visit <strong className="text-[#12201C]">chrome://extensions</strong>,
                or open the three-dot menu and choose <strong className="text-[#12201C]">Extensions → Manage Extensions</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Turn on <strong className="text-[#12201C]">Developer mode</strong> using the switch in the top-right corner.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">4</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Click <strong className="text-[#12201C]">Load unpacked</strong> and select the extracted extension folder.
                Choose the folder that contains <code className="px-1 py-0.5 rounded bg-stone-100 text-[#0A4A3D] text-[10px]">manifest.json</code>.
              </span>
            </li>
          </ol>
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200">
            <FolderOpen className="w-4 h-4 text-stone-500 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-stone-600 leading-relaxed">
              Chrome may open a separate, blank-looking setup tab after the extension loads.
              Continue with the extension setup flow and leave the extension enabled.
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-stone-100 text-[#0A4A3D] flex items-center justify-center text-[11px] font-extrabold">02</div>
            <h3 className="text-sm font-bold text-[#12201C]">Connect your Plumbline account</h3>
          </div>
          <ol className="space-y-3.5">
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                On the extension setup screen, click <strong className="text-[#12201C]">Save Keys</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Choose <strong className="text-[#12201C]">Connect Account</strong> and sign in with the same
                Plumbline account you just created on this website.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Click <strong className="text-[#12201C]">Sync Now</strong> to sync your account and workspace information.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">4</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Click <strong className="text-[#12201C]">Save Guidelines</strong> so the extension can use your brand rules.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-[#0A4A3D] text-[10px] font-bold flex items-center justify-center flex-shrink-0">5</span>
              <span className="text-xs text-[#52645C] leading-relaxed">
                Open Chrome's <strong className="text-[#12201C]">Extensions</strong> menu in the toolbar,
                select Plumbline, and pin it for quick access on a supported website.
              </span>
            </li>
          </ol>

          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
            <KeyRound className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-amber-900 leading-relaxed">
              <strong>Before using the extension:</strong> add your brand details and guidelines in
              Plumbline first. The extension needs your workspace's brand information to review content.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/app/brand-knowledge')}
            className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-bold transition-colors"
          >
            Add brand details
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <p className="mt-4 text-[10px] text-stone-500 leading-relaxed flex items-start gap-2">
            <RefreshCw className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            After changing brand rules, repeat the extension's Save Guidelines step to refresh what it uses.
          </p>
        </div>
      </div>
    </section>
  );
};
