import React, { useState } from 'react';
import {
  MessageSquare,
  Search,
  Sparkles,
  Send,
  Trash2,
  ShieldAlert,
  UserX,
  RefreshCw,
  CheckCircle,
  Clock,
  Filter,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { CommentItem } from '../../types';
import { groqService } from '../../services/ai/groqService';

export const CommentsPage: React.FC = () => {
  const { comments, guidelines, replyToComment, moderateComment, syncSocialComments } = useWorkspace();

  const [filterTab, setFilterTab] = useState<'all' | 'needs_reply' | 'flagged' | 'new' | 'most_engaged'>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [replyError, setReplyError] = useState('');
  const [generatedReplies, setGeneratedReplies] = useState<Record<string, string>>({});

  // Selected comment for active reply
  const [activeCommentId, setActiveCommentId] = useState<string>(comments[0]?.id || '');
  const [customReplyText, setCustomReplyText] = useState<string>('');
  const [editingCommentId, setEditingCommentId] = useState<string>('');

  // Internal Plumbline triage modal
  
  const [moderationModalOpen, setModerationModalOpen] = useState(false);
  const [modTargetComment, setModTargetComment] = useState<CommentItem | null>(null);
  const [modAction, setModAction] = useState<'report' | 'block' | 'delete'>('report');
  const [modReason, setModReason] = useState('spam');

  const groqConfig = groqService.getConfig();

  const handleSyncComments = async () => {
    setIsSyncing(true);
    setSyncError('');
    try { await syncSocialComments(); }
    catch (error) { setSyncError(error instanceof Error ? error.message : 'Could not sync comments.'); }
    finally { setIsSyncing(false); }
  };

  const handleGenerateReply = async (comment: CommentItem) => {
    setReplyError('');
    try {
      const result = await groqService.generateCommentReply(comment.text, comment.platform, guidelines);
      setGeneratedReplies(current => ({ ...current, [comment.id]: result.reply }));
    } catch (error) { setReplyError(error instanceof Error ? error.message : 'Could not generate a reply.'); }
  };

  const engagement = (c: CommentItem) => Number(c.likes || 0) + 2 * Number(c.replyCount || 0);

  const filteredComments = comments.filter(c => {
    if (filterTab === 'needs_reply' && c.status !== 'needs_reply') return false;
    if (filterTab === 'flagged' && c.status !== 'flagged') return false;
    if (filterTab === 'new' && c.status !== 'new') return false;
    // Any comment with at least one like or reply counts; the list is then ranked by engagement.
    if (filterTab === 'most_engaged' && engagement(c) < 1) return false;

    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.text.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.authorHandle.toLowerCase().includes(q)
      );
    }
    return true;
  });
  if (filterTab === 'most_engaged') filteredComments.sort((a, b) => engagement(b) - engagement(a));

  const handleUseReply = async (comment: CommentItem) => {
    const reply = generatedReplies[comment.id] || comment.suggestedReply;
    if (!reply) return;
    setReplyError('');
    try { await replyToComment(comment.id, reply); }
    catch (error) { setReplyError(error instanceof Error ? error.message : 'The reply could not be sent.'); }
  };

  const handleSendCustomReply = async (commentId: string) => {
    if (!customReplyText.trim()) return;
    setReplyError('');
    try { await replyToComment(commentId, customReplyText); setCustomReplyText(''); }
    catch (error) { setReplyError(error instanceof Error ? error.message : 'The reply could not be sent.'); }
  };

  const openModeration = (comment: CommentItem, action: 'report' | 'block' | 'delete') => {
    setModTargetComment(comment);
    setModAction(action);
    setModReason('spam');
    setModerationModalOpen(true);
  };

  const confirmModeration = () => {
    if (!modTargetComment) return;
    moderateComment(modTargetComment.id, modAction, modReason);
    setModerationModalOpen(false);
  };

  // Stats calculation
  const totalCommentsCount = comments.length;
  const awaitingReplyCount = comments.filter(c => c.status === 'needs_reply' || c.status === 'new').length;
  const flaggedCount = comments.filter(c => c.status === 'flagged').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight flex items-center gap-2">
            <MessageSquare className="w-7 h-7 text-[#0A4A3D]" />
            Comments
          </h1>
          <p className="text-sm text-[#68756F] mt-1">
            Reply in your brand voice across platforms.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {groqConfig.isActive && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Groq {groqConfig.model} Active</span>
            </span>
          )}

          <button
            onClick={handleSyncComments}
            disabled={isSyncing}
            className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] disabled:opacity-60 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing live comments…' : 'Sync live comments'}
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-plumb-subtle flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {[
            { id: 'all', label: 'All Comments' },
            { id: 'needs_reply', label: 'Needs Reply' },
            { id: 'most_engaged', label: 'Most Engaged' },
            { id: 'new', label: 'New' },
            { id: 'flagged', label: 'Flagged / Moderated' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                filterTab === tab.id
                  ? 'bg-[#0A4A3D] text-white shadow-xs'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="relative w-full md:w-60">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search content or handle..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
            />
          </div>

          <select
            value={platformFilter}
            onChange={e => setPlatformFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-xl border border-stone-200 bg-white"
          >
            <option value="all">All Channels</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
            <option value="x">X</option>
            <option value="facebook">Facebook</option>
          </select>
        </div>
      </div>

      {/* Main Grid: 8 cols (Comments feed) + 4 cols (Stats & Moderation info) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Comments List (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {filteredComments.map(comment => {
            const isSelected = activeCommentId === comment.id;

            return (
              <div
                key={comment.id}
                onClick={() => setActiveCommentId(comment.id)}
                className={`bg-white rounded-2xl p-6 border transition-all shadow-plumb-subtle space-y-4 ${
                  isSelected ? 'border-[#0A4A3D] ring-2 ring-[#0A4A3D]/10' : 'border-stone-200'
                }`}
              >
                {/* Author Info & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-xs font-bold text-stone-600">
                      {(comment.authorName || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#12201C]">{comment.authorName}</span>
                        <span className="text-[11px] text-[#68756F]">{comment.authorHandle}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-stone-400 mt-0.5">
                        <span className="capitalize font-medium text-stone-600">{comment.platform}</span>
                        <span>•</span>
                        <span>{new Date(comment.timeReceived).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>•</span>
                        <span>❤️ {comment.likes} likes</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        comment.status === 'needs_reply'
                          ? 'warning'
                          : comment.status === 'flagged'
                          ? 'danger'
                          : comment.status === 'replied'
                          ? 'success'
                          : 'neutral'
                      }
                    >
                      {comment.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>

                {/* Comment Text */}
                <div className="text-xs text-[#12201C] leading-relaxed pl-13 font-normal">
                  "{comment.text}"
                </div>

                {/* Existing Reply if already replied */}
                {comment.replyDraft && (
                  <div className="ml-6 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-[#0A4A3D] space-y-1">
                    <span className="font-semibold text-[11px] text-emerald-800">Your Brand Reply:</span>
                    <p className="italic">"{comment.replyDraft}"</p>
                  </div>
                )}

                {/* AI Suggested Reply Box (Explainable & Editable) */}
                {comment.status !== 'replied' && (
                  <div className="ml-6 p-4 rounded-xl bg-stone-50 border border-emerald-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#0A4A3D]">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        AI Suggested Response ({comment.platform.toUpperCase()})
                      </div>
                      <span className="text-[10px] text-stone-400">
                        Based on verified facts & brand tone
                      </span>
                    </div>

                    <div className="p-3 bg-white rounded-lg border border-stone-200 text-xs text-[#12201C] italic min-h-12">
                      {generatedReplies[comment.id] || comment.suggestedReply || 'Generate a reply draft using your configured AI provider.'}
                    </div>

                    <div className="text-[10px] text-stone-500 font-mono">
                      {comment.suggestedReplySource ? <>Source Rule: <strong>{comment.suggestedReplySource}</strong></> : 'AI text is a draft only. Review it before sending.'}
                    </div>

                    {/* Actions */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleGenerateReply(comment)}
                          className="px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 text-[11px] text-stone-700 flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" /> Generate draft
                        </button>
                        <button
                          type="button"
                          disabled={!(generatedReplies[comment.id] || comment.suggestedReply)}
                          onClick={() => handleUseReply(comment)}
                          className="px-3.5 py-1.5 rounded-lg bg-[#0A4A3D] hover:bg-[#063028] disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                        >
                          <Send className="w-3 h-3" /> Send reply
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCustomReplyText(generatedReplies[comment.id] || comment.suggestedReply); setEditingCommentId(comment.id); }}
                          className="px-2.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 text-[11px] text-stone-700"
                        >
                          Edit
                        </button>
                      </div>

                      {editingCommentId === comment.id && (
                      <div className="space-y-2">
                        <textarea value={customReplyText} onChange={event => setCustomReplyText(event.target.value)} rows={3} className="w-full p-3 rounded-lg border border-stone-200 text-xs" placeholder="Edit your reply before sending" />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingCommentId('')} className="px-3 py-1.5 rounded-lg border border-stone-200 text-[11px]">Cancel</button>
                          <button type="button" onClick={() => handleSendCustomReply(comment.id)} disabled={!customReplyText.trim()} className="px-3 py-1.5 rounded-lg bg-[#0A4A3D] text-white text-[11px] disabled:opacity-50">Send edited reply</button>
                        </div>
                      </div>
                    )}

                    {/* Moderation actions */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openModeration(comment, 'report')}
                          className="p-1.5 text-stone-400 hover:text-amber-600 rounded transition-colors"
                          title="Flag inside Plumbline"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openModeration(comment, 'block')}
                          className="p-1.5 text-stone-400 hover:text-stone-700 rounded transition-colors"
                          title="Add internal block-list note"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openModeration(comment, 'delete')}
                          className="p-1.5 text-stone-400 hover:text-red-600 rounded transition-colors"
                          title="Hide from this Plumbline workspace"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {syncError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{syncError}</div>}
          {replyError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{replyError}</div>}
          {filteredComments.length === 0 && (
            <div className="bg-white rounded-2xl p-12 text-center border border-stone-200 text-stone-400">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 text-stone-300" />
              <h4 className="text-sm font-semibold text-stone-700">No comments found</h4>
              <p className="text-xs mt-1">Connect a social account, then select “Sync live comments” to load comments from that account.</p>
            </div>
          )}
        </div>

        {/* Right Column: Statistics & Guidelines Info (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* E. Comment Statistics */}
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-sm font-bold text-[#12201C]">Comments Overview</h3>
              <span className="text-[10px] text-stone-400">Live API data</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <div className="text-xl font-bold text-[#12201C]">{totalCommentsCount}</div>
                <div className="text-[11px] text-[#68756F]">Total received</div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                <div className="text-xl font-bold text-[#B45309]">{awaitingReplyCount}</div>
                <div className="text-[11px] text-[#68756F]">Awaiting reply</div>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-xl font-bold text-[#167A58]">—</div>
                <div className="text-[11px] text-[#68756F]">Response time</div>
              </div>

              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200">
                <div className="text-xl font-bold text-[#C2413B]">{flaggedCount}</div>
                <div className="text-[11px] text-[#68756F]">Flagged / spam</div>
              </div>
            </div>
          </div>

          {/* AI Fact Grounding Notice */}
          <div className="p-5 rounded-2xl bg-emerald-950 text-stone-200 text-xs space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-white">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Fact-Grounded Responses
            </div>
            <p className="text-[11px] text-emerald-200/90 leading-relaxed font-light">
              Plumbline never fabricates URLs, dates, prices, or rankings in replies. If information is absent from the brand knowledge base, a neutral verified referral response is recommended.
            </p>
          </div>
        </div>
      </div>

      {/* Internal moderation confirmation */}
      <Modal
        isOpen={moderationModalOpen}
        onClose={() => setModerationModalOpen(false)}
        title={`Plumbline internal triage (${modAction.toUpperCase()})`}
        subtitle="These labels are local notes only. Platform moderation is not performed."
      >
        <div className="space-y-4">
          <p className="text-xs text-stone-700">
            Apply the <strong>{modAction}</strong> label to the comment from <strong>{modTargetComment?.authorName}</strong> inside this Plumbline workspace? This does not report, block, or delete anything on the social platform.
          </p>

          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">
              Moderation Reason
            </label>
            <select
              value={modReason}
              onChange={e => setModReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200 bg-white"
            >
              <option value="spam">Spam / Unsolicited Promotion</option>
              <option value="harassment">Harassment or Defamatory Language</option>
              <option value="inappropriate">Inappropriate / Off-Topic</option>
              <option value="impersonation">Impersonation</option>
            </select>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={() => setModerationModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              onClick={confirmModeration}
              className="px-5 py-2 rounded-xl bg-[#C2413B] text-white text-xs font-semibold"
            >
              Confirm {modAction}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
