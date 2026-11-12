import { useEffect, useRef } from 'react';

// Keep the stored Unicode emoji, but render it on a tiny grid for the pixel UI.
// Native emoji fonts vary by platform; no external image service is involved.
export function PixelEmoji({ emoji }: { emoji: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 16, 16);
    context.font = '14px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, 8, 9, 16);
  }, [emoji]);
  return <canvas ref={canvas} width={16} height={16} className="pixel-emoji" aria-hidden="true">{emoji}</canvas>;
}
