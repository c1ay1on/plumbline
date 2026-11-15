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
  getAIStatus() { return this.request<{ configured: boolean; model: string }>('/api/ai/status'); }
  testAI() { return this.request<{ success: boolean; model: string }>('/api/ai/test', { method: 'POST' }); }
  groqCompletion(body: { messages: any[]; model?: string; temperature?: number; max_tokens?: number; response_format?: { type: string } }) {
    return this.request<any>('/api/ai/chat/completions', { method: 'POST', body: JSON.stringify(body) });
  }
}

export const apiClient = new ApiClient();
export const API_BASE = API_BASE_URL;
