import { AmbiguousRuleAlert, BrandGuidelines, ClarificationSuggestion, Post } from '../../types';
import { apiClient } from '../api/client';
import { buildFallbackSuggestion, detectAmbiguousRules, LocalAlertState } from './ambiguity';

// Alert actions go to the backend. A copy of each alert's state is kept in localStorage
// so the alert list still behaves the same when the API cannot be reached.

const STATE_KEY = 'plumbline_rule_alerts';

function stateKey(): string {
  return `${STATE_KEY}:${localStorage.getItem('plumbline_active_user_id') || 'anonymous'}`;
}

function readStates(): Record<string, LocalAlertState> {
  try { return JSON.parse(localStorage.getItem(stateKey()) || '{}'); } catch { return {}; }
}

function writeState(ruleId: string, patch: Partial<LocalAlertState>): void {
  const states = readStates();
  states[ruleId] = { status: 'open', ...states[ruleId], ...patch };
  localStorage.setItem(stateKey(), JSON.stringify(states));
}

export interface AlertLoadResult {
  alerts: AmbiguousRuleAlert[];
  fromServer: boolean;
}

export const governanceService = {
  async loadAlerts(posts: Post[], guidelines: BrandGuidelines, includeClosed = false): Promise<AlertLoadResult> {
    try {
      const result = await apiClient.getRuleAlerts(includeClosed);
      return { alerts: result.alerts, fromServer: true };
    } catch {
      return { alerts: detectAmbiguousRules(posts, guidelines, readStates(), includeClosed), fromServer: false };
    }
  },

  async recordDispute(post: Post, findingId: string, ruleId: string, ruleLabel: string, reason: string): Promise<void> {
    try {
      await apiClient.recordDispute({
        rule_id: ruleId, rule_label: ruleLabel, post_id: post.id, finding_id: findingId,
        reason, guideline_version: post.guidelineVersion || ''
      });
    } catch {
      // The dispute is already saved on the finding itself and is counted from there when the API is back.
    }
  },

  async suggest(alert: AmbiguousRuleAlert): Promise<ClarificationSuggestion> {
    try {
      const result = await apiClient.suggestRuleClarification(alert.ruleId);
      if (result.suggestion) {
        writeState(alert.ruleId, { suggestion: result.suggestion });
        return result.suggestion;
      }
    } catch {
      // Fall through to the local suggestion.
    }
    const suggestion = buildFallbackSuggestion(alert, alert.topReasons.map(item => item.reason), alert.disputeCount, alert.flagCount);
    writeState(alert.ruleId, { suggestion });
    return suggestion;
  },

  async dismiss(ruleId: string, note = ''): Promise<void> {
    writeState(ruleId, { status: 'dismissed', closedAt: new Date().toISOString() });
    try { await apiClient.dismissRuleAlert(ruleId, note); } catch { /* local state already updated */ }
  },

  async resolve(ruleId: string, version: string, note = ''): Promise<void> {
    writeState(ruleId, { status: 'resolved', closedAt: new Date().toISOString(), resolvedVersion: version });
    try { await apiClient.resolveRuleAlert(ruleId, version, note); } catch { /* local state already updated */ }
  }
};
