import React, { useMemo, useState } from 'react';
import { Users, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import type { TeamMember } from '../../types';

const ROLE_OPTIONS: TeamMember['role'][] = ['admin', 'manager', 'approver', 'employee'];

/**
 * Team management: assign each member to a team (department) and, for the
 * owner/admin, change their role. Teams power "Error rate by team".
 */
export const TeamManagementPanel: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { currentRole } = useAuth();
  const { teamMembers, updateTeamMember } = useWorkspace();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');

  const canManage = currentRole === 'owner' || currentRole === 'admin' || currentRole === 'manager';
  const canChangeRoles = currentRole === 'owner' || currentRole === 'admin';
  const knownTeams = useMemo(
    () => Array.from(new Set(teamMembers.map(m => (m.department || '').trim()).filter(Boolean))).sort(),
    [teamMembers]
  );

  const save = async (member: TeamMember, changes: { department?: string; role?: TeamMember['role'] }) => {
    setSaving(member.id); setError('');
    try {
      await updateTeamMember(member.id, changes);
      setSaved(member.id);
      setTimeout(() => setSaved(current => (current === member.id ? null : current)), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this member.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-plumb-subtle">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
          <Users className="w-5 h-5 text-[#0A4A3D]" /> Team management
        </h2>
        <span className="text-[10px] text-stone-500">{teamMembers.length} member{teamMembers.length === 1 ? '' : 's'}</span>
      </div>
      <p className="text-xs text-[#68756F] mb-4">
        Assign people to teams so error rates can be compared. To add someone, share the Workspace ID from Profile.
      </p>
      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {teamMembers.length === 0 && <p className="text-xs text-stone-500 py-3">No other users have joined this workspace yet.</p>}

      <datalist id="plumbline-teams">{knownTeams.map(t => <option key={t} value={t} />)}</datalist>
      <div className="divide-y divide-stone-100">
        {teamMembers.slice(0, compact ? 6 : undefined).map(member => {
          const value = drafts[member.id] ?? member.department ?? '';
          const dirty = value.trim() !== (member.department || '').trim();
          return (
            <div key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#12201C] truncate">{member.name}</div>
                <div className="text-[11px] text-[#68756F] truncate">{member.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  list="plumbline-teams"
                  value={value}
                  disabled={!canManage}
                  placeholder="Unassigned"
                  aria-label={`Team for ${member.name}`}
                  onChange={e => setDrafts(d => ({ ...d, [member.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && dirty) void save(member, { department: value }); }}
                  className="w-36 px-2.5 py-1.5 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]/30 disabled:bg-stone-50"
                />
                {canManage && dirty && (
                  <button onClick={() => save(member, { department: value })}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0A4A3D] text-white text-[11px] font-semibold">Save</button>
                )}
                <select
                  value={member.role}
                  disabled={!canChangeRoles || member.role === 'owner'}
                  aria-label={`Role for ${member.name}`}
                  onChange={e => save(member, { role: e.target.value as TeamMember['role'] })}
                  className="px-2 py-1.5 text-xs rounded-lg border border-stone-200 capitalize disabled:bg-stone-50"
                >
                  {member.role === 'owner' && <option value="owner">owner</option>}
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="w-4">
                  {saving === member.id && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
                  {saved === member.id && <Check className="w-4 h-4 text-emerald-600" />}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
