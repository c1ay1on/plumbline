// Deterministic checks — a direct port of src/services/aiAuditService.ts (AIAuditEngine)
// so the extension scores posts exactly the way the Plumbline web app does.

const uid = () => `audit-${crypto.randomUUID()}`;

function ruleApplies(rule, platform) {
  const list = rule.platforms || ['all'];
  return list.includes('all') || list.includes(platform);
}

export function auditDeterministic(text, platform, guidelines) {
  const findings = [];
  const normalized = text.toLocaleLowerCase();
  const version = guidelines.version || 'v1';

  (guidelines.terminology || []).forEach(rule => {
    if (!ruleApplies(rule, platform) || !rule.bannedTerm || !rule.bannedTerm.trim()) return;
    const term = rule.bannedTerm.trim().toLocaleLowerCase();
    const match = normalized.indexOf(term);
    if (match < 0) return;
    findings.push({
      id: uid(), category: 'terminology', severity: 'warning', origin: 'rules',
      issueTitle: `Configured restricted term: “${rule.bannedTerm}”`,
      description: rule.explanation || 'This term matches a restriction configured in your brand terminology rules.',
      affectedContent: text.slice(match, match + term.length) || rule.bannedTerm,
      sourceReference: `Your terminology rules${rule.context ? ` → ${rule.context}` : ''}`,
      citations: rule.id ? [`T:${rule.id}`] : [],
      guidelineVersion: version,
      suggestedCorrection: rule.preferredTerm || 'Review this phrase against your brand terminology policy.',
      confidence: 1, status: 'open'
    });
  });

  const claimPatterns = [
    /\b(number\s*one|number\s*1|no\.?\s*1|first|best|largest|leading)\b|#1\b/i,
    /\b(certified|accredited|award[- ]winning|guaranteed|official partner)\b/i,
    /\b\d+(?:\.\d+)?\s*%/i
  ];
  const approved = (guidelines.facts || [])
    .filter(f => f.approvalStatus === 'approved')
    .map(f => (f.fact || '').toLocaleLowerCase()).join(' ');
  claimPatterns.forEach(pattern => {
    const m = pattern.exec(text);
    if (!m) return;
    const claim = m[0];
    if (approved.includes(claim.toLocaleLowerCase())) return;
    findings.push({
      id: uid(), category: 'unsupported_claim', severity: 'warning', origin: 'rules',
      issueTitle: 'Verify factual or promotional claim',
      description: 'This wording may communicate a ranking, credential, guarantee, or quantified claim. Add a matching approved fact and source, or revise the claim before publishing.',
      affectedContent: claim,
      sourceReference: `Approved facts in your workspace (${version})`,
      citations: [], guidelineVersion: version,
      suggestedCorrection: 'Add a verified supporting fact and source, or remove/rephrase the claim.',
      confidence: 0.75, status: 'open'
    });
  });

  return findings;
}

export function calculateRiskScore(findings) {
  const breakdown = { unsupportedClaims: 0, visualAssets: 0, messagingViolations: 0, terminology: 0, accessibility: 0, toneInconsistencies: 0 };
  let criticalCount = 0, warningCount = 0, suggestionCount = 0;
  findings.forEach(f => {
    if (f.status !== 'open' && f.status !== 'contested') return;
    if (f.severity === 'critical') criticalCount++;
    if (f.severity === 'warning') warningCount++;
    if (f.severity === 'suggestion') suggestionCount++;
    switch (f.category) {
      case 'unsupported_claim': case 'outdated_info': breakdown.unsupportedClaims += 30; break;
      case 'visual_mismatch': case 'wrong_logo': case 'incorrect_colours': breakdown.visualAssets += 25; break;
      case 'incorrect_messaging': breakdown.messagingViolations += 20; break;
      case 'terminology': breakdown.terminology += 10; break;
      case 'accessibility': case 'alt_text_missing': breakdown.accessibility += 10; break;
      case 'tone_mismatch': breakdown.toneInconsistencies += 5; break;
    }
  });
  const overallScore = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  return {
    overallScore,
    riskCategory: overallScore > 50 ? 'high' : overallScore > 20 ? 'medium' : 'low',
    breakdown, criticalCount, warningCount, suggestionCount
  };
}
