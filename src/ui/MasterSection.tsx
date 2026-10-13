import type { StemManifest } from '../song/manifest';
import { useMeter } from './ChannelStrip';
import { useGame, useHud } from './GameContext';

export function MasterSection() {
  const { session } = useGame();
  const hud = useHud();
  const { summary } = hud;
  const total = session.song.events.length;
  const autoStems = session.song.manifest.stems.filter((s) => s.role === 'auto');

  return (
    <section className="master" aria-label="Score">
      <div>
        <div className="label">Combo</div>
        <div className="stat-value" aria-live="off">
          {summary.combo}
        </div>
        <div className="stat-sub">best {summary.maxCombo}</div>
      </div>
      <div>
        <div className="label">Rhythm accuracy</div>
        <div className="stat-value small">{summary.accuracy === null ? '—' : `${(summary.accuracy * 100).toFixed(1)}%`}</div>
        <div className="stat-sub">
          {summary.judged} of {total} notes
        </div>
      </div>
      <div>
        <div className="label">Clean words</div>
        <div className="stat-value small">{hud.words.clean}</div>
        <div className="stat-sub">
          of {hud.words.done} typed · {hud.words.total} in all
        </div>
      </div>
      <div className="auto-stems">
        <div className="label">Always on</div>
        {autoStems.map((s) => (
          <AutoStemMeter key={s.id} stem={s} />
        ))}
      </div>
    </section>
  );
}

function AutoStemMeter({ stem }: { stem: StemManifest }) {
  const ref = useMeter(stem.id);
  return (
    <div className="auto-row">
      <span>{stem.label}</span>
      <div className="hmeter" aria-hidden>
        <i ref={ref as React.RefObject<HTMLElement>} />
      </div>
    </div>
  );
}
