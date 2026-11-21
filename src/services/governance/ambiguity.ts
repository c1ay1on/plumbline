import {
  AmbiguousRuleAlert,
  AuditFinding,
  BrandGuidelines,
  ClarificationSuggestion,
  Post
} from '../../types';
import { termLabel } from './versioning';

// Client copy of backend/app/services/ambiguity.py. The backend result is preferred;
// this runs when the API cannot be reached so the alerts still show from cached data.

export const AMBIGUITY_THRESHOLDS = {
  minDisputes: 3,
  minFlagsForRate: 3,
  disputeRate: 0.4
};

const DISPUTED_STATUSES: AuditFinding['status'][] = ['contested', 'rejected'];

export const BUILTIN_CHECKS: Record<string, { label: string; text: string; editorTab: AmbiguousRuleAlert['editorTab'] }> = {
  'check:unsupported_claim': {
    label: 'Unsupported claims check',
    text: 'Ranking, credential, guarantee or percentage claims must match an approved fact.',
    editorTab: 'facts'
  },
  'check:alt_text_missing': {
    label: 'Media alt text check',
    text: 'Every attached image or video needs an accessibility description.',
    editorTab: 'voice'
  },
  'check:tone_mismatch': {
    label: 'Voice and tone rules',
    text: 'Posts should match the workspace voice and the platform tone rules.',
    editorTab: 'voice'
  },
  'check:visual_palette': {
    label: 'Brand palette check',
    text: "Most of a creative's colour should come from the brand palette (white, black and greys allowed).",
    editorTab: 'colors'
  },
  'check:visual_contrast': {
    label: 'WCAG contrast check',
    text: 'Text on a creative needs 4.5:1 contrast, or 3:1 for large text (WCAG 2.1 AA).',
    editorTab: 'colors'
  },
  'check:visual_logo': {
    label: 'Logo usage check',
    text: 'Use an approved logo variant, scaled proportionally and not recoloured or distorted.',
    editorTab: 'assets'
  }
};

const VAGUE_WORDS: Record<string, string> = {
  appropriate: 'name the exact cases where it is allowed',
  inappropriate: 'list what counts as inappropriate',
  avoid: 'say "do not use" and list any allowed exceptions',
  sometimes: 'state when exactly',
  generally: 'state the rule and its exceptions',
  usually: 'state the rule and its exceptions',
  'where possible': 'say when it is not possible',
  'when necessary': 'say who decides it is necessary',
  reasonable: 'give a measurable limit',
  excessive: 'give a measurable limit',
  too: 'give a measurable limit',
  overly: 'give a measurable limit',
  may: 'use "must" or "must not"',
  might: 'use "must" or "must not"',
  should: 'use "must" if it is a hard rule',
  informal: 'give an example of informal wording',
  some: 'list which ones',
  often: 'state when exactly'
};

const WORD_REPLACEMENTS: [string, string][] = [
  ['avoid using', 'do not use'],
  ['avoid', 'do not use'],
  ['where possible', ''],
  ['when possible', ''],
  ['generally', ''],
  ['usually', ''],
  ['sometimes', '']
];

const EXCEPTION_HINTS: [RegExp, string][] = [
  [/quot/, 'direct quotations from named people'],
  [/\bname|brand|product|title|proper/, 'official names, product names and titles'],
  [/event|campaign|partner|sponsor/, 'partner, sponsor or event names we do not control'],
  [/hashtag|handle|@/, 'hashtags and account handles'],
  [/casual|informal|tone|audience|student|community|slang/, 'informal community channels where the audience uses the term themselves'],
  [/legal|regulat|complian|statut/, 'wording required by legal or regulatory text'],
  [/source|cite|citation|verified|official|report/, 'claims that cite a named, dated official source in the post'],
  [/context|meaning|different sense|not referring/, 'uses of the word with a different meaning than the rule targets']
];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findVagueTerms(text: string): string[] {
  const lowered = (text || '').toLocaleLowerCase();
  return Object.keys(VAGUE_WORDS).filter(word => new RegExp(`\\b${escapeRegex(word)}\\b`).test(lowered));
}

type RuleInfo = Omit<AmbiguousRuleAlert, 'flagCount' | 'disputeCount' | 'disputeRate' | 'topReasons' | 'status' | 'reopened'>;

export function ruleCatalogue(guidelines: BrandGuidelines): Map<string, RuleInfo> {
  const catalogue = new Map<string, RuleInfo>();
  guidelines.terminology.forEach(rule => {
    catalogue.set(rule.id, {
      ruleId: rule.id, kind: 'terminology', editorTab: 'terminology', label: termLabel(rule),
      text: rule.explanation || '', context: rule.context || '', bannedTerm: rule.bannedTerm, preferredTerm: rule.preferredTerm
    });
  });
  Object.entries(BUILTIN_CHECKS).forEach(([ruleId, check]) => {
    catalogue.set(ruleId, { ruleId, kind: 'check', context: '', bannedTerm: '', preferredTerm: '', ...check });
  });
  return catalogue;
}

/** Which rule raised a finding. Older findings have no ruleId, so terminology ones are matched by term. */
export function resolveRuleId(finding: AuditFinding, guidelines: BrandGuidelines): string {
  if (finding.ruleId) return finding.ruleId;
  if (finding.category === 'terminology') {
    const affected = finding.affectedContent.toLocaleLowerCase();
    const title = finding.issueTitle.toLocaleLowerCase();
    const rule = guidelines.terminology.find(item => {
      const banned = item.bannedTerm.trim().toLocaleLowerCase();
      return banned && (affected.includes(banned) || title.includes(banned));
    });
    if (rule) return rule.id;
  }
  return `check:${finding.category}`;
}

export function ruleLabelFor(ruleId: string, guidelines: BrandGuidelines): string {
  return ruleCatalogue(guidelines).get(ruleId)?.label || ruleId;
}

export interface LocalAlertState {
  status: 'open' | 'dismissed' | 'resolved';
  closedAt?: string;
  resolvedVersion?: string;
  suggestion?: ClarificationSuggestion | null;
}

export function isAmbiguous(flagCount: number, disputeCount: number, limits = AMBIGUITY_THRESHOLDS): boolean {
  if (disputeCount >= limits.minDisputes) return true;
  if (flagCount >= limits.minFlagsForRate && disputeCount > 0) return disputeCount / flagCount >= limits.disputeRate;
  return false;
}

function topReasons(reasons: string[]): { reason: string; count: number }[] {
  const counts = new Map<string, { reason: string; count: number }>();
  reasons.forEach(raw => {
    const reason = raw.split(/\s+/).join(' ').trim();
    if (!reason) return;
    const key = reason.toLocaleLowerCase().replace(/\.$/, '');
    const entry = counts.get(key) || { reason, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 3);
}

export function detectAmbiguousRules(
  posts: Post[],
  guidelines: BrandGuidelines,
  states: Record<string, LocalAlertState> = {},
  includeClosed = false
): AmbiguousRuleAlert[] {
  const activity = new Map<string, { flags: string[]; disputes: Map<string, { reason: string; at: string }>; label: string }>();
  const seen = new Set<string>();
  posts.forEach(post => {
    const flaggedAt = post.checkedAt || post.createdAt;
    const findings = [...post.findings, ...(post.auditHistory || []).flatMap(item => item.findings)];
    findings.forEach(finding => {
      if (seen.has(finding.id)) return;
      seen.add(finding.id);
      const ruleId = resolveRuleId(finding, guidelines);
      const entry = activity.get(ruleId) || { flags: [], disputes: new Map(), label: finding.ruleLabel || '' };
      entry.flags.push(flaggedAt);
      if (DISPUTED_STATUSES.includes(finding.status)) {
        entry.disputes.set(finding.id, { reason: finding.contestedReason || '', at: finding.disputedAt || post.updatedAt });
      }
      activity.set(ruleId, entry);
    });
  });

  const catalogue = ruleCatalogue(guidelines);
  const alerts: AmbiguousRuleAlert[] = [];
  activity.forEach((entry, ruleId) => {
    const state = states[ruleId];
    const closedAt = state && state.status !== 'open' ? state.closedAt : undefined;
    let flags = entry.flags;
    let disputes = Array.from(entry.disputes.values());
    if (closedAt) {
      flags = flags.filter(at => at > closedAt);
      disputes = disputes.filter(item => item.at > closedAt);
    }
    const flagCount = Math.max(flags.length, disputes.length);
    const ambiguous = isAmbiguous(flagCount, disputes.length);
    if (!ambiguous && (!closedAt || !includeClosed)) return;
    const rule: RuleInfo = catalogue.get(ruleId) || {
      ruleId, kind: ruleId.startsWith('check:') ? 'check' : 'terminology', label: entry.label || ruleId, text: '', context: '',
      editorTab: 'terminology', bannedTerm: '', preferredTerm: '', removed: true
    };
    const reasons = topReasons(disputes.map(item => item.reason));
    const alert: AmbiguousRuleAlert = {
      ...rule,
      flagCount,
      disputeCount: disputes.length,
      disputeRate: flagCount ? disputes.length / flagCount : 0,
      topReasons: reasons,
      status: ambiguous ? 'open' : state!.status,
      reopened: Boolean(closedAt && ambiguous),
      closedAt: state?.closedAt || null,
      resolvedVersion: state?.resolvedVersion || null,
      suggestion: state?.suggestion || null
    };
    if (!alert.suggestion && alert.status === 'open') {
      alert.suggestion = buildFallbackSuggestion(alert, reasons.map(item => item.reason), alert.disputeCount, alert.flagCount);
    }
    alerts.push(alert);
  });
  return alerts.sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || b.disputeCount - a.disputeCount || b.disputeRate - a.disputeRate);
}

function tighten(text: string): string {
  let result = text || '';
  WORD_REPLACEMENTS.forEach(([word, replacement]) => {
    result = result.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), replacement);
  });
  return result.split(/\s+/).join(' ').trim();
}

export function buildFallbackSuggestion(
  rule: Pick<AmbiguousRuleAlert, 'kind' | 'label' | 'text' | 'context' | 'bannedTerm' | 'preferredTerm'>,
  reasons: string[],
  disputeCount = 0,
  flagCount = 0
): ClarificationSuggestion {
  const vague = findVagueTerms(rule.text);
  const joined = reasons.join(' ').toLocaleLowerCase();
  const exceptions = EXCEPTION_HINTS.filter(([pattern]) => pattern.test(joined)).map(([, hint]) => hint);
  const notes: string[] = [];
  if (disputeCount) notes.push(`Disputed ${disputeCount} time${disputeCount === 1 ? '' : 's'} out of ${flagCount} flag${flagCount === 1 ? '' : 's'}.`);
  vague.forEach(word => notes.push(`"${word}" is vague: ${VAGUE_WORDS[word]}.`));
  notes.push(exceptions.length
    ? `Dispute reasons point to cases the rule does not mention: ${exceptions.join('; ')}.`
    : 'Add at least one allowed and one not-allowed example so reviewers apply it the same way.');

  const exceptionText = exceptions.length ? exceptions.join('; ') : 'none';
  const parts: string[] = [];
  if (rule.kind === 'terminology' && rule.bannedTerm) {
    const preferred = rule.preferredTerm || 'the approved term';
    const scope = rule.context ? ` in ${rule.context} content` : '';
    parts.push(`Use "${preferred}" instead of "${rule.bannedTerm}"${scope} on every platform.`);
    const tightened = tighten(rule.text);
    if (tightened) parts.push(`Reason: ${tightened.replace(/\.$/, '')}.`);
    parts.push(`Allowed exceptions: ${exceptionText}.`);
    parts.push(`Example: "... our ${preferred} ..." passes; "... our ${rule.bannedTerm} ..." is flagged.`);
  } else {
    parts.push(tighten(rule.text) || `${rule.label} applies to every post.`);
    parts.push(`Allowed exceptions: ${exceptionText}.`);
    parts.push('Add one example that passes and one that is flagged.');
  }
  return {
    source: 'rules',
    summary: `${rule.label} is disputed often. Make the wording explicit and list its exceptions.`,
    proposedText: parts.join(' '),
    notes,
    vagueTerms: vague
  };
}
