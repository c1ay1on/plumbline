import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { PlusSquare, CheckSquare, MessageSquare, TrendingUp, Share2, BookOpen, User, Menu, X, Server, LogOut, Sparkles, Building2, BarChart3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { groqService } from '../../services/ai/groqService';
import { GroqSettingsModal } from './GroqSettingsModal';
import { WatchDemoButton } from '../demo/WatchDemoButton';

export const Header: React.FC = () => {
  const { currentUser, currentRole, backendHealth, logout } = useAuth();
  const { workspace, guidelines, posts, comments } = useWorkspace();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [groqModalOpen, setGroqModalOpen] = useState(false);
  const [groqConfig, setGroqConfig] = useState(() => groqService.getConfig());
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { groqService.getConfigAsync().then(setGroqConfig).catch(() => undefined); }, []);

  const pendingApprovalsCount = posts.filter(post => post.status === 'in_review').length;
  const needsReplyCommentsCount = comments.filter(comment => comment.status === 'needs_reply').length;
  const navItems = [
    { name: 'Home', path: '/app/home', icon: Building2 },
    { name: 'Create post', path: '/app/create', icon: PlusSquare },
    { name: currentRole === 'employee' ? 'My Submissions' : 'Review & Approvals', path: '/app/review', icon: CheckSquare, badge: pendingApprovalsCount || undefined },
    { name: 'Comments', path: '/app/comments', icon: MessageSquare, badge: needsReplyCommentsCount || undefined },
    { name: 'Insights', path: '/app/insights', icon: BarChart3 },
    { name: 'Growth', path: '/app/growth', icon: TrendingUp },
    { name: 'Channels', path: '/app/channels', icon: Share2 },
    { name: 'Brand Knowledge', path: '/app/brand-knowledge', icon: BookOpen },
    { name: 'Profile', path: '/app/profile', icon: User }
  ];
  const initials = currentUser.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-stone-200 shadow-sm">
      <div className="bg-[#12201C] text-stone-300 text-[11px] px-4 py-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1.5 font-medium text-white truncate"><span className="w-1.5 h-1.5 rounded-full bg-[#167A58]" />{workspace.organization || 'Workspace'} · {workspace.name || 'My Workspace'}</span>
          <span className="hidden sm:inline text-stone-500">|</span>
          <span className="hidden sm:inline text-stone-400">Brand guidelines: <strong className="text-emerald-400 font-medium">{guidelines.version || 'Not configured'}</strong></span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <WatchDemoButton />
          <button onClick={() => setGroqModalOpen(true)} className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-semibold ${groqConfig.isActive ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-stone-800 text-stone-300 border border-stone-700'}`} title="Check Groq configuration">
            <Sparkles className="w-3 h-3" /><span>{groqConfig.isActive ? `AI: ${groqConfig.model}` : 'AI not configured'}</span>
          </button>
          <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${backendHealth.online ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-800'}`}>
            <Server className="w-3 h-3" />{backendHealth.online ? 'API online' : 'API offline'}
          </span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <NavLink to="/app/home" className="flex items-center gap-2.5">
              <img src="/logo.png" alt="C:/Users/ADMIN/Downloads/WhatsApp .png" className="w-8 h-8 object-contain" />
              <div className="flex flex-col"><span className="text-xl font-bold text-[#12201C] leading-none">Plumbline</span><span className="text-[10px] text-[#68756F] font-medium">Brand Governance</span></div>
            </NavLink>
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(item.path);
                return <NavLink key={item.path} to={item.path} className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${isActive ? 'bg-[#0A4A3D] text-white' : 'text-[#68756F] hover:text-[#12201C] hover:bg-stone-100'}`}>
                  <Icon className="w-4 h-4" /><span>{item.name}</span>{item.badge !== undefined && <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${isActive ? 'bg-amber-400 text-[#12201C]' : 'bg-amber-100 text-amber-800'}`}>{item.badge}</span>}
                </NavLink>;
              })}
            </nav>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#0A4A3D] flex items-center justify-center text-xs font-bold">{initials}</div>
            <div className="max-w-40"><div className="text-xs font-semibold text-[#12201C] truncate">{currentUser.name}</div><div className="text-[10px] text-[#68756F] capitalize">{currentRole}</div></div>
            <button onClick={handleLogout} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
          </div>

          <div className="flex lg:hidden items-center gap-2">
            <span className="text-xs text-stone-600">{currentUser.name}</span>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 rounded-lg text-stone-600 hover:bg-stone-100">{mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && <div className="lg:hidden border-t border-stone-200 bg-white px-4 pt-3 pb-6 space-y-2">
        {navItems.map(item => { const Icon = item.icon; const isActive = location.pathname.startsWith(item.path); return <NavLink key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)} className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium ${isActive ? 'bg-[#0A4A3D] text-white' : 'text-[#68756F] hover:bg-stone-100'}`}><span className="flex items-center gap-3"><Icon className="w-5 h-5" />{item.name}</span>{item.badge ? <span className="px-2 py-0.5 text-xs rounded-full bg-amber-400 text-[#12201C]">{item.badge}</span> : null}</NavLink>; })}
        <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 border-t border-stone-200"><LogOut className="w-4 h-4" /> Sign out</button>
      </div>}

      <GroqSettingsModal isOpen={groqModalOpen} onClose={() => setGroqModalOpen(false)} onSaved={() => groqService.getConfigAsync().then(setGroqConfig).catch(() => undefined)} />
    </header>
  );
};
