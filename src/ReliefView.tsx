import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { createReliefScene, DEFAULT_RELIEF } from './relief/reliefScene';
import type { ReliefScene } from './relief/reliefScene';
import { loadReliefPhoto } from './relief/source';
import { NEBULA_SEED, validateSnapshot } from './artwork';
import type { ReliefPhoto, SceneSnapshot } from './artwork';
import type { ParticleSceneHandle } from './ParticleScene';
import type { VisualState } from './visual';
import type { ActivitySignal } from './emotionShape';

// 与 /relief-lab 同一套默认值；触屏和小屏降低密度，保证按压流畅。
const compact = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
const PARAMS = compact ? { ...DEFAULT_RELIEF, density: 380, size: 2 } : DEFAULT_RELIEF;

// 顶栏与底部输入条（凝结时为凝结卡片）占用的高度；浮在作品上的回复卡片不计入，流式回复时画面不跳。
function measureInsets(container: HTMLElement) {
  const experience = container.closest('.experience');
  const bounds = container.getBoundingClientRect();
  const header = experience?.querySelector('.site-header');
  const condensed = experience?.classList.contains('is-condensed');
  const dock = experience?.querySelector(condensed ? '.work-panel' : '.expression:not([hidden]) .composer');
  return {
    top: header ? header.getBoundingClientRect().bottom - bounds.top + 12 : 70,
    bottom: dock ? bounds.bottom - dock.getBoundingClientRect().top + 16 : bounds.height * 0.2,
  };
}

export default function ReliefView({ photo, visual, snapshot = null, active = true, activity, ref }: {
  photo: ReliefPhoto; visual: VisualState; snapshot?: SceneSnapshot | null; active?: boolean;
  activity?: { current: ActivitySignal }; ref?: Ref<ParticleSceneHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReliefScene | null>(null);
  const visualRef = useRef(visual);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ capture() {
    const scene = sceneRef.current;
    if (!scene) throw new Error('画面还没有准备好，请稍等再凝结。');
    const shot = scene.capture();
    return {
      scene: validateSnapshot({ version: 3, kind: 'relief', seed: NEBULA_SEED, phase: shot.phase, visual: shot.visual, photo: null, relief: photo }),
      thumbnail: shot.thumbnail,
    };
  } }), [photo]);

  useEffect(() => {
    const container = containerRef.current;
    const ring = ringRef.current;
    if (!container || !ring) return;
    let scene: ReliefScene;
    try {
      scene = createReliefScene(container, ring, { params: PARAMS, onError: setError, insets: () => measureInsets(container), activity });
    } catch {
      setError('暂时无法显示照片。请开启浏览器硬件加速后刷新页面。');
      return;
    }
    sceneRef.current = scene;
    scene.setVisual(visualRef.current);
    // 输入条长高、切换语音条时重新取景。
    const observer = new ResizeObserver(() => scene.refit());
    const dock = container.closest('.experience')?.querySelector('.dock-area');
    if (dock) observer.observe(dock);
    return () => { observer.disconnect(); sceneRef.current = null; scene.dispose(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadReliefPhoto(photo)
      .then(source => { if (!cancelled) { sceneRef.current?.setSource(source); setError(null); } })
      .catch(() => { if (!cancelled) setError('这张照片暂时无法显影，请重新选择。'); });
    return () => { cancelled = true; };
  }, [photo]);

  useEffect(() => { visualRef.current = visual; sceneRef.current?.setVisual(visual); }, [visual]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setFrozen(Boolean(snapshot), snapshot?.phase);
    scene.refit();
    // 凝结卡片出现后为它让出位置，名称换行等尺寸变化也跟着取景。
    const panel = containerRef.current?.closest('.experience')?.querySelector('.work-panel');
    if (!panel) return;
    const observer = new ResizeObserver(() => scene.refit());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [snapshot]);

  useEffect(() => { sceneRef.current?.setActive(active); }, [active]);

  return (
    <div className="particle-viewport is-relief" ref={containerRef}>
      <div className="scene-ring" ref={ringRef} aria-hidden="true" />
      {error && <p className="scene-error" role="alert">{error}</p>}
    </div>
  );
}
