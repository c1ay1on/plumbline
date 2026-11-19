/** Tiny event bridge so any component (e.g. the header) can launch the demo tour. */
export const OPEN_DEMO_TOUR_EVENT = 'plumbline:open-demo-tour';

export function openDemoTour(): void {
  window.dispatchEvent(new CustomEvent(OPEN_DEMO_TOUR_EVENT));
}

export function demoSeenKey(userKey: string): string {
  return `plumbline_demo_tour_seen:${userKey || 'anonymous'}`;
}
