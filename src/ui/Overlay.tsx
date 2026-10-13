import { gradeFor } from '../rhythm/scoring';
import { HANDS } from '../rhythm/types';
import { useGame, useHud } from './GameContext';
import { SPEEDS } from './prefs';
import { TransportButtons } from './Transport';

export function Overlay() {
  const { status } = useHud();
  if (status === 'playing') return null;
  return (
    <div className="overlay">
      <div className="card" role="dialog" aria-modal="false" aria-labelledby="overlay-title">
        {status === 'ready' && <Intro />}
        {status === 'paused' && <Paused />}
        {status === 'finished' && <Results />}
      </div>
    </div>
  );
}

function Intro() {
  const { session } = useGame();
  const { hands, stems } = session.song.manifest;
  const label = (id: string) => stems.find((s) => s.id === id)?.label.toLowerCase() ?? id;
  const left = label(hands.left.instrument);
  const right = label(hands.right.instrument);
  return (
    <>
      <h2 id="overlay-title">Play the band by typing</h2>
      {session.mode === 'sentence' ? (
        <>
          <p>
            The sentence scrolls toward the cursor. Type each letter as it reaches it: one letter per beat, with a rest
            between words. Letters on the <span className="hand-l">left half</span> of the keyboard play {left}; the{' '}
            <span className="hand-r">right half</span> plays {right}.
          </p>
          <p>
            Read the next word ahead and play it in time. Hit every letter and the word lights up, and its instruments
            come up in the mix. Spaces are optional.
          </p>
        </>
      ) : (
        <>
          <p>
            Type each key as it lands on the line. Your <span className="hand-l">left hand</span> plays {left}; your{' '}
            <span className="hand-r">right hand</span> plays {right}.
          </p>
          <p>
            Play in time and that instrument comes up in the mix. Miss and it fades out. Each lane spells its own words,
            one letter per beat. <strong>Don’t type the spaces.</strong>
          </p>
        </>
      )}
      <p className="touch-note">This needs a physical keyboard.</p>
      <SetupControls />
      <div className="buttons">
        <TransportButtons />
      </div>
    </>
  );
}

/** Chart and speed pickers. Changing either reloads the song. */
function SetupControls() {
  const { session, setup, onSetupChange } = useGame();
  const { manifest, chart } = session.song;
  return (
    <div className="setup">
      {manifest.charts.length > 1 && (
        <div className="setting">
          <span className="label" id="mode-label">
            Mode
          </span>
          <div className="segmented" role="group" aria-labelledby="mode-label">
            {manifest.charts.map((c) => (
              <button key={c.id} aria-pressed={c.id === chart.id} onClick={() => onSetupChange({ chartId: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {manifest.synthetic && (
        <div className="setting">
          <span className="label" id="speed-label">
            Speed
          </span>
          <div className="segmented" role="group" aria-labelledby="speed-label">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={s === setup.speed} onClick={() => onSetupChange({ speed: s })}>
                {Math.round(s * 100)}%
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Paused() {
  return (
    <>
      <h2 id="overlay-title">Paused</h2>
      <p>The song picks up exactly where it stopped.</p>
      <div className="buttons">
        <TransportButtons />
      </div>
    </>
  );
}

function Results() {
  const { session } = useGame();
  const { summary, words } = useHud();
  const { counts } = summary;
  const { hands, stems } = session.song.manifest;
  const label = (id: string) => stems.find((s) => s.id === id)?.label ?? id;
  const rows: [string, number][] = [
    ['Perfect', counts.perfect],
    ['Great', counts.great],
    ['Good', counts.good],
    ['Wrong key', counts.wrong],
    ['Missed', counts.miss],
    ['Extra keys', counts.stray],
  ];

  return (
    <>
      <h2 id="overlay-title">Song complete</h2>
      <div className="results-head">
        <div className="grade" aria-label={`Grade ${gradeFor(summary.accuracy)}`}>
          {gradeFor(summary.accuracy)}
        </div>
        <div>
          <div className="stat-value small">
            {summary.accuracy === null ? '—' : `${(summary.accuracy * 100).toFixed(1)}%`}
          </div>
          <div className="stat-sub">
            rhythm accuracy · best combo {summary.maxCombo} · {words.clean} of {words.total} words clean
          </div>
        </div>
      </div>
      <dl className="counts">
        {rows.map(([name, n]) => (
          <div key={name}>
            <dt className="label">{name}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <div className="hand-results">
        {HANDS.map((h) => {
          const s = summary.hands[h];
          const mean = s.meanOffsetMs;
          return (
            <div key={h}>
              <span className={h === 'left' ? 'hand-l' : 'hand-r'}>{label(hands[h].instrument)}</span>{' '}
              {s.accuracy === null ? '—' : `${Math.round(s.accuracy * 100)}%`}
              {mean !== null && Math.abs(mean) >= 3 ? ` · on average ${Math.abs(Math.round(mean))} ms ${mean > 0 ? 'late' : 'early'}` : mean !== null ? ' · right on the beat' : ''}
            </div>
          );
        })}
      </div>
      <SetupControls />
      <div className="buttons">
        <TransportButtons />
      </div>
    </>
  );
}
