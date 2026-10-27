import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createStudyAppearance, createStudyPositions, SHAPE_STUDIES } from './shapes';

type StudyView = { yaw: number; pitch: number; rotating: boolean };
export const INITIAL_STUDY_VIEW: StudyView = { yaw: .22, pitch: .10, rotating: false };

const vertexShader = /* glsl */ `
  uniform float uPointScale;
  uniform float uPixelRatio;
  uniform float uCenterDepth;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aGlow;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float projected = aSize * uPointScale / -viewPosition.z;
    gl_PointSize = clamp(projected, .9 * uPixelRatio, 18.0 * uPixelRatio);
    float depth = mix(.48, 1.0, smoothstep(-1.8, 1.8, viewPosition.z + uCenterDepth));
    vAlpha = aAlpha * depth * min(1.0, pow(projected / gl_PointSize, 2.0));
    vGlow = aGlow;
  }
`;
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.0;
    float crisp = 1.0 - smoothstep(.65 - fwidth(r), .65 + fwidth(r), r);
    float glow = exp(-r * r * 8.0) * (1.0 - smoothstep(.6, 1.0, r));
    float alpha = mix(crisp, glow, vGlow) * vAlpha;
    if (alpha < .002) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

export default function StudyScene({ rotating, revision, focused }: {
  rotating: boolean; revision: number; focused: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controls = useRef({ rotating, revision, focused });
  const wake = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    controls.current = { rotating, revision, focused };
    wake.current?.();
  }, [rotating, revision, focused]);

  useEffect(() => {
    const host = hostRef.current;
    const board = host?.parentElement;
    if (!host || !board) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      setError('暂时无法显示粒子。请开启浏览器硬件加速后刷新。');
      return;
    }
    setError(null);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '四种粒子形态，同色同视角对照');
    host.appendChild(renderer.domElement);
    const appearance = createStudyAppearance();
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color('#b7d4e8') },
        uPointScale: { value: 1 }, uPixelRatio: { value: renderer.getPixelRatio() },
        uCenterDepth: { value: 10 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const views = SHAPE_STUDIES.map(study => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(createStudyPositions(study.id), 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(appearance.sizes, 1));
      geometry.setAttribute('aAlpha', new THREE.BufferAttribute(appearance.alphas, 1));
      geometry.setAttribute('aGlow', new THREE.BufferAttribute(appearance.glows, 1));
      const points = new THREE.Points(geometry, material);
      const scene = new THREE.Scene();
      scene.add(points);
      return { id: study.id, geometry, points, scene, box: { left: 0, top: 0, width: 0, height: 0 } };
    });
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 60);
    let width = 1, height = 1, frame = 0, disposed = false;
    let yaw = INITIAL_STUDY_VIEW.yaw;
    let revision = controls.current.revision;
    let previousTime = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    function layout() {
      if (disposed) return;
      const boardRect = board!.getBoundingClientRect();
      width = Math.max(1, boardRect.width); height = Math.max(1, boardRect.height);
      renderer.setSize(width, height, false);
      for (const view of views) {
        const element = board!.querySelector<HTMLElement>(`[data-study-window="${view.id}"]`)!;
        const rect = element.getBoundingClientRect();
        view.box = { left: rect.left - boardRect.left, top: rect.top - boardRect.top, width: rect.width, height: rect.height };
      }
      requestFrame();
    }
    function requestFrame() {
      if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(draw);
    }
    function draw(time: number) {
      frame = 0;
      if (disposed) return;
      if (revision !== controls.current.revision) {
        revision = controls.current.revision;
        yaw = INITIAL_STUDY_VIEW.yaw;
      }
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
      previousTime = time;
      if (controls.current.rotating && !reduced.matches) yaw += dt * .24;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
      for (const view of views) {
        if (controls.current.focused && controls.current.focused !== view.id) continue;
        const box = view.box;
        if (box.width < 1 || box.height < 1) continue;
        camera.aspect = box.width / box.height;
        const distance = Math.max(2.75, 3.0 / camera.aspect) / Math.tan(Math.PI / 10);
        camera.position.set(0, 0, distance);
        camera.updateProjectionMatrix();
        view.points.rotation.set(INITIAL_STUDY_VIEW.pitch, yaw, 0);
        material.uniforms.uPointScale.value = box.height * renderer.getPixelRatio() / (2 * Math.tan(Math.PI / 10));
        material.uniforms.uCenterDepth.value = distance;
        renderer.setViewport(box.left, height - box.top - box.height, box.width, box.height);
        renderer.setScissor(box.left, height - box.top - box.height, box.width, box.height);
        renderer.render(view.scene, camera);
      }
      if (controls.current.rotating && !reduced.matches) requestFrame();
    }
    function visibility() {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
      else { layout(); }
    }
    function changeMotion() { previousTime = 0; requestFrame(); }
    const observer = new ResizeObserver(layout);
    observer.observe(board);
    board.querySelectorAll('[data-study-window]').forEach(element => observer.observe(element));
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', changeMotion);
    wake.current = layout;
    layout();
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', changeMotion);
      wake.current = null;
      views.forEach(view => view.geometry.dispose());
      material.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div className="study-canvas" ref={hostRef}>{error && <p className="study-error" role="alert">{error}</p>}</div>;
}
