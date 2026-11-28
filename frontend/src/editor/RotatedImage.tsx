import { useEffect, useRef } from 'react';
import type { ViewDeg } from './viewRotation.js';

/**
 * Bild im Uhrzeigersinn gedreht. Auf ein Canvas gezeichnet statt per
 * CSS-`transform`, damit die gedrehten Masse auch den Platz bestimmen und
 * nichts überlappt.
 */
export function RotatedImage({ src, deg, alt }: { src: string; deg: ViewDeg; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (cancelled || !canvas || !context) return;
      const sideways = deg === '90' || deg === '270';
      canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
      canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((Number(deg) * Math.PI) / 180);
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, deg]);

  return <canvas ref={canvasRef} role="img" aria-label={alt} className="paper" style={{ maxWidth: 'min(320px, 100%)', height: 'auto' }} />;
}
