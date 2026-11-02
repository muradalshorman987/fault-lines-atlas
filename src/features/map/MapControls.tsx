// The map controls (#mapctl): zoom, reset, map type and the layers popover. They sit inside #stage at the
// inline-end bottom corner; zoom and reset go to whichever map is mounted, map type and layers go through the store.

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { Prefs } from '../../app/prefs';
import { atlas, useAtlas } from '../../app/store';
import { useT } from '../../app/useT';
import { esc } from '../../ui/dom';
import { Icon } from '../../ui/Icon';
import './controls.css';
import './strings';

/** What the controls need from the mounted map (canvas engine or detailed map). */
export interface MapControlsApi { zoom(f: number): void; reset(): void }

type Projection = Prefs['projection'];
const PROJECTIONS: { id: Projection; icon: string }[] = [
  { id: 'globe', icon: 'globe' },
  { id: 'flat', icon: 'flat' },
  { id: 'detailed', icon: 'route' },
];
const LAYERS = ['labels', 'graticule', 'boundaries', 'disputed'] as const;
/** The detailed map draws basemap labels and our borders; it has no graticule or disputed hatching. */
const DETAILED_LAYERS = new Set<string>(['labels', 'boundaries']);
const stop = (e: SyntheticEvent) => e.stopPropagation();

type Pop = 'proj' | 'layers';

export function MapControls({ api }: { api: MapControlsApi }) {
  const { t } = useT();
  const projection = useAtlas((s) => s.projection);
  const layers = useAtlas((s) => s.layers);
  const [open, setOpenState] = useState<Pop | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const buttons = { proj: useRef<HTMLButtonElement>(null), layers: useRef<HTMLButtonElement>(null) };
  // where focus goes once a popover has opened or closed
  const focusNext = useRef<{ to: 'pop' | 'btn'; which: Pop } | null>(null);

  const setOpen = (v: Pop | null, focusBtn = false) => {
    const which = v ?? open;
    focusNext.current = which && (v || focusBtn) ? { to: v ? 'pop' : 'btn', which } : null;
    setOpenState(v);
  };

  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (!want) return;
    if (want.to === 'pop') {
      const sel = want.which === 'proj' ? '#mapctl-proj input:checked' : '#mapctl-layers input';
      box.current?.querySelector<HTMLInputElement>(sel)?.focus({ preventScroll: true });
    } else buttons[want.which].current?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && box.current?.contains(e.target))) { focusNext.current = null; setOpenState(null); }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const btn = (ctl: string, ic: string, label: string, onClick: () => void) => (
    <button className="btn icon ctl" type="button" data-ctl={ctl} aria-label={label} data-tip={esc(label)} onClick={onClick}><Icon name={ic} size={18} /></button>
  );
  const popBtn = (which: Pop, ic: string, label: string, ctl: string) => (
    <button ref={buttons[which]} className="btn icon ctl" type="button" data-ctl={ctl} aria-label={label} data-tip={esc(label)}
      aria-expanded={open === which} aria-pressed={open === which} aria-controls={`mapctl-${which}`} onClick={() => setOpen(open === which ? null : which)}>
      <Icon name={ic} size={18} />
    </button>
  );
  const current = PROJECTIONS.find((p) => p.id === projection) ?? PROJECTIONS[0]!;
  const shownLayers = projection === 'detailed' ? LAYERS.filter((k) => DETAILED_LAYERS.has(k)) : LAYERS;

  return (
    <div id="mapctl" ref={box} role="group" aria-label={t('map.ctl')}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(null, true); } }}
      onPointerDown={stop} onWheel={stop} onDoubleClick={stop}>
      <div className="ctl-stack">
        {btn('zin', 'plus', t('map.zoomIn'), () => api.zoom(1.6))}
        {btn('zout', 'minus', t('map.zoomOut'), () => api.zoom(1 / 1.6))}
        {btn('reset', 'home', t('map.reset'), () => api.reset())}
      </div>
      <div className="ctl-stack">
        {popBtn('proj', current.icon, t('map.proj'), 'proj')}
        {popBtn('layers', 'layers', t('map.layers'), 'layers')}
      </div>
      <div className="ctl-pop" id="mapctl-proj" role="radiogroup" aria-label={t('map.proj')} hidden={open !== 'proj'}>
        <p className="lc-label">{t('map.proj')}</p>
        {PROJECTIONS.map((p) => (
          <label className="ctl-check ctl-radio" key={p.id}>
            <input type="radio" name="mapctl-proj" value={p.id} data-proj={p.id} checked={projection === p.id}
              aria-describedby={p.id === 'detailed' ? 'mapctl-proj-note' : undefined}
              onChange={() => atlas.set({ projection: p.id })}
              // a pointer choice is final; arrow keys also "click" (detail 0) and must leave the group open
              onClick={(e) => { if (e.detail > 0) setOpen(null, true); }} />
            <Icon name={p.icon} size={16} />
            <span className="ctl-name">{t('map.proj.' + p.id)}</span>
          </label>
        ))}
        <p className="ctl-note" id="mapctl-proj-note">{t('map.proj.detailedNote')}</p>
      </div>
      <div className="ctl-pop" id="mapctl-layers" role="group" aria-label={t('map.layers')} hidden={open !== 'layers'}>
        <p className="lc-label">{t('map.layers')}</p>
        {shownLayers.map((k) => (
          <label className="ctl-check" key={k}>
            <input type="checkbox" data-layer={k} checked={layers[k]} onChange={(e) => atlas.setLayer(k, e.target.checked)} />
            <span>{t('map.lyr.' + k)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
