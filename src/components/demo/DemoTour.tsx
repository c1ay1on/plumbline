import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Volume2,
  VolumeX,
  Info,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getTourScenes, sceneDuration, TourScene } from './tourScenes';
import { useNarration } from './useNarration';
import { OPEN_DEMO_TOUR_EVENT, demoSeenKey, isJudgeEmail } from './demoTourEvents';
import './demoTour.css';

interface SpotRect { top: number; left: number; width: number; height: number }

const SPOT_PAD = 6;
const AUTO_OPEN_PATH = '/app/home';
const MUTE_KEY = 'plumbline_demo_tour_muted';

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const isUsableRect = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;

/**
 * Video-style guided walkthrough of every tab in Plumbline.
 * Auto-opens the first time a user lands on /app/home and can be replayed from the "Watch demo" button.
 */
export const DemoTour: React.FC = () => {
  const { currentUser, currentRole, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const narration = useNarration();

  const firstName = (currentUser?.name || '').trim().split(/\s+/)[0] || '';
  const isJudge = isJudgeEmail(currentUser?.email);
  const scenes = useMemo(() => getTourScenes(currentRole, isJudge ? '' : firstName, isJudge), [currentRole, firstName, isJudge]);
  const durations = useMemo(() => scenes.map(sceneDuration), [scenes]);
  const totalMs = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(MUTE_KEY) !== 'false'; } catch { return true; }
  });
  const [elapsed, setElapsed] = useState(0);
  const [spot, setSpot] = useState<SpotRect | null>(null);
  const [playerHeight, setPlayerHeight] = useState(320);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const elapsedRef = useRef(0);
  const startPathRef = useRef('/app/home');
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const scrolledForSceneRef = useRef<number>(-1);
  const autoOpenedRef = useRef(false);

  const scene: TourScene = scenes[Math.min(index, scenes.length - 1)];
  const isLast = index === scenes.length - 1;
  const userKey = currentUser?.id || currentUser?.email || '';

  // ---------- open / close ----------
  const openTour = useCallback((startAt = 0) => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    startPathRef.current = location.pathname;
    elapsedRef.current = 0;
    setElapsed(0);
    setIndex(startAt);
    setPlaying(true);
    setOpen(true);
    try { localStorage.setItem(demoSeenKey(userKey), new Date().toISOString()); } catch { /* storage unavailable */ }
  }, [location.pathname, userKey]);

  const closeTour = useCallback((goTo?: string) => {
    narration.stop();
    setOpen(false);
    setSpot(null);
    const destination = goTo || startPathRef.current;
    if (destination && destination !== window.location.pathname) navigate(destination);
    window.setTimeout(() => restoreFocusRef.current?.focus?.(), 50);
  }, [narration, navigate]);

  // Replay button / external trigger
  useEffect(() => {
    const handler = () => openTour(0);
    window.addEventListener(OPEN_DEMO_TOUR_EVENT, handler);
    return () => window.removeEventListener(OPEN_DEMO_TOUR_EVENT, handler);
  }, [openTour]);

  // First visit to the dashboard → auto-open once per user
  useEffect(() => {
    if (open || autoOpenedRef.current || !isAuthenticated || !userKey) return;
    if (location.pathname !== AUTO_OPEN_PATH) return;
    // The judge account gets its own welcome popup, which offers the tour itself.
    if (isJudgeEmail(currentUser?.email)) return;
    let seen = false;
    try { seen = Boolean(localStorage.getItem(demoSeenKey(userKey))); } catch { seen = true; }
    if (seen) return;
    autoOpenedRef.current = true;
    const t = window.setTimeout(() => openTour(0), 900);
    return () => window.clearTimeout(t);
  }, [open, isAuthenticated, userKey, location.pathname, openTour, currentUser?.email]);

  // ---------- scene navigation ----------
  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(scenes.length - 1, next));
    elapsedRef.current = 0;
    setElapsed(0);
    setIndex(clamped);
  }, [scenes.length]);

  const next = useCallback(() => {
    if (isLast) { setPlaying(false); elapsedRef.current = durations[index]; setElapsed(durations[index]); return; }
    goTo(index + 1);
  }, [isLast, goTo, index, durations]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Route + narration per scene
  useEffect(() => {
    if (!open) return;
    scrolledForSceneRef.current = -1;
    if (scene.route && scene.route !== window.location.pathname) {
      navigate(scene.route);
      window.scrollTo({ top: 0 });
    }
    if (!muted && playing) narration.speak(scene.narration);
    else narration.stop();
    // Optional in-page action (e.g. open a sub-tab) once the route has rendered.
    const enterTimer = scene.onEnter ? window.setTimeout(() => scene.onEnter?.(), 400) : 0;
    return () => window.clearTimeout(enterTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // ---------- playback clock ----------
  const speakingRef = useRef(false);
  speakingRef.current = narration.speaking && !muted;
  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0;
    let last = performance.now();
    const duration = durations[index];
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      elapsedRef.current += dt;
      if (elapsedRef.current >= duration) {
        // Hold on the final frame while narration finishes (capped so a stuck engine can't freeze the tour).
        if (speakingRef.current && elapsedRef.current < duration + 9000) {
          setElapsed(duration);
          raf = requestAnimationFrame(tick);
          return;
        }
        setElapsed(duration);
        next();
        return;
      }
      setElapsed(elapsedRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, index, durations, next]);

  const togglePlay = useCallback(() => {
    setPlaying(p => {
      const nextPlaying = !p;
      if (!nextPlaying) narration.stop();
      else {
        if (isLast && elapsedRef.current >= durations[index]) { elapsedRef.current = 0; setElapsed(0); }
        if (!muted) narration.speak(scene.narration);
      }
      return nextPlaying;
    });
  }, [narration, muted, scene, isLast, durations, index]);

  const toggleMute = useCallback(() => {
    if (!narration.supported) return;
    setMuted(m => {
      const nextMuted = !m;
      try { localStorage.setItem(MUTE_KEY, String(nextMuted)); } catch { /* ignore */ }
      if (nextMuted) narration.stop();
      else if (playing) narration.speak(scene.narration);
      return nextMuted;
    });
  }, [narration, playing, scene]);

  const restart = useCallback(() => { goTo(0); setPlaying(true); }, [goTo]);

  // ---------- spotlight tracking ----------
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      const el = scene.target?.() || null;
      let rect: SpotRect | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (isUsableRect(r)) {
          const playerTop = window.innerHeight - (playerRef.current?.offsetHeight || 0) - 16;
          // Bring in-page targets into view once per scene (nav items are sticky and always visible).
          if (scrolledForSceneRef.current !== index && (r.top < 96 || r.top > playerTop - 40)) {
            scrolledForSceneRef.current = index;
            window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 112), behavior: 'smooth' });
          } else if (scrolledForSceneRef.current !== index) {
            scrolledForSceneRef.current = index;
          }
          rect = {
            top: r.top - SPOT_PAD,
            left: r.left - SPOT_PAD,
            width: r.width + SPOT_PAD * 2,
            height: r.height + SPOT_PAD * 2
          };
        }
      }
      const key = rect ? `${Math.round(rect.top)}|${Math.round(rect.left)}|${Math.round(rect.width)}|${Math.round(rect.height)}` : 'none';
      if (key !== lastKey) { lastKey = key; setSpot(rect); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, index, scene]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open || !playerRef.current) return;
    const el = playerRef.current;
    const measure = () => setPlayerHeight(el.offsetHeight);
    measure();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return;
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, index]);

  // Focus the player when it opens
  useEffect(() => {
    if (open) window.setTimeout(() => playerRef.current?.focus(), 30);
  }, [open]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeTour(); return; }
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); if (!isLast) goTo(index + 1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMute(); return; }
      if (e.key === 'Home') { e.preventDefault(); restart(); return; }
      if (e.key === 'Tab' && playerRef.current) {
        // Keep focus inside the player while the tour is open.
        const focusables = Array.from(playerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
        if (focusables.length === 0) { e.preventDefault(); return; }
        const first = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!playerRef.current.contains(active)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && (active === first || active === playerRef.current)) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && active === lastEl) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, closeTour, togglePlay, goTo, index, isLast, toggleMute, restart]);

  if (!open) return null;

  // ---------- derived layout ----------
  const sceneProgress = Math.min(1, elapsed / durations[index]);
  const elapsedTotal = durations.slice(0, index).reduce((a, b) => a + b, 0) + Math.min(elapsed, durations[index]);
  const Icon = scene.icon;
  const finished = isLast && !playing && elapsed >= durations[index];

  const hole: SpotRect = spot || { top: viewport.h * 0.35, left: viewport.w / 2, width: 0, height: 0 };
  const tagBelow = spot ? spot.top + spot.height + 12 : 0;
  const tagLeft = spot ? Math.min(Math.max(12, spot.left), viewport.w - 240) : 0;
  const showTag = Boolean(spot) && !scene.hero && tagBelow + 40 < viewport.h - playerHeight - 16 && spot!.height < viewport.h * 0.4;
  const showHero = Boolean(scene.hero) && viewport.h >= 700;

  return (
    <div className="pl-tour-root" role="presentation">
      {/* Click blocker: the page stays visible but inert while the demo plays */}
      <div className="pl-tour-blocker" aria-hidden="true" onClick={() => playing && togglePlay()} />

      {/* Spotlight cut-out + animated ring */}
      <div
        className={`pl-tour-spot ${spot ? 'pl-tour-spot--active' : ''}`}
        aria-hidden="true"
        style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: spot ? 14 : 9999 }}
      />

      {showTag && spot && (
        <div key={`tag-${scene.id}`} className="pl-tour-tag" aria-hidden="true" style={{ top: tagBelow, left: tagLeft }}>
          <div className="relative inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0A4A3D] shadow-plumb-modal ring-1 ring-emerald-200">
            <span className="absolute -top-1 left-5 h-2 w-2 rotate-45 bg-white ring-0" />
            <Icon className="h-3.5 w-3.5" />
            {scene.tab ? `Tab · ${scene.label}` : scene.label}
          </div>
        </div>
      )}

      {/* Hero title card for intro / outro */}
      {showHero && (
        <div className="pointer-events-none fixed inset-x-0 flex justify-center px-4" style={{ top: Math.max(120, (viewport.h - playerHeight) / 2 - 130) }}>
          <div key={`hero-${scene.id}`} className="pl-tour-hero relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A4A3D] px-10 py-8 text-center text-white shadow-2xl">
            <div className="pl-tour-glow absolute inset-0" aria-hidden="true" />
            <div className="relative">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
                <img src="/logo.png" alt="" className="h-11 w-11 object-contain" />
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300">
                {scene.id === 'intro' ? 'Plumbline · Guided demo' : 'Demo complete'}
              </div>
              <div className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                {scene.id === 'intro' ? 'Every post, true to your brand.' : 'You’re ready to go.'}
              </div>
              <div className="mt-2 text-sm text-emerald-100/80">
                {scene.id === 'intro'
                  ? `${scenes.length - 2} stops · about ${Math.round(totalMs / 60000)} minutes · narration available`
                  : 'Draft → AI audit → human sign-off → publish.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Player */}
      <div
        ref={playerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pl-tour-title"
        aria-describedby="pl-tour-summary"
        tabIndex={-1}
        className="pl-tour-player fixed inset-x-0 bottom-3 mx-auto w-[min(700px,calc(100vw-20px))] overflow-hidden rounded-2xl border border-white/10 bg-[#0B1F1A]/95 text-white shadow-2xl outline-none backdrop-blur-md sm:bottom-5"
        style={{ maxHeight: 'calc(100vh - 24px)' }}
      >
        <div className="max-h-[calc(100vh-24px)] overflow-y-auto">
          {/* Header row */}
          <div className="flex items-center justify-between gap-3 px-5 pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#167A58] text-white">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">
                  Scene {String(index + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
                </div>
                <div className="truncate text-xs font-medium text-white/70">{scene.label}</div>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                disabled={!narration.supported}
                aria-pressed={!muted}
                aria-label={!narration.supported ? 'Narration not supported in this browser' : muted ? 'Turn narration on (M)' : 'Turn narration off (M)'}
                title={!narration.supported ? 'Narration is not supported in this browser' : muted ? 'Turn narration on (M)' : 'Turn narration off (M)'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${muted ? 'border-white/15 text-white/70 hover:bg-white/10' : 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'}`}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{muted ? 'Narration off' : 'Narration on'}</span>
                {!muted && narration.speaking && (
                  <span className="pl-tour-eq ml-0.5 inline-flex h-3 items-end" aria-hidden="true"><span /><span /><span /></span>
                )}
              </button>
              <button
                type="button"
                onClick={() => closeTour()}
                aria-label="Close demo (Esc)"
                title="Close demo (Esc)"
                className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Scene content */}
          <div key={scene.id} className="pl-tour-scene-in px-5 pb-1 pt-3">
            <h2 id="pl-tour-title" aria-live="polite" className="text-lg font-extrabold leading-snug tracking-tight sm:text-xl">
              {scene.title}
            </h2>
            <p id="pl-tour-summary" className="mt-1.5 text-[13px] leading-relaxed text-emerald-50/80">
              {scene.summary}
            </p>

            <div className="mt-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">
              {scene.hero ? (scene.id === 'intro' ? 'How this demo works' : 'Your first run') : 'What to do here'}
            </div>
            <ol className="mt-2 space-y-1.5">
              {scene.steps.map((step, i) => (
                <li
                  key={i}
                  className="pl-tour-step flex items-start gap-2.5 text-[13px] leading-snug text-white/90"
                  style={{ animationDelay: `${120 + i * 110}ms` }}
                >
                  <span className="mt-[1px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/40">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {scene.note && (
              <p className="pl-tour-step mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-[11.5px] leading-snug text-amber-100/90" style={{ animationDelay: '480ms' }}>
                <Info className="mt-[1px] h-3.5 w-3.5 flex-shrink-0 text-amber-300" />
                <span>{scene.note}</span>
              </p>
            )}
          </div>

          {/* Timeline */}
          <div className="px-5 pt-4" role="group" aria-label="Demo timeline">
            <div className="flex items-center gap-1">
              {scenes.map((s, i) => {
                const fill = i < index ? 1 : i === index ? sceneProgress : 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Go to scene ${i + 1}: ${s.label}`}
                    aria-current={i === index ? 'step' : undefined}
                    title={s.label}
                    className="group relative h-4 flex-1 py-1.5"
                  >
                    <span className="block h-1 overflow-hidden rounded-full bg-white/15 transition-[height] group-hover:h-1.5">
                      <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${fill * 100}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="sr-only"
              role="progressbar"
              aria-label="Demo progress"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalMs / 1000)}
              aria-valuenow={Math.round(elapsedTotal / 1000)}
            />
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-2">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={prev} disabled={index === 0} aria-label="Previous scene (←)" title="Previous (←)" className="rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={finished ? restart : togglePlay}
                aria-label={finished ? 'Replay demo' : playing ? 'Pause (Space)' : 'Play (Space)'}
                title={finished ? 'Replay' : playing ? 'Pause (Space)' : 'Play (Space)'}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0A4A3D] shadow-lg hover:bg-emerald-50"
              >
                {finished ? <RotateCcw className="h-4 w-4" /> : playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
              </button>
              <button type="button" onClick={() => goTo(index + 1)} disabled={isLast} aria-label="Next scene (→)" title="Next (→)" className="rounded-full p-2 text-white/80 hover:bg-white/10 disabled:opacity-30">
                <SkipForward className="h-4 w-4" />
              </button>
              <span className="ml-2 font-mono text-[11px] tabular-nums text-white/60">
                {formatTime(elapsedTotal)} / {formatTime(totalMs)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-white/40 md:inline">Space pause · ← → scenes · M audio · Esc close</span>
              {isLast ? (
                <>
                  <button type="button" onClick={() => closeTour()} className="rounded-lg px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
                    Finish
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTour('/app/create')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#167A58] px-3.5 py-2 text-xs font-bold text-white shadow-md hover:bg-[#126150]"
                  >
                    Create your first post <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => closeTour()} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
                  Skip demo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DemoTour;
