import {
  User,
  Workspace,
  BrandGuidelines,
  Post,
  CommentItem,
  ChannelConnection,
  TeamMember,
  GuidelineVersionHistory,
  AuditFinding,
  Platform
} from '../types';

const GLOBAL_USER_KEY = 'plumbline_current_user';
const ACTIVE_USER_KEY = 'plumbline_active_user_id';
const DATA_KEYS = [
  'plumbline_workspace', 'plumbline_guidelines', 'plumbline_guideline_versions',
  'plumbline_posts', 'plumbline_comments', 'plumbline_channels',
  'plumbline_onboarding_completed', 'plumbline_clean_workspace'
];

const PLATFORM_INFO: { platform: Platform; name: string; capabilities: string[] }[] = [
  { platform: 'linkedin', name: 'LinkedIn', capabilities: ['Publish text posts'] },
  { platform: 'instagram', name: 'Instagram', capabilities: ['Publish media posts', 'Read and reply to comments'] },
  { platform: 'x', name: 'X', capabilities: ['Publish posts', 'Read mentions and reply'] },
  { platform: 'facebook', name: 'Facebook Pages', capabilities: ['Publish to Pages', 'Read and reply to comments'] },
  { platform: 'threads', name: 'Threads', capabilities: ['Publish text posts'] },
  { platform: 'youtube', name: 'YouTube', capabilities: ['Read and reply to video comments'] }
];

const EMPTY_USER: User = {
  id: '', name: '', email: '', role: 'owner', workspaceId: '', createdAt: '', lastLogin: ''
};

const EMPTY_GUIDELINES: BrandGuidelines = {
  id: 'brand-guidelines', version: 'v1', lastUpdated: '', updatedBy: '',
  voice: {
    tones: [], customToneDescription: '', examplePositive: '', exampleNegative: '',
    platformRules: { linkedin: '', instagram: '', x: '', facebook: '', threads: '', youtube: '' }
  },
  terminology: [], facts: [],
  colors: { primary: '#0A4A3D', secondary: '#167A58', accent: '#B45309', background: '#F2F5F3' },
  fonts: { heading: 'Inter', body: 'Inter' }, assets: [], rulebookDocuments: []
};

class WorkspaceStorage {
  private persistenceHandler: (() => void) | null = null;

  setPersistenceHandler(handler: (() => void) | null): void {
    this.persistenceHandler = handler;
  }

  private persist(key: string, value: unknown): void {
    localStorage.setItem(this.scopedKey(key), JSON.stringify(value));
    if (this.persistenceHandler && DATA_KEYS.includes(key)) this.persistenceHandler();
  }

  hydrateWorkspaceData(data: Record<string, unknown>): void {
    const keyMap: Record<string, string> = {
      workspace: 'plumbline_workspace', guidelines: 'plumbline_guidelines',
      guideline_versions: 'plumbline_guideline_versions', posts: 'plumbline_posts',
      comments: 'plumbline_comments',
      onboarding_completed: 'plumbline_onboarding_completed', clean_workspace: 'plumbline_clean_workspace'
    };
    for (const [key, value] of Object.entries(data)) {
      const localKey = keyMap[key];
      if (!localKey) continue;
      if (key === 'onboarding_completed' || key === 'clean_workspace') {
        localStorage.setItem(this.scopedKey(localKey), String(Boolean(value)));
      } else {
        localStorage.setItem(this.scopedKey(localKey), JSON.stringify(value));
      }
    }
  }

  getWorkspaceSnapshot(): Record<string, unknown> {
    return {
      workspace: this.getWorkspace(),
      guidelines: this.getGuidelines(),
      guideline_versions: this.getGuidelineVersions(),
      posts: this.getPosts(),
      comments: this.getComments(),
      onboarding_completed: this.isOnboardingCompleted(),
      clean_workspace: this.isCleanWorkspace()
    };
  }

  private scopedKey(key: string): string {
    const userId = localStorage.getItem(ACTIVE_USER_KEY) || 'anonymous';
    return `${key}:${userId}`;
  }

  getCurrentUser(): User {
    const stored = localStorage.getItem(GLOBAL_USER_KEY);
    if (!stored) return EMPTY_USER;
    try { return JSON.parse(stored) as User; } catch { return EMPTY_USER; }
  }

  setCurrentUser(user: User): void {
    const migrationKey = 'plumbline_real_workspace_migration_v2';
    if (!localStorage.getItem(migrationKey)) {
      // Clear the previous demo build's local seed/cache once. Real workspace data is restored from the backend after login.
      const keysToRemove = new Set<string>();
      for (const key of DATA_KEYS) {
        keysToRemove.add(key);
        for (let index = 0; index < localStorage.length; index += 1) {
          const existingKey = localStorage.key(index);
          if (existingKey && (existingKey === key || existingKey.startsWith(`${key}:`))) keysToRemove.add(existingKey);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(migrationKey, 'true');
    }
    localStorage.setItem(GLOBAL_USER_KEY, JSON.stringify(user));
    if (user.id) localStorage.setItem(ACTIVE_USER_KEY, user.id);
  }

  getAllUsers(): User[] {
    const user = this.getCurrentUser();
    return user.id ? [user] : [];
  }

  isOnboardingCompleted(): boolean {
    return localStorage.getItem(this.scopedKey('plumbline_onboarding_completed')) === 'true';
  }

  setOnboardingCompleted(val: boolean): void {
    localStorage.setItem(this.scopedKey('plumbline_onboarding_completed'), String(val));
    if (this.persistenceHandler) this.persistenceHandler();
  }

  getWorkspace(): Workspace {
    const stored = localStorage.getItem(this.scopedKey('plumbline_workspace'));
    if (stored) { try { return JSON.parse(stored) as Workspace; } catch { /* reset malformed local data */ } }
    const user = this.getCurrentUser();
    return {
      id: user.workspaceId || 'workspace-local', name: 'My Workspace', organization: '',
      type: 'independent', ownerId: user.id, memberCount: user.id ? 1 : 0
    };
  }

  saveWorkspace(ws: Workspace): void {
    this.persist('plumbline_workspace', ws);
  }

  getGuidelines(): BrandGuidelines {
    const stored = localStorage.getItem(this.scopedKey('plumbline_guidelines'));
    if (stored) { try { return JSON.parse(stored) as BrandGuidelines; } catch { /* reset malformed local data */ } }
    return { ...EMPTY_GUIDELINES, voice: { ...EMPTY_GUIDELINES.voice, platformRules: { ...EMPTY_GUIDELINES.voice.platformRules } } };
  }

  saveGuidelines(guidelines: BrandGuidelines): void {
    this.persist('plumbline_guidelines', guidelines);
  }

  getGuidelineVersions(): GuidelineVersionHistory[] {
    const stored = localStorage.getItem(this.scopedKey('plumbline_guideline_versions'));
    if (!stored) return [];
    try { return JSON.parse(stored) as GuidelineVersionHistory[]; } catch { return []; }
  }

  saveGuidelineVersions(versions: GuidelineVersionHistory[]): void {
    this.persist('plumbline_guideline_versions', versions);
  }

  getPosts(): Post[] {
    const stored = localStorage.getItem(this.scopedKey('plumbline_posts'));
    if (!stored) return [];
    try { return JSON.parse(stored) as Post[]; } catch { return []; }
  }

  getPostById(id: string): Post | undefined { return this.getPosts().find(post => post.id === id); }

  savePosts(posts: Post[]): void {
    this.persist('plumbline_posts', posts);
  }

  addPost(post: Post): void { this.savePosts([post, ...this.getPosts()]); }

  updatePost(updated: Post): void {
    const posts = this.getPosts();
    const index = posts.findIndex(post => post.id === updated.id);
    if (index >= 0) { posts[index] = updated; this.savePosts(posts); }
  }

  updateFindingStatus(postId: string, findingId: string, status: AuditFinding['status'], contestedReason?: string): void {
    const post = this.getPostById(postId);
    if (!post) return;
    post.findings = post.findings.map(finding => finding.id === findingId ? {
      ...finding, status,
      statusUpdatedAt: new Date().toISOString(),
      userAction: status === 'accepted' ? 'accepted' : status === 'rejected' ? 'rejected' : 'contested',
      contestedReason: contestedReason || finding.contestedReason
    } : finding);
    const open = post.findings.filter(f => f.status === 'open' || f.status === 'contested');
    const critical = open.filter(f => f.severity === 'critical').length;
    const warning = open.filter(f => f.severity === 'warning').length;
    const suggestion = open.filter(f => f.severity === 'suggestion').length;
    const score = Math.min(100, critical * 30 + warning * 10 + suggestion * 5);
    post.brandRiskScore = { ...post.brandRiskScore, overallScore: score, riskCategory: score > 50 ? 'high' : score > 20 ? 'medium' : 'low', criticalCount: critical, warningCount: warning, suggestionCount: suggestion };
    post.updatedAt = new Date().toISOString();
    this.updatePost(post);
  }

  disputeFinding(postId: string, findingId: string, details: { reason: string; ruleId: string; ruleLabel: string; disputedBy: string; disputedAt: string }): void {
    this.updateFindingStatus(postId, findingId, 'contested', details.reason);
    const post = this.getPostById(postId);
    if (!post) return;
    post.findings = post.findings.map(finding => finding.id === findingId ? {
      ...finding,
      ruleId: details.ruleId,
      ruleLabel: details.ruleLabel,
      disputedBy: details.disputedBy,
      disputedAt: details.disputedAt
    } : finding);
    this.updatePost(post);
  }

  getComments(): CommentItem[] {
    const stored = localStorage.getItem(this.scopedKey('plumbline_comments'));
    if (!stored) return [];
    try { return JSON.parse(stored) as CommentItem[]; } catch { return []; }
  }

  saveComments(comments: CommentItem[]): void { this.persist('plumbline_comments', comments); }
  addComment(comment: CommentItem): void { this.saveComments([comment, ...this.getComments()]); }

  replyToComment(commentId: string, replyText: string): void {
    const comments = this.getComments().map(comment => comment.id === commentId ? { ...comment, status: 'replied' as const, replyDraft: replyText, replyCount: comment.replyCount + 1 } : comment);
    this.saveComments(comments);
  }

  moderateComment(commentId: string, action: 'report' | 'block' | 'delete', reason?: string): void {
    const comments = this.getComments();
    this.saveComments(action === 'delete' ? comments.filter(c => c.id !== commentId) : comments.map(c => c.id === commentId ? { ...c, status: 'flagged' as const, moderationReason: reason || action } : c));
  }

  getChannels(): ChannelConnection[] {
    const stored = localStorage.getItem(this.scopedKey('plumbline_channels'));
    if (stored) { try { return JSON.parse(stored) as ChannelConnection[]; } catch { /* rebuild catalogue */ } }
    return PLATFORM_INFO.map(item => ({
      id: item.platform, platform: item.platform, name: item.name, status: 'not_connected',
      accountName: '', accountHandle: '', lastSync: 'Not connected', capabilities: item.capabilities
    }));
  }

  saveChannels(channels: ChannelConnection[]): void { localStorage.setItem(this.scopedKey('plumbline_channels'), JSON.stringify(channels)); }

  getTeamMembers(): TeamMember[] {
    const stored = localStorage.getItem(this.scopedKey('plumbline_team'));
    if (stored) { try { return JSON.parse(stored) as TeamMember[]; } catch { return []; } }
    const user = this.getCurrentUser();
    if (!user.id) return [];
    return [{ id: user.id, name: user.name, email: user.email, role: user.role, department: '', status: 'active', draftCount: 0, pendingSubmissions: 0, lastActive: user.lastLogin || 'Active now' }];
  }

  saveTeamMembers(members: TeamMember[]): void { localStorage.setItem(this.scopedKey('plumbline_team'), JSON.stringify(members)); }

  startCleanWorkspace(organizationName: string, brandName: string): void {
    const user = this.getCurrentUser();
    const timestamp = new Date().toISOString();
    const workspace: Workspace = {
      id: user.workspaceId || `workspace-${crypto.randomUUID()}`,
      name: `${brandName || organizationName || 'My'} Workspace`, organization: organizationName || brandName,
      type: 'manager_workspace', ownerId: user.id, memberCount: user.id ? 1 : 0
    };
    this.saveWorkspace(workspace);
    this.saveGuidelines({
      ...EMPTY_GUIDELINES, id: `guidelines-${crypto.randomUUID()}`, version: 'v1', lastUpdated: timestamp,
      updatedBy: user.name, voice: { ...EMPTY_GUIDELINES.voice, tones: ['Professional', 'Clear'] }
    });
    this.saveGuidelineVersions([]);
    this.savePosts([]);
    this.saveComments([]);
    this.saveChannels(PLATFORM_INFO.map(item => ({ id: item.platform, platform: item.platform, name: item.name, status: 'not_connected', accountName: '', accountHandle: '', lastSync: 'Not connected', capabilities: item.capabilities })));
    this.saveTeamMembers(user.id ? [{ id: user.id, name: user.name, email: user.email, role: user.role, department: '', status: 'active', draftCount: 0, pendingSubmissions: 0, lastActive: 'Active now' }] : []);
    this.setOnboardingCompleted(true);
    localStorage.setItem(this.scopedKey('plumbline_clean_workspace'), 'true');
    if (this.persistenceHandler) this.persistenceHandler();
  }

  isCleanWorkspace(): boolean { return localStorage.getItem(this.scopedKey('plumbline_clean_workspace')) === 'true'; }

  resetAll(): void {
    DATA_KEYS.forEach(key => localStorage.removeItem(this.scopedKey(key)));
  }
}

export const workspaceStorage = new WorkspaceStorage();
