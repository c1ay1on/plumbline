import {
  AuditFinding,
  BrandRiskScore,
  BrandGuidelines,
  Platform,
  PostPlatformVariant
} from '../types';
import { termLabel } from './governance/versioning';

export interface AuditResult {
  findings: AuditFinding[];
  score: BrandRiskScore;
}

export class AIAuditEngine {
  /** Performs deterministic checks only against rules configured by the workspace owner. */
  static auditContent(
    text: string,
    platforms: Platform[],
    guidelines: BrandGuidelines,
    hasMedia = false,
    mediaAltText?: string
  ): AuditResult {
    const findings: AuditFinding[] = [];
    const normalized = text.toLocaleLowerCase();
    const id = () => `audit-${crypto.randomUUID()}`;

    guidelines.terminology.forEach(rule => {
      const applies = (rule.platforms as string[]).includes('all') || rule.platforms.some(platform => platforms.includes(platform as Platform));
      if (!applies || !rule.bannedTerm.trim()) return;
      const match = normalized.indexOf(rule.bannedTerm.trim().toLocaleLowerCase());
      if (match < 0) return;
      const affected = text.slice(match, match + rule.bannedTerm.length);
      findings.push({
        id: id(), category: 'terminology', severity: 'warning',
        issueTitle: `Configured restricted term: “${rule.bannedTerm}”`,
        description: rule.explanation || 'This term matches a restriction configured in your brand terminology rules.',
        affectedContent: affected || rule.bannedTerm,
        sourceReference: `Your terminology rules${rule.context ? ` → ${rule.context}` : ''}`,
        guidelineVersion: guidelines.version,
        suggestedCorrection: rule.preferredTerm || 'Review this phrase against your brand terminology policy.',
        confidence: 1, status: 'open',
        ruleId: rule.id, ruleLabel: termLabel(rule)
      });
    });

    const factualClaimPatterns = [
      /\b(number\s*one|number\s*1|no\.?\s*1|#1|first|best|largest|leading)\b/i,
      /\b(certified|accredited|award[- ]winning|guaranteed|official partner)\b/i,
      /\b\d+(?:\.\d+)?\s*%\b/i
    ];
    const approvedFacts = guidelines.facts.filter(fact => fact.approvalStatus === 'approved').map(fact => fact.fact.toLocaleLowerCase()).join(' ');
    factualClaimPatterns.forEach(pattern => {
      const match = pattern.exec(text);
      if (!match) return;
      const claim = match[0];
      const supported = approvedFacts.includes(claim.toLocaleLowerCase());
      if (supported) return;
      findings.push({
        id: id(), category: 'unsupported_claim', severity: 'warning',
        issueTitle: 'Verify factual or promotional claim',
        description: 'This wording may communicate a ranking, credential, guarantee, or quantified claim. Add a matching approved fact and source, or revise the claim before publishing.',
        affectedContent: claim,
        sourceReference: `Approved facts in your workspace (${guidelines.version})`,
        guidelineVersion: guidelines.version,
        suggestedCorrection: 'Add a verified supporting fact and source, or remove/rephrase the claim.',
        confidence: 0.75, status: 'open',
        ruleId: 'check:unsupported_claim', ruleLabel: 'Unsupported claims check'
      });
    });

    if (hasMedia && !mediaAltText?.trim()) {
      findings.push({
        id: id(), category: 'alt_text_missing', severity: 'suggestion',
        issueTitle: 'Add an accessibility description',
        description: 'Provide alternative text so people using screen readers can understand the attached media.',
        affectedContent: 'Attached media',
        sourceReference: 'Accessibility review', guidelineVersion: guidelines.version,
        suggestedCorrection: 'Describe the important subject, action, and any essential text shown in the image.',
        confidence: 1, status: 'open',
        ruleId: 'check:alt_text_missing', ruleLabel: 'Media alt text check'
      });
    }

    return { findings, score: this.calculateRiskScore(findings) };
  }

  static calculateRiskScore(findings: AuditFinding[]): BrandRiskScore {
    const breakdown = {
      unsupportedClaims: 0, visualAssets: 0, messagingViolations: 0,
      terminology: 0, accessibility: 0, toneInconsistencies: 0
    };
    let criticalCount = 0, warningCount = 0, suggestionCount = 0;
    findings.forEach(finding => {
      if (finding.status !== 'open' && finding.status !== 'contested') return;
      if (finding.severity === 'critical') criticalCount++;
      if (finding.severity === 'warning') warningCount++;
      if (finding.severity === 'suggestion') suggestionCount++;
      switch (finding.category) {
        case 'unsupported_claim': case 'outdated_info': breakdown.unsupportedClaims += 30; break;
        case 'visual_mismatch': case 'wrong_logo': case 'incorrect_colours': breakdown.visualAssets += 25; break;
        case 'incorrect_messaging': breakdown.messagingViolations += 20; break;
        case 'terminology': breakdown.terminology += 10; break;
        case 'accessibility': case 'alt_text_missing': breakdown.accessibility += 10; break;
        case 'tone_mismatch': breakdown.toneInconsistencies += 5; break;
      }
    });
    const overallScore = Math.min(100, Object.values(breakdown).reduce((total, value) => total + value, 0));
    return {
      overallScore,
      riskCategory: overallScore > 50 ? 'high' : overallScore > 20 ? 'medium' : 'low',
      breakdown, criticalCount, warningCount, suggestionCount
    };
  }

  /** Creates neutral per-platform drafts. It does not invent organization names or facts. */
  static generatePlatformVariants(title: string, caption: string, platforms: Platform[]): Partial<Record<Platform, PostPlatformVariant>> {
    const toneByPlatform: Record<Platform, string> = {
      linkedin: 'Professional', instagram: 'Visual and conversational', x: 'Concise',
      facebook: 'Community-oriented', threads: 'Conversational', youtube: 'Informative'
    };
    const variants: Partial<Record<Platform, PostPlatformVariant>> = {};
    platforms.forEach(platform => {
      variants[platform] = {
        platform,
        title,
        description: caption,
        targetTone: toneByPlatform[platform],
        suggestions: []
      };
    });
    return variants;
  }
}
