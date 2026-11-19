import type { AmbiguousRuleAlert, ApprovalTimeStats, ChangeImpact, GuidelineRulesSnapshot, RuleChange, AuditFinding, BrandRiskScore, GroundedAuditMeta, RulebookDocument } from '../../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const TOKEN_KEY = 'plumbline_access_token';

export interface BackendHealthResponse {
  status: string;
  name?: string;
  version?: string;
}

export interface SocialConnection {
  id: string;
  platform: 'linkedin' | 'instagram' | 'x' | 'facebook' | 'threads' | 'youtube';
  accountId: string;
  accountName: string;
  accountHandle: string;
  status: 'connected';
  connectedAt: string;
  capabilities: string[];
  notes?: string;
}

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'approver' | 'employee' | 'owner';
  workspaceId: string;
  createdAt: string;
  lastLogin: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function insightQuery(f: { days?: number; team?: string; platform?: string; creatorId?: string }): string {
  const q = new URLSearchParams();
  if (f.days) q.set('days', String(f.days));
  if (f.team) q.set('team', f.team);
  if (f.platform) q.set('platform', f.platform);
  if (f.creatorId) q.set('creator_id', f.creatorId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

class ApiClient {
  getToken(): string {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  setSession(token: string, user: ApiUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('plumbline_current_user', JSON.stringify(user));
    localStorage.setItem('plumbline_active_user_id', user.id);
  }

  clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('plumbline_current_user');
    localStorage.removeItem('plumbline_active_user_id');
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const token = this.getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    } catch {
      throw new ApiError('Could not reach Plumbline API. It may be waking up; try again in a minute.', 0);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.detail || payload.message || `Request failed (${response.status}).`;
      throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), response.status);
    }
    return payload as T;
  }

  async checkHealth(): Promise<{ online: boolean; data?: BackendHealthResponse; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { online: true, data: await response.json() };
    } catch (error) {
      return { online: false, error: error instanceof Error ? error.message : 'Backend unavailable' };
    }
  }

  login(email: string, password: string) {
    return this.request<{ user: ApiUser; token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  register(fullName: string, email: string, password: string, workspaceId?: string) {
    return this.request<{ user: ApiUser; token: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ full_name: fullName, email, password, workspace_id: workspaceId || undefined }) });
  }

  getWorkspaceData() { return this.request<Record<string, unknown>>('/api/workspace/data'); }
  saveWorkspaceData(data: Record<string, unknown>) { return this.request<{ status: string }>('/api/workspace/data', { method: 'PUT', body: JSON.stringify({ data }) }); }
  getWorkspaceMembers() { return this.request<Array<{ id: string; name: string; email: string; role: string; department: string; status: string; draftCount: number | null; pendingSubmissions: number | null; lastActive: string }>>('/api/workspace/members'); }

  // --- Governance Insights -------------------------------------------------
  getGovernanceInsights(filters: { days?: number; team?: string; platform?: string; creatorId?: string } = {}) {
    return this.request<import('../../types').GovernanceInsights>(`/api/analytics/governance${insightQuery(filters)}`);
  }
  async downloadGovernanceReport(filters: { days?: number; team?: string; platform?: string; creatorId?: string } = {}) {
    const response = await fetch(`${API_BASE_URL}/api/analytics/governance.csv${insightQuery(filters)}`, {
      headers: { Authorization: `Bearer ${this.getToken()}` }
    });
    if (!response.ok) throw new ApiError('Could not export the report.', response.status);
    return response.blob();
  }
  updateWorkspaceMember(memberId: string, body: { department?: string; role?: string }) {
    return this.request<{ id: string; name: string; email: string; role: string; department: string }>(
      `/api/workspace/members/${encodeURIComponent(memberId)}`, { method: 'PATCH', body: JSON.stringify(body) }
    );
  }

  me() { return this.request<ApiUser>('/api/auth/me'); }
  logout() { return this.request<{ status: string }>('/api/auth/logout', { method: 'POST' }); }

  getSocialConnections() { return this.request<SocialConnection[]>('/api/social/connections'); }
  getSocialConfig() { return this.request<{ platforms: Record<string, boolean> }>('/api/social/config'); }
  connectSocial(platform: string) { return this.request<{ authorizationUrl: string }>(`/api/social/${platform}/connect`, { method: 'POST' }); }
  disconnectSocial(platform: string, accountId?: string) {
    const query = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return this.request<{ status: string }>(`/api/social/${platform}/disconnect${query}`, { method: 'DELETE' });
  }
  publishSocial(platform: string, body: { text: string; title?: string; image_url?: string; video_url?: string; account_id?: string }) {
    return this.request<{ status: string; platform: string; id: string; permalink?: string; dispatchId: string }>(`/api/social/${platform}/publish`, { method: 'POST', body: JSON.stringify(body) });
  }
  getSocialComments() { return this.request<any[]>('/api/social/comments'); }
  replyToSocialComment(commentId: string, platform: string, replyText: string, accountId?: string) {
    return this.request<{ status: string }>(`/api/social/comments/${encodeURIComponent(commentId)}/reply`, { method: 'POST', body: JSON.stringify({ platform, reply_text: replyText, account_id: accountId }) });
  }
  getGovernanceSummary() { return this.request<{ approvalTime: ApprovalTimeStats; alerts: AmbiguousRuleAlert[]; thresholds: Record<string, number>; currentVersion: string }>('/api/governance/summary'); }
  getApprovalTime() { return this.request<ApprovalTimeStats>('/api/governance/approval-time'); }
  getRuleAlerts(includeClosed = false) {
    return this.request<{ alerts: AmbiguousRuleAlert[] }>(`/api/governance/alerts${includeClosed ? '?include_closed=true' : ''}`);
  }
  recordDispute(body: { rule_id: string; rule_label: string; post_id: string; finding_id: string; reason: string; guideline_version: string }) {
    return this.request<{ status: string; ruleId: string; alert: AmbiguousRuleAlert | null }>('/api/governance/disputes', { method: 'POST', body: JSON.stringify(body) });
  }
  suggestRuleClarification(ruleId: string) {
    return this.request<AmbiguousRuleAlert>(`/api/governance/alerts/${encodeURIComponent(ruleId)}/suggestion`, { method: 'POST' });
  }
  dismissRuleAlert(ruleId: string, note = '') {
    return this.request<{ status: string }>(`/api/governance/alerts/${encodeURIComponent(ruleId)}/dismiss`, { method: 'POST', body: JSON.stringify({ note }) });
  }
  resolveRuleAlert(ruleId: string, version: string, note = '') {
    return this.request<{ status: string }>(`/api/governance/alerts/${encodeURIComponent(ruleId)}/resolve`, { method: 'POST', body: JSON.stringify({ version, note }) });
  }
  createGuidelineVersion(body: { id?: string; previous_id?: string; version_number: number; change_summary: string; rules: GuidelineRulesSnapshot; previous_rules?: GuidelineRulesSnapshot }) {
    return this.request<{ version: { id: string; version: string; versionNumber: number }; changes: RuleChange[]; impact: ChangeImpact }>('/api/governance/versions', { method: 'POST', body: JSON.stringify(body) });
  }
  getGuidelineVersionDiff(versionNumber: number) {
    return this.request<{ version: string; against: string | null; changes: RuleChange[] }>(`/api/governance/versions/${versionNumber}/diff`);
  }

  // Improvement 1: grounded RAG audit + rulebook upload
  listRulebooks() { return this.request<RulebookDocument[]>('/api/rag/rulebooks'); }
  uploadRulebook(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.request<RulebookDocument & { preview: Array<{ id: string; label: string; text: string }> }>('/api/rag/rulebooks', { method: 'POST', body: form });
  }
  deleteRulebook(id: string) { return this.request<{ status: string }>(`/api/rag/rulebooks/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  getRulebookChunks(id: string) { return this.request<Array<{ id: string; label: string; text: string; page: number | null }>>(`/api/rag/rulebooks/${encodeURIComponent(id)}/chunks`); }
  groundedAudit(body: { text: string; platforms: string[]; guidelines?: unknown; hasMedia?: boolean; mediaAltText?: string }) {
    return this.request<{ findings: AuditFinding[]; score: BrandRiskScore; retrieved: Array<{ id: string; label: string; text: string; score: number | null; source: string }>; meta: GroundedAuditMeta }>('/api/rag/audit', { method: 'POST', body: JSON.stringify(body) });
  }
  getAIStatus() { return this.request<{ configured: boolean; model: string }>('/api/ai/status'); }
  testAI() { return this.request<{ success: boolean; model: string }>('/api/ai/test', { method: 'POST' }); }
  groqCompletion(body: { messages: any[]; model?: string; temperature?: number; max_tokens?: number; response_format?: { type: string } }) {
    return this.request<any>('/api/ai/chat/completions', { method: 'POST', body: JSON.stringify(body) });
  }
}

export const apiClient = new ApiClient();
export const API_BASE = API_BASE_URL;
