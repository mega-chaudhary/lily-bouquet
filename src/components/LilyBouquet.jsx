import { useEffect, useRef } from 'react';
import { Renderer } from '../engine/renderer.js';
import './LilyBouquet.css';

/**
 * Full-screen ASCII lily bouquet.
 * Click / tap or press R to replay, SPACE to pause.
 * Add ?t=6 to the URL to show a single frozen frame (handy for screenshots).
 */
export default function LilyBouquet() {
  const mainRef = useRef(null);
  const glowRef = useRef(null);
  const replayRef = useRef(() => {});

  useEffect(() => {
    const renderer = new Renderer(mainRef.current, glowRef.current);
    const fit = () =>
      renderer.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    fit();

    const frozen = new URLSearchParams(window.location.search).get('t');
    if (frozen !== null) {
      renderer.render(parseFloat(frozen) || 0);
      window.__renderAt = (t) => renderer.render(t);
      window.__renderer = renderer;
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }

    let start = performance.now();
    let paused = false;
    let pausedAt = 0;
    let raf = 0;
    const loop = (now) => {
      renderer.render(paused ? pausedAt : (now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    replayRef.current = () => {
      start = performance.now();
      paused = false;
    };
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') replayRef.current();
      if (e.code === 'Space') {
        e.preventDefault();
        if (paused) start = performance.now() - pausedAt * 1000;
        else pausedAt = (performance.now() - start) / 1000;
        paused = !paused;
      }
    };
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="bouquet" onPointerDown={() => replayRef.current()}>
      <canvas ref={glowRef} className="bouquet__glow" aria-hidden="true" />
      <canvas ref={mainRef} className="bouquet__main" role="img" aria-label="ASCII art lily bouquet" />
    </div>
  );
}
