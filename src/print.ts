import { dayLabel, clockTime } from './diary.ts';

// 冲印：把凝结的一刻排成一张带白边的相纸（显影 → 定影 → 冲印）；把一天的几刻排成一张印样。图片在本机生成，不上传。
// 相纸 3:4，适合存进手机相册、贴进日记；单张的画面区 4:3，作品按这个大小重画。
export const PAPER = { width: 1200, height: 1600 };
export const PRINT_IMAGE = { x: 72, y: 72, width: 1056, height: 792 };
// 重画时放大 1.5 倍再缩小，颗粒边缘更平滑。
export const STILL_SCALE = 1.5;

const SERIF = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
const LATIN = '"Cormorant Garamond", "Times New Roman", serif';
const MARGIN = 72;
// 落款的短横线离底边的距离。
const FOOTER = 104;

type Picture = CanvasImageSource & { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };
type Moment = { title: string; createdAt: number; summary?: string };
const pad = (value: number) => String(value).padStart(2, '0');
// 相纸上印的是这一刻真实的日历日期（凌晨 1 点就印次日），4 点规则只用来决定它排在日记的哪一页。
function calendarDay(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 逐字画并加字距（canvas 的 letterSpacing 在部分手机浏览器上不可用）；x 是居中点、左端或右端。
function drawSpaced(context: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'center' | 'left' | 'right' = 'center') {
  const chars = [...text];
  const widths = chars.map(char => context.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (chars.length - 1);
  let left = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  context.textAlign = 'left';
  chars.forEach((char, index) => { context.fillText(char, left, y); left += widths[index] + spacing; });
}

// 中文按字折行，最多 maxLines 行，超出时最后一行以省略号结尾。
function wrap(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (context.measureText(line + char).width > width && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else line += char;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  return lines;
}

// 一行放不下时截短，末尾加省略号。
function fit(context: CanvasRenderingContext2D, text: string, width: number) {
  if (context.measureText(text).width <= width) return text;
  const chars = [...text];
  while (chars.length && context.measureText(chars.join('') + '…').width > width) chars.pop();
  return chars.join('') + '…';
}

// 按“铺满”裁切：画面区比例和图片不同时裁掉两边，不留黑边也不变形。
function drawCover(context: CanvasRenderingContext2D, image: Picture, box: Box) {
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const width = box.width / scale, height = box.height / scale;
  context.drawImage(image, (image.width - width) / 2, (image.height - height) / 2, width, height, box.x, box.y, box.width, box.height);
}

// 字体是网页字体；加载不到（比如国内网络连不上）时用系统宋体，最多等 1.5 秒。
async function waitForFonts() {
  await Promise.race([
    Promise.all([document.fonts?.load(`400 52px ${SERIF}`), document.fonts?.load(`400 26px ${LATIN}`)]).catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ]);
}

// 相纸：暖白底，加一层很淡的纸纹（按面积撒，长印样和单张一样细）。
function blankPaper(width: number, height: number) {
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('暂时无法冲印，请重试。');
  context.fillStyle = '#F2EFE8';
  context.fillRect(0, 0, width, height);
  const grains = Math.round(9000 * (width * height) / (PAPER.width * PAPER.height));
  for (let i = 0; i < grains; i++) {
    context.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '120,110,95'},${0.05 + Math.random() * 0.05})`;
    context.fillRect(Math.random() * width, Math.random() * height, 1.4, 1.4);
  }
  context.textBaseline = 'alphabetic';
  return { sheet, context };
}

function drawFooter(context: CanvasRenderingContext2D, width: number, height: number) {
  const center = width / 2;
  context.fillStyle = '#A9ADB2';
  context.fillRect(center - 24, height - FOOTER, 48, 1);
  context.font = `400 20px ${SERIF}`;
  drawSpaced(context, '显影 · XIAN YING', center, height - 62, 8);
}

export async function composePrint(image: Picture, moment: Moment, withSummary: boolean) {
  await waitForFonts();
  const { sheet, context } = blankPaper(PAPER.width, PAPER.height);
  context.fillStyle = '#040507';
  context.fillRect(PRINT_IMAGE.x, PRINT_IMAGE.y, PRINT_IMAGE.width, PRINT_IMAGE.height);
  drawCover(context, image, PRINT_IMAGE);

  // 文字整块放在画面下方和落款之间，略偏上；不印总结时也不会空出一大片。
  const center = PAPER.width / 2;
  const footerLine = PAPER.height - FOOTER;
  context.font = `300 30px ${SERIF}`;
  const lines = withSummary && moment.summary ? wrap(context, moment.summary, 880, 3) : [];
  const blockHeight = 42 + 58 + 38 + (lines.length ? 82 + 54 * (lines.length - 1) : 0) + 8;
  const areaTop = PRINT_IMAGE.y + PRINT_IMAGE.height;
  let y = areaTop + (footerLine - areaTop - blockHeight) * 0.42 + 42;

  context.fillStyle = '#1E2023';
  context.font = `400 52px ${SERIF}`;
  drawSpaced(context, moment.title, center, y, 10);

  y += 58;
  const { date, weekday } = dayLabel(calendarDay(moment.createdAt));
  context.fillStyle = '#8B9096';
  context.font = `400 26px ${LATIN}`;
  drawSpaced(context, `${date} · ${clockTime(moment.createdAt)}`, center, y, 5);
  y += 38;
  context.font = `400 22px ${SERIF}`;
  drawSpaced(context, weekday, center, y, 6);

  if (lines.length) {
    y += 82;
    context.fillStyle = '#4B5058';
    context.font = `300 30px ${SERIF}`;
    for (const line of lines) { drawSpaced(context, line, center, y, 3); y += 54; }
  }

  drawFooter(context, PAPER.width, PAPER.height);
  return sheet;
}

// 印样的排法：一刻一格，按时间先后从左到右、从上到下。1 刻单独一格，2—4 刻两列，更多三列；
// 排不下时相纸往下加长（宽度不变，存进相册是一张长图），落款始终在最下面。纯计算，方便测试。
export const SHEET_HEADER_RULE = 196;
export function daySheetLayout(count: number, noteLines: number) {
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const gap = columns === 3 ? 28 : 36;
  const content = PAPER.width - MARGIN * 2;
  const width = columns === 1 ? 720 : (content - gap * (columns - 1)) / columns;
  const height = width * 3 / 4;
  const caption = columns === 1 ? 100 : columns === 2 ? 88 : 80;
  const rowGap = 40;
  const noteBaseline = SHEET_HEADER_RULE + 76;
  const top = (noteLines ? noteBaseline + (noteLines - 1) * 54 + 22 : SHEET_HEADER_RULE) + 56;
  const left = columns === 1 ? (PAPER.width - width) / 2 : MARGIN;
  const frames: Box[] = Array.from({ length: count }, (_, index) => ({
    x: left + (index % columns) * (width + gap),
    y: top + Math.floor(index / columns) * (height + caption + rowGap),
    width, height,
  }));
  const rows = Math.ceil(count / columns);
  const bottom = top + rows * (height + caption) + Math.max(0, rows - 1) * rowGap;
  return { columns, frames, caption, noteBaseline, bottom, paperHeight: Math.max(PAPER.height, Math.ceil(bottom + 72 + FOOTER)) };
}

export type DayFrame = { image: Picture | null; title: string; createdAt: number };

export async function composeDaySheet(day: string, frames: DayFrame[], note: string) {
  await waitForFonts();
  // 先量出写的那句占几行，再定相纸长短。
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('暂时无法冲印，请重试。');
  const noteFont = `400 34px ${SERIF}`;
  probe.font = noteFont;
  const noteLines = note ? wrap(probe, note, PAPER.width - MARGIN * 2, 3) : [];
  const layout = daySheetLayout(frames.length, noteLines.length);
  const { sheet, context } = blankPaper(PAPER.width, layout.paperHeight);
  const right = PAPER.width - MARGIN;

  // 页眉：左边日期，右边星期和几个时刻，下面一条细线。
  const { date, weekday } = dayLabel(day);
  context.fillStyle = '#1E2023';
  context.font = `400 60px ${LATIN}`;
  drawSpaced(context, date, MARGIN, 150, 6, 'left');
  context.fillStyle = '#8B9096';
  context.font = `400 24px ${SERIF}`;
  drawSpaced(context, `${weekday} · ${frames.length} 个时刻`, right, 150, 4, 'right');
  context.fillStyle = '#C9C4BA';
  context.fillRect(MARGIN, SHEET_HEADER_RULE, right - MARGIN, 1);

  if (noteLines.length) {
    context.fillStyle = '#2B2E33';
    context.font = noteFont;
    noteLines.forEach((line, index) => drawSpaced(context, line, MARGIN, layout.noteBaseline + index * 54, 2, 'left'));
  }

  // 每一格像一小段底片：黑框里是作品，下面一行是格号（橙色，像胶片边上的编号）和钟点，再下面是标题。
  const inset = layout.columns === 3 ? 6 : 8;
  const small = layout.columns === 3 ? 20 : 22;
  const titleSize = layout.columns === 1 ? 32 : layout.columns === 2 ? 28 : 24;
  frames.forEach((frame, index) => {
    const box = layout.frames[index];
    context.fillStyle = '#08090C';
    context.fillRect(box.x, box.y, box.width, box.height);
    if (frame.image) drawCover(context, frame.image, { x: box.x + inset, y: box.y + inset, width: box.width - inset * 2, height: box.height - inset * 2 });
    const line = box.y + box.height + small + 16;
    context.font = `500 ${small}px ${LATIN}`;
    context.fillStyle = '#B8642A';
    drawSpaced(context, pad(index + 1), box.x, line, 3, 'left');
    context.fillStyle = '#8B9096';
    drawSpaced(context, clockTime(frame.createdAt), box.x + box.width, line, 3, 'right');
    context.fillStyle = '#1E2023';
    context.font = `400 ${titleSize}px ${SERIF}`;
    context.textAlign = 'left';
    context.fillText(fit(context, frame.title, box.width), box.x, line + titleSize + 18);
  });

  drawFooter(context, PAPER.width, layout.paperHeight);
  return sheet;
}

export function printFileName(title: string, createdAt: number) {
  const day = calendarDay(createdAt);
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 20) || '此刻的显影';
  return `显影-${day}-${safe}.jpg`;
}
export const dayPrintFileName = (day: string) => `显影-印样-${day}.jpg`;

export function sheetToBlob(sheet: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => sheet.toBlob(blob => blob ? resolve(blob) : reject(new Error('暂时无法冲印，请重试。')), 'image/jpeg', 0.92));
}

// 手机上弹出系统的分享 / 存储图像；电脑上直接下载。都不行时（微信、抖音里常见）由界面提示长按图片保存。
export async function savePrint(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (cause) { if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
