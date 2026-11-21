import type { AuditFinding, BrandGuidelines, BrandRiskScore, VisualAuditResult } from '../../types';
import { apiClient } from '../api/client';
import { AIAuditEngine } from '../aiAuditService';

const MAX_SIDE = 1280;

function canvasToDataUrl(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot read the image.');
  ctx.fillStyle = '#ffffff'; // transparent PNGs are judged on white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function imageFrame(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try { resolve(canvasToDataUrl(img, img.naturalWidth, img.naturalHeight)); }
      catch (e) { reject(e); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format cannot be read in the browser.')); };
    img.src = url;
  });
}

/** Grabs the thumbnail frame of a video (1 second in, or a quarter of the way for short clips). */
function videoFrame(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const fail = (msg: string) => { URL.revokeObjectURL(url); reject(new Error(msg)); };
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = d > 4 ? 1 : d / 4;
    };
    video.onseeked = () => {
      try { resolve(canvasToDataUrl(video, video.videoWidth, video.videoHeight)); }
      catch (e) { reject(e); }
      finally { URL.revokeObjectURL(url); }
    };
    video.onerror = () => fail('This video format cannot be read in the browser. Try an MP4 (H.264).');
    video.src = url;
  });
}

export async function creativeThumbnail(file: File): Promise<{ dataUrl: string; kind: 'image' | 'video' }> {
  if (file.type.startsWith('video/')) return { dataUrl: await videoFrame(file), kind: 'video' };
  return { dataUrl: await imageFrame(file), kind: 'image' };
}

export async function runVisualAudit(file: File, guidelines: BrandGuidelines, altText: string): Promise<VisualAuditResult & { thumbnail: string }> {
  const { dataUrl, kind } = await creativeThumbnail(file);
  const logos = (guidelines.assets || [])
    .filter(a => a.type === 'logo' && a.url?.startsWith('data:image/'))
    .map(a => ({ name: a.name, variant: a.variant, url: a.url }));
  const result = await apiClient.visualAudit({
    image: dataUrl,
    colors: { ...guidelines.colors },
    logos,
    altText,
    guidelineVersion: guidelines.version,
    mediaKind: kind
  });
  return { ...result, thumbnail: dataUrl };
}

/**
 * Adds visual findings to the text audit and recomputes the 0-100 score, so palette and logo issues
 * count under "visual assets" and contrast / alt text under "accessibility". The visual alt-text
 * finding replaces the text audit's generic one because it carries a suggested description.
 */
export function mergeVisualFindings(textFindings: AuditFinding[], visual: AuditFinding[] | undefined, altText: string): { findings: AuditFinding[]; score: BrandRiskScore } {
  const visualNow = (visual || []).filter(f => !(f.category === 'alt_text_missing' && altText.trim()));
  const hasVisualAlt = visualNow.some(f => f.category === 'alt_text_missing');
  const base = hasVisualAlt ? textFindings.filter(f => f.category !== 'alt_text_missing') : textFindings;
  const findings = [...base, ...visualNow];
  return { findings, score: AIAuditEngine.calculateRiskScore(findings) };
}
