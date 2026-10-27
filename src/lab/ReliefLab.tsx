import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createReliefScene, DEFAULT_RELIEF } from '../relief/reliefScene';
import type { ReliefParams, ReliefScene } from '../relief/reliefScene';
import { createSampleSource } from './sampleImage';
import { loadPhotoSource } from '../relief/source';
import './lab.css';

const SLIDERS: { key: keyof ReliefParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'density', label: '密度', min: 260, max: 640, step: 20 },
  { key: 'size', label: '颗粒大小', min: 0.7, max: 2.4, step: 0.05 },
  { key: 'relief', label: '浮雕厚度', min: 0, max: 0.9, step: 0.05 },
  { key: 'spread', label: '边缘散开', min: 0, max: 1, step: 0.05 },
  { key: 'radius', label: '孔的大小', min: 0.1, max: 0.6, step: 0.02 },
  { key: 'recover', label: '合上速度', min: 0.2, max: 3, step: 0.1 },
];

const coarse = window.matchMedia('(pointer: coarse)').matches;
// 触屏和小屏先用较低密度，保证手机也能流畅按压。
const initialParams: ReliefParams = coarse || Math.min(window.innerWidth, window.innerHeight) < 600
  ? { ...DEFAULT_RELIEF, density: 380, size: 2 } : DEFAULT_RELIEF;

export default function ReliefLab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<ReliefScene | null>(null);
  const [params, setParams] = useState(initialParams);
  const [count, setCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '显影 · 质感试验';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const ring = ringRef.current;
    if (!container || !ring) return;
    let scene: ReliefScene;
    try {
      scene = createReliefScene(container, ring, { params: initialParams, onStats: setCount, onError: setMessage });
      scene.setSource(createSampleSource());
    } catch {
      setMessage('暂时无法显示画面。请开启浏览器硬件加速后刷新页面。');
      return;
    }
    sceneRef.current = scene;
    return () => { sceneRef.current = null; scene.dispose(); };
  }, []);

  useEffect(() => { sceneRef.current?.setParams(params); }, [params]);

  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const source = await loadPhotoSource(file);
      sceneRef.current?.setSource(source);
      setMessage(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '这张图片无法读取。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relief-lab">
      <div className="relief-canvas" ref={containerRef} />
      <div className="relief-vignette" aria-hidden="true" />
      <div className="relief-ring" ref={ringRef} aria-hidden="true" />

      <header className="relief-header">
        <a className="relief-wordmark" href="/">显影</a>
        <nav aria-label="试验页导航">
          <button type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen(open => !open)}>TUNE</button>
          <a href="/">THE DARKROOM</a>
        </nav>
      </header>

      <div className="relief-status"><span aria-hidden="true" />质感试验 · RELIEF LAB</div>

      {panelOpen && (
        <section className="relief-panel" aria-label="质感参数">
          {SLIDERS.map(slider => (
            <label key={slider.key}>
              <span>{slider.label}</span>
              <input type="range" min={slider.min} max={slider.max} step={slider.step} value={params[slider.key]}
                onChange={event => setParams(current => ({ ...current, [slider.key]: Number(event.target.value) }))} />
              <output>{slider.key === 'density' ? Math.round(params.density) : params[slider.key].toFixed(2)}</output>
            </label>
          ))}
          <footer>
            <span>{count.toLocaleString()} 颗表面粒子</span>
            <button type="button" onClick={() => setParams(initialParams)}>还原</button>
          </footer>
        </section>
      )}

      <div className="relief-dock">
        {message && <p className="relief-message" role="alert">{message}</p>}
        <p className="relief-hint">{coarse ? '按住画面拖动，把粒子拨开' : '按住鼠标拖动，把粒子拨开'}</p>
        <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp"
          aria-label="选择本地照片" onChange={event => void selectPhoto(event)} />
        <button type="button" className="relief-upload" disabled={loading} onClick={() => inputRef.current?.click()}>
          <span aria-hidden="true">←</span>{loading ? '正在显影…' : '换一张照片'}<em>Upload Another</em>
        </button>
        <p className="relief-note">照片只在本机处理，不上传、不保存</p>
      </div>
    </main>
  );
}
