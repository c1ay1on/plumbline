import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  Workspace,
  BrandGuidelines,
  GuidelineVersionHistory,
  Post,
  CommentItem,
  ChannelConnection,
  TeamMember,
  AuditFinding,
  Platform,
  ChangeImpact,
  RuleChange
} from '../types';
import { workspaceStorage } from '../services/workspaceStorage';
import { apiClient, SocialConnection } from '../services/api/client';
import { AIAuditEngine } from '../services/aiAuditService';
import { diffRules, computeImpact, snapshotRules, versionNumber, PENDING_STATUSES } from '../services/governance/versioning';
import { resolveRuleId, ruleLabelFor } from '../services/governance/ambiguity';
import { governanceService } from '../services/governance/governanceService';
import { useAuth } from './AuthContext';

interface PublishResult {
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface SaveGuidelinesResult {
  version: string;
  changes: RuleChange[];
  impact: ChangeImpact;
}

interface WorkspaceContextType {
  workspace: Workspace;
  guidelines: BrandGuidelines;
  guidelineVersions: GuidelineVersionHistory[];
  posts: Post[];
  comments: CommentItem[];
  channels: ChannelConnection[];
  teamMembers: TeamMember[];
  updateTeamMember: (memberId: string, changes: { department?: string; role?: TeamMember['role'] }) => Promise<void>;
  isCleanWorkspace: boolean;
  createPost: (post: Omit<Post, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewTrail'>) => Post;
  updatePost: (post: Post) => void;
  submitPostForApproval: (postId: string, notes?: string) => void;
  approvePost: (postId: string, comment?: string) => void;
  requestChanges: (postId: string, reason: string) => void;
  publishPost: (postId: string) => Promise<PublishResult>;
  updateFindingStatus: (postId: string, findingId: string, status: AuditFinding['status'], reason?: string) => void;
  disputeFinding: (postId: string, findingId: string, reason?: string) => void;
  recheckPosts: (postIds: string[]) => number;
  replyToComment: (commentId: string, replyText: string) => Promise<void>;
  moderateComment: (commentId: string, action: 'report' | 'block' | 'delete', reason?: string) => void;
  syncSocialComments: () => Promise<number>;
  saveGuidelines: (guidelines: BrandGuidelines, changeSummary: string) => SaveGuidelinesResult;
  restoreGuidelineVersion: (version: string) => SaveGuidelinesResult | null;
  startCleanWorkspace: (organizationName: string, brandName: string) => void;
  refreshData: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const PLATFORM_NAMES: Record<Platform, string> = {
  linkedin: 'LinkedIn', instagram: 'Instagram', x: 'X', facebook: 'Facebook Pages', threads: 'Threads', youtube: 'YouTube'
};

function mapConnection(connection: SocialConnection): ChannelConnection {
  return {
    id: connection.id,
    platform: connection.platform,
    accountId: connection.accountId,
    name: PLATFORM_NAMES[connection.platform],
    status: 'connected',
    accountName: connection.accountName,
    accountHandle: connection.accountHandle,
    lastSync: connection.connectedAt,
    capabilities: connection.capabilities
  };
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isAuthenticated } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace>(() => workspaceStorage.getWorkspace());
  const [guidelines, setGuidelines] = useState<BrandGuidelines>(() => workspaceStorage.getGuidelines());
  const [guidelineVersions, setGuidelineVersions] = useState<GuidelineVersionHistory[]>(() => workspaceStorage.getGuidelineVersions());
  const [posts, setPosts] = useState<Post[]>(() => workspaceStorage.getPosts());
  const [comments, setComments] = useState<CommentItem[]>(() => workspaceStorage.getComments());
  const [channels, setChannels] = useState<ChannelConnection[]>(() => workspaceStorage.getChannels());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => workspaceStorage.getTeamMembers());

  const refreshData = () => {
    setWorkspace(workspaceStorage.getWorkspace());
    setGuidelines(workspaceStorage.getGuidelines());
    setGuidelineVersions(workspaceStorage.getGuidelineVersions());
    setPosts(workspaceStorage.getPosts());
    setComments(workspaceStorage.getComments());
    setChannels(workspaceStorage.getChannels());
  };

  const refreshConnections = async () => {
    if (!isAuthenticated) return;
    try {
      const connected = await apiClient.getSocialConnections();
      const connectedByPlatform = new Map<Platform, ChannelConnection>();
      for (const item of connected) {
        if (!connectedByPlatform.has(item.platform)) connectedByPlatform.set(item.platform, mapConnection(item));
      }
      const catalogue = workspaceStorage.getChannels().map(channel => connectedByPlatform.get(channel.platform) || {
        ...channel, status: 'not_connected' as const, accountName: '', accountHandle: '', lastSync: 'Not connected'
      });
      workspaceStorage.saveChannels(catalogue);
      setChannels(catalogue);
    } catch {
      // Keep last known local display if the API is temporarily unreachable.
    }
  };

  useEffect(() => {
    let active = true;
    workspaceStorage.setPersistenceHandler(null);
    if (currentUser.id) {
      workspaceStorage.setCurrentUser(currentUser);
      setTeamMembers(workspaceStorage.getTeamMembers());
    }
    if (!isAuthenticated || !currentUser.id) {
      refreshData();
      return () => { active = false; };
    }

    const hydrateWorkspace = async () => {
      try {
        const sharedData = await apiClient.getWorkspaceData();
        if (!active) return;
        workspaceStorage.hydrateWorkspaceData(sharedData);
      } catch {
        // Local cache remains available when the API cannot be reached.
      }
      if (!active) return;
      refreshData();
      try {
        const members = await apiClient.getWorkspaceMembers();
        if (active) setTeamMembers(members.map(member => ({ ...member, role: member.role as TeamMember['role'], status: member.status as TeamMember['status'] })));
      } catch {
        // Fall back to the cached list of local members.
      }
      if (active) {
        let saveQueue: Promise<unknown> = Promise.resolve();
        workspaceStorage.setPersistenceHandler(() => {
          const snapshot = workspaceStorage.getWorkspaceSnapshot();
          saveQueue = saveQueue.catch(() => undefined).then(() => apiClient.saveWorkspaceData(snapshot));
          void saveQueue.catch(() => undefined);
        });
        void refreshConnections();
      }
    };

    void hydrateWorkspace();
    return () => { active = false; workspaceStorage.setPersistenceHandler(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id, isAuthenticated]);

  // Returns the history entry for the active guideline version, creating a baseline entry if there is none yet.
  const ensureCurrentVersionEntry = (): GuidelineVersionHistory => {
    const current = workspaceStorage.getGuidelines();
    const history = workspaceStorage.getGuidelineVersions();
    const existing = history.find(item => item.version === current.version);
    if (existing?.id && existing.snapshot) return existing;
    const entry: GuidelineVersionHistory = {
      version: current.version,
      editor: existing?.editor || current.updatedBy || currentUser.name,
      timestamp: existing?.timestamp || current.lastUpdated || new Date().toISOString(),
      summary: existing?.summary || 'Guidelines in use before version tracking started.',
      changesCount: existing?.changesCount || 0,
      ...existing,
      id: existing?.id || `gv-${crypto.randomUUID()}`,
      snapshot: existing?.snapshot || snapshotRules(current),
      ruleChanges: existing?.ruleChanges || []
    };
    workspaceStorage.saveGuidelineVersions(existing
      ? history.map(item => item.version === current.version ? entry : item)
      : [entry, ...history]);
    void syncVersionToServer(entry);
    return entry;
  };

  const syncVersionToServer = async (entry: GuidelineVersionHistory, previous?: GuidelineVersionHistory) => {
    if (!isAuthenticated || !entry.snapshot) return null;
    try {
      return await apiClient.createGuidelineVersion({
        id: entry.id,
        previous_id: previous?.id,
        version_number: versionNumber(entry.version),
        change_summary: entry.summary,
        rules: entry.snapshot,
        previous_rules: previous?.snapshot
      });
    } catch {
      // The version is kept in the shared workspace history; the server copy is only a record.
      return null;
    }
  };

  const createPost = (postData: Omit<Post, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'reviewTrail'>): Post => {
    const timestamp = new Date().toISOString();
    const role = currentUser.role === 'manager' || currentUser.role === 'owner' || currentUser.role === 'admin' ? 'Manager' : 'Social Media Creator';
    const versionEntry = ensureCurrentVersionEntry();
    const reviewTrail: Post['reviewTrail'] = [{
      id: `rev-${crypto.randomUUID()}`,
      version: 'v1',
      timestamp,
      userName: currentUser.name,
      userRole: role,
      action: 'Created post draft',
      comment: 'Initial draft composition.'
    }];
    if (postData.status === 'in_review') {
      reviewTrail.push({
        id: `rev-${crypto.randomUUID()}`, version: 'v1', timestamp, userName: currentUser.name, userRole: role,
        action: 'Submitted for approval', comment: 'Submitted directly from the composer.'
      });
    }
    const newPost: Post = {
      ...postData,
      id: `post-${crypto.randomUUID()}`,
      version: 'v1',
      guidelineVersion: versionEntry.version,
      guidelineVersionId: versionEntry.id,
      guidelineSnapshot: versionEntry.snapshot,
      checkedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewTrail
    };
    workspaceStorage.addPost(newPost);
    refreshData();
    return newPost;
  };

  const updatePost = (updated: Post) => {
    workspaceStorage.updatePost({ ...updated, updatedAt: new Date().toISOString() });
    refreshData();
  };

  const submitPostForApproval = (postId: string, notes?: string) => {
    const post = workspaceStorage.getPostById(postId);
    if (!post) return;
    const nextVer = `v${Math.max(1, Number(post.version.replace('v', '')) || 1) + 1}`;
    post.status = 'in_review';
    post.version = nextVer;
    post.updatedAt = new Date().toISOString();
    post.reviewTrail.push({
      id: `rev-${crypto.randomUUID()}`, version: nextVer, timestamp: post.updatedAt,
      userName: currentUser.name,
      userRole: currentUser.role === 'manager' || currentUser.role === 'owner' || currentUser.role === 'admin' ? 'Manager' : 'Social Media Creator',
      action: 'Submitted for approval', comment: notes || 'Submitted draft for review.',
      findingsSnapshot: {
        total: post.findings.length,
        open: post.findings.filter(f => f.status === 'open' || f.status === 'contested').length,
        resolved: post.findings.filter(f => f.status === 'accepted' || f.status === 'fixed' || f.status === 'resolved').length,
        critical: post.findings.filter(f => f.severity === 'critical' && f.status !== 'rejected').length
      }
    });
    workspaceStorage.updatePost(post);
    refreshData();
  };

  const approvePost = (postId: string, comment?: string) => {
    const post = workspaceStorage.getPostById(postId);
    if (!post) return;
    post.status = 'approved';
    post.updatedAt = new Date().toISOString();
    post.reviewTrail.push({
      id: `rev-${crypto.randomUUID()}`, version: post.version, timestamp: post.updatedAt,
      userName: currentUser.name, userRole: 'Manager', action: 'Approved for publishing',
      comment: comment || 'Approved by a workspace reviewer.'
    });
    workspaceStorage.updatePost(post);
    refreshData();
  };

  const requestChanges = (postId: string, reason: string) => {
    const post = workspaceStorage.getPostById(postId);
    if (!post) return;
    post.status = 'changes_requested';
    post.updatedAt = new Date().toISOString();
    post.reviewTrail.push({
      id: `rev-${crypto.randomUUID()}`, version: post.version, timestamp: post.updatedAt,
      userName: currentUser.name, userRole: 'Manager', action: 'Requested revisions', comment: reason
    });
    workspaceStorage.updatePost(post);
    refreshData();
  };

  const publishPost = async (postId: string): Promise<PublishResult> => {
    const post = workspaceStorage.getPostById(postId);
    if (!post) throw new Error('This draft could not be found. Refresh the page and try again.');
    if (post.status !== 'approved' && post.status !== 'published') {
      throw new Error('A post must be approved before it can be published.');
    }
    const alreadyPublished = new Set((post.dispatches || []).filter(item => item.status === 'published').map(item => item.platform));
    const targets = post.platforms.filter(platform => !alreadyPublished.has(platform));
    if (targets.length === 0) return { succeeded: 0, failed: 0, errors: ['Every selected platform already has a successful publish record.'] };

    const results = await Promise.all(targets.map(async platform => {
      const channel = channels.find(item => item.platform === platform && item.status === 'connected');
      if (!channel) return { platform, ok: false as const, error: `${PLATFORM_NAMES[platform]} is not connected.` };
      const variant = post.platformVariants[platform];
      const content = (variant?.description || post.originalDescription || '').trim();
      if (!content) return { platform, ok: false as const, error: `${PLATFORM_NAMES[platform]} has no post text.` };
      const media = post.mediaUrls.find(url => /^https:\/\//i.test(url));
      try {
        const result = await apiClient.publishSocial(platform, {
          text: content,
          title: variant?.title || post.title,
          image_url: platform === 'instagram' || platform === 'threads' || platform === 'facebook' ? media : undefined,
          account_id: channel.accountId
        });
        return { platform, ok: true as const, result, channel };
      } catch (error) {
        return { platform, ok: false as const, error: error instanceof Error ? error.message : 'Platform request failed.' };
      }
    }));

    const timestamp = new Date().toISOString();
    const newDispatches = results.map(result => result.ok ? {
      platform: result.platform,
      status: 'published' as const,
      timestamp,
      targetAccount: result.channel.accountHandle || result.channel.accountName,
      dispatchId: result.result.dispatchId || result.result.id,
      liveUrl: result.result.permalink
    } : {
      platform: result.platform,
      status: 'failed' as const,
      timestamp,
      targetAccount: channels.find(item => item.platform === result.platform)?.accountHandle || '',
      dispatchId: `failed-${result.platform}-${Date.now()}`
    });

    post.dispatches = [...(post.dispatches || []).filter(item => item.status === 'published'), ...newDispatches];
    const failedResults = results.filter(item => !item.ok);
    const succeededCount = results.length - failedResults.length;
    const allSelectedPublished = post.platforms.every(platform => post.dispatches?.some(dispatch => dispatch.platform === platform && dispatch.status === 'published'));
    post.status = allSelectedPublished ? 'published' : 'approved';
    post.updatedAt = timestamp;
    post.reviewTrail.push({
      id: `rev-${crypto.randomUUID()}`, version: post.version, timestamp,
      userName: currentUser.name, userRole: 'Manager',
      action: allSelectedPublished ? 'Published to connected channels' : 'Publishing attempt completed',
      comment: `${succeededCount} successful, ${failedResults.length} failed. ${failedResults.map(item => `${PLATFORM_NAMES[item.platform]}: ${item.error}`).join(' | ')}`
    });
    workspaceStorage.updatePost(post);
    refreshData();
    return {
      succeeded: succeededCount,
      failed: failedResults.length,
      errors: failedResults.map(item => `${PLATFORM_NAMES[item.platform]}: ${item.error}`)
    };
  };

  const updateTeamMember = async (memberId: string, changes: { department?: string; role?: TeamMember['role'] }) => {
    const updated = await apiClient.updateWorkspaceMember(memberId, changes);
    setTeamMembers(prev => prev.map(member => member.id === memberId
      ? { ...member, department: updated.department, role: updated.role as TeamMember['role'] }
      : member));
  };

  const updateFindingStatus = (postId: string, findingId: string, status: AuditFinding['status'], reason?: string) => {
    workspaceStorage.updateFindingStatus(postId, findingId, status, reason);
    refreshData();
  };

  const disputeFinding = (postId: string, findingId: string, reason?: string) => {
    const post = workspaceStorage.getPostById(postId);
    const finding = post?.findings.find(item => item.id === findingId);
    if (!post || !finding) return;
    const rulesAtCheck = post.guidelineSnapshot ? { ...guidelines, terminology: post.guidelineSnapshot.terminology } : guidelines;
    const ruleId = resolveRuleId(finding, rulesAtCheck);
    const ruleLabel = finding.ruleLabel || ruleLabelFor(ruleId, rulesAtCheck);
    workspaceStorage.disputeFinding(postId, findingId, {
      reason: (reason || '').trim(), ruleId, ruleLabel, disputedBy: currentUser.name, disputedAt: new Date().toISOString()
    });
    refreshData();
    void governanceService.recordDispute(post, findingId, ruleId, ruleLabel, (reason || '').trim());
  };

  // Re-runs the rule checks on pending posts against the active guidelines. The previous result is kept in auditHistory.
  const recheckPosts = (postIds: string[]): number => {
    const versionEntry = ensureCurrentVersionEntry();
    const active = workspaceStorage.getGuidelines();
    let count = 0;
    postIds.forEach(postId => {
      const post = workspaceStorage.getPostById(postId);
      if (!post || !PENDING_STATUSES.includes(post.status)) return;
      const variantTexts = Object.values(post.platformVariants || {}).map(variant => variant?.description || '').filter(Boolean);
      const text = variantTexts.length ? Array.from(new Set(variantTexts)).join('\n') : post.originalDescription;
      const result = AIAuditEngine.auditContent(text, post.platforms, active, post.mediaUrls.length > 0);
      const timestamp = new Date().toISOString();
      const previousVersion = post.guidelineVersion || post.findings[0]?.guidelineVersion || 'v1';
      const updated: Post = {
        ...post,
        auditHistory: [...(post.auditHistory || []), {
          guidelineVersion: previousVersion, guidelineVersionId: post.guidelineVersionId,
          checkedAt: post.checkedAt || post.createdAt, findings: post.findings, brandRiskScore: post.brandRiskScore
        }],
        findings: result.findings,
        brandRiskScore: result.score,
        guidelineVersion: versionEntry.version,
        guidelineVersionId: versionEntry.id,
        guidelineSnapshot: versionEntry.snapshot,
        checkedAt: timestamp,
        updatedAt: timestamp,
        reviewTrail: [...post.reviewTrail, {
          id: `rev-${crypto.randomUUID()}`, version: post.version, timestamp, userName: currentUser.name,
          userRole: currentUser.role === 'employee' ? 'Social Media Creator' : 'Manager',
          action: `Re-checked against guidelines ${versionEntry.version}`,
          comment: `${result.findings.length} finding(s). The ${previousVersion} check is kept in the audit history.`
        }]
      };
      workspaceStorage.updatePost(updated);
      count += 1;
    });
    refreshData();
    return count;
  };

  const replyToComment = async (commentId: string, replyText: string) => {
    const comment = comments.find(item => item.id === commentId) || workspaceStorage.getComments().find(item => item.id === commentId);
    if (!comment) throw new Error('Comment not found. Sync comments and try again.');
    if (!replyText.trim()) throw new Error('Enter a reply before sending.');
    await apiClient.replyToSocialComment(comment.id, comment.platform, replyText.trim(), comment.sourceAccountId);
    workspaceStorage.replyToComment(commentId, replyText.trim());
    refreshData();
  };

  const moderateComment = (commentId: string, action: 'report' | 'block' | 'delete', reason?: string) => {
    // This is an internal Plumbline triage label only. Platform moderation APIs vary and are not called here.
    workspaceStorage.moderateComment(commentId, action, reason);
    refreshData();
  };

  const syncSocialComments = async (): Promise<number> => {
    const remote = await apiClient.getSocialComments();
    const existing = new Map(workspaceStorage.getComments().map(comment => [`${comment.platform}:${comment.id}`, comment]));
    const syncedFromCurrentAccounts: CommentItem[] = remote.map((item: any) => {
      const previous = existing.get(`${item.platform}:${String(item.id)}`);
      return {
        id: String(item.id),
        platform: item.platform as Platform,
        sourceAccountId: item.accountId,
        authorName: item.authorName || 'Social account user',
        authorAvatar: '',
        authorHandle: item.authorHandle || '',
        text: item.text || '',
        timeReceived: item.timeReceived || new Date().toISOString(),
        likes: Number(item.likes || 0),
        replyCount: Number(item.replyCount || 0),
        status: item.notice || item.flagged ? 'flagged' : previous?.status || 'needs_reply',
        suggestedReply: previous?.suggestedReply || '',
        suggestedReplySource: previous?.suggestedReplySource || '',
        replyDraft: previous?.replyDraft,
        moderationReason: item.notice ? 'Platform connection or permission notice' : item.flagged ? (item.flagReason || 'Flagged by platform') : previous?.moderationReason
      };
    });
    const merged = new Map<string, CommentItem>(existing);
    for (const item of syncedFromCurrentAccounts) merged.set(`${item.platform}:${item.id}`, item);
    const normalized = Array.from(merged.values()).sort((a, b) => b.timeReceived.localeCompare(a.timeReceived));
    workspaceStorage.saveComments(normalized);
    setComments(normalized);
    return syncedFromCurrentAccounts.filter(item => !item.id.startsWith('permission-')).length;
  };

  const saveGuidelines = (newGuidelines: BrandGuidelines, changeSummary: string): SaveGuidelinesResult => {
    const previousEntry = ensureCurrentVersionEntry();
    const history = workspaceStorage.getGuidelineVersions();
    const currentVerNum = Math.max(versionNumber(workspaceStorage.getGuidelines().version), ...history.map(item => versionNumber(item.version)));
    const nextVersion = `v${currentVerNum + 1}`;
    const timestamp = new Date().toISOString();
    const updatedGuidelines: BrandGuidelines = {
      ...newGuidelines,
      version: nextVersion,
      lastUpdated: timestamp,
      updatedBy: `${currentUser.name} (${currentUser.role})`
    };
    const snapshot = snapshotRules(updatedGuidelines);
    const changes = diffRules(previousEntry.snapshot, snapshot);
    const newHistoryItem: GuidelineVersionHistory = {
      id: `gv-${crypto.randomUUID()}`,
      version: nextVersion, editor: currentUser.name, timestamp,
      summary: changeSummary || 'Updated brand guidelines and approved knowledge.',
      changesCount: changes.length,
      snapshot,
      ruleChanges: changes
    };
    workspaceStorage.saveGuidelines(updatedGuidelines);
    workspaceStorage.saveGuidelineVersions([newHistoryItem, ...history]);
    refreshData();
    void syncVersionToServer(newHistoryItem, previousEntry);
    return { version: nextVersion, changes, impact: computeImpact(workspaceStorage.getPosts(), changes, nextVersion) };
  };

  const restoreGuidelineVersion = (version: string): SaveGuidelinesResult | null => {
    const historyItem = workspaceStorage.getGuidelineVersions().find(item => item.version === version);
    if (!historyItem) return null;
    const current = workspaceStorage.getGuidelines();
    const restored: BrandGuidelines = historyItem.snapshot ? {
      ...current,
      terminology: historyItem.snapshot.terminology,
      // Facts keep their extra fields (owner, dates) when they still exist; removed ones come back with defaults.
      facts: historyItem.snapshot.facts.map(fact => ({
        approvalOwner: '', version, lastUpdated: '', ...current.facts.find(item => item.id === fact.id), ...fact
      })),
      voice: { ...current.voice, ...historyItem.snapshot.voice }
    } : current;
    return saveGuidelines(restored, `Restored rules and facts from ${version}.`);
  };

  const startCleanWorkspace = (organizationName: string, brandName: string) => {
    workspaceStorage.startCleanWorkspace(organizationName, brandName);
    refreshData();
  };

  return (
    <WorkspaceContext.Provider value={{
      workspace, guidelines, guidelineVersions, posts, comments, channels, teamMembers, updateTeamMember,
      isCleanWorkspace: workspaceStorage.isCleanWorkspace(), createPost, updatePost, submitPostForApproval,
      approvePost, requestChanges, publishPost, updateFindingStatus, disputeFinding, recheckPosts, replyToComment, moderateComment,
      syncSocialComments, saveGuidelines, restoreGuidelineVersion,
      startCleanWorkspace, refreshData
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
