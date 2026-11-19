import {
  BrandGuidelines,
  ChangeImpact,
  GuidelineRulesSnapshot,
  ImpactedReview,
  Post,
  RuleChange,
  TerminologyRule
} from '../../types';

// Mirrors backend/app/services/versioning.py so the editor can show impact without a round trip.

export const PENDING_STATUSES: Post['status'][] = ['draft', 'in_review', 'changes_requested'];

const TERM_FIELDS = ['context', 'preferredTerm', 'bannedTerm', 'explanation', 'platforms'] as const;
const FACT_FIELDS = ['fact', 'source', 'category', 'approvalStatus'] as const;
const VOICE_FIELDS = ['tones', 'customToneDescription', 'platformRules'] as const;

export function versionNumber(version: string | number | undefined | null): number {
  if (typeof version === 'number') return version;
  const match = String(version || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

export function snapshotRules(guidelines: BrandGuidelines): GuidelineRulesSnapshot {
  return {
    terminology: guidelines.terminology.map(rule => ({ ...rule, platforms: [...rule.platforms] as TerminologyRule['platforms'] })),
    facts: guidelines.facts.map(({ id, fact, source, category, approvalStatus }) => ({ id, fact, source, category, approvalStatus })),
    voice: {
      tones: [...guidelines.voice.tones],
      customToneDescription: guidelines.voice.customToneDescription,
      platformRules: { ...guidelines.voice.platformRules }
    }
  };
}

export function termLabel(rule: Pick<TerminologyRule, 'bannedTerm' | 'preferredTerm'>): string {
  return rule.preferredTerm ? `"${rule.bannedTerm}" -> "${rule.preferredTerm}"` : `"${rule.bannedTerm}"`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffById<T extends { id: string }>(
  kind: RuleChange['kind'],
  before: T[],
  after: T[],
  fields: readonly string[],
  label: (item: T) => string
): RuleChange[] {
  const changes: RuleChange[] = [];
  const oldById = new Map(before.map(item => [item.id, item]));
  const newById = new Map(after.map(item => [item.id, item]));
  newById.forEach((item, id) => {
    const previous = oldById.get(id);
    if (!previous) {
      changes.push({ ruleId: id, kind, label: label(item), changeType: 'added', fields: [], before: null, after: { ...item } });
      return;
    }
    const changed = fields.filter(field => !same((previous as any)[field], (item as any)[field]));
    if (changed.length) {
      changes.push({ ruleId: id, kind, label: label(item), changeType: 'modified', fields: changed, before: { ...previous }, after: { ...item } });
    }
  });
  oldById.forEach((item, id) => {
    if (!newById.has(id)) changes.push({ ruleId: id, kind, label: label(item), changeType: 'removed', fields: [], before: { ...item }, after: null });
  });
  return changes;
}

export function diffRules(previous: GuidelineRulesSnapshot | undefined, current: GuidelineRulesSnapshot): RuleChange[] {
  const base: GuidelineRulesSnapshot = previous || { terminology: [], facts: [], voice: { tones: [], customToneDescription: '', platformRules: {} as any } };
  const changes = [
    ...diffById<TerminologyRule>('terminology', base.terminology, current.terminology, TERM_FIELDS, termLabel),
    ...diffById('fact', base.facts, current.facts, FACT_FIELDS, fact => fact.fact.slice(0, 80))
  ];
  const voiceFields = VOICE_FIELDS.filter(field => !same(base.voice?.[field], current.voice?.[field]));
  if (voiceFields.length) {
    changes.push({
      ruleId: 'voice', kind: 'voice', label: 'Voice and tone', changeType: 'modified', fields: [...voiceFields],
      before: { ...base.voice }, after: { ...current.voice }
    });
  }
  return changes;
}

export function postText(post: Post): string {
  const parts = [post.title, post.originalDescription, ...Object.values(post.platformVariants || {}).map(variant => variant?.description || '')];
  return parts.join('\n').toLocaleLowerCase();
}

export function checkedVersion(post: Post): string {
  return post.guidelineVersion || post.findings.find(finding => finding.guidelineVersion)?.guidelineVersion || 'v1';
}

function findingMatchesTerm(finding: Post['findings'][number], rule: Record<string, unknown> | null): boolean {
  if (!rule) return false;
  if (finding.ruleId === rule.id) return true;
  const banned = String(rule.bannedTerm || '').trim().toLocaleLowerCase();
  return Boolean(banned) && !finding.ruleId && finding.category === 'terminology'
    && finding.affectedContent.toLocaleLowerCase().includes(banned);
}

export function changeReasons(post: Post, change: RuleChange): string[] {
  const reasons: string[] = [];
  if (change.kind === 'terminology') {
    if ((change.changeType === 'modified' || change.changeType === 'removed') && post.findings.some(finding => findingMatchesTerm(finding, change.before))) {
      reasons.push(`was flagged by ${change.label}, which was ${change.changeType}`);
    }
    const banned = String(change.after?.bannedTerm || '').trim().toLocaleLowerCase();
    if ((change.changeType === 'added' || change.changeType === 'modified') && banned && postText(post).includes(banned) && reasons.length === 0) {
      reasons.push(`contains "${change.after?.bannedTerm}" which the ${change.changeType} rule now covers`);
    }
  } else if (change.kind === 'fact') {
    if (post.findings.some(finding => finding.category === 'unsupported_claim' || finding.ruleId === 'check:unsupported_claim')) {
      reasons.push('has a claim finding and an approved fact changed');
    }
  } else if (change.kind === 'voice') {
    if (post.findings.some(finding => finding.category === 'tone_mismatch')) {
      reasons.push('has a tone finding and the voice rules changed');
    }
  }
  return reasons;
}

/** Pending posts checked under an older version that these changes touch. Approved and published posts are never included. */
export function computeImpact(posts: Post[], changes: RuleChange[], newVersion: string): ChangeImpact {
  const target = versionNumber(newVersion);
  const affected: ImpactedReview[] = [];
  let lockedHistoryCount = 0;
  posts.forEach(post => {
    if (versionNumber(checkedVersion(post)) >= target) return;
    const reasons = changes.flatMap(change => changeReasons(post, change));
    if (!reasons.length) return;
    if (!PENDING_STATUSES.includes(post.status)) { lockedHistoryCount += 1; return; }
    affected.push({ postId: post.id, title: post.title || 'Untitled', status: post.status, checkedVersion: checkedVersion(post), reasons });
  });
  const byVersion = new Map<string, number>();
  affected.forEach(item => byVersion.set(item.checkedVersion, (byVersion.get(item.checkedVersion) || 0) + 1));
  const parts = Array.from(byVersion.entries())
    .sort((a, b) => versionNumber(a[0]) - versionNumber(b[0]))
    .map(([version, count]) => `${count} pending review${count === 1 ? '' : 's'} checked under ${version}`);
  return {
    version: `v${target}`,
    affected,
    affectedCount: affected.length,
    lockedHistoryCount,
    summary: affected.length ? `${parts.join(', ')} affected by this change.` : 'No pending reviews are affected by this change.'
  };
}

/** Pending posts checked under any version older than the current one, used for the "outdated check" view. */
export function isOutdatedCheck(post: Post, currentVersion: string): boolean {
  return PENDING_STATUSES.includes(post.status) && versionNumber(checkedVersion(post)) < versionNumber(currentVersion);
}
