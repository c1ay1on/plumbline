/** Tiny event bridge so any component (e.g. the header) can launch the demo tour. */
export const OPEN_DEMO_TOUR_EVENT = 'plumbline:open-demo-tour';

export function openDemoTour(): void {
  window.dispatchEvent(new CustomEvent(OPEN_DEMO_TOUR_EVENT));
}

export const JUDGE_EMAIL = ((import.meta.env.VITE_DEMO_EMAIL as string | undefined) || 'judge@demo.com').toLowerCase();
export const JUDGE_NOTICE_SEEN_KEY = 'plumbline_judge_notice_seen';
export const JUDGE_NOTICE_CLOSED_EVENT = 'plumbline:judge-notice-closed';

export function isJudgeEmail(email?: string | null): boolean {
  return (email || '').toLowerCase() === JUDGE_EMAIL;
}

export function demoSeenKey(userKey: string): string {
  return `plumbline_demo_tour_seen:${userKey || 'anonymous'}`;
}
