import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import { GameSession } from './game/GameSession';
import { ManifestError, loadSong, type StemCache } from './song/loadSong';
import { GameScreen, type Setup } from './ui/GameScreen';
import { FONTS } from './ui/palette';
import { loadPrefs, savePrefs } from './ui/prefs';

const MANIFEST_URL = `${import.meta.env.BASE_URL}songs/neon-tide/manifest.json`;

type Phase =
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'error'; message: string; details: string[] }
  | { kind: 'ready'; session: GameSession };

export function App() {
  const [setup, setSetup] = useState<Setup>(() => {
    const { chartId, speed } = loadPrefs();
    return { chartId, speed };
  });
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', done: 0, total: 0 });
  const stemCache = useRef<StemCache>(new Map());

  // One AudioContext for the app's lifetime. It starts suspended (autoplay
  // policy) and is resumed by the first Start; stems render offline meanwhile.
  useEffect(() => {
    const engine = new AudioEngine(new AudioContext({ latencyHint: 'interactive' }));
    setAudio(engine);
    return () => void engine.dispose();
  }, []);

  // (Re)load the song whenever the chart or speed changes.
  useEffect(() => {
    if (!audio) return;
    let cancelled = false;
    let session: GameSession | null = null;
    setPhase({ kind: 'loading', done: 0, total: 0 });

    (async () => {
      try {
        const [song] = await Promise.all([
          loadSong(MANIFEST_URL, audio.ctx, {
            chartId: setup.chartId,
            speed: setup.speed,
            cache: stemCache.current,
            onProgress: (done, total) => !cancelled && setPhase({ kind: 'loading', done, total }),
          }),
          // Canvas text needs the fonts before the first frame.
          document.fonts?.load(`600 19px ${FONTS.mono}`),
          document.fonts?.load(`700 13px ${FONTS.label}`),
        ]);
        if (cancelled) return;
        stemCache.current = song.cache;
        audio.setStems(
          song.manifest.stems.map((s) => ({ id: s.id, buffer: song.buffers.get(s.id)!, gain: 0, pan: s.pan })),
        );
        const prefs = loadPrefs();
        session = new GameSession(song, audio, { guidanceMode: prefs.guidance, calibrationMs: prefs.calibrationMs });
        // Dev-only handle for console poking and automated play-throughs.
        if (import.meta.env.DEV) Object.assign(window, { __typopro: { session, audio } });
        setPhase({ kind: 'ready', session });
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message.split('\n')[0] : String(err),
          details: err instanceof ManifestError ? err.errors : [],
        });
      }
    })();

    return () => {
      cancelled = true;
      session?.dispose();
      audio.stop();
    };
  }, [audio, setup.chartId, setup.speed]);

  const changeSetup = useCallback((patch: Partial<Setup>) => {
    setSetup((s) => ({ ...s, ...patch }));
    savePrefs(patch);
  }, []);

  if (phase.kind === 'ready' && audio) {
    return <GameScreen session={phase.session} audio={audio} setup={setup} onSetupChange={changeSetup} />;
  }
  if (phase.kind === 'error') {
    return (
      <div className="status-screen" role="alert">
        <div>
          <p>The song could not be loaded: {phase.message}</p>
          {phase.details.length > 0 && <pre>{phase.details.join('\n')}</pre>}
        </div>
      </div>
    );
  }
  return (
    <div className="status-screen" aria-live="polite">
      <p className="label">
        {phase.kind === 'loading' && phase.total ? `Rendering stems · ${phase.done} of ${phase.total}` : 'Rendering stems…'}
      </p>
    </div>
  );
}
