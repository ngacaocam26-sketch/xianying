// 日记：把凝结的时刻按“一天”收在一起，像一卷胶片冲成一张印样。
// 凌晨 4 点前算前一天：熬夜到一两点聊完，感受上还属于“今天”。按本机时区计算。
export const DAY_START_HOUR = 4;

const pad = (value: number) => String(value).padStart(2, '0');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 这一刻属于哪一天：YYYY-MM-DD。
export function diaryDay(time: number): string {
  const date = new Date(time);
  if (date.getHours() < DAY_START_HOUR) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 一页日记的标题：2026.11.06 · 周五。
export function dayLabel(day: string): { date: string; weekday: string } {
  const [year, month, date] = day.split('-').map(Number);
  return { date: `${year}.${pad(month)}.${pad(date)}`, weekday: WEEKDAYS[new Date(year, month - 1, date).getDay()] };
}

// 一刻的钟点：23:29。
export function clockTime(time: number): string {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 按天分组：最近的一天在前；同一天里按时间先后排，像胶片上的一格格底片。
export function groupByDay<T extends { createdAt: number }>(items: T[]): { day: string; items: T[] }[] {
  const days = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const day = diaryDay(item.createdAt);
    const list = days.get(day);
    if (list) list.push(item); else days.set(day, [item]);
  }
  return [...days].map(([day, list]) => ({ day, items: list })).sort((a, b) => (a.day < b.day ? 1 : -1));
}

// 用户给这一天写的一句：空白和换行并成一个空格（紧挨中文标点的直接去掉），最多 60 个字。只存在本机。
export const NOTE_LIMIT = 60;
const FULL_WIDTH_PUNCTUATION = '，。！？、；：“”‘’（）《》〈〉【】「」『』…—～';
export function cleanNote(text: string): string {
  const spaced = text.replace(/\s+/g, ' ').trim();
  const tidy = [...spaced].filter((char, index, chars) =>
    char !== ' ' || !(FULL_WIDTH_PUNCTUATION.includes(chars[index - 1]) || FULL_WIDTH_PUNCTUATION.includes(chars[index + 1]))).join('');
  return [...tidy].slice(0, NOTE_LIMIT).join('').trim();
}
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
