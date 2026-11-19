import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper over the browser Web Speech API (speechSynthesis).
 * Fails silently when unsupported; `supported` tells the UI to hide/disable the toggle.
 */
export function useNarration() {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined';

  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const pick = () => {
      try {
        const voices = synth.getVoices();
        voiceRef.current =
          voices.find(v => /en[-_]IN/i.test(v.lang)) ||
          voices.find(v => /en[-_]GB/i.test(v.lang) && /google|natural|female/i.test(v.name)) ||
          voices.find(v => /en[-_]US/i.test(v.lang) && /google|natural|samantha|aria|jenny/i.test(v.name)) ||
          voices.find(v => /^en/i.test(v.lang)) ||
          null;
      } catch {
        voiceRef.current = null;
      }
    };
    pick();
    synth.addEventListener?.('voiceschanged', pick);
    return () => synth.removeEventListener?.('voiceschanged', pick);
  }, [supported]);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    setSpeaking(false);
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text) return;
    try {
      window.speechSynthesis.cancel();
      const token = ++tokenRef.current;
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang || 'en-US';
      utterance.rate = 1.03;
      utterance.pitch = 1;
      const done = () => { if (token === tokenRef.current) setSpeaking(false); };
      utterance.onend = done;
      utterance.onerror = done;
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
    }
  }, [supported]);

  useEffect(() => () => { if (supported) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } } }, [supported]);

  return { supported, speaking, speak, stop };
}
