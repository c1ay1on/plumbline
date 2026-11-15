import React, { useCallback, useEffect, useState } from 'react';
import { Share2, CheckCircle2, AlertCircle, ExternalLink, ShieldCheck, Link2, Unplug, RefreshCw, CircleHelp } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { apiClient, SocialConnection } from '../../services/api/client';
import { ChannelAvailabilityNotice } from '../../components/common/ChannelAvailabilityNotice';

type PlatformId = SocialConnection['platform'];
const PLATFORMS: { id: PlatformId; name: string; mark: string; description: string; limitation: string }[] = [
  { id: 'linkedin', name: 'LinkedIn', mark: 'in', description: 'Publish text posts to the authorized LinkedIn member profile.', limitation: 'LinkedIn comment sync/replies and organization-page publishing are not implemented in this build.' },
  { id: 'instagram', name: 'Instagram', mark: 'IG', description: 'Connect an Instagram Professional account through Meta.', limitation: 'Personal consumer accounts are not supported. The account must be Business or Creator and linked to a Facebook Page.' },
  { id: 'facebook', name: 'Facebook Pages', mark: 'f', description: 'Publish text and image posts to Pages and manage Page comments.', limitation: 'Publishing targets Pages, not personal Facebook profiles. The authorizing user must have Page access.' },
  { id: 'threads', name: 'Threads', mark: '@', description: 'Publish text posts from the authorized Threads account.', limitation: 'Threads comment sync and replies are not implemented in this build.' },
  { id: 'x', name: 'X', mark: '𝕏', description: 'Publish posts and read/reply to mentions.', limitation: 'Requires X developer API access and OAuth 2.0 user-context permissions. API pricing/limits may apply.' },
  { id: 'youtube', name: 'YouTube', mark: 'YT', description: 'Connect a channel and manage video comments.', limitation: 'The YouTube Data API supports video-comment sync/replies in this build, but not text-only Community posts. Video upload is also not yet wired into the composer.' }
];

export const ChannelsPage: React.FC = () => {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [items, config] = await Promise.all([apiClient.getSocialConnections(), apiClient.getSocialConfig()]);
      setConnections(items);
      setConfigured(config.platforms || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connected accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const oauthError = params.get('oauth_error');
    if (connected) setNotice(`${connected} authorization completed. Your available account(s) have been added.`);
    if (oauthError) setError(`${oauthError} authorization was cancelled or could not be completed.`);
    if (connected || oauthError) window.history.replaceState({}, '', '/app/channels');
  }, [refresh]);

  const connect = async (platform: PlatformId) => {
    setConnecting(platform);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.connectSocial(platform);
      window.location.assign(response.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start account authorization.');
      setConnecting(null);
    }
  };

  const disconnect = async (connection: SocialConnection) => {
    if (!window.confirm(`Disconnect ${connection.accountName} from ${connection.platform}?`)) return;
    setError('');
    try {
      await apiClient.disconnectSocial(connection.platform, connection.accountId);
      setConnections(current => current.filter(item => item.id !== connection.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect account.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-stone-200">
        <div><h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] flex items-center gap-2"><Share2 className="w-7 h-7 text-[#0A4A3D]" /> Connected social accounts</h1><p className="text-sm text-[#68756F] mt-1">Authorize the accounts you manage and publish through their official APIs.</p></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHelpOpen(true)} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-stone-200 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50" aria-haspopup="dialog">
            <CircleHelp className="w-3.5 h-3.5" /> How to connect
          </button>
          <button onClick={refresh} disabled={loading} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-stone-200 bg-white text-xs font-semibold text-stone-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh connections</button>
        </div>
      </div>

      <ChannelAvailabilityNotice />

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3 text-xs text-emerald-950">
        <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-emerald-800" />
        <div><strong>Sign in on the platform itself.</strong><p className="mt-1 leading-relaxed">Plumbline never asks for or stores your social-media password. Choose Connect, sign in on the official platform page, review the permissions, and approve access. The resulting authorization tokens are stored by the backend and are not exposed to the browser.</p></div>
      </div>

      {notice && <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">{notice}</div>}
      {error && <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      {loading ? <div className="py-16 text-center text-sm text-stone-500">Loading account connections…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {PLATFORMS.map(platform => {
            const items = connections.filter(connection => connection.platform === platform.id);
            const isConfigured = Boolean(configured[platform.id]);
            return <section key={platform.id} className="bg-white rounded-2xl p-5 border border-stone-200 shadow-plumb-subtle flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#0A4A3D] font-extrabold">{platform.mark}</div><div><h2 className="font-bold text-[#12201C]">{platform.name}</h2><p className="text-[11px] text-stone-500 mt-0.5">{items.length ? `${items.length} account${items.length > 1 ? 's' : ''} connected` : 'Not connected'}</p></div></div>
                {items.length ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1"><CheckCircle2 className="w-3 h-3" />Connected</span> : <span className="text-[10px] font-semibold text-stone-500 bg-stone-100 rounded-full px-2 py-1">Not connected</span>}
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">{platform.description}</p>
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-100 text-[11px] text-stone-600 leading-relaxed">{platform.limitation}</div>
              {items.length > 0 && <div className="space-y-2">
                {items.map(connection => <div key={connection.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-emerald-100 bg-emerald-50/40">
                  <div className="min-w-0"><div className="text-xs font-semibold text-[#12201C] truncate">{connection.accountName}</div><div className="text-[10px] text-stone-500 truncate">{connection.accountHandle || connection.accountId}</div></div>
                  <button onClick={() => disconnect(connection)} className="shrink-0 p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Disconnect account"><Unplug className="w-3.5 h-3.5" /></button>
                </div>)}
              </div>}
              <div className="mt-auto pt-2 border-t border-stone-100">
                <button onClick={() => connect(platform.id)} disabled={connecting !== null || !isConfigured} className="w-full py-2.5 px-3 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  {connecting === platform.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}{isConfigured ? `Connect ${platform.name}` : 'OAuth app not configured'}
                </button>
                {!isConfigured && <p className="mt-2 text-[10px] text-amber-700">Add the {platform.id === 'facebook' || platform.id === 'instagram' ? 'META' : platform.id === 'youtube' ? 'GOOGLE' : platform.id.toUpperCase()} OAuth settings to backend/.env.</p>}
              </div>
            </section>;
          })}
        </div>
      )}

      <div className="space-y-3">
        <div className="text-[11px] text-stone-500 flex items-start gap-2"><ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>Some platforms require your developer app to be reviewed, approved for the requested scopes, or placed in Live mode before accounts outside your test-user list can connect.</span></div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600 leading-relaxed">
          <strong className="text-[#12201C]">Need to connect an unsupported platform?</strong>{' '}
          Use the Plumbline browser extension if it is available for your workspace, or contact your administrator. Keep sign-in and 2-step verification on the platform itself; never share passwords or verification codes in this page or extension.
        </div>
      </div>

      <Modal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="How to connect a social account"
        subtitle="Sign in and approve access on the platform's official authorization page."
        maxWidth="lg"
      >
        <ol className="space-y-4 list-decimal pl-5">
          <li><strong>Choose a platform.</strong> Find its card on this page and select <strong>Connect</strong>. If the button says the OAuth app is not configured, ask your administrator to finish the platform setup.</li>
          <li><strong>Continue to the official platform.</strong> You will be redirected to that service to sign in and review the requested permissions. Plumbline does not ask for your platform password.</li>
          <li><strong>Complete verification there.</strong> If the platform asks for a 2-step verification code or other confirmation, enter it only on the platform's official page.</li>
          <li><strong>Approve and return.</strong> After approving access, you will return here and the connected account will appear on its platform card. Use the disconnect button on that card to remove access later.</li>
        </ol>
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2 text-xs text-emerald-950">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Plumbline stores the authorization provided by the platform on the backend. Never enter a social password, API secret, or verification code into this page.</p>
        </div>
        <p className="mt-4 text-xs text-stone-600 leading-relaxed">For a platform that is not listed, use the Plumbline browser extension if it is available for your workspace, or contact your administrator for supported options.</p>
      </Modal>
    </div>
  );
};
