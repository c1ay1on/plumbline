import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Sparkles, X, ShieldQuestion } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { AmbiguousRuleAlert } from '../../types';
import { governanceService } from '../../services/governance/governanceService';
import { AMBIGUITY_THRESHOLDS } from '../../services/governance/ambiguity';
import { Badge } from '../common/Badge';

interface AmbiguousRuleAlertsProps {
  compact?: boolean;
  // Lets the guideline editor open a rule in place instead of navigating.
  onOpenRule?: (alert: AmbiguousRuleAlert) => void;
  refreshKey?: number;
}

export function useRuleAlerts(refreshKey = 0) {
  const { posts, guidelines } = useWorkspace();
  const [alerts, setAlerts] = useState<AmbiguousRuleAlert[]>([]);
  const [fromServer, setFromServer] = useState(true);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const result = await governanceService.loadAlerts(posts, guidelines);
    setAlerts(result.alerts.filter(alert => alert.status === 'open'));
    setFromServer(result.fromServer);
    setLoading(false);
  }, [posts, guidelines]);

  useEffect(() => {
    // Short delay so a change that was just made has been saved to the shared workspace first.
    const timer = window.setTimeout(() => { void reload(); }, 400);
    return () => window.clearTimeout(timer);
  }, [reload, refreshKey]);

  return { alerts, setAlerts, fromServer, loading, reload };
}

export const AmbiguousRuleAlerts: React.FC<AmbiguousRuleAlertsProps> = ({ compact = false, onOpenRule, refreshKey = 0 }) => {
  const navigate = useNavigate();
  const { alerts, setAlerts, fromServer, loading } = useRuleAlerts(refreshKey);
  const [busyRule, setBusyRule] = useState<string | null>(null);

  if (compact && alerts.length === 0) return null;

  const openRule = (alert: AmbiguousRuleAlert) => {
    if (onOpenRule) onOpenRule(alert);
    else navigate(`/app/brand-knowledge?rule=${encodeURIComponent(alert.ruleId)}`);
  };

  const regenerate = async (alert: AmbiguousRuleAlert) => {
    setBusyRule(alert.ruleId);
    const suggestion = await governanceService.suggest(alert);
    setAlerts(current => current.map(item => item.ruleId === alert.ruleId ? { ...item, suggestion } : item));
    setBusyRule(null);
  };

  const dismiss = async (alert: AmbiguousRuleAlert) => {
    if (!confirm(`Dismiss the ambiguity alert for ${alert.label}? It will come back only if new disputes cross the threshold.`)) return;
    await governanceService.dismiss(alert.ruleId);
    setAlerts(current => current.filter(item => item.ruleId !== alert.ruleId));
  };

  const resolve = async (alert: AmbiguousRuleAlert) => {
    await governanceService.resolve(alert.ruleId, '');
    setAlerts(current => current.filter(item => item.ruleId !== alert.ruleId));
  };

  return (
    <div className={`bg-white rounded-2xl border shadow-plumb-subtle space-y-4 ${compact ? 'p-5 border-amber-300' : 'p-6 border-stone-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#12201C] flex items-center gap-2">
            <ShieldQuestion className="w-5 h-5 text-[#B45309]" />
            Ambiguous rule alerts
            {alerts.length > 0 && <Badge variant="warning" size="sm">{alerts.length}</Badge>}
          </h2>
          <p className="text-xs text-[#68756F]">
            Rules people keep disputing: {AMBIGUITY_THRESHOLDS.minDisputes}+ disputes, or {Math.round(AMBIGUITY_THRESHOLDS.disputeRate * 100)}%+ of at least {AMBIGUITY_THRESHOLDS.minFlagsForRate} flags.
          </p>
        </div>
        {!fromServer && (
          <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-0.5 rounded border border-stone-200 whitespace-nowrap">Offline view</span>
        )}
      </div>

      {loading && alerts.length === 0 && <p className="text-xs text-stone-400">Checking rules...</p>}
      {!loading && alerts.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-xs text-stone-600">
          No ambiguous rules right now. When reviewers dispute the same rule's flags repeatedly, it shows up here with a suggested clarification.
        </div>
      )}

      <div className="space-y-3">
        {alerts.map(alert => (
          <div key={alert.ruleId} className="p-4 rounded-xl border border-amber-300 bg-amber-50/40 text-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B45309]" />
                <span className="font-bold text-[#12201C]">{alert.label}</span>
                {alert.reopened && <Badge variant="danger" size="sm">reopened</Badge>}
                {alert.removed && <Badge variant="neutral" size="sm">rule removed</Badge>}
              </div>
              <span className="text-[11px] text-[#68756F]">
                Disputed <strong className="text-[#B45309]">{alert.disputeCount}</strong> of {alert.flagCount} flags ({Math.round(alert.disputeRate * 100)}%)
              </span>
            </div>

            {alert.text && <p className="text-[11px] text-stone-600">Current rule: "{alert.text}"</p>}

            {alert.topReasons.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#68756F] mb-1">Top dispute reasons</div>
                <ul className="space-y-0.5">
                  {alert.topReasons.map(item => (
                    <li key={item.reason} className="text-[11px] text-stone-700">"{item.reason}" <span className="text-stone-400">x{item.count}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {alert.suggestion && !compact && (
              <div className="p-3 rounded-xl bg-white border border-emerald-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#167A58]">Suggested clarification</span>
                  <span className="text-[10px] text-stone-500">{alert.suggestion.source === 'groq' ? 'Groq AI' : 'Rule-based'}</span>
                </div>
                <p className="text-[#12201C]">{alert.suggestion.proposedText}</p>
                {alert.suggestion.notes.length > 0 && (
                  <ul className="list-disc pl-4 text-[11px] text-stone-600 space-y-0.5">
                    {alert.suggestion.notes.map(note => <li key={note}>{note}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {!compact && (
                <button
                  onClick={() => regenerate(alert)}
                  disabled={busyRule === alert.ruleId}
                  className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-medium text-stone-600 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  {busyRule === alert.ruleId ? 'Generating...' : 'Regenerate suggestion'}
                </button>
              )}
              <button
                onClick={() => dismiss(alert)}
                className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-medium text-stone-600 flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Dismiss alert
              </button>
              {alert.kind === 'check' && (
                <button
                  onClick={() => resolve(alert)}
                  className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-[11px] font-medium text-stone-600"
                >
                  Mark resolved
                </button>
              )}
              <button
                onClick={() => openRule(alert)}
                className="px-3 py-1 rounded-lg bg-[#0A4A3D] text-white hover:bg-[#063028] text-[11px] font-semibold flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                Open rule in editor
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
