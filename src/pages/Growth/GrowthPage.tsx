import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, BarChart3, ShieldCheck, FileCheck2, MessageSquare, ArrowRight } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Badge } from '../../components/common/Badge';
import { WhyThisPage } from '../../components/common/WhyThisPage';

export const GrowthPage: React.FC = () => {
  const navigate = useNavigate();
  const { posts, comments, channels } = useWorkspace();
  const publishedPosts = posts.filter(post => post.status === 'published');
  const reviewedDrafts = posts.filter(post => post.status !== 'draft').length;
  const openFindings = posts.reduce((total, post) => total + post.findings.filter(finding => finding.status === 'open' || finding.status === 'contested').length, 0);
  const acceptedFindings = posts.reduce((total, post) => total + post.findings.filter(finding => finding.status === 'accepted' || finding.status === 'fixed' || finding.status === 'resolved').length, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8">
      <div className="pb-4 border-b border-stone-200">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight flex items-center gap-2">
          <Activity className="w-7 h-7 text-[#0A4A3D]" /> Growth & Governance Insights
        </h1>
        <p className="text-sm text-[#68756F] mt-1">Workspace activity is shown below. Social reach, impressions, and follower analytics are not currently fetched from platform APIs.</p>
      </div>

      <WhyThisPage
        why="Growth is the one-glance health check for the whole workspace: how much content is moving through review, how many brand issues are still open, and which channels are actually connected. It answers 'are we on track?' without opening every post."
        when={[
          'Weekly or end-of-campaign check-ins: are drafts getting reviewed and published, or piling up?',
          'Before a launch: make sure there are no unresolved brand findings and every channel you plan to post to is connected.',
          'Reporting to a manager or client: a quick snapshot of output and compliance.',
        ]}
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Drafts reviewed', value: reviewedDrafts, icon: FileCheck2 },
          { label: 'Posts published', value: publishedPosts.length, icon: BarChart3 },
          { label: 'Open brand findings', value: openFindings, icon: ShieldCheck },
          { label: 'Comments synced', value: comments.filter(comment => !comment.id.startsWith('permission-')).length, icon: MessageSquare }
        ].map(item => (
          <div key={item.label} className="bg-white rounded-2xl p-5 border border-stone-200 shadow-plumb-subtle">
            <item.icon className="w-5 h-5 text-[#0A4A3D] mb-3" />
            <div className="text-2xl font-bold text-[#12201C]">{item.value}</div>
            <div className="text-xs text-[#68756F] mt-1">{item.label}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#12201C]">Brand governance</h2>
            <Badge variant="neutral">Based on saved drafts</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-2xl font-bold text-amber-800">{openFindings}</div>
              <div className="text-xs text-stone-600">Unresolved findings</div>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-2xl font-bold text-emerald-800">{acceptedFindings}</div>
              <div className="text-xs text-stone-600">Accepted / resolved</div>
            </div>
          </div>
          <button onClick={() => navigate('/app/review')} className="flex items-center gap-2 text-xs font-semibold text-[#0A4A3D] hover:underline">
            Open review queue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#12201C]">Connected social accounts</h2>
            <Badge variant="neutral">{channels.filter(channel => channel.status === 'connected').length} connected</Badge>
          </div>
          <div className="space-y-2">
            {channels.map(channel => (
              <div key={channel.platform} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0 text-xs">
                <span className="font-medium text-stone-700">{channel.name}</span>
                <span className={channel.status === 'connected' ? 'text-emerald-700 font-semibold' : 'text-stone-400'}>{channel.status === 'connected' ? (channel.accountHandle || channel.accountName || 'Connected') : 'Not connected'}</span>
              </div>
            ))}
            {channels.length === 0 && <p className="text-xs text-stone-500">No channel information yet.</p>}
          </div>
          <button onClick={() => navigate('/app/channels')} className="flex items-center gap-2 text-xs font-semibold text-[#0A4A3D] hover:underline">
            Manage connections <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      <section className="bg-stone-50 rounded-2xl border border-stone-200 p-6 space-y-2">
        <h2 className="text-sm font-bold text-[#12201C]">Social performance metrics are not connected yet</h2>
        <p className="text-xs text-stone-600 leading-relaxed">The current integration supports account authorization, publishing for selected platforms, and comment retrieval/replies where scopes allow. It does not yet collect reach, impressions, profile visits, or follower history, so Plumbline intentionally does not display sample numbers or estimated growth rates.</p>
      </section>
    </div>
  );
};
