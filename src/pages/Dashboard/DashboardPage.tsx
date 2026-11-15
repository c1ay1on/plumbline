import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  AlertTriangle,
  Clock,
  CheckCircle,
  Plus,
  ArrowRight,
  MessageSquare,
  Share2,
  Users,
  BookOpen,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Badge } from '../../components/common/Badge';
import { ExtensionSetupCard } from '../../components/common/ExtensionSetupCard';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, currentRole } = useAuth();
  const {
    posts,
    guidelines,
    comments,
    channels,
    teamMembers
  } = useWorkspace();

  // Compute stats
  const draftsCount = posts.filter(p => p.status === 'draft').length;
  const openFindingsCount = posts.reduce((acc, p) => {
    return acc + p.findings.filter(f => f.status === 'open' || f.status === 'contested').length;
  }, 0);
  const approvalsAwaitingCount = posts.filter(p => p.status === 'in_review').length;
  const readyToPublishCount = posts.filter(p => p.status === 'approved').length;

  // Filter submissions awaiting manager approval
  const awaitingSubmissions = posts.filter(p => p.status === 'in_review');

  // Employee submissions (for employee persona)
  const mySubmissions = posts.filter(p => p.creatorId === currentUser.id || currentRole === 'employee');



  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight">
            Good morning, {currentUser.name}
          </h1>
          <p className="text-sm text-[#68756F] mt-1">
            Here is what needs your attention before anything goes live.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/create')}
            className="px-4 py-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-[#12201C] shadow-xs flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4 text-[#0A4A3D]" />
            Create post
          </button>
          <button
            onClick={() => navigate('/app/create')}
            className="px-5 py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold shadow-sm flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            + Create new post
          </button>
        </div>
      </div>

      <ExtensionSetupCard />
      
      {/* A. Overview Statistics (4 Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Drafts */}
        <div
          onClick={() => navigate('/app/create')}
          className="bg-white rounded-2xl p-5 border border-stone-200 hover:border-[#0A4A3D]/40 transition-all cursor-pointer shadow-plumb-subtle group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#68756F]">Drafts</span>
            <div className="w-8 h-8 rounded-lg bg-stone-100 group-hover:bg-emerald-50 text-[#68756F] group-hover:text-[#0A4A3D] flex items-center justify-center transition-colors">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-[#12201C]">{draftsCount}</div>
          <p className="text-[11px] text-stone-500 mt-1">Unsubmitted drafts in workspace</p>
        </div>

        {/* Card 2: Open Findings */}
        <div
          onClick={() => navigate('/app/review')}
          className="bg-white rounded-2xl p-5 border border-stone-200 hover:border-amber-400 transition-all cursor-pointer shadow-plumb-subtle group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#68756F]">Open findings</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-[#B45309] flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-[#B45309]">{openFindingsCount}</div>
          <p className="text-[11px] text-stone-500 mt-1">Requires human review & resolution</p>
        </div>

        {/* Card 3: Approvals Awaiting */}
        <div
          onClick={() => navigate('/app/review')}
          className="bg-white rounded-2xl p-5 border border-stone-200 hover:border-[#0A4A3D] transition-all cursor-pointer shadow-plumb-subtle group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#68756F]">Approvals awaiting</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0A4A3D] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-[#0A4A3D]">{approvalsAwaitingCount}</div>
          <p className="text-[11px] text-stone-500 mt-1">Submissions in manager queue</p>
        </div>

        {/* Card 4: Ready to Publish */}
        <div
          onClick={() => navigate('/app/channels')}
          className="bg-white rounded-2xl p-5 border border-stone-200 hover:border-emerald-500 transition-all cursor-pointer shadow-plumb-subtle group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#68756F]">Ready to publish</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#167A58] flex items-center justify-center">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-[#167A58]">{readyToPublishCount}</div>
          <p className="text-[11px] text-stone-500 mt-1">Approved by compliance reviewer</p>
        </div>
      </div>

      {/* Main Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (8 cols) */}
        <div className="lg:col-span-8 space-y-8">
          {/* G. Manager Approval Summary (or Employee Submissions) */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-plumb-subtle">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#0A4A3D]" />
                  {currentRole === 'employee' ? 'My Active Submissions' : 'Submissions Awaiting Approval'}
                </h2>
                <p className="text-xs text-[#68756F]">
                  {currentRole === 'employee'
                    ? 'Track review status and feedback from your manager.'
                    : 'Submissions require manager sign-off before social distribution.'}
                </p>
              </div>

              <button
                onClick={() => navigate('/app/review')}
                className="text-xs font-semibold text-[#0A4A3D] hover:underline flex items-center gap-1"
              >
                View all queue
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {(currentRole === 'employee' ? mySubmissions : awaitingSubmissions).slice(0, 3).map(post => {
                const openFindings = post.findings.filter(f => f.status === 'open' || f.status === 'contested');

                return (
                  <div
                    key={post.id}
                    className="p-4 rounded-xl border border-stone-200 bg-stone-50/50 hover:bg-stone-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#12201C]">{post.campaign}</span>
                        <span className="text-stone-300">•</span>
                        <span className="text-xs text-stone-600">{post.title}</span>
                        <Badge
                          variant={
                            post.status === 'approved'
                              ? 'success'
                              : post.status === 'in_review'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {post.status.replace('_', ' ')}
                        </Badge>
                      </div>

                      <div className="text-[11px] text-[#68756F] flex items-center gap-3">
                        <span>Creator: <strong>{post.creatorName}</strong></span>
                        <span>Version: <strong>{post.version}</strong></span>
                        {openFindings.length > 0 ? (
                          <span className="text-amber-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            {openFindings.length} open AI findings
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">✓ Zero findings</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/app/review/${post.id}`)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
                      >
                        {currentRole === 'employee' ? 'View Findings' : 'Review & Sign Off'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {awaitingSubmissions.length === 0 && currentRole !== 'employee' && (
                <div className="text-center py-8 text-stone-400 text-xs">
                  No submissions currently awaiting manager approval.
                </div>
              )}
            </div>
          </div>

          {/* D. Recent Activity */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-plumb-subtle">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-[#12201C]">Recent Activity</h2>
                <p className="text-xs text-[#68756F]">Recently audited and published content campaigns</p>
              </div>
              <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-0.5 rounded border border-stone-200 font-medium">
                Workspace activity
              </span>
            </div>

            <div className="divide-y divide-stone-100">
              {posts.length === 0 && (
                <div className="py-8 text-center text-xs text-stone-500">No drafts or publishing activity yet. Create your first post to get started.</div>
              )}
              {posts.map(item => (
                <div key={item.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-stone-100 overflow-hidden flex-shrink-0 border border-stone-200">
                      {item.mediaUrls[0] ? (
                        <img
                          src={item.mediaUrls[0]}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-400">
                          <FileText className="w-5 h-5" />
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-[#12201C]">{item.title}</h4>
                      <div className="flex items-center gap-2 text-[11px] text-[#68756F] mt-0.5">
                        <span className="capitalize">{item.platforms.join(', ')}</span>
                        <span>•</span>
                        <span>{item.campaign}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div className="hidden sm:block text-[11px] text-[#68756F]">
                      <div>Updated: <strong className="text-[#12201C]">{new Date(item.updatedAt).toLocaleDateString()}</strong></div>
                      <div>Version: <strong className="text-emerald-700">{item.version}</strong></div>
                    </div>

                    <Badge
                      variant={
                        item.status === 'published'
                          ? 'success'
                          : item.status === 'approved'
                          ? 'primary'
                          : item.status === 'in_review'
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                    >
                      {item.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* C. My Team (Managers Only) */}
          {(currentRole === 'owner' || currentRole === 'manager' || currentRole === 'admin') && (
            <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-plumb-subtle">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
                    <Users className="w-5 h-5 text-[#0A4A3D]" />
                    My Team
                  </h2>
                  <p className="text-xs text-[#68756F]">
                    People with access to this workspace.
                  </p>
                </div>

              </div>

              <p className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mb-3">To add a colleague, share the Workspace ID shown on Profile. They can join during registration.</p>
              {teamMembers.length === 0 && <p className="text-xs text-stone-500 py-3">No other users have joined this workspace yet.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teamMembers.map(member => (
                  <div
                    key={member.id}
                    className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/50 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-[#12201C]">{member.name}</div>
                      <div className="text-[11px] text-[#68756F]">{member.email}</div>
                      <div className="text-[10px] text-stone-500 mt-1 capitalize">{member.role}</div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-[#167A58]">
                        {member.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* E. Brand Guidelines Card */}
          <div className="bg-[#0A4A3D] text-white rounded-2xl p-6 shadow-plumb-subtle relative overflow-hidden">
            <div className="relative z-10">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center mb-3">
                <BookOpen className="w-4 h-4 text-emerald-300" />
              </div>
              <h3 className="text-base font-bold text-white">Brand Guidelines</h3>
              <p className="text-xs text-emerald-100/90 mt-1 leading-relaxed">
Your configured voice, terminology, approved facts, and brand assets.
              </p>

              <div className="mt-4 pt-3 border-t border-emerald-800/80 flex items-center justify-between text-xs text-emerald-200">
                <span>Active Version: <strong className="text-white">{guidelines.version}</strong></span>
                <span>{guidelines.facts.filter(fact => fact.approvalStatus === 'approved').length} approved facts</span>
              </div>

              <button
                onClick={() => navigate('/app/brand-knowledge')}
                className="mt-4 w-full py-2.5 px-4 rounded-xl bg-white hover:bg-emerald-50 text-[#0A4A3D] font-bold text-xs shadow-xs transition-colors text-center"
              >
                Edit brand guidelines
              </button>
            </div>
          </div>

          {/* B. Recent Comments */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-plumb-subtle">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#12201C] flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-[#0A4A3D]" />
                Recent Comments
              </h3>
              <button
                onClick={() => navigate('/app/comments')}
                className="text-xs font-semibold text-[#0A4A3D] hover:underline"
              >
                Open comments
              </button>
            </div>

            <div className="space-y-3">
              {comments.length === 0 && <p className="text-xs text-stone-500 py-4">No comments synced. Connect an account and sync comments to see real conversations.</p>}
              {comments.slice(0, 3).map(comment => (
                <div
                  key={comment.id}
                  onClick={() => navigate('/app/comments')}
                  className="p-3 rounded-xl border border-stone-100 hover:border-stone-300 bg-stone-50/50 cursor-pointer transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#12201C] truncate max-w-[140px]">
                      {comment.authorName}
                    </span>
                    <Badge
                      variant={
                        comment.status === 'needs_reply'
                          ? 'warning'
                          : comment.status === 'flagged'
                          ? 'danger'
                          : 'success'
                      }
                      size="sm"
                    >
                      {comment.status.replace('_', ' ')}
                    </Badge>
                  </div>

                  <p className="text-xs text-stone-700 line-clamp-2 italic">
                    "{comment.text}"
                  </p>

                  <div className="text-[10px] text-[#68756F] flex items-center justify-between pt-1">
                    <span className="capitalize">{comment.platform}</span>
                    <span>{new Date(comment.timeReceived).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* F. Connected Channels */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-plumb-subtle">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#12201C] flex items-center gap-1.5">
                <Share2 className="w-4 h-4 text-[#0A4A3D]" />
                Connected Channels
              </h3>
              <button
                onClick={() => navigate('/app/channels')}
                className="text-xs font-semibold text-[#0A4A3D] hover:underline"
              >
                Manage
              </button>
            </div>

            <div className="space-y-2">
              {channels.map(ch => (
                <div
                  key={ch.id}
                  className="p-2.5 rounded-xl border border-stone-100 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#167A58]" />
                    <span className="font-semibold text-[#12201C] capitalize">{ch.platform}</span>
                  </div>

                  <Badge
                    variant={
                      ch.status === 'connected'
                        ? 'success'
                        : ch.status === 'extension_required'
                        ? 'info'
                        : 'neutral'
                    }
                    size="sm"
                  >
                    {ch.status.replace('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/app/channels')}
              className="mt-4 w-full py-2 border border-stone-200 hover:bg-stone-50 rounded-xl text-xs font-semibold text-stone-700 transition-colors"
            >
              + Connect new channel
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
