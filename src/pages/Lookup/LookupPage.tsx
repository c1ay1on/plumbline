import React, { useEffect, useMemo, useState } from 'react';
import { ScanSearch, Youtube, Instagram, Loader2, ShieldAlert, MessageCircleQuestion, ThumbsUp, Frown, Ban, Minus, ExternalLink, Users, Eye, Film, Heart, MessageSquare, Sparkles, AlertTriangle } from 'lucide-react';
import { apiClient } from '../../services/api/client';

type Label = 'spam' | 'toxic' | 'complaint' | 'question' | 'praise' | 'neutral';

const LABELS: Record<Label, { name: string; cls: string; icon: React.ElementType }> = {
  toxic: { name: 'Toxic', cls: 'bg-red-50 text-red-700 border-red-200', icon: Ban },
  spam: { name: 'Spam', cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: ShieldAlert },
  complaint: { name: 'Complaint', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Frown },
  question: { name: 'Question', cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: MessageCircleQuestion },
  praise: { name: 'Praise', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ThumbsUp },
  neutral: { name: 'Neutral', cls: 'bg-stone-50 text-stone-600 border-stone-200', icon: Minus },
};
const ORDER: Label[] = ['toxic', 'spam', 'complaint', 'question', 'praise', 'neutral'];

const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return 'Hidden';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
};

const Stat: React.FC<{ label: string; value: React.ReactNode; icon?: React.ElementType; tone?: string }> = ({ label, value, icon: Icon, tone }) => (
  <div className={`rounded-2xl p-4 border shadow-plumb-subtle ${tone || 'bg-white border-stone-200'}`}>
    {Icon && <Icon className="w-4 h-4 text-[#0A4A3D] mb-2" />}
    <div className="text-xl font-bold text-[#12201C]">{value}</div>
    <div className="text-[11px] text-[#68756F] mt-0.5">{label}</div>
  </div>
);

const YT_EXAMPLES = ['@mkbhd', '@MrBeast', '@tseries', '@veritasium'];
const IG_EXAMPLES = ['natgeo', 'nike', 'nasa', 'zomato'];

export const LookupPage: React.FC = () => {
  const [platform, setPlatform] = useState<'youtube' | 'instagram'>('youtube');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [yt, setYt] = useState<any>(null);
  const [ig, setIg] = useState<any>(null);
  const [filter, setFilter] = useState<'all' | 'flagged' | Label>('all');
  const [status, setStatus] = useState<{ youtube: boolean; instagram: boolean; ai: boolean } | null>(null);

  useEffect(() => { apiClient.getLookupStatus().then(setStatus).catch(() => undefined); }, []);

  const run = async (value?: string) => {
    const q = (value ?? query).trim();
    if (!q) return;
    setQuery(q);
    setLoading(true);
    setError('');
    try {
      if (platform === 'youtube') { setYt(await apiClient.lookupYouTube(q)); setFilter('all'); }
      else setIg(await apiClient.lookupInstagram(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed.');
    } finally { setLoading(false); }
  };

  const shown = useMemo(() => {
    const list: any[] = yt?.comments || [];
    if (filter === 'all') return list;
    if (filter === 'flagged') return list.filter(c => c.audit.flagged);
    return list.filter(c => c.audit.label === filter);
  }, [yt, filter]);

  const healthTone = (h: number) => h >= 85 ? 'bg-emerald-50 border-emerald-200' : h >= 60 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-6">
      <div className="pb-4 border-b border-stone-200">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight flex items-center gap-2">
          <ScanSearch className="w-7 h-7 text-[#0A4A3D]" /> Account Lookup
        </h1>
        <p className="text-sm text-[#68756F] mt-1">Type any public username. No login to that account needed: Plumbline pulls its public data and audits it live.</p>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-plumb-subtle p-5 space-y-4">
        <div className="flex gap-2">
          {(['youtube', 'instagram'] as const).map(p => (
            <button key={p} onClick={() => { setPlatform(p); setError(''); setQuery(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition ${platform === p ? 'bg-[#0A4A3D] text-white border-[#0A4A3D]' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}`}>
              {p === 'youtube' ? <Youtube className="w-4 h-4" /> : <Instagram className="w-4 h-4" />}
              {p === 'youtube' ? 'YouTube comment audit' : 'Instagram counts'}
            </button>
          ))}
        </div>
        <form onSubmit={e => { e.preventDefault(); run(); }} className="flex flex-col sm:flex-row gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)} disabled={loading}
            placeholder={platform === 'youtube' ? 'Channel handle, URL or ID, e.g. @mkbhd' : 'Business or creator username, e.g. natgeo'}
            className="flex-1 px-4 py-3 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]/30" />
          <button type="submit" disabled={loading || !query.trim()}
            className="px-6 py-3 rounded-xl bg-[#0A4A3D] text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
            {loading ? (platform === 'youtube' ? 'Auditing comments…' : 'Looking up…') : (platform === 'youtube' ? 'Audit' : 'Look up')}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-stone-500">Try:</span>
          {(platform === 'youtube' ? YT_EXAMPLES : IG_EXAMPLES).map(x => (
            <button key={x} onClick={() => run(x)} disabled={loading} className="px-2.5 py-1 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700">{x}</button>
          ))}
          {platform === 'youtube' && status?.ai && <span className="ml-auto flex items-center gap-1 text-emerald-700"><Sparkles className="w-3 h-3" /> AI + rules audit</span>}
        </div>
        {status && platform === 'youtube' && !status.youtube && (
          <p className="text-xs text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> YOUTUBE_API_KEY isn't set on the backend yet.</p>
        )}
        {status && platform === 'instagram' && !status.instagram && (
          <p className="text-xs text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Connect one Instagram professional account in Channels to enable lookups.</p>
        )}
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}
      </div>

      {platform === 'youtube' && yt && (
        <>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-plumb-subtle p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
            {yt.channel.avatar && <img src={yt.channel.avatar} alt="" className="w-16 h-16 rounded-full" />}
            <div className="flex-1 min-w-0">
              <a href={yt.channel.url} target="_blank" rel="noreferrer" className="text-lg font-bold text-[#12201C] hover:underline flex items-center gap-1.5">{yt.channel.title}<ExternalLink className="w-3.5 h-3.5 text-stone-400" /></a>
              <div className="text-xs text-stone-500">{yt.channel.handle}{yt.channel.country ? ` · ${yt.channel.country}` : ''}</div>
              {yt.channel.description && <p className="text-xs text-stone-600 mt-1 line-clamp-2">{yt.channel.description}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="font-bold text-[#12201C]">{fmt(yt.channel.subscribers)}</div><div className="text-[11px] text-stone-500">Subscribers</div></div>
              <div><div className="font-bold text-[#12201C]">{fmt(yt.channel.views)}</div><div className="text-[11px] text-stone-500">Views</div></div>
              <div><div className="font-bold text-[#12201C]">{fmt(yt.channel.videoCount)}</div><div className="text-[11px] text-stone-500">Videos</div></div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Comment health score" value={`${yt.summary.healthScore}/100`} icon={ShieldAlert} tone={healthTone(yt.summary.healthScore)} />
            <Stat label={`Comments audited across ${yt.videos.length} latest videos`} value={yt.summary.total} icon={MessageSquare} />
            <Stat label="Flagged (spam + toxic)" value={yt.summary.flagged} icon={Ban} />
            <Stat label="Need a reply (questions + complaints)" value={yt.summary.needsReply} icon={MessageCircleQuestion} />
          </div>

          <div className="bg-white rounded-2xl border border-stone-200 shadow-plumb-subtle p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              {[['all', `All ${yt.summary.total}`], ['flagged', `Flagged ${yt.summary.flagged}`], ...ORDER.map(l => [l, `${LABELS[l].name} ${yt.summary.counts[l]}`])].map(([key, text]) => (
                <button key={key} onClick={() => setFilter(key as any)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${filter === key ? 'bg-[#12201C] text-white border-[#12201C]' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}`}>{text}</button>
              ))}
              <span className="ml-auto text-[11px] text-stone-400 self-center">{yt.summary.aiUsed ? 'Labelled by Groq, checked by rules' : 'Labelled by rules'}{yt.cached ? ' · cached' : ''}</span>
            </div>
            <div className="divide-y divide-stone-100">
              {shown.map((c: any) => {
                const meta = LABELS[c.audit.label as Label];
                return (
                  <div key={c.id} className="py-3 flex gap-3">
                    {c.authorAvatar ? <img src={c.authorAvatar} alt="" className="w-8 h-8 rounded-full shrink-0" /> : <div className="w-8 h-8 rounded-full bg-stone-200 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-[#12201C]">{c.authorName}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.cls}`}><meta.icon className="w-3 h-3" />{meta.name}</span>
                        {c.audit.risk > 0 && <span className="text-[11px] text-stone-500">risk {c.audit.risk}</span>}
                        <span className="text-stone-400 truncate">on “{c.videoTitle}”</span>
                      </div>
                      <p className="text-sm text-stone-700 mt-1 whitespace-pre-wrap break-words">{c.text}</p>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-stone-500">
                        <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{c.likes}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{c.replyCount}</span>
                        {(c.audit.reason || c.audit.signals?.length > 0) && <span className="italic">Why: {c.audit.reason || c.audit.signals.join('; ')}</span>}
                        <a href={c.url} target="_blank" rel="noreferrer" className="text-[#0A4A3D] hover:underline flex items-center gap-1">Open <ExternalLink className="w-3 h-3" /></a>
                      </div>
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && <p className="py-6 text-center text-sm text-stone-500">No comments in this group.</p>}
            </div>
            {yt.videos.some((v: any) => v.commentsDisabled) && (
              <p className="text-[11px] text-stone-400">Comments are turned off on {yt.videos.filter((v: any) => v.commentsDisabled).length} of the latest videos.</p>
            )}
          </div>
        </>
      )}

      {platform === 'instagram' && ig && (
        <>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-plumb-subtle p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
            {ig.profile.avatar && <img src={ig.profile.avatar} alt="" className="w-16 h-16 rounded-full" />}
            <div className="flex-1 min-w-0">
              <a href={ig.profile.url} target="_blank" rel="noreferrer" className="text-lg font-bold text-[#12201C] hover:underline flex items-center gap-1.5">@{ig.profile.username}<ExternalLink className="w-3.5 h-3.5 text-stone-400" /></a>
              <div className="text-xs text-stone-500">{ig.profile.name}</div>
              {ig.profile.biography && <p className="text-xs text-stone-600 mt-1 line-clamp-2">{ig.profile.biography}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label="Followers" value={fmt(ig.profile.followers)} icon={Users} />
            <Stat label="Following" value={fmt(ig.profile.following)} icon={Users} />
            <Stat label="Posts" value={fmt(ig.profile.mediaCount)} icon={Film} />
            <Stat label={`Avg likes, last ${ig.stats.postsSampled}`} value={fmt(ig.stats.avgLikes)} icon={Heart} />
            <Stat label={`Avg comments, last ${ig.stats.postsSampled}`} value={ig.stats.avgComments} icon={MessageSquare} />
            <Stat label="Engagement rate" value={ig.stats.engagementRate === null ? '–' : `${ig.stats.engagementRate}%`} icon={Eye} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {ig.media.map((m: any) => (
              <a key={m.id} href={m.permalink} target="_blank" rel="noreferrer" className={`bg-white rounded-2xl border shadow-plumb-subtle overflow-hidden hover:shadow-md transition ${m.id === ig.stats.topPostId ? 'border-[#0A4A3D] ring-2 ring-[#0A4A3D]/20' : 'border-stone-200'}`}>
                {m.image ? <img src={m.image} alt="" className="w-full aspect-square object-cover" /> : <div className="w-full aspect-square bg-stone-100 flex items-center justify-center text-xs text-stone-400">{m.type}</div>}
                <div className="p-3 space-y-1">
                  <div className="flex items-center gap-3 text-xs font-semibold text-[#12201C]">
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{fmt(m.likes)}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{fmt(m.comments)}</span>
                    {m.id === ig.stats.topPostId && <span className="ml-auto text-[10px] text-[#0A4A3D]">Top post</span>}
                  </div>
                  <p className="text-[11px] text-stone-500 line-clamp-2">{m.caption}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="text-[11px] text-stone-400">Instagram shares counts only for business and creator accounts. Comment text from other accounts isn't available through its API.</p>
        </>
      )}
    </div>
  );
};
