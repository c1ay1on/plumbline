import {
  AuditFinding,
  BrandRiskScore,
  BrandGuidelines,
  Platform,
  PostPlatformVariant,
  AISuggestionItem,
  GroqConfig,
  GroundedAuditMeta
} from '../../types';

export type GroundedRetrieved = { id: string; label: string; text: string; score: number | null; source: string };
import { AIAuditEngine } from '../aiAuditService';
import { apiClient } from '../api/client';
import { resolveRuleId, ruleLabelFor } from '../governance/ambiguity';

// Links a model finding to the workspace rule it came from so disputes can be counted per rule.
function withRule(finding: AuditFinding, guidelines: BrandGuidelines): AuditFinding {
  const ruleId = resolveRuleId(finding, guidelines);
  return { ...finding, ruleId, ruleLabel: ruleLabelFor(ruleId, guidelines) };
}

// Groq shut down llama-3.3-70b-versatile and llama-3.1-8b-instant on 2026-08-16.
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export const POPULAR_GROQ_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
  { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' }
];

class GroqService {
  private serverConfig: GroqConfig = { apiKey: '', model: DEFAULT_GROQ_MODEL, isActive: false };

  getConfig(): GroqConfig { return this.serverConfig; }

  async getConfigAsync(): Promise<GroqConfig> {
    try {
      const status = await apiClient.getAIStatus();
      this.serverConfig = { apiKey: '', model: status.model || DEFAULT_GROQ_MODEL, isActive: status.configured };
    } catch {
      this.serverConfig = { apiKey: '', model: DEFAULT_GROQ_MODEL, isActive: false };
    }
    return this.serverConfig;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await apiClient.testAI();
      return { success: true, message: `Groq connected. Active model: ${result.model}.` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Groq connection test failed.' };
    }
  }

  /**
   * Grounded audit (Improvement 1). The backend runs the same RAG engine the Chrome
   * extension uses: rule checks + hybrid retrieval over Brand Knowledge and uploaded
   * rulebooks + Groq, and every finding cites the exact rule passage it came from.
   * Falls back to the local rule engine only if the backend cannot be reached.
   */
  async auditContent(
    text: string,
    platforms: Platform[],
    guidelines: BrandGuidelines,
    hasMedia: boolean = false,
    mediaAltText?: string
  ): Promise<{ findings: AuditFinding[]; score: BrandRiskScore; isLiveAi: boolean; meta?: GroundedAuditMeta; retrieved?: GroundedRetrieved[]; offline?: boolean }> {
    try {
      const result = await apiClient.groundedAudit({ text, platforms, guidelines, hasMedia, mediaAltText });
      // Stamp each finding with its workspace rule so disputes, ambiguity alerts and Insights group it correctly.
      const findings = result.findings.map(f => withRule({ ...f, guidelineVersion: f.guidelineVersion || guidelines.version }, guidelines));
      return { findings, score: result.score, isLiveAi: Boolean(result.meta.provider), meta: result.meta, retrieved: result.retrieved };
    } catch (err) {
      console.warn('Grounded audit unavailable, falling back to local rule engine:', err);
      const localResult = AIAuditEngine.auditContent(text, platforms, guidelines, hasMedia, mediaAltText);
      return { ...localResult, findings: localResult.findings.map(f => withRule(f, guidelines)), isLiveAi: false, offline: true };
    }
  }

  /**
   * Generate platform variants with Groq
   */
  async generatePlatformVariants(
    title: string,
    caption: string,
    platforms: Platform[],
    guidelines: BrandGuidelines
  ): Promise<Partial<Record<Platform, PostPlatformVariant>>> {
    const config = await this.getConfigAsync();

    if (!config.isActive) {
      return AIAuditEngine.generatePlatformVariants(title, caption, platforms);
    }

    try {
      const systemPrompt = `You are Plumbline's multi-platform copy adaptation engine.
Adapt the original post into tailored copies for each requested social platform based on these brand guidelines:
Brand Voice: ${guidelines.voice.tones.join(', ')}
${guidelines.voice.customToneDescription}

Platform Rules:
${platforms.map(p => `- ${p}: ${guidelines.voice.platformRules[p] || 'Standard'}`).join('\n')}

Terminology:
${guidelines.terminology.map(t => `- Replace "${t.bannedTerm}" with "${t.preferredTerm}"`).join('\n')}

Return ONLY JSON format:
{
  "variants": {
    "<platform>": {
      "title": "Adapted headline",
      "description": "Adapted copy",
      "targetTone": "Target tone description",
      "suggestions": [
        {
          "original": "Original phrase",
          "suggestion": "Improved phrase",
          "explanation": "Why this aligns with brand tone",
          "sourceRef": "Rule reference"
        }
      ]
    }
  }
}`;

      const data = await apiClient.groqCompletion({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Original Title: "${title}"\nOriginal Caption:\n"""${caption}"""\nPlatforms: ${platforms.join(', ')}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });
      const parsed = JSON.parse(data.choices[0].message.content);
      const variants: Partial<Record<Platform, PostPlatformVariant>> = {};

      platforms.forEach(p => {
        const v = parsed.variants?.[p];
        if (v) {
          variants[p] = {
            platform: p,
            title: v.title || title,
            description: v.description || caption,
            targetTone: v.targetTone || 'Adapted Tone',
            suggestions: (v.suggestions || []).map((s: any, idx: number) => ({
              id: `sug-${p}-${idx}-${Date.now()}`,
              original: s.original || '',
              suggestion: s.suggestion || '',
              explanation: s.explanation || '',
              sourceRef: s.sourceRef || 'Platform Guidelines',
              status: 'pending' as const
            }))
          };
        }
      });

      return variants;
    } catch (err) {
      console.warn('Groq variant generation error, using fallback:', err);
      return AIAuditEngine.generatePlatformVariants(title, caption, platforms);
    }
  }

  /**
   * Generate brand-grounded comment reply using Groq
   */
  async generateCommentReply(
    commentText: string,
    platform: Platform,
    guidelines: BrandGuidelines
  ): Promise<{ reply: string; source: string; isLiveAi: boolean }> {
    const config = await this.getConfigAsync();

    if (!config.isActive) {
      // Deterministic reply based on keywords
      if (commentText.toLowerCase().includes('rank') || commentText.toLowerCase().includes('verify')) {
        return {
          reply: 'Thanks for reaching out! Our verified accreditations and official statutory documents are published directly on our portal.',
          source: 'Brand Governance Charter & Verified Facts (Local)',
          isLiveAi: false
        };
      }
      return {
        reply: `Thank you for connecting with us! We appreciate your engagement with our community.`,
        source: `${platform.toUpperCase()} Community Voice Guidelines (Local)`,
        isLiveAi: false
      };
    }

    try {
      const prompt = `You are a social media brand representative responding to an audience comment.
Brand Voice: ${guidelines.voice.tones.join(', ')}
Platform: ${platform} (Tone rule: ${guidelines.voice.platformRules[platform] || 'Professional & Courteous'})
Verified Facts:
${guidelines.facts.map(f => `- ${f.fact} (Source: ${f.source})`).join('\n')}

Comment: "${commentText}"

Instruction: Write a helpful, brand-grounded response.
IMPORTANT: Never invent fake event dates, links, prices, or ranking superlatives.
Return ONLY JSON:
{
  "reply": "Your proposed response",
  "source": "Which approved fact or voice rule guided this response"
}`;

      const data = await apiClient.groqCompletion({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });
      const parsed = JSON.parse(data.choices[0].message.content);
      return {
        reply: parsed.reply || 'Thank you for connecting with us!',
        source: parsed.source || 'Groq AI Brand Alignment',
        isLiveAi: true
      };
    } catch (err) {
      console.warn('Groq comment reply error, using fallback:', err);
      return {
        reply: `Thank you for your question! We appreciate your engagement with our brand.`,
        source: 'Brand Voice Guidelines (Fallback)',
        isLiveAi: false
      };
    }
  }
}

export const groqService = new GroqService();
