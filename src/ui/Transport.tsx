import { useRef } from 'react';
import { useFrame, useGame, useHud } from './GameContext';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Click handlers blur the button so Enter/Space never re-trigger it mid-song. */
export const blurAfter = (fn: () => unknown) => (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.blur();
  void fn();
};

export function TransportButtons() {
  const { session } = useGame();
  const { status } = useHud();
  if (status === 'ready') {
    return (
      <button className="btn primary" onClick={blurAfter(() => session.start())}>
        Start <kbd>Enter</kbd>
      </button>
    );
  }
  if (status === 'finished') {
    return (
      <button className="btn primary" onClick={blurAfter(() => session.start())}>
        Play again <kbd>Enter</kbd>
      </button>
    );
  }
  return (
    <>
      {status === 'playing' ? (
        <button className="btn" onClick={blurAfter(() => session.pause())}>
          Pause <kbd>Esc</kbd>
        </button>
      ) : (
        <button className="btn primary" onClick={blurAfter(() => session.resume())}>
          Resume <kbd>Esc</kbd>
        </button>
      )}
      <button className="btn" onClick={blurAfter(() => session.restart())}>
        Restart
      </button>
    </>
  );
}

export function Transport() {
  const { session } = useGame();
  const { status } = useHud();
  const { manifest } = session.song;
  const fill = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);

  useFrame((t) => {
    const k = Math.min(1, Math.max(0, t / manifest.durationMs));
    if (fill.current) fill.current.style.transform = `scaleX(${k})`;
    if (time.current) time.current.textContent = `${clock(t)} / ${clock(manifest.durationMs)}`;
  });

  return (
    <header>
      <div className="transport">
        <div>
          <h1 className="title">{manifest.title}</h1>
          <div className="meta">
            {manifest.synthetic ? <b>Synthetic demo</b> : manifest.artist} · {session.song.chart.label} ·{' '}
            {Math.round(manifest.bpm)} BPM
            {manifest.synthetic ? ' · all audio is generated in your browser' : ''}
          </div>
        </div>
        {/* While the overlay is up it carries the transport buttons itself. */}
        {status === 'playing' && (
          <div className="buttons">
            <TransportButtons />
          </div>
        )}
      </div>
      <div className="progress" style={{ marginTop: 14 }}>
        <div className="progress-track">
          <div className="progress-fill" ref={fill} />
        </div>
        <span className="progress-time mono" ref={time} />
      </div>
    </header>
  );
}
