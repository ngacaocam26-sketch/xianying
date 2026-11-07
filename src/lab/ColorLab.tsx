import { useEffect, useRef, useState } from 'react';
import { createReliefScene, DEFAULT_RELIEF } from '../relief/reliefScene';
import type { ReliefParams, ReliefScene } from '../relief/reliefScene';
import { IMAGERY, imageLabel } from '../imagery';
import type { ImageId } from '../imagery';
import { findPalette, IMAGE_COLORS, PALETTES } from '../palette';
import type { PaletteId } from '../palette';
import { DEFAULT_VISUAL } from '../visual';
import './lab.css';

// 颜色试验：点意象会换成它的默认颜色（IMAGE_COLORS），也可以任选配色和鲜艳度对比。不接 AI、不保存，主暗房不受影响。
const coarse = window.matchMedia('(pointer: coarse)').matches;
const params: ReliefParams = coarse || Math.min(window.innerWidth, window.innerHeight) < 600
  ? { ...DEFAULT_RELIEF, density: 380, size: 2 } : DEFAULT_RELIEF;

const SLIDERS = [
  { key: 'vivid', label: '鲜艳度' },
  { key: 'luminosity', label: '明暗' },
  { key: 'warmth', label: '冷暖' },
] as const;
type Levels = Record<typeof SLIDERS[number]['key'], number>;

// 地址栏可以带上组合，方便对比和转述：/color-lab?image=rain&palette=deep&vivid=0.7&luminosity=0.4
// 没写的部分用这个意象的默认颜色。
const query = new URLSearchParams(window.location.search);
const queryImage = IMAGERY.find(item => item.id === query.get('image'))?.id ?? 'bloom';
const initialDefault = IMAGE_COLORS[queryImage];
const queryPalette = query.get('palette') === 'mono' ? null
  : PALETTES.find(item => item.id === query.get('palette'))?.id ?? initialDefault.palette;
const level = (key: string, fallback: number) => {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
};
const initialLevels = {
  vivid: level('vivid', initialDefault.vivid || 0.85),
  luminosity: level('luminosity', initialDefault.luminosity),
  warmth: level('warmth', 0.5),
};

export default function ColorLab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const paletteRowRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReliefScene | null>(null);
  const [image, setImage] = useState<ImageId>(queryImage);
  const [palette, setPalette] = useState<PaletteId | null>(queryPalette);
  const [levels, setLevels] = useState<Levels>(initialLevels);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '显影 · 颜色试验';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const ring = ringRef.current;
    if (!container || !ring) return;
    let scene: ReliefScene;
    try {
      scene = createReliefScene(container, ring, {
        params, onError: setMessage,
        insets: () => ({ top: 96, bottom: (dockRef.current?.offsetHeight ?? 0) + 24 }),
      });
      scene.setSculpture();
      // 打开页面时直接是地址栏里的组合，之后的切换才慢慢变过去。
      scene.setForm({ image: queryImage, variant: 0 });
      scene.setColor(queryPalette ? { palette: queryPalette, vivid: initialLevels.vivid } : null, true);
    } catch {
      setMessage('暂时无法显示画面。请开启浏览器硬件加速后刷新页面。');
      return;
    }
    sceneRef.current = scene;
    return () => { sceneRef.current = null; scene.dispose(); };
  }, []);

  useEffect(() => { sceneRef.current?.setForm({ image, variant: 0 }); }, [image]);
  // 换成默认颜色时，选中的配色可能在横向列表外面，滚过去让它看得见。
  useEffect(() => {
    paletteRowRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [palette]);
  useEffect(() => {
    sceneRef.current?.setVisual({ ...DEFAULT_VISUAL, luminosity: levels.luminosity, warmth: levels.warmth });
    sceneRef.current?.setColor(palette ? { palette, vivid: levels.vivid } : null);
  }, [palette, levels]);

  // 换意象时像主暗房一样先散成雾再凝聚，颜色换成这个意象的默认颜色；再点一次当前意象回到默认。
  const chooseImage = (next: ImageId) => {
    if (next !== image) sceneRef.current?.develop();
    const preset = IMAGE_COLORS[next];
    setImage(next);
    setPalette(preset.palette);
    setLevels(current => ({ ...current, luminosity: preset.luminosity, vivid: preset.palette ? preset.vivid : current.vivid }));
  };
  const defaultPalette = IMAGE_COLORS[image].palette;

  const readout = `${imageLabel(image)} · ${palette ? findPalette(palette).label : '单色'}`
    + (palette === defaultPalette ? '（默认）' : '')
    + (palette ? ` · 鲜艳度 ${levels.vivid.toFixed(2)}` : '');

  return (
    <main className="relief-lab color-lab">
      <div className="relief-canvas" ref={containerRef} />
      <div className="relief-vignette" aria-hidden="true" />
      <div className="relief-ring" ref={ringRef} aria-hidden="true" />

      <header className="relief-header">
        <a className="relief-wordmark" href="/">显影</a>
        <nav aria-label="试验页导航"><a href="/">THE DARKROOM</a></nav>
      </header>
      <div className="relief-status"><span aria-hidden="true" />颜色试验 · COLOR LAB</div>

      <section className="color-dock" ref={dockRef} aria-label="颜色设置">
        {message && <p className="relief-message" role="alert">{message}</p>}
        <p className="color-readout">{readout}</p>
        <div className="color-row" role="group" aria-label="意象">
          {IMAGERY.map(item => (
            <button key={item.id} type="button" aria-pressed={image === item.id} onClick={() => chooseImage(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="color-row" role="group" aria-label="配色" ref={paletteRowRef}>
          <button type="button" aria-pressed={palette === null} onClick={() => setPalette(null)}>
            <i className="color-swatch is-mono" aria-hidden="true" />单色
            {defaultPalette === null && <em>默认</em>}
          </button>
          {PALETTES.map(item => (
            <button key={item.id} type="button" aria-pressed={palette === item.id} onClick={() => setPalette(item.id)}>
              <i className="color-swatch" aria-hidden="true"
                style={{ background: `radial-gradient(circle at 38% 36%, ${item.glow} 0 22%, ${item.lit} 48%, ${item.shade} 100%)` }} />
              {item.label}
              {defaultPalette === item.id && <em>默认</em>}
            </button>
          ))}
        </div>
        <div className="color-sliders">
          {SLIDERS.map(slider => (
            <label key={slider.key}>
              <span>{slider.label}</span>
              <input type="range" min={0} max={1} step={0.05} value={levels[slider.key]}
                disabled={slider.key === 'vivid' && !palette}
                onChange={event => setLevels(current => ({ ...current, [slider.key]: Number(event.target.value) }))} />
              <output>{levels[slider.key].toFixed(2)}</output>
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}
