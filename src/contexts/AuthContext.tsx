import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, UserRole } from '../types';
import { workspaceStorage } from '../services/workspaceStorage';
import { apiClient, ApiUser, BackendHealthResponse } from '../services/api/client';

interface AuthContextType {
  currentUser: User;
  currentRole: UserRole;
  isAuthenticated: boolean;
  backendHealth: { online: boolean; data?: BackendHealthResponse; error?: string };
  isCheckingHealth: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string, workspaceId?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkBackendHealth: () => Promise<void>;
}

const guestUser: User = { id: '', name: '', email: '', role: 'owner', workspaceId: '', createdAt: '', lastLogin: '' };
const AuthContext = createContext<AuthContextType | undefined>(undefined);

function fromApiUser(user: ApiUser): User {
  return { ...user };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User>(() => workspaceStorage.getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(apiClient.getToken()));
  const [backendHealth, setBackendHealth] = useState<{ online: boolean; data?: BackendHealthResponse; error?: string }>({ online: false, error: 'Checking connection...' });
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const checkBackendHealth = async () => {
    setIsCheckingHealth(true);
    setBackendHealth(await apiClient.checkHealth());
    setIsCheckingHealth(false);
  };

  useEffect(() => {
    let alive = true;
    checkBackendHealth();
    if (apiClient.getToken()) {
      apiClient.me().then(user => {
        if (!alive) return;
        const parsed = fromApiUser(user);
        workspaceStorage.setCurrentUser(parsed);
        setCurrentUser(parsed);
        setIsAuthenticated(true);
      }).catch((err) => {
        // Only log out when the server says the session is invalid, not on network errors
        if (err?.status === 401) {
          apiClient.clearSession();
          if (alive) { setCurrentUser(guestUser); setIsAuthenticated(false); }
        }
      });
    }
    return () => { alive = false; };
  }, []);

  const acceptSession = (token: string, apiUser: ApiUser) => {
    const user = fromApiUser(apiUser);
    apiClient.setSession(token, apiUser);
    workspaceStorage.setCurrentUser(user);
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    const result = await apiClient.login(email, password);
    acceptSession(result.token, result.user);
    return true;
  };

  const register = async (name: string, email: string, password: string, workspaceId?: string): Promise<boolean> => {
    const result = await apiClient.register(name, email, password, workspaceId);
    acceptSession(result.token, result.user);
    return true;
  };

  const logout = async () => {
    try { if (apiClient.getToken()) await apiClient.logout(); } catch { /* clear local session even if API is offline */ }
    apiClient.clearSession();
    setCurrentUser(guestUser);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      currentRole: currentUser.role,
      isAuthenticated,
      backendHealth,
      isCheckingHealth,
      login,
      register,
      logout,
      checkBackendHealth
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
