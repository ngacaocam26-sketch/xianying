import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { createReliefScene, DEFAULT_RELIEF } from './relief/reliefScene';
import type { ReliefScene } from './relief/reliefScene';
import { loadReliefPhoto } from './relief/source';
import { NEBULA_SEED, validateSnapshot } from './artwork';
import type { ReliefPhoto, SceneSnapshot } from './artwork';
import type { ParticleSceneHandle } from './ParticleScene';
import type { VisualState } from './visual';
import type { SculptureForm } from './imagery';
import type { ActivitySignal } from './emotionShape';

// 比 /relief-lab 更细更密：颗粒小、数量多，表面才细腻。触屏和小屏密度低一档，保证按压流畅。
// 推开的小洞：手指粗，触屏保持原大；鼠标指得准，桌面缩小约三分之一。
const compact = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
const PARAMS = compact ? { ...DEFAULT_RELIEF, density: 480, size: 1.7 } : { ...DEFAULT_RELIEF, density: 560, size: 1.6, radius: 0.16 };

// 顶栏与底部输入条（凝结时为凝结卡片）占用的高度。宽屏上回复卡片浮在作品前，不计入；
// 竖屏手机两侧没有空位，回复卡片也计入，作品平滑上移缩小，让出卡片的位置。
function measureInsets(container: HTMLElement) {
  const experience = container.closest('.experience');
  const bounds = container.getBoundingClientRect();
  const header = experience?.querySelector('.site-header');
  const condensed = experience?.classList.contains('is-condensed');
  const portrait = bounds.width < 640 && bounds.width < bounds.height;
  const dock = experience?.querySelector(condensed ? '.work-panel'
    : portrait ? '.expression:not([hidden]) > :first-child' : '.expression:not([hidden]) .composer');
  return {
    top: header ? header.getBoundingClientRect().bottom - bounds.top + 12 : 70,
    bottom: dock ? bounds.bottom - dock.getBoundingClientRect().top + 16 : bounds.height * 0.2,
  };
}

// 新画法的 React 外壳：有照片时显示照片浮雕，没有照片时显示默认雕塑。
export default function ReliefView({ photo, visual, form = null, snapshot = null, active = true, activity, develop = 0, onStroke, ref }: {
  photo: ReliefPhoto | null; visual: VisualState; form?: SculptureForm | null; snapshot?: SceneSnapshot | null; active?: boolean;
  activity?: { current: ActivitySignal };
  // 手指按在作品上拨开时每帧回调，参数是秒数。
  onStroke?: (seconds: number) => void;
  // 每次 AI 给出新参数时加一，触发一次显影（散开再凝聚）。
  develop?: number; ref?: Ref<ParticleSceneHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef(onStroke); strokeRef.current = onStroke;
  const ringRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReliefScene | null>(null);
  const visualRef = useRef(visual);
  const formRef = useRef(form);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ capture() {
    const scene = sceneRef.current;
    if (!scene) throw new Error('画面还没有准备好，请稍等再凝结。');
    const shot = scene.capture();
    const common = { version: 3, seed: NEBULA_SEED, phase: shot.phase, visual: shot.visual, photo: null };
    return {
      scene: validateSnapshot(photo ? { ...common, kind: 'relief', relief: photo }
        : { ...common, kind: 'sculpture', ...(form ? { form } : {}) }),
      thumbnail: shot.thumbnail,
    };
  } }), [photo, form]);

  useEffect(() => {
    const container = containerRef.current;
    const ring = ringRef.current;
    if (!container || !ring) return;
    let scene: ReliefScene;
    try {
      scene = createReliefScene(container, ring, { params: PARAMS, onError: setError, insets: () => measureInsets(container), activity,
        onStroke: seconds => strokeRef.current?.(seconds) });
    } catch {
      setError('暂时无法显示照片。请开启浏览器硬件加速后刷新页面。');
      return;
    }
    sceneRef.current = scene;
    scene.setVisual(visualRef.current);
    scene.setForm(formRef.current);
    // 输入条长高、切换语音条时重新取景。
    const observer = new ResizeObserver(() => scene.refit());
    const dock = container.closest('.experience')?.querySelector('.dock-area');
    if (dock) observer.observe(dock);
    return () => { observer.disconnect(); sceneRef.current = null; scene.dispose(); };
  }, []);

  useEffect(() => {
    if (!photo) {
      sceneRef.current?.setSculpture();
      setError(null);
      return;
    }
    let cancelled = false;
    loadReliefPhoto(photo)
      .then(source => { if (!cancelled) { sceneRef.current?.setSource(source); setError(null); } })
      .catch(() => { if (!cancelled) setError('这张照片暂时无法显影，请重新选择。'); });
    return () => { cancelled = true; };
  }, [photo]);

  useEffect(() => { visualRef.current = visual; sceneRef.current?.setVisual(visual); }, [visual]);
  useEffect(() => { formRef.current = form; sceneRef.current?.setForm(form); }, [form]);
  useEffect(() => { if (develop) sceneRef.current?.develop(); }, [develop]);

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
