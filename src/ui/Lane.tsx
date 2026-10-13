import { useEffect, useMemo, useRef } from 'react';
import { groupWords } from '../input/sequences';
import type { Hand } from '../rhythm/types';
import { drawLane } from './drawLane';
import { useFrame, useGame, useHud } from './GameContext';

export function Lane({ hand }: { hand: Hand }) {
  const { session } = useGame();
  return (
    <section className="lane" data-hand={hand} aria-label={`${hand} hand lane`}>
      <LaneCanvas hand={hand} />
      {session.mode === 'split' && <SequenceStrip hand={hand} />}
    </section>
  );
}

function LaneCanvas({ hand }: { hand: Hand }) {
  const { session } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const events = session.engine.eventsFor(hand);

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
    // A sentence has one next letter overall; two lanes each have their own.
    const next = session.mode === 'sentence' ? session.nextEvent() : events[session.engine.nextPendingIndex(hand)];
    drawLane(g, {
      w,
      h,
      dpr,
      hand,
      t,
      now,
      events,
      resultFor: (id) => session.engine.resultFor(id),
      nextPendingId: next && next.hand === hand ? next.id : null,
      cueShiftMs: session.guidance.cueShift(hand),
      bpm: session.song.manifest.bpm,
      flash: session.flash[hand],
      windows: session.engine.windows,
    });
  });

  return <canvas ref={canvasRef} className="lane-canvas" role="img" aria-label={`Falling keys for the ${hand} hand`} />;
}

/** The hand's upcoming words, with the next character underlined. */
function SequenceStrip({ hand }: { hand: Hand }) {
  const { session } = useGame();
  const hud = useHud();
  const events = session.engine.eventsFor(hand);
  const words = useMemo(() => groupWords(events), [events]);
  const nextIndex = hud.nextPending[hand];
  const nextEvent = events[nextIndex];
  const current = nextEvent ? words.findIndex((w) => w.word === nextEvent.word) : words.length;
  const visible = words.slice(Math.max(0, current - 1), current + 4);

  return (
    <div className="sequence" aria-label={`${hand} hand words`}>
      {visible.map((w) => (
        <span key={w.word} className={`word${w.word === nextEvent?.word ? ' current' : ''}`}>
          {w.events.map((e) => {
            const r = session.engine.resultFor(e.id);
            const cls = r ? (r.kind === 'hit' ? 'done' : 'bad') : e === nextEvent ? 'next' : '';
            return (
              <span key={e.id} className={`ch ${cls}`}>
                {e.char}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}
