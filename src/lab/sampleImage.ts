import type { ReliefSource } from '../relief/reliefScene';
import { prepareSource } from '../relief/source';

function seededRandom(seed: number) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}

// 程序绘制的虚构夜景：月光、山脊与湖面倒影，只用于打开页面时有画面可看。
export function createSampleSource(): ReliefSource {
  const width = 1200;
  const height = 800;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器暂时无法绘制示例画面。');
  const random = seededRandom(0x6e696768);
  const horizon = height * 0.62;

  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#070d22');
  sky.addColorStop(0.45, '#1b2b55');
  sky.addColorStop(0.8, '#5a5f86');
  sky.addColorStop(1, '#d39a6a');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);

  for (let i = 0; i < 420; i++) {
    const y = random() ** 1.6 * horizon * 0.8;
    context.fillStyle = `rgba(255,255,255,${0.25 + random() * 0.7})`;
    context.fillRect(random() * width, y, random() < 0.08 ? 2 : 1, random() < 0.08 ? 2 : 1);
  }

  const moonX = width * 0.7;
  const moonY = height * 0.24;
  const halo = context.createRadialGradient(moonX, moonY, 10, moonX, moonY, 300);
  halo.addColorStop(0, 'rgba(255,240,215,0.55)');
  halo.addColorStop(0.3, 'rgba(190,200,240,0.16)');
  halo.addColorStop(1, 'rgba(120,140,200,0)');
  context.fillStyle = halo;
  context.fillRect(0, 0, width, horizon);
  const moon = context.createRadialGradient(moonX - 12, moonY - 10, 4, moonX, moonY, 58);
  moon.addColorStop(0, '#fffaf0');
  moon.addColorStop(0.85, '#f1e2c4');
  moon.addColorStop(1, 'rgba(240,220,190,0)');
  context.fillStyle = moon;
  context.beginPath();
  context.arc(moonX, moonY, 58, 0, Math.PI * 2);
  context.fill();

  for (let i = 0; i < 7; i++) {
    const cloud = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    cloud.addColorStop(0, 'rgba(200,190,220,0.22)');
    cloud.addColorStop(1, 'rgba(200,190,220,0)');
    context.save();
    context.translate(random() * width, horizon * (0.35 + random() * 0.45));
    context.scale(180 + random() * 220, 20 + random() * 26);
    context.fillStyle = cloud;
    context.fillRect(-1, -1, 2, 2);
    context.restore();
  }

  const ridges = [
    { base: 0.5, amp: 0.13, color: '#39456e', light: 'rgba(210,200,230,0.35)', seed: 1.3 },
    { base: 0.56, amp: 0.1, color: '#1f2744', light: 'rgba(230,200,170,0.3)', seed: 2.7 },
    { base: 0.61, amp: 0.06, color: '#0e121d', light: 'rgba(255,210,170,0.22)', seed: 4.1 },
  ];
  for (const ridge of ridges) {
    const ridgeY = (x: number) => height * (ridge.base
      - ridge.amp * (0.55 * Math.sin(x / width * 5.1 + ridge.seed) + 0.3 * Math.sin(x / width * 11.3 + ridge.seed * 2)
      + 0.15 * Math.sin(x / width * 27 + ridge.seed * 3)));
    context.beginPath();
    context.moveTo(0, horizon);
    for (let x = 0; x <= width; x += 6) context.lineTo(x, ridgeY(x));
    context.lineTo(width, horizon);
    context.closePath();
    context.fillStyle = ridge.color;
    context.fill();
    context.beginPath();
    for (let x = 0; x <= width; x += 6) context.lineTo(x, ridgeY(x) + 1.5);
    context.strokeStyle = ridge.light;
    context.lineWidth = 2;
    context.stroke();
  }

  const lake = context.createLinearGradient(0, horizon, 0, height);
  lake.addColorStop(0, '#5b4a5c');
  lake.addColorStop(0.25, '#1d2541');
  lake.addColorStop(1, '#05070e');
  context.fillStyle = lake;
  context.fillRect(0, horizon, width, height - horizon);
  for (let i = 0; i < 160; i++) {
    const y = horizon + random() ** 1.4 * (height - horizon);
    const spread = 30 + (y - horizon) * 0.5;
    const x = moonX + (random() - 0.5) * spread;
    context.fillStyle = `rgba(255,236,205,${0.12 + random() * 0.4})`;
    context.fillRect(x - 20, y, 14 + random() * 46, 1.5);
  }
  for (let i = 0; i < 60; i++) {
    context.fillStyle = `rgba(160,175,220,${0.05 + random() * 0.08})`;
    context.fillRect(random() * width, horizon + random() * (height - horizon), 40 + random() * 140, 1);
  }

  const lampX = width * 0.32;
  const lamp = context.createRadialGradient(lampX, horizon - 6, 0, lampX, horizon - 6, 40);
  lamp.addColorStop(0, 'rgba(255,200,120,0.95)');
  lamp.addColorStop(0.2, 'rgba(255,170,90,0.4)');
  lamp.addColorStop(1, 'rgba(255,150,80,0)');
  context.fillStyle = lamp;
  context.fillRect(lampX - 40, horizon - 46, 80, 80);

  return prepareSource(canvas, width, height);
}
