import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  PlusSquare,
  CheckSquare,
  MessageSquare,
  BarChart3,
  TrendingUp,
  Share2,
  BookOpen,
  FileText,
  Timer,
  User,
  Sparkles,
  Puzzle,
  PlayCircle,
  Rocket
} from 'lucide-react';
import type { UserRole } from '../../types';

/**
 * A scene in the Plumbline demo walkthrough.
 * `target` returns the real DOM element to spotlight. When it returns null
 * (element hidden on mobile, not rendered yet, etc.) the player falls back
 * to a centred, un-spotlit scene.
 */
export interface TourScene {
  id: string;
  /** Short label shown in the scene chip and the spotlight tag. */
  label: string;
  title: string;
  /** What this tab is for. */
  summary: string;
  /** What the user should do here: 2–3 concrete steps. */
  steps: string[];
  /** Spoken narration (Web Speech API) when audio is on. */
  narration: string;
  icon: LucideIcon;
  /** Route the tour opens in the background while this scene plays. */
  route?: string;
  target?: () => Element | null;
  /** Hero scenes (intro / outro) show a large title card. */
  hero?: boolean;
  /** Optional small note shown under the steps. */
  note?: string;
  /** True when the spotlight is a navigation tab (the tag reads “Tab · label”). */
  tab?: boolean;
  /** Optional action run once the scene's route has rendered (e.g. open an in-page sub-tab). */
  onEnter?: () => void;
}

const navItem = (path: string) => () =>
  document.querySelector(`header nav a[href="${path}"]`);

const byText = (selector: string, text: string) => () =>
  Array.from(document.querySelectorAll(selector)).find(el => el.textContent?.includes(text)) || null;

/** Nearest ancestor of an element found by its text, e.g. the card around a heading. */
const cardOf = (selector: string, text: string, ancestor: string) => () =>
  byText(selector, text)()?.closest(ancestor) || null;

export function getTourScenes(role: UserRole, firstName: string): TourScene[] {
  const isEmployee = role === 'employee';
  const canEditRules = role === 'owner' || role === 'admin' || role === 'manager';
  const reviewLabel = isEmployee ? 'My Submissions' : 'Review & Approvals';
  const hello = firstName ? `Welcome, ${firstName}` : 'Welcome to Plumbline';

  return [
    {
      id: 'intro',
      label: 'Introduction',
      title: hello,
      summary:
        'Plumbline makes sure every post is true to your brand before it goes live: AI drafts and audits the copy against your own rulebooks with cited evidence, a human signs it off, and only then does it reach your channels.',
      steps: [
        'This short demo walks through every tab in the top navigation, plus the new governance features.',
        'Each scene highlights the real tab or card and tells you exactly what to do there.',
        'Use Space to pause, ← → to move between scenes, and Esc to leave at any time.'
      ],
      narration: `${hello}. Plumbline makes sure every post is true to your brand before it goes live. Let's take a quick tour of each tab and what you should do there.`,
      icon: PlayCircle,
      route: '/app/home',
      hero: true
    },
    {
      id: 'home',
      label: 'Home',
      title: 'Home: your command centre',
      summary:
        'One view of everything that needs attention: drafts, open AI findings, approvals awaiting sign-off and posts ready to publish, plus approval timing, rule alerts, recent activity and your team.',
      steps: [
        'Scan the four counters. Click any card to jump straight to the drafts or the review queue behind it.',
        isEmployee
          ? 'Open “View Findings” on an active submission to see your manager’s feedback.'
          : 'Use “Review & Sign Off” on any submission awaiting approval.',
        isEmployee
          ? 'Check the Brand Guidelines card to confirm which guideline version is active.'
          : 'Further down, Team management lets you put each colleague in a team for the Insights error rates.'
      ],
      narration:
        'Home is your command centre. The four counters show drafts, open findings, approvals waiting, and posts ready to publish. Click any of them to jump straight to the work behind it.',
      icon: Building2,
      route: '/app/home',
      target: navItem('/app/home'),
      tab: true
    },
    {
      id: 'governance',
      label: 'Approval time & rule alerts',
      title: 'Approval time and ambiguous rule alerts',
      summary:
        'Average approval time measures submission to reviewer sign-off from the real review trail. Ambiguous rule alerts surface rules people keep disputing, with the top reasons and a suggested clarification.',
      steps: [
        'Read the mean and median approval time, and how many submissions are waiting right now.',
        'For each alert, check how often the rule was disputed and why.',
        '“Open rule in editor” to clarify the wording in Brand Knowledge, or “Dismiss alert” if the rule is fine as it is.'
      ],
      note: 'An alert appears once a rule crosses the dispute threshold. With no disputes yet, the card says so.',
      narration:
        'Two governance cards sit on Home. Average approval time shows how long sign-off really takes. Ambiguous rule alerts flag rules your team keeps disputing, so you can open the rule and clarify it.',
      icon: Timer,
      route: '/app/home',
      target: cardOf('main h2', 'Average approval time', '.grid')
    },
    {
      id: 'extension',
      label: 'Browser extension',
      title: 'Take Plumbline into your browser',
      summary:
        'The Chrome extension brings the same brand checks, with the same cited rulebook passages, to websites that are not connected to the dashboard.',
      steps: [
        'Download the extension ZIP and unzip it.',
        'In chrome://extensions turn on Developer mode, then “Load unpacked” and pick the folder with manifest.json.',
        'In the extension: Connect Account with this login, Sync Now, then Save Guidelines.'
      ],
      note: 'Add your brand details first. The extension reviews content against your workspace guidelines.',
      narration:
        'This card sets up the Plumbline browser extension. Download it, load it unpacked in Chrome with developer mode on, then connect your account, sync, and save your guidelines.',
      icon: Puzzle,
      route: '/app/home',
      target: () => byText('main section', 'Take Plumbline into your browser')()?.firstElementChild || null
    },
    {
      id: 'create',
      label: 'Create post',
      title: 'Create post: draft once, audit with evidence',
      summary:
        'Write one master draft, let AI adapt it per platform, and run a grounded audit: every flag cites the exact rulebook passage or Brand Knowledge rule behind it. Nothing is published from this page.',
      steps: [
        'Write a title and the master caption, add the campaign, and pick target channels (LinkedIn, Instagram, X…).',
        'Click “Generate with Groq” for platform variants, then Accept or Reject each suggestion.',
        'Hit “Run grounded audit”, open “Show cited rules” on each finding, then “Send for approval to manager” (or Save as draft).'
      ],
      note: 'Flags the AI cannot back with a citation are dropped, and the audit says how many.',
      narration:
        'Create post is where content starts. Write one master draft, generate platform variants, then run the grounded audit. Every finding cites the rule it comes from. Then send it for approval.',
      icon: PlusSquare,
      route: '/app/create',
      target: navItem('/app/create'),
      tab: true
    },
    {
      id: 'review',
      label: reviewLabel,
      title: isEmployee ? 'My Submissions: track your approvals' : 'Review & Approvals: human sign-off',
      summary: isEmployee
        ? 'Follow every post you have submitted, see the cited findings and read your manager’s decision. Each review shows which guideline version it was checked against.'
        : 'Every submission waits here for a human decision. Each finding shows its rule and cited passage, and each review shows the guideline version it was checked against.',
      steps: isEmployee
        ? [
            'Filter by status or platform, or search for a post, and open a submission.',
            'Click highlighted text to inspect a finding and “Show cited rules” to read the evidence.',
            '“Apply fix” to accept a correction, or “Dispute this flag” with your reason if the rule doesn’t fit.'
          ]
        : [
            'Filter the queue by status or platform and open a submission.',
            'Inspect each finding and its cited rule, read any dispute, and use “Re-check against” the new version if guidelines changed.',
            '“Request changes” with notes, or “Approve for publishing”, then “Publish to Connected Channels”.'
          ],
      note: 'Re-checks keep the old results under “Earlier checks”. Approved reviews stay locked to the version they used.',
      narration: isEmployee
        ? 'My Submissions tracks everything you have sent for approval. Open a post to read each cited finding, apply the fix, or dispute the flag with your reason.'
        : 'Review and Approvals is where a human signs off. Open a submission, read each finding and the rule it cites, re-check it if guidelines changed, then request changes or approve it.',
      icon: CheckSquare,
      route: '/app/review',
      target: navItem('/app/review'),
      tab: true
    },
    {
      id: 'comments',
      label: 'Comments',
      title: 'Comments: reply in your brand voice',
      summary:
        'Comments from your connected accounts in one inbox, with AI replies grounded only in your approved facts. Plumbline never invents URLs, dates, prices or rankings.',
      steps: [
        'Click “Sync live comments” to pull in conversations from your connected accounts.',
        'Pick a comment and “Generate draft” for a fact-grounded reply that cites its source rule.',
        'Edit if needed and “Send reply”, or flag spam or harassment inside the workspace.'
      ],
      narration:
        'Comments brings conversations from your connected accounts into one place. Sync them, generate a reply grounded in verified facts, edit it, and send, or flag anything that needs moderation.',
      icon: MessageSquare,
      route: '/app/comments',
      target: navItem('/app/comments'),
      tab: true
    },
    {
      id: 'insights',
      label: 'Insights',
      title: 'Insights: where your team keeps going wrong',
      summary: isEmployee
        ? 'Your own audit history: what gets flagged most, how often you fix drafts before review, and how fast you get approved. Every number comes from real audit and review records.'
        : 'Governance analytics built from real audit and review history: time to approve, drafts fixed before review, most violated rules, error rate by team, most disputed rules and a weekly trend.',
      steps: isEmployee
        ? [
            'Pick a date range or platform with the filters.',
            'Check the four KPI cards and your most violated rules.',
            'Use the weekly trend to see whether your findings are going down.'
          ]
        : [
            'Filter by date range, team, platform or creator.',
            'Read the KPI cards, then Most violated rules and Error rate by team to see where training is needed.',
            'In Most disputed rules, “Open rule” to clarify it. “Export CSV” for a report.'
          ],
      note: isEmployee
        ? 'A metric with no data shows “—” with an explanation, never a fake zero.'
        : 'Assign people to teams in Team management at the bottom of this page. A metric with no data shows “—”, never a fake zero.',
      narration: isEmployee
        ? 'Insights shows your own audit history: what gets flagged, how often you fix drafts before review, and how fast you get approved.'
        : 'Insights is your governance analytics. See how long approvals take, which rules are violated most, error rates by team, and which rules get disputed. Export it all as CSV.',
      icon: BarChart3,
      route: '/app/insights',
      target: navItem('/app/insights'),
      tab: true
    },
    {
      id: 'growth',
      label: 'Growth',
      title: 'Growth: governance health at a glance',
      summary:
        'A quick health check: content saved, unresolved versus resolved findings, the open review queue and connected accounts.',
      steps: [
        'Watch unresolved findings trend down as your team applies fixes.',
        'Use “Open review queue” to clear what is still pending.',
        'Use “Manage connections” to add the accounts you want covered.'
      ],
      note: 'Reach and follower analytics are not pulled from platform APIs yet, so no sample numbers are shown.',
      narration:
        'Growth is a quick health check: unresolved and resolved findings, the review queue, and your connected accounts.',
      icon: TrendingUp,
      route: '/app/growth',
      target: navItem('/app/growth'),
      tab: true
    },
    {
      id: 'channels',
      label: 'Channels',
      title: 'Channels: connect your accounts securely',
      summary:
        'Authorise the social accounts you manage through each platform’s official OAuth flow. Plumbline never asks for or stores your social passwords.',
      steps: [
        'Find the platform card and click Connect.',
        'Sign in and approve the permissions on the official platform page (2-step codes are entered there).',
        'Return here to see the account on its card. Use Refresh connections or Disconnect anytime.'
      ],
      narration:
        'Channels is where you connect your social accounts. Click connect, approve access on the official platform page, and come back. Plumbline never sees your password.',
      icon: Share2,
      route: '/app/channels',
      target: navItem('/app/channels'),
      tab: true
    },
    {
      id: 'brand',
      label: 'Brand Knowledge',
      title: 'Brand Knowledge: versioned rules the AI follows',
      summary:
        'Voice, platform tone rules, terminology, approved facts, palette, fonts and assets. Every save creates a new guideline version and shows which reviews it affects.',
      steps: [
        'Edit voice, terminology and approved facts. Rules flagged “ambiguous” can be clarified in place.',
        '“Save new version”. The change-impact panel lists affected drafts and reviews, with a one-click re-check.',
        'In Version History, “View changes” shows the rule diff, and “Restore this version” rolls back.'
      ],
      note: 'Past reviews stay linked to the guideline version they were checked against.',
      narration:
        'Brand Knowledge is the rulebook the AI audits against. Every save creates a new version, shows which reviews it affects, and lets you re-check them. Version history shows each rule change and can restore it.',
      icon: BookOpen,
      route: '/app/brand-knowledge',
      target: navItem('/app/brand-knowledge'),
      tab: true
    },
    {
      id: 'rulebooks',
      label: 'Rulebooks',
      title: 'Rulebooks: upload your brand policy',
      summary:
        'Upload your brand or social media policy as a PDF or Markdown file. Plumbline splits it into rule passages and indexes them, so every audit, here and in the extension, cites the exact passage behind each flag.',
      steps: canEditRules
        ? [
            'Open the Rulebooks tab in Brand Knowledge.',
            'Click “Upload rulebook” and pick a PDF with selectable text, or a Markdown file.',
            'Once it shows Indexed, use “Passages” to check how it was split, then run an audit on Create post.'
          ]
        : [
            'Open the Rulebooks tab in Brand Knowledge.',
            'See which rulebooks are indexed and browse their passages.',
            'Your manager or admin uploads new rulebooks; your audits cite them automatically.'
          ],
      note: 'Scanned PDFs (images only) are not supported yet.',
      narration:
        'In the Rulebooks tab you upload your brand policy as a PDF or Markdown file. Plumbline indexes it, and every audit cites the exact passage behind each flag.',
      icon: FileText,
      route: '/app/brand-knowledge',
      target: byText('main button', 'Rulebooks'),
      tab: true,
      onEnter: () => (byText('main button', 'Rulebooks')() as HTMLElement | null)?.click()
    },
    {
      id: 'profile',
      label: 'Profile',
      title: 'Profile: account and team access',
      summary:
        'Your role, workspace and sign-in details, with activity counts calculated from real records in this workspace.',
      steps: [
        'Copy the Workspace ID and share it with colleagues.',
        'Colleagues paste it during registration to join your workspace.',
        'Track posts created, posts published and findings resolved.'
      ],
      narration:
        'Profile shows your role and workspace. Share your workspace ID so colleagues can join during registration.',
      icon: User,
      route: '/app/profile',
      target: navItem('/app/profile'),
      tab: true
    },
    {
      id: 'ai',
      label: 'AI engine',
      title: 'AI status, always visible',
      summary:
        'This badge shows whether Groq AI is live and which model it uses. If it isn’t configured, audits fall back to local rule-based checks so nothing is blocked.',
      steps: [
        'Click the badge to check the configuration status.',
        'To enable it, set GROQ_API_KEY and GROQ_MODEL in backend/.env.',
        'Restart the backend. The badge turns green with the model name.'
      ],
      narration:
        'This badge shows whether Groq AI is live. If it is not configured, Plumbline falls back to local rule-based checks, so your workflow never stops.',
      icon: Sparkles,
      route: '/app/home',
      target: () => document.querySelector('header button[title="Check Groq configuration"]')
    },
    {
      id: 'outro',
      label: 'You’re ready',
      title: 'You’re ready to go',
      summary: 'A good first run through Plumbline takes about five minutes:',
      steps: [
        canEditRules
          ? 'Upload a rulebook and set up your voice, terms and facts in Brand Knowledge.'
          : 'Check your voice, terms and facts in Brand Knowledge.',
        'Create a post, generate platform variants and run the grounded audit.',
        isEmployee
          ? 'Send it for approval, track it in My Submissions, and watch your trend in Insights.'
          : 'Send it for approval, sign it off in Review & Approvals, then track it all in Insights.'
      ],
      note: 'Replay this demo anytime with the “Watch demo” button in the top bar.',
      narration:
        'You are ready. Set up your brand knowledge, create your first post, run the grounded audit, and send it for approval. You can replay this demo any time from the Watch demo button.',
      icon: Rocket,
      route: '/app/home',
      hero: true,
      target: () => document.querySelector('[data-tour="watch-demo"]')
    }
  ];
}

/** Estimated scene length (ms), tuned so narration usually fits. */
export function sceneDuration(scene: TourScene): number {
  const words = scene.narration.split(/\s+/).length;
  return Math.min(16000, Math.max(8000, Math.round((words / 2.6) * 1000) + 2000));
}
