import React, { useEffect, useState } from 'react';
import { Eye, Palette, Contrast, BadgeCheck, Type, RefreshCw } from 'lucide-react';
import type { VisualAuditResult } from '../../types';

interface Props {
  result: (VisualAuditResult & { thumbnail?: string }) | null;
  loading: boolean;
  error: string;
  hasMedia: boolean;
  altText: string;
  onRun: () => void;
  onUseAltText: (text: string) => void;
}

const sevStyle: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  suggestion: 'bg-stone-200 text-stone-700'
};

const statusStyle: Record<string, string> = {
  on_palette: 'bg-emerald-50 text-[#167A58] border-emerald-200',
  neutral: 'bg-stone-50 text-stone-600 border-stone-200',
  off_palette: 'bg-red-50 text-red-800 border-red-200'
};

const statusLabel: Record<string, string> = { on_palette: 'Brand', neutral: 'Neutral', off_palette: 'Off-palette' };

/** Improvement 2: shows what the visual check measured on the creative and lets the creator adopt the alt-text draft. */
export const VisualAuditPanel: React.FC<Props> = ({ result, loading, error, hasMedia, altText, onRun, onUseAltText }) => {
  const [draftAlt, setDraftAlt] = useState('');
  useEffect(() => { setDraftAlt(result?.suggestedAltText || ''); }, [result?.suggestedAltText]);

  if (!hasMedia) return null;
  const findings = (result?.findings || []).filter(f => !(f.category === 'alt_text_missing' && altText.trim()));

  return (
    <div className="bg-white rounded-2xl p-4 border border-stone-200 space-y-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-[#12201C] flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Visual and accessibility check</div>
          <div className="text-[10px] text-stone-500">
            {result
              ? `${result.meta.mediaKind === 'video' ? 'Video thumbnail' : 'Image'} ${result.meta.width}x${result.meta.height} • ${result.meta.provider ? `vision: ${result.meta.provider.split(':').pop()}` : 'colour and contrast only'} • ${result.meta.ms} ms`
              : 'Checks palette, WCAG text contrast, logo usage and drafts alt text.'}
          </div>
        </div>
        <button type="button" onClick={onRun} disabled={loading} className="px-3 py-2 rounded-lg bg-[#0A4A3D] text-white text-[11px] font-semibold disabled:opacity-50 shrink-0 inline-flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking…' : result ? 'Re-check' : 'Check creative'}
        </button>
      </div>

      {error && <p className="text-[11px] text-amber-700">{error}</p>}
      {result?.meta.aiError && <p className="text-[11px] text-amber-700">Vision model unavailable ({result.meta.aiError}). Palette and contrast checks still ran; logo check skipped.</p>}

      {result && (
        <>
          {/* Palette */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[#12201C] flex items-center gap-1"><Palette className="w-3 h-3" /> Palette: {result.palette.paletteConfigured ? `${result.palette.onPalettePct}% on brand` : 'no brand colours set in Brand Knowledge'}</div>
            <div className="flex flex-wrap gap-1.5">
              {result.palette.colours.map(c => (
                <div key={c.hex} className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-[10px] ${statusStyle[c.status]}`} title={c.nearestBrand ? `Nearest brand colour: ${c.nearestBrand} ${c.nearestBrandHex} (ΔE ${c.deltaE})` : ''}>
                  <span className="w-3.5 h-3.5 rounded border border-black/10" style={{ background: c.hex }} />
                  <span className="font-mono">{c.hex}</span>
                  <span>{Math.round(c.coverage * 100)}%</span>
                  <span className="font-semibold">{statusLabel[c.status]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Contrast */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[#12201C] flex items-center gap-1"><Contrast className="w-3 h-3" /> Text contrast (WCAG 2.1 AA)</div>
            {result.contrast.length === 0 ? (
              <p className="text-[10px] text-stone-500">No text found on the creative.</p>
            ) : result.contrast.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="px-1.5 py-0.5 rounded font-bold border border-black/10" style={{ color: c.foreground, background: c.background }}>Aa</span>
                <span className="flex-1 truncate text-stone-700">{c.text ? `“${c.text}”` : 'Estimated text area'}{c.largeText ? ' (large)' : ''}</span>
                <span className="font-mono">{c.ratio}:1</span>
                <span className={`px-1.5 py-0.5 rounded font-bold ${c.passesAA ? 'bg-emerald-100 text-[#167A58]' : 'bg-red-100 text-red-800'}`}>{c.passesAA ? 'Pass' : `Fail (${c.required}:1)`}</span>
              </div>
            ))}
          </div>

          {/* Logo */}
          <div className="text-[11px] flex items-start gap-1">
            <BadgeCheck className="w-3 h-3 mt-0.5" />
            <span>
              <span className="font-semibold text-[#12201C]">Logo: </span>
              {result.logo.approvedLogos === 0
                ? 'upload a PNG or JPG logo in Brand Knowledge, Logos and Assets to enable this check.'
                : !result.logo.checked ? 'not checked (vision model unavailable).'
                : !result.logo.result?.present ? 'no approved logo found on the creative.'
                : `found${result.logo.result.matchesApproved === false ? ', not an approved variant' : ', matches an approved variant'}${result.logo.aspect ? `, proportions ${result.logo.aspect.differencePct}% off` : ''}${result.logo.result.distorted ? ', looks distorted' : ''}.`}
            </span>
          </div>

          {/* Alt text */}
          {(result.suggestedAltText || !altText.trim()) && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-[#12201C] flex items-center gap-1"><Type className="w-3 h-3" /> Suggested alt text (edit before using)</div>
              <textarea rows={2} value={draftAlt} onChange={e => setDraftAlt(e.target.value)} placeholder="The vision model could not draft one. Describe the subject, action and any on-image text." className="w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-stone-200" />
              <button type="button" disabled={!draftAlt.trim()} onClick={() => onUseAltText(draftAlt.trim())} className="px-2.5 py-1 rounded-lg border border-[#0A4A3D] text-[#0A4A3D] text-[10px] font-semibold disabled:opacity-40">Use as alt text</button>
            </div>
          )}

          {/* Findings */}
          {findings.length === 0 ? (
            <p className="text-[11px] text-[#167A58]">No visual or accessibility issues found.</p>
          ) : (
            <div className="space-y-2">
              {findings.map(f => (
                <div key={f.id} className="p-2.5 rounded-xl border border-stone-200 bg-stone-50 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-[#12201C]">{f.issueTitle}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${sevStyle[f.severity]}`}>{f.severity}</span>
                  </div>
                  {f.description && <p className="text-[11px] text-stone-700">{f.description}</p>}
                  {f.suggestedCorrection && <p className="text-[11px] text-[#167A58]">Suggestion: {f.suggestedCorrection}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
