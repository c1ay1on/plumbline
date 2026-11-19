import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {
  BarChart3, Clock, Download, FileCheck2, Filter, Flag, Loader2, RefreshCw, ShieldAlert, Users, Wrench
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { apiClient } from '../../services/api/client';
import { TeamManagementPanel } from '../../components/insights/TeamManagementPanel';
import type { GovernanceInsights, InsightFilters, Platform } from '../../types';

const BRAND = '#0A4A3D';
const AMBER = '#B45309';
const RED = '#B91C1C';
const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time', days: 0 }
];

const fmtHours = (h: number | null) => {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
};
const fmtPct = (n: number | null) => (n === null || n === undefined ? '—' : `${n}%`);
const shortWeek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const MetricCard: React.FC<{
  label: string; value: string; hint: string; icon: React.ElementType; tone?: 'brand' | 'amber' | 'red';
}> = ({ label, value, hint, icon: Icon, tone = 'brand' }) => {
  const colour = tone === 'amber' ? 'text-[#B45309] bg-amber-50' : tone === 'red' ? 'text-red-700 bg-red-50' : 'text-[#0A4A3D] bg-emerald-50';
  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-200 shadow-plumb-subtle">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#68756F]">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colour}`}><Icon className="w-4 h-4" /></div>
      </div>
      <div className="mt-2 text-2xl font-bold text-[#12201C]" data-testid={`metric-${label}`}>{value}</div>
      <p className="text-[11px] text-stone-500 mt-1">{hint}</p>
    </div>
  );
};

const Panel: React.FC<{ title: string; subtitle: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }> =
  ({ title, subtitle, icon: Icon, children, action }) => (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-plumb-subtle">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2"><Icon className="w-5 h-5 text-[#0A4A3D]" />{title}</h2>
          <p className="text-xs text-[#68756F]">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="py-10 text-center text-xs text-stone-500 border border-dashed border-stone-200 rounded-xl">{text}</div>
);

export const GovernanceInsightsPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentRole } = useAuth();
  const { posts } = useWorkspace();
  const isReviewer = currentRole !== 'employee';

  const [filters, setFilters] = useState<InsightFilters>({ days: 30 });
  const [data, setData] = useState<GovernanceInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await apiClient.getGovernanceInsights({ ...filters, days: filters.days || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load insights.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Reload when filters change, and when workspace posts change (new audits, approvals).
  useEffect(() => { void load(); }, [load, posts.length]);

  const exportCsv = async () => {
    try {
      const blob = await apiClient.downloadGovernanceReport({ ...filters, days: filters.days || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'plumbline-governance-insights.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const rules = data?.mostViolatedRules ?? [];
  const teams = data?.errorRateByTeam ?? [];
  const contested = useMemo(() => rules.filter(r => r.contested > 0).sort((a, b) => b.contested - a.contested), [rules]);
  const trend = useMemo(() => (data?.weeklyTrend ?? []).map(w => ({ ...w, week: shortWeek(w.weekStart) })), [data]);
  const ruleChart = useMemo(() => rules.map(r => ({ ...r, label: r.rule.length > 28 ? `${r.rule.slice(0, 27)}…` : r.rule })), [rules]);

  const fixed = data?.fixedBeforeReview;
  const approval = data?.approvalTime;
  const select = 'px-3 py-2 text-xs rounded-lg border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]/30';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight">Governance Insights</h1>
          <p className="text-sm text-[#68756F] mt-1">
            {isReviewer
              ? 'Where your team keeps going wrong, built from real audit and review history.'
              : 'Your own audit history: what gets flagged and how fast you get approved.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {isReviewer && (
            <button onClick={exportCsv} className="px-3 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-plumb-subtle flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-[#68756F] flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Filters</span>
        <select aria-label="Date range" className={select} value={filters.days ?? 0}
          onChange={e => setFilters(f => ({ ...f, days: Number(e.target.value) || undefined }))}>
          {RANGES.map(r => <option key={r.label} value={r.days}>{r.label}</option>)}
        </select>
        {isReviewer && (
          <select aria-label="Team" className={select} value={filters.team ?? ''}
            onChange={e => setFilters(f => ({ ...f, team: e.target.value || undefined }))}>
            <option value="">All teams</option>
            {data?.available.teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select aria-label="Platform" className={select} value={filters.platform ?? ''}
          onChange={e => setFilters(f => ({ ...f, platform: (e.target.value || undefined) as Platform | undefined }))}>
          <option value="">All platforms</option>
          {data?.available.platforms.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
        </select>
        {isReviewer && (
          <select aria-label="Creator" className={select} value={filters.creatorId ?? ''}
            onChange={e => setFilters(f => ({ ...f, creatorId: e.target.value || undefined }))}>
            <option value="">All creators</option>
            {data?.available.creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {(filters.team || filters.platform || filters.creatorId || filters.days !== 30) && (
          <button onClick={() => setFilters({ days: 30 })} className="text-xs font-semibold text-[#0A4A3D] hover:underline">Reset</button>
        )}
        <span className="ml-auto text-[11px] text-stone-500">
          {loading ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</span>
            : data ? `${data.postsInScope} posts in scope · updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ''}
        </span>
      </div>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Avg. time to approve" icon={Clock}
          value={fmtHours(approval?.avgHours ?? null)}
          hint={approval?.approvedPosts ? `Median ${fmtHours(approval.medianHours)} across ${approval.approvedPosts} approvals` : 'No approved posts yet'} />
        <MetricCard label="Drafts fixed before review" icon={Wrench}
          value={fmtPct(fixed?.rate ?? null)}
          hint={fixed?.submittedDrafts ? `${fixed.draftsFixedBeforeReview} of ${fixed.submittedDrafts} submitted drafts` : 'No drafts submitted yet'} />
        <MetricCard label="Findings raised" icon={ShieldAlert} tone="amber"
          value={String(data?.summary.totalFindings ?? 0)}
          hint={`${data?.summary.draftsChecked ?? 0} drafts checked · ${data?.summary.rejectedFlags ?? 0} rejected as false positives`} />
        <MetricCard label="Disputed flags" icon={Flag} tone={(data?.summary.contestedFlags ?? 0) > 0 ? 'red' : 'brand'}
          value={String(data?.summary.contestedFlags ?? 0)}
          hint={`${data?.summary.revisionRequests ?? 0} revision requests from reviewers`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Most violated rules */}
        <div className="lg:col-span-7">
          <Panel title="Most violated rules" subtitle="Grouped by the rule each finding cites. Rejected flags are excluded." icon={BarChart3}>
            {rules.length === 0 ? <Empty text="No rule violations in this range. Audited drafts will show up here." /> : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ruleChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E7E5E4" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number, n: string) => [v, n]} labelFormatter={(_, p) => p?.[0]?.payload?.rule ?? ''} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="critical" stackId="s" name="Critical" fill={RED} />
                      <Bar dataKey="warning" stackId="s" name="Warning" fill={AMBER} />
                      <Bar dataKey="suggestion" stackId="s" name="Suggestion" fill="#A8A29E" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="w-full mt-4 text-xs">
                  <thead><tr className="text-left text-[#68756F] border-b border-stone-200">
                    <th className="py-2 font-semibold">Rule</th><th className="py-2 font-semibold text-right">Violations</th>
                    <th className="py-2 font-semibold text-right">Posts</th><th className="py-2 font-semibold text-right">Disputed</th>
                  </tr></thead>
                  <tbody>{rules.map(r => (
                    <tr key={`${r.rule}-${r.category}`} className="border-b border-stone-100">
                      <td className="py-2 pr-2"><div className="font-semibold text-[#12201C]">{r.rule}</div><div className="text-[10px] text-stone-500 capitalize">{r.category.replace(/_/g, ' ')}</div></td>
                      <td className="py-2 text-right font-bold">{r.count}</td>
                      <td className="py-2 text-right">{r.postsAffected}</td>
                      <td className={`py-2 text-right ${r.contested ? 'text-red-700 font-semibold' : 'text-stone-400'}`}>{r.contested}</td>
                    </tr>))}</tbody>
                </table>
              </>
            )}
          </Panel>
        </div>

        {/* Error rate by team */}
        <div className="lg:col-span-5 space-y-8">
          {isReviewer && (
            <Panel title="Error rate by team" subtitle="Share of a team's audited posts with a critical or warning finding." icon={Users}>
              {teams.length === 0 ? <Empty text="No audited posts yet." /> : (
                <>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={teams} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E5E4" />
                        <XAxis dataKey="team" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v}%`, 'Error rate']} />
                        <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                          {teams.map(t => <Cell key={t.team} fill={t.rate >= 50 ? RED : t.rate >= 25 ? AMBER : BRAND} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-3 space-y-1.5">{teams.map(t => (
                    <li key={t.team} className="flex justify-between text-xs">
                      <span className="text-[#12201C] font-semibold">{t.team}</span>
                      <span className="text-[#68756F]">{t.postsWithErrors}/{t.posts} posts · {t.avgSeriousFindingsPerPost} per post</span>
                    </li>))}</ul>
                  {teams.some(t => t.team === 'Unassigned') && (
                    <p className="mt-3 text-[11px] text-stone-500">Assign people to teams below to split out "Unassigned".</p>
                  )}
                </>
              )}
            </Panel>
          )}

          {/* Contested rules -> feeds Ambiguous Rule Alerts */}
          <Panel title="Most disputed rules" subtitle="Rules creators dispute most. Ones that cross the threshold become Ambiguous Rule Alerts." icon={Flag}>
            {contested.length === 0 ? <Empty text="No disputed flags in this range." /> : (
              <ul className="space-y-2">{contested.slice(0, 5).map(r => (
                <li key={`${r.ruleId}-${r.rule}`} className="p-3 rounded-xl border border-stone-200 bg-stone-50/50 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#12201C] truncate">{r.rule}</div>
                    <div className="text-[11px] text-[#68756F]">Disputed {r.contested} of {r.count} times</div>
                  </div>
                  {isReviewer && (
                    <button onClick={() => navigate(`/app/brand-knowledge?rule=${encodeURIComponent(r.ruleId)}`)}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-semibold text-[#0A4A3D]">
                      Open rule
                    </button>
                  )}
                </li>))}</ul>
            )}
          </Panel>
        </div>
      </div>

      {/* Trend */}
      <Panel title="Weekly trend" subtitle="Posts created, findings raised and posts approved per week." icon={FileCheck2}>
        {trend.every(w => w.posts === 0) ? <Empty text="Not enough history for a trend yet." /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -16, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="posts" name="Posts" stroke={BRAND} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="findings" name="Findings" stroke={AMBER} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="critical" name="Critical" stroke={RED} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="approved" name="Approved" stroke="#167A58" strokeDasharray="4 3" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {isReviewer && <TeamManagementPanel />}
    </div>
  );
};

export default GovernanceInsightsPage;
