import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Plus,
  Trash2,
  Edit2,
  Save,
  RotateCcw,
  History,
  FileText,
  AlertTriangle,
  CheckCircle,
  Upload,
  Sparkles,
  ShieldCheck,
  Eye,
  Type,
  Palette,
  Image as ImageIcon,
  X
} from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useAuth } from '../../contexts/AuthContext';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { RulebookManager } from '../../components/rag/RulebookManager';
import {
  TerminologyRule,
  ApprovedFact,
  BrandAsset,
  Platform,
  AmbiguousRuleAlert,
  RuleChange,
  GuidelineVersionHistory
} from '../../types';
import { AmbiguousRuleAlerts, useRuleAlerts } from '../../components/governance/AmbiguousRuleAlerts';
import { ChangeImpactPanel } from '../../components/governance/ChangeImpactPanel';
import { RuleDiffList } from '../../components/governance/RuleDiffList';
import { governanceService } from '../../services/governance/governanceService';
import { BUILTIN_CHECKS } from '../../services/governance/ambiguity';
import { checkedVersion, computeImpact, diffRules, termLabel } from '../../services/governance/versioning';

export const BrandKnowledgePage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, currentRole } = useAuth();
  const {
    guidelines,
    guidelineVersions,
    posts,
    saveGuidelines,
    restoreGuidelineVersion,
    recheckPosts
  } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const ruleParam = searchParams.get('rule');

  const [activeTab, setActiveTab] = useState<
    'voice' | 'terminology' | 'facts' | 'colors' | 'assets' | 'documents' | 'versions'
  >('voice');

  // Working state copy
  const [workingVoice, setWorkingVoice] = useState(guidelines.voice);
  const [workingTerminology, setWorkingTerminology] = useState<TerminologyRule[]>(guidelines.terminology);
  const [workingFacts, setWorkingFacts] = useState<ApprovedFact[]>(guidelines.facts);
  const [workingColors, setWorkingColors] = useState(guidelines.colors);
  const [workingFonts, setWorkingFonts] = useState(guidelines.fonts);
  const [workingAssets, setWorkingAssets] = useState<BrandAsset[]>(guidelines.assets);
  const canEditAssets = ['owner', 'admin', 'manager'].includes(currentRole);

  // Reload the editable copy when a new version is saved or the shared workspace finishes loading.
  useEffect(() => {
    setWorkingVoice(guidelines.voice);
    setWorkingTerminology(guidelines.terminology);
    setWorkingFacts(guidelines.facts);
    setWorkingColors(guidelines.colors);
    setWorkingFonts(guidelines.fonts);
    setWorkingAssets(guidelines.assets);
  }, [guidelines.version, guidelines.lastUpdated]);

  // Last saved version and its rule changes; the impact is recomputed from live posts so re-checks update it.
  const [lastSave, setLastSave] = useState<{ version: string; changes: RuleChange[] } | null>(null);
  const [alertsRefreshKey, setAlertsRefreshKey] = useState(0);
  const { alerts: openAlerts } = useRuleAlerts(alertsRefreshKey);
  const disputedRuleIds = new Set(openAlerts.map(alert => alert.ruleId));

  // Rule clarification opened from an ambiguity alert (?rule=<id>)
  const [focusAlert, setFocusAlert] = useState<AmbiguousRuleAlert | null>(null);
  const [clarifyText, setClarifyText] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);

  useEffect(() => {
    if (!ruleParam) { setFocusAlert(null); return; }
    const tab = ruleParam === 'check:unsupported_claim' ? 'facts'
      : ruleParam === 'check:visual_logo' ? 'assets'
      : ruleParam === 'check:visual_palette' || ruleParam === 'check:visual_contrast' ? 'colors'
      : ruleParam.startsWith('check:') ? 'voice' : 'terminology';
    setActiveTab(tab);
    let active = true;
    governanceService.loadAlerts(posts, guidelines, true).then(result => {
      if (!active) return;
      const alert = result.alerts.find(item => item.ruleId === ruleParam) || null;
      const rule = guidelines.terminology.find(item => item.id === ruleParam);
      setFocusAlert(alert);
      setClarifyText(alert?.suggestion?.proposedText || rule?.explanation || '');
    });
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`rule-row-${ruleParam}`) || document.getElementById('rule-clarify-panel');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleParam]);

  const focusRule = ruleParam ? guidelines.terminology.find(item => item.id === ruleParam) : undefined;
  const focusLabel = focusAlert?.label || (focusRule ? termLabel(focusRule) : BUILTIN_CHECKS[ruleParam || '']?.label) || ruleParam || '';

  const closeClarification = () => {
    searchParams.delete('rule');
    setSearchParams(searchParams);
  };

  const workingGuidelines = (terminology = workingTerminology) => ({
    ...guidelines,
    voice: workingVoice,
    terminology,
    facts: workingFacts,
    colors: workingColors,
    fonts: workingFonts,
    assets: workingAssets
  });

  const handleRegenerateSuggestion = async () => {
    if (!focusAlert) return;
    setIsSuggesting(true);
    const suggestion = await governanceService.suggest(focusAlert);
    setFocusAlert({ ...focusAlert, suggestion });
    setClarifyText(suggestion.proposedText);
    setIsSuggesting(false);
  };

  const handleSaveClarification = async () => {
    if (!ruleParam || !focusRule || !clarifyText.trim()) return;
    const terminology = workingTerminology.map(rule => rule.id === ruleParam ? { ...rule, explanation: clarifyText.trim() } : rule);
    setWorkingTerminology(terminology);
    const result = saveGuidelines(workingGuidelines(terminology), `Clarified rule ${termLabel(focusRule)} after repeated disputes.`);
    await governanceService.resolve(ruleParam, result.version, 'Clarified in the guideline editor');
    setLastSave({ version: result.version, changes: result.changes });
    setAlertsRefreshKey(key => key + 1);
    closeClarification();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResolveWithoutEdit = async () => {
    if (!ruleParam) return;
    await governanceService.resolve(ruleParam, guidelines.version, 'Marked resolved from the guideline editor');
    setAlertsRefreshKey(key => key + 1);
    closeClarification();
  };

  const handleRecheck = (postIds: string[]) => {
    const count = recheckPosts(postIds);
    if (count === 0) alert('Nothing to re-check. Only drafts and reviews still in progress can be re-checked.');
  };

  const versionChanges = (ver: GuidelineVersionHistory, index: number): RuleChange[] | null => {
    if (ver.ruleChanges && (ver.ruleChanges.length > 0 || index === guidelineVersions.length - 1)) return ver.ruleChanges;
    const previous = guidelineVersions[index + 1];
    if (ver.snapshot && previous?.snapshot) return diffRules(previous.snapshot, ver.snapshot);
    return ver.ruleChanges || null;
  };

  // Modals
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');

  // Add Term Modal
  const [addTermModalOpen, setAddTermModalOpen] = useState(false);
  const [newContext, setNewContext] = useState('');
  const [newPreferred, setNewPreferred] = useState('');
  const [newBanned, setNewBanned] = useState('');
  const [newExplanation, setNewExplanation] = useState('');

  // Add Fact Modal
  const [addFactModalOpen, setAddFactModalOpen] = useState(false);
  const [newFactText, setNewFactText] = useState('');
  const [newFactSource, setNewFactSource] = useState('');
  const [newFactCategory, setNewFactCategory] = useState('Accreditation');
  const [newFactOwner, setNewFactOwner] = useState('Content owner');

  const [assetError, setAssetError] = useState('');

  const handleAssetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setAssetError('');
    for (const file of files) {
      if (!file.type.startsWith('image/')) { setAssetError(`${file.name} is not an image.`); continue; }
      if (file.size > 750 * 1024) { setAssetError(`${file.name} is over 750 KB. Use a smaller PNG, SVG or JPG.`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const asset: BrandAsset = {
          id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          type: 'logo',
          variant: 'primary',
          url: String(reader.result),
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          updatedAt: new Date().toLocaleDateString()
        };
        setWorkingAssets(current => [...current, asset]);
      };
      reader.readAsDataURL(file);
    }
  };

  const updateAsset = (id: string, patch: Partial<BrandAsset>) =>
    setWorkingAssets(current => current.map(a => (a.id === id ? { ...a, ...patch } : a)));

  const removeAsset = (id: string) => setWorkingAssets(current => current.filter(a => a.id !== id));

  const handleSaveNewVersionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = saveGuidelines(workingGuidelines(), changeSummary || 'Updated terminology and verified facts.');
    setSaveModalOpen(false);
    setChangeSummary('');
    setLastSave({ version: result.version, changes: result.changes });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPreferred || !newBanned) return;

    if (editingTermId) {
      setWorkingTerminology(workingTerminology.map(rule => rule.id === editingTermId ? {
        ...rule, context: newContext || 'General', preferredTerm: newPreferred, bannedTerm: newBanned, explanation: newExplanation
      } : rule));
      closeTermModal();
      return;
    }

    const newRule: TerminologyRule = {
      id: `term-${Date.now()}`,
      context: newContext || 'General',
      preferredTerm: newPreferred,
      bannedTerm: newBanned,
      explanation: newExplanation,
      platforms: ['all']
    };

    setWorkingTerminology([...workingTerminology, newRule]);
    setAddTermModalOpen(false);
    setNewContext('');
    setNewPreferred('');
    setNewBanned('');
    setNewExplanation('');
  };

  const openEditTerm = (rule: TerminologyRule) => {
    setEditingTermId(rule.id);
    setNewContext(rule.context);
    setNewPreferred(rule.preferredTerm);
    setNewBanned(rule.bannedTerm);
    setNewExplanation(rule.explanation);
    setAddTermModalOpen(true);
  };

  const closeTermModal = () => {
    setAddTermModalOpen(false);
    setEditingTermId(null);
    setNewContext('');
    setNewPreferred('');
    setNewBanned('');
    setNewExplanation('');
  };

  const handleDeleteTerm = (id: string) => {
    setWorkingTerminology(workingTerminology.filter(t => t.id !== id));
  };

  const handleAddFact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFactText || !newFactSource) return;

    const newFact: ApprovedFact = {
      id: `fact-${Date.now()}`,
      fact: newFactText,
      source: newFactSource,
      category: newFactCategory,
      approvalStatus: 'approved',
      approvalOwner: newFactOwner,
      version: guidelines.version,
      lastUpdated: new Date().toISOString().split('T')[0]
    };

    setWorkingFacts([...workingFacts, newFact]);
    setAddFactModalOpen(false);
    setNewFactText('');
    setNewFactSource('');
  };

  const toggleFactStatus = (id: string) => {
    setWorkingFacts(
      workingFacts.map(f => {
        if (f.id === id) {
          return {
            ...f,
            approvalStatus: f.approvalStatus === 'approved' ? 'outdated' : 'approved'
          };
        }
        return f;
      })
    );
  };

  const handleDeleteFact = (id: string) => {
    setWorkingFacts(workingFacts.filter(f => f.id !== id));
  };

  const handleRestoreVersion = (version: string) => {
    if (confirm(`Restore rules from ${version}? A new version will be created to record this restoration.`)) {
      const result = restoreGuidelineVersion(version);
      if (result) {
        setLastSave({ version: result.version, changes: result.changes });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 font-sans space-y-8 pb-24">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-[#0A4A3D] bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              Active Guideline: {guidelines.version}
            </span>
            <span className="text-xs text-stone-400">
              Last updated: {new Date(guidelines.lastUpdated).toLocaleDateString()}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#12201C] tracking-tight">
            Edit brand guidelines
          </h1>
          <p className="text-sm text-[#68756F] mt-1">
            Changes create a new version. Past reviews keep the version they used.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/home')}
            className="px-4 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-600"
          >
            Discard
          </button>
          <button
            onClick={() => setSaveModalOpen(true)}
            className="px-5 py-2.5 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold shadow-xs flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save new version
          </button>
        </div>
      </div>

      {/* Critical Rule Banner */}
      <div className="p-4 rounded-2xl bg-emerald-950 text-emerald-100 text-xs flex items-center justify-between gap-4 shadow-plumb-subtle">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>
            <strong className="text-white">Strict Immutability Guarantee:</strong> Modifying rules will not silently rewrite or invalidate historical post reviews. Previous campaigns remain linked to their original guideline snapshot.
          </span>
        </div>
      </div>

      {lastSave && (
        <ChangeImpactPanel
          impact={computeImpact(posts, lastSave.changes, lastSave.version)}
          onRecheck={handleRecheck}
          onClose={() => setLastSave(null)}
        />
      )}

      {!ruleParam && (
        <AmbiguousRuleAlerts
          compact
          refreshKey={alertsRefreshKey}
          onOpenRule={alert => setSearchParams({ rule: alert.ruleId })}
        />
      )}

      {ruleParam && (
        <div id="rule-clarify-panel" className="bg-white rounded-2xl p-6 border-2 border-amber-300 shadow-plumb-subtle space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#12201C] flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[#B45309]" />
                Clarify rule: {focusLabel}
              </h3>
              <p className="text-xs text-[#68756F]">
                {focusAlert
                  ? `Disputed ${focusAlert.disputeCount} of ${focusAlert.flagCount} flags (${Math.round(focusAlert.disputeRate * 100)}%). Saving creates a new guideline version and resolves the alert.`
                  : 'No open ambiguity alert for this rule. You can still edit and save it as a new version.'}
              </p>
            </div>
            <button onClick={closeClarification} className="p-1 text-stone-400 hover:text-stone-700" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {focusAlert && focusAlert.topReasons.length > 0 && (
            <div className="text-xs">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#68756F] mb-1">Why people disputed it</div>
              <ul className="space-y-0.5">
                {focusAlert.topReasons.map(item => (
                  <li key={item.reason} className="text-stone-700">"{item.reason}" <span className="text-stone-400">x{item.count}</span></li>
                ))}
              </ul>
            </div>
          )}

          {focusAlert?.suggestion && focusAlert.suggestion.notes.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-stone-600 space-y-0.5">
              {focusAlert.suggestion.notes.map(note => <li key={note}>{note}</li>)}
            </ul>
          )}

          {focusRule ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#68756F] mb-1">Current wording ({guidelines.version})</div>
                  <p className="text-stone-700">{focusRule.explanation || '(no explanation)'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#167A58] mb-1">
                    Clarified wording {focusAlert?.suggestion && `(suggested by ${focusAlert.suggestion.source === 'groq' ? 'Groq AI' : 'rule-based helper'}, edit freely)`}
                  </label>
                  <textarea
                    rows={5}
                    value={clarifyText}
                    onChange={e => setClarifyText(e.target.value)}
                    className="w-full p-3 text-xs rounded-xl border border-emerald-200 bg-emerald-50/20 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
                  />
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {focusAlert && (
                  <button
                    onClick={handleRegenerateSuggestion}
                    disabled={isSuggesting}
                    className="px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    {isSuggesting ? 'Generating...' : 'Regenerate suggestion'}
                  </button>
                )}
                <button
                  onClick={() => openEditTerm(focusRule)}
                  className="px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 flex items-center gap-1.5"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit terms too
                </button>
                <button
                  onClick={handleSaveClarification}
                  disabled={!clarifyText.trim()}
                  className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  Save clarification as new version
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3 text-xs">
              {focusAlert?.suggestion && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#12201C]">
                  <span className="font-bold text-[#167A58]">Suggested clarification: </span>{focusAlert.suggestion.proposedText}
                </div>
              )}
              <p className="text-stone-600">
                {ruleParam.startsWith('check:')
                  ? 'This check is built into the auditor. Add the missing approved fact or voice guidance in this tab, save a new version, then mark the alert resolved.'
                  : 'This rule no longer exists in the current guidelines.'}
              </p>
              <div className="flex justify-end">
                <button
                  onClick={handleResolveWithoutEdit}
                  className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold"
                >
                  Mark resolved
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-stone-200 pb-2">
        {[
          { id: 'voice', label: 'Voice and Tone', icon: Sparkles },
          { id: 'terminology', label: 'Terminology', icon: BookOpen },
          { id: 'facts', label: 'Approved Facts', icon: CheckCircle },
          { id: 'colors', label: 'Colours and Fonts', icon: Palette },
          { id: 'assets', label: 'Logos and Assets', icon: ImageIcon },
          { id: 'documents', label: 'Rulebooks', icon: FileText },
          { id: 'versions', label: 'Version History', icon: History }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-[#0A4A3D] text-white shadow-xs'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Voice and Tone */}
      {activeTab === 'voice' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-5">
            <h3 className="text-base font-bold text-[#12201C]">Brand Voice & Personality</h3>

            <div>
              <label className="block text-xs font-semibold text-[#12201C] mb-1">
                Overarching Voice Statement
              </label>
              <textarea
                rows={3}
                value={workingVoice.customToneDescription}
                onChange={e =>
                  setWorkingVoice({ ...workingVoice, customToneDescription: e.target.value })
                }
                className="w-full p-3 text-xs rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#0A4A3D]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#167A58] mb-1">
                  ✓ Example of a post that sounds like your brand
                </label>
                <textarea
                  rows={3}
                  value={workingVoice.examplePositive}
                  onChange={e =>
                    setWorkingVoice({ ...workingVoice, examplePositive: e.target.value })
                  }
                  className="w-full p-3 text-xs rounded-xl border border-emerald-200 bg-emerald-50/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#C2413B] mb-1">
                  ✕ Content that should NOT sound like your brand
                </label>
                <textarea
                  rows={3}
                  value={workingVoice.exampleNegative}
                  onChange={e =>
                    setWorkingVoice({ ...workingVoice, exampleNegative: e.target.value })
                  }
                  className="w-full p-3 text-xs rounded-xl border border-red-200 bg-red-50/20"
                />
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-stone-100">
              <h4 className="text-xs font-bold text-[#12201C] uppercase tracking-wider">
                Platform Tone Rules
              </h4>

              {[
                { p: 'linkedin', name: 'LinkedIn' },
                { p: 'instagram', name: 'Instagram' },
                { p: 'x', name: 'X (formerly Twitter)' },
                { p: 'facebook', name: 'Facebook' },
                { p: 'threads', name: 'Meta Threads' }
              ].map(item => (
                <div key={item.p} className="p-3 rounded-xl border border-stone-200 bg-stone-50/60 flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="w-28 font-bold text-xs text-[#12201C]">{item.name}</span>
                  <input
                    type="text"
                    value={workingVoice.platformRules[item.p as Platform] || ''}
                    onChange={e =>
                      setWorkingVoice({
                        ...workingVoice,
                        platformRules: {
                          ...workingVoice.platformRules,
                          [item.p as Platform]: e.target.value
                        }
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 bg-white"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Terminology Table */}
      {activeTab === 'terminology' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#12201C]">Brand Terminology Dictionary</h3>
                <p className="text-xs text-[#68756F]">
                  Exact matching rules used by the AI auditor to flag discouraged or informal language.
                </p>
              </div>

              <button
                onClick={() => setAddTermModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Term Rule
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-[#68756F] uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3">Context</th>
                    <th className="py-3 px-3">Preferred Term</th>
                    <th className="py-3 px-3">Banned / Discouraged</th>
                    <th className="py-3 px-3">Explanation & Rule</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {workingTerminology.map(term => (
                    <tr
                      key={term.id}
                      id={`rule-row-${term.id}`}
                      className={ruleParam === term.id ? 'bg-amber-50 outline outline-2 outline-amber-400' : 'hover:bg-stone-50/50'}
                    >
                      <td className="py-3 px-3 font-semibold text-[#12201C]">
                        {term.context}
                        {disputedRuleIds.has(term.id) && (
                          <button
                            onClick={() => setSearchParams({ rule: term.id })}
                            className="ml-2 text-[10px] font-bold text-[#B45309] bg-amber-100 px-1.5 py-0.5 rounded"
                            title="This rule is disputed often. Click to clarify it."
                          >
                            ambiguous
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-3 font-bold text-[#167A58]">{term.preferredTerm}</td>
                      <td className="py-3 px-3 font-bold text-[#C2413B] line-through">{term.bannedTerm}</td>
                      <td className="py-3 px-3 text-stone-600 max-w-sm">{term.explanation}</td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openEditTerm(term)}
                          className="p-1 text-stone-400 hover:text-[#0A4A3D] transition-colors"
                          title="Edit term"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTerm(term.id)}
                          className="p-1 text-stone-400 hover:text-red-600 transition-colors"
                          title="Delete term"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Approved Facts Table */}
      {activeTab === 'facts' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#12201C]">Approved Facts & Claims Repository</h3>
                <p className="text-xs text-[#68756F]">
                  Verified statutory claims used to cross-reference statements before publishing.
                </p>
              </div>

              <button
                onClick={() => setAddFactModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Approved Fact
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-[#68756F] uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3">Verified Fact</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Source Document</th>
                    <th className="py-3 px-3">Owner</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {workingFacts.map(fact => (
                    <tr key={fact.id} className="hover:bg-stone-50/50">
                      <td className="py-3 px-3 font-medium text-[#12201C] max-w-sm">{fact.fact}</td>
                      <td className="py-3 px-3 text-stone-600">{fact.category}</td>
                      <td className="py-3 px-3 text-[11px] font-mono text-stone-500">{fact.source}</td>
                      <td className="py-3 px-3 text-stone-600">{fact.approvalOwner}</td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => toggleFactStatus(fact.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            fact.approvalStatus === 'approved'
                              ? 'bg-emerald-100 text-[#167A58]'
                              : 'bg-stone-200 text-stone-600'
                          }`}
                          title="Click to toggle status"
                        >
                          {fact.approvalStatus}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleDeleteFact(fact.id)}
                          className="p-1 text-stone-400 hover:text-red-600"
                          title="Delete fact"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Colours and Fonts */}
      {activeTab === 'colors' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-6">
            <h3 className="text-base font-bold text-[#12201C]">Brand Palette & Typography</h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {[
                { key: 'primary', label: 'Primary Brand Color', val: workingColors.primary },
                { key: 'secondary', label: 'Secondary Green', val: workingColors.secondary },
                { key: 'accent', label: 'Accent / Warning Amber', val: workingColors.accent },
                { key: 'background', label: 'Mineral Background', val: workingColors.background }
              ].map(c => (
                <div key={c.key} className="p-4 rounded-xl border border-stone-200 text-xs space-y-2">
                  <div
                    className="w-full h-12 rounded-lg border border-stone-200 shadow-xs"
                    style={{ backgroundColor: c.val }}
                  />
                  <div className="font-semibold text-[#12201C]">{c.label}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={c.val}
                      onChange={e =>
                        setWorkingColors({ ...workingColors, [c.key]: e.target.value })
                      }
                      className="w-6 h-6 rounded cursor-pointer border-0"
                    />
                    <input
                      type="text"
                      value={c.val}
                      onChange={e =>
                        setWorkingColors({ ...workingColors, [c.key]: e.target.value })
                      }
                      className="w-full font-mono text-[11px] px-2 py-1 border border-stone-200 rounded"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-[#12201C] mb-1">Heading Font</label>
                <select
                  value={workingFonts.heading}
                  onChange={e => setWorkingFonts({ ...workingFonts, heading: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white"
                >
                  <option value="Inter">Inter (Sans-Serif)</option>
                  <option value="Merriweather">Merriweather (Academic)</option>
                  <option value="Playfair Display">Playfair Display</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#12201C] mb-1">Body Font</label>
                <select
                  value={workingFonts.body}
                  onChange={e => setWorkingFonts({ ...workingFonts, body: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white"
                >
                  <option value="Inter">Inter</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Source Sans Pro">Source Sans Pro</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Logos and Assets */}
      {activeTab === 'assets' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#12201C]">Official Crest & Asset Library</h3>
                <p className="text-xs text-[#68756F]">
                  Approved vector logos, banners, and social media templates. Click Save new version to keep changes.
                </p>
              </div>
              {canEditAssets && (
                <label className="px-4 py-2 rounded-xl bg-[#0A4A3D] hover:bg-[#063028] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  Upload asset
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleAssetUpload} />
                </label>
              )}
            </div>
            {assetError && <p className="text-xs text-[#C2413B]">{assetError}</p>}
            {workingAssets.length === 0 && (
              <p className="py-6 text-center text-xs text-stone-500 border border-dashed border-stone-200 rounded-xl">
                No assets yet. Upload your logo, banners or templates (PNG, SVG or JPG, up to 750 KB each).
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {workingAssets.map(asset => (
                <div key={asset.id} className="p-4 rounded-xl border border-stone-200 space-y-3 bg-stone-50/50">
                  <div className="h-28 rounded-lg bg-stone-900 overflow-hidden flex items-center justify-center p-2">
                    <img
                      src={asset.url}
                      alt={asset.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>

                  <div className="space-y-1.5">
                    {canEditAssets ? (
                      <input
                        value={asset.name}
                        onChange={e => updateAsset(asset.id, { name: e.target.value })}
                        className="w-full text-xs font-bold text-[#12201C] bg-transparent border-b border-transparent focus:border-stone-300 outline-none"
                      />
                    ) : (
                      <div className="text-xs font-bold text-[#12201C] truncate">{asset.name}</div>
                    )}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#68756F]">
                      {canEditAssets ? (
                        <div className="flex items-center gap-1">
                          <select value={asset.type} onChange={e => updateAsset(asset.id, { type: e.target.value as BrandAsset['type'] })} className="bg-white border border-stone-200 rounded px-1 py-0.5 capitalize">
                            <option value="logo">Logo</option>
                            <option value="template">Template</option>
                            <option value="graphic">Graphic</option>
                          </select>
                          <select value={asset.variant} onChange={e => updateAsset(asset.id, { variant: e.target.value as BrandAsset['variant'] })} className="bg-white border border-stone-200 rounded px-1 py-0.5 capitalize">
                            <option value="primary">Primary</option>
                            <option value="monochrome">Monochrome</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                          </select>
                        </div>
                      ) : (
                        <span className="capitalize">{asset.variant} variant</span>
                      )}
                      <span>{asset.size}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-stone-200 text-[10px]">
                    <span className="text-[#167A58] font-bold">✓ Approved</span>
                    <span className="flex items-center gap-2">
                      <a href={asset.url} download={asset.name} className="text-[#0A4A3D] font-semibold hover:underline">Download</a>
                      {canEditAssets && (
                        <button onClick={() => removeAsset(asset.id)} className="text-[#C2413B] hover:text-red-700" title="Remove asset">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: Rulebooks (Improvement 1: parsed, indexed and cited) */}
      {activeTab === 'documents' && (
        <div className="space-y-6 animate-in fade-in">
          <RulebookManager canEdit={['owner', 'admin', 'manager'].includes(currentRole)} />
        </div>
      )}

      {/* TAB 7: Version History */}
      {activeTab === 'versions' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-plumb-subtle space-y-4">
            <div>
              <h3 className="text-base font-bold text-[#12201C]">Guideline Version History</h3>
              <p className="text-xs text-[#68756F]">
                Immutable timeline of guideline amendments. Previous versions are kept intact.
              </p>
            </div>

            <div className="divide-y divide-stone-100">
              {guidelineVersions.length === 0 && (
                <p className="py-4 text-xs text-stone-500">No versions saved yet. Save a change to start the history.</p>
              )}
              {guidelineVersions.map((ver, index) => {
                const changes = versionChanges(ver, index);
                const reviewsChecked = posts.filter(post => checkedVersion(post) === ver.version).length;
                return (
                <div key={ver.id || ver.version} className="py-4 space-y-3 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#0A4A3D] bg-emerald-50 px-2 py-0.5 rounded">
                        {ver.version}
                      </span>
                      <span className="text-stone-400">•</span>
                      <span className="text-stone-600 font-medium">
                        Edited by <strong>{ver.editor}</strong>
                      </span>
                      <span className="text-stone-400 font-mono text-[11px]">
                        ({new Date(ver.timestamp).toLocaleDateString()})
                      </span>
                    </div>
                    <p className="text-stone-700 max-w-2xl">{ver.summary}</p>
                    <p className="text-[11px] text-[#68756F]">
                      {changes ? `${changes.length} rule change${changes.length === 1 ? '' : 's'}` : 'Rule snapshot not recorded'}
                      {' · '}{reviewsChecked} review{reviewsChecked === 1 ? '' : 's'} checked against this version
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    {changes && (
                      <button
                        onClick={() => setExpandedVersion(expandedVersion === ver.version ? null : ver.version)}
                        className="px-3.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-xs font-semibold text-stone-700 flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#0A4A3D]" />
                        {expandedVersion === ver.version ? 'Hide changes' : 'View changes'}
                      </button>
                    )}
                    {ver.version !== guidelines.version && ver.snapshot && (
                      <button
                        onClick={() => handleRestoreVersion(ver.version)}
                        className="px-3.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-xs font-semibold text-stone-700 flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#0A4A3D]" />
                        Restore this version
                      </button>
                    )}
                  </div>
                </div>
                {expandedVersion === ver.version && changes && <RuleDiffList changes={changes} />}
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Save New Version Modal */}
      <Modal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Publish New Brand Guidelines Version"
        subtitle="Creating a new version permanently records your amendments."
      >
        <form onSubmit={handleSaveNewVersionSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">
              Summary of Modifications
            </label>
            <textarea
              rows={3}
              required
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              placeholder="e.g. Added a verified company fact and updated preferred terminology..."
              className="w-full p-3 text-xs rounded-xl border border-stone-200"
            />
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-[#0A4A3D]">
            This will create the next version of the active brand guidelines. Historical posts will continue to evaluate against the version they were drafted with.
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSaveModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold"
            >
              Publish New Version
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Term Modal */}
      <Modal
        isOpen={addTermModalOpen}
        onClose={closeTermModal}
        title={editingTermId ? 'Edit Terminology Rule' : 'Add Terminology Rule'}
        subtitle={editingTermId ? 'Changes apply when you save a new guidelines version.' : 'Define preferred phrasing and disallowed vocabulary.'}
      >
        <form onSubmit={handleAddTerm} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">Rule Context</label>
            <input
              type="text"
              required
              value={newContext}
              onChange={e => setNewContext(e.target.value)}
              placeholder="e.g. University Accreditation or Student Body"
              className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#167A58] mb-1">Preferred Term</label>
            <input
              type="text"
              required
              value={newPreferred}
              onChange={e => setNewPreferred(e.target.value)}
              placeholder="e.g. Students"
              className="w-full px-3 py-2 text-xs rounded-xl border border-emerald-200 bg-emerald-50/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#C2413B] mb-1">Banned / Discouraged Term</label>
            <input
              type="text"
              required
              value={newBanned}
              onChange={e => setNewBanned(e.target.value)}
              placeholder="e.g. Kids"
              className="w-full px-3 py-2 text-xs rounded-xl border border-red-200 bg-red-50/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">Explanation</label>
            <textarea
              rows={2}
              value={newExplanation}
              onChange={e => setNewExplanation(e.target.value)}
              placeholder="Explain why this rule exists..."
              className="w-full p-2.5 text-xs rounded-xl border border-stone-200"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeTermModal}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold"
            >
              {editingTermId ? 'Update Term' : 'Add Term'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Fact Modal */}
      <Modal
        isOpen={addFactModalOpen}
        onClose={() => setAddFactModalOpen(false)}
        title="Add Approved Verified Fact"
        subtitle="Enter officially verified company or institutional information."
      >
        <form onSubmit={handleAddFact} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#12201C] mb-1">Verified Fact Statement</label>
            <textarea
              rows={3}
              required
              value={newFactText}
              onChange={e => setNewFactText(e.target.value)}
              placeholder="e.g. Our organisation holds [accreditation] status, verified by [official source] on [date]..."
              className="w-full p-2.5 text-xs rounded-xl border border-stone-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#12201C] mb-1">Source Document</label>
              <input
                type="text"
                required
                value={newFactSource}
                onChange={e => setNewFactSource(e.target.value)}
                placeholder="Certificate # or Charter §"
                className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#12201C] mb-1">Category</label>
              <input
                type="text"
                value={newFactCategory}
                onChange={e => setNewFactCategory(e.target.value)}
                placeholder="Accreditation / Rankings"
                className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddFactModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0A4A3D] text-white text-xs font-semibold"
            >
              Save Fact
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
