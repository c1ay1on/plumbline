import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, Download, Eye, EyeOff, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { apiClient } from '../../services/api/client';
import type { RulebookDocument } from '../../types';
import sampleRulebooks from 'virtual:sample-rulebooks';

const MAX_MB = 10;
const ACCEPT = '.pdf,.md,.markdown,.txt';

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Real rulebook upload (Improvement 1). Files are parsed and indexed on the backend,
 * and the grounded audit retrieves and cites their passages in the web app and the extension.
 */
export const RulebookManager: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [docs, setDocs] = useState<RulebookDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [passages, setPassages] = useState<Record<string, Array<{ id: string; label: string; text: string; page: number | null }>>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDocs(await apiClient.listRulebooks());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load rulebooks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setError('');
    setNotice('');
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (!['pdf', 'md', 'markdown', 'txt'].includes(ext)) { setError('Upload a PDF (.pdf) or Markdown (.md) file.'); return; }
    if (file.size === 0) { setError('That file is empty.'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`That file is larger than ${MAX_MB} MB.`); return; }
    setBusy(true);
    try {
      const doc = await apiClient.uploadRulebook(file);
      setDocs(prev => [doc, ...prev.filter(d => d.id !== doc.id)]);
      setNotice(`${doc.filename} is indexed: ${doc.chunkCount} rule passage${doc.chunkCount === 1 ? '' : 's'}${doc.pages ? ` from ${doc.pages} page${doc.pages === 1 ? '' : 's'}` : ''}. Audits will now cite it.`);
      if (doc.warning) setError(doc.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: RulebookDocument) => {
    if (deleting) return;
    if (!window.confirm(`Remove "${doc.filename}"? Audits will stop citing it. Past reviews keep the passages they already cited.`)) return;
    setDeleting(doc.id);
    setError('');
    setNotice('');
    try {
      await apiClient.deleteRulebook(doc.id);
    } catch (err) {
      // A 404 means it is already gone, so treat it as removed.
      if (!(err instanceof Error && /not found/i.test(err.message))) {
        setError(err instanceof Error ? err.message : 'Could not remove the rulebook.');
        setDeleting(null);
        return;
      }
    }
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    setNotice(`${doc.filename} removed.`);
    setDeleting(null);
  };

  const togglePassages = async (doc: RulebookDocument) => {
    if (openDoc === doc.id) { setOpenDoc(null); return; }
    setOpenDoc(doc.id);
    if (!passages[doc.id]) {
      try {
        const rows = await apiClient.getRulebookChunks(doc.id);
        setPassages(prev => ({ ...prev, [doc.id]: rows }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load passages.');
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-[#12201C]">Brand rulebooks</h3>
          <p className="text-xs text-[#68756F] max-w-xl">
            Upload your brand or social media policy as a PDF or Markdown file. Plumbline splits it into rule passages and indexes them.
            Every audit, here and in the Chrome extension, retrieves the relevant passages and cites the exact one behind each flag.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <details className="relative">
            <summary className="list-none cursor-pointer px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-[#0A4A3D] flex items-center gap-2">
              <Download className="w-4 h-4" />
              Sample rulebooks
              <ChevronDown className="w-3.5 h-3.5" />
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-stone-200 bg-white p-2 shadow-lg">
              {sampleRulebooks.length > 0 ? sampleRulebooks.map(sample => (
                <a
                  key={sample.name}
                  href={sample.url}
                  download={sample.name}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-xs text-stone-700 hover:bg-stone-50"
                >
                  <span className="truncate">{sample.name}</span>
                  <Download className="w-3.5 h-3.5 shrink-0 text-[#0A4A3D]" />
                </a>
              )) : (
                <p className="px-3 py-2 text-xs text-stone-500">No sample rulebooks are available.</p>
              )}
            </div>
          </details>
          <button type="button" onClick={load} disabled={loading} className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-50" title="Refresh">
            <RefreshCw className={`w-4 h-4 text-stone-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canEdit && (
            <>
              <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? 'Parsing and indexing…' : 'Upload rulebook'}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-[11px] text-stone-500">
        PDF with selectable text, Markdown or .txt, up to {MAX_MB} MB. Scanned PDFs (images only) are not supported yet.
        {' '}Add more supported files to <code>public/sample-rulebooks/</code> to make them available in the sample dropdown.
      </p>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-[#167A58]">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{notice}</span>
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div className="p-6 text-center text-xs text-stone-500 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading rulebooks…</div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-xs text-stone-600">
          No rulebooks yet. {canEdit ? 'Upload one to make it a source the checker really uses.' : 'Ask a workspace owner or manager to upload one.'}
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map(doc => (
            <div key={doc.id} className="rounded-xl border border-stone-200 bg-stone-50">
              <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-6 h-6 text-[#0A4A3D] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#12201C] truncate">{doc.filename}</div>
                    <div className="text-[11px] text-stone-500">
                      {formatSize(doc.sizeBytes)} • {doc.pages ? `${doc.pages} pages • ` : ''}{doc.chunkCount} passages • {doc.embedded ? 'keyword + vector search' : 'keyword search'} • {new Date(doc.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-[#167A58] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">Indexed</span>
                  <button type="button" onClick={() => togglePassages(doc)} className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[11px] text-stone-700 flex items-center gap-1">
                    {openDoc === doc.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} Passages
                  </button>
                  {canEdit && (
                    <button type="button" onClick={() => remove(doc)} disabled={deleting === doc.id} className="p-1.5 rounded-lg border border-stone-200 bg-white hover:bg-red-50 text-red-600 disabled:opacity-50" title="Remove">
                      {deleting === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
              {openDoc === doc.id && (
                <div className="border-t border-stone-200 p-4 space-y-2 max-h-80 overflow-y-auto">
                  {!passages[doc.id] ? (
                    <div className="text-[11px] text-stone-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading passages…</div>
                  ) : passages[doc.id].map(p => (
                    <div key={p.id} className="text-[11px] text-stone-700">
                      <span className="font-mono font-semibold text-[#0A4A3D]">[{p.id}]</span> {p.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
