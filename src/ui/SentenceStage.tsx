import { useEffect, useMemo, useRef } from 'react';
import { drawSentence } from './drawSentence';
import { useFrame, useGame } from './GameContext';
import { buildTextTrack } from './textTrack';

/** Sentence mode's note track: the text itself scrolls through a caret in time. */
export function SentenceStage() {
  const { session } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const track = useMemo(() => buildTextTrack(session.song.events), [session]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = entry.contentRect;
      size.current = { w: width, h: height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useFrame((t, now) => {
    const g = canvasRef.current?.getContext('2d');
    const { w, h, dpr } = size.current;
    if (!g || w === 0) return;
    const { guidance } = session;
    drawSentence(g, {
      w,
      h,
      dpr,
      t,
      now,
      track,
      resultFor: (id) => session.engine.resultFor(id),
      next: session.nextEvent(),
      // One line of text can only move one way: use the mean of the two hands' shifts.
      cueShiftMs: (guidance.cueShift('left') + guidance.cueShift('right')) / 2,
      flash: session.flash,
      windows: session.engine.windows,
    });
  });

  return (
    <section className="stage" aria-label="Sentence">
      <canvas ref={canvasRef} className="stage-canvas" role="img" aria-label="The sentence scrolling through the caret" />
    </section>
  );
}
