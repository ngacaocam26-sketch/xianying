import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNote, clockTime, dayLabel, diaryDay, groupByDay, isDay, NOTE_LIMIT } from '../src/diary.ts';
import { dayPrintFileName, daySheetLayout, PAPER, printFileName, SHEET_HEADER_RULE } from '../src/print.ts';

// 用本机时区构造时间，与页面里的算法一致。
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('a moment before 4 a.m. belongs to the previous day, also across month and year ends', () => {
  assert.equal(diaryDay(at(2026, 11, 7, 3, 59)), '2026-11-06');
  assert.equal(diaryDay(at(2026, 11, 7, 4, 0)), '2026-11-07');
  assert.equal(diaryDay(at(2026, 11, 6, 23, 29)), '2026-11-06');
  assert.equal(diaryDay(at(2026, 12, 1, 1, 30)), '2026-11-30');
  assert.equal(diaryDay(at(2027, 1, 1, 0, 10)), '2026-12-31');
});

test('days come newest first and moments within a day stay in the order they happened', () => {
  const late = { id: 'c', createdAt: at(2026, 11, 7, 1, 15) };   // 属于 11-06
  const evening = { id: 'b', createdAt: at(2026, 11, 6, 23, 29) };
  const morning = { id: 'a', createdAt: at(2026, 11, 6, 9, 0) };
  const today = { id: 'd', createdAt: at(2026, 11, 7, 10, 0) };
  const days = groupByDay([evening, today, late, morning]);
  assert.deepEqual(days.map(day => day.day), ['2026-11-07', '2026-11-06']);
  assert.deepEqual(days[1].items.map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(groupByDay([]), []);
});

test('labels read like a diary page', () => {
  assert.deepEqual(dayLabel('2026-11-06'), { date: '2026.11.06', weekday: '周五' });
  assert.equal(clockTime(at(2026, 11, 6, 9, 5)), '09:05');
});

test('a print is named by the real calendar date, while the diary page still follows the 4 a.m. rule', () => {
  const lateNight = at(2026, 11, 7, 1, 20);
  assert.equal(diaryDay(lateNight), '2026-11-06');
  assert.equal(printFileName('睡不着的 窗边', lateNight), '显影-2026-11-07-睡不着的窗边.jpg');
  assert.equal(printFileName(' / ', lateNight), '显影-2026-11-07-此刻的显影.jpg');
});

test('a note for the day is one tidy line of at most 60 characters', () => {
  assert.equal(cleanNote('  下雨了，\n\n  但还是出门了  '), '下雨了，但还是出门了');
  assert.equal(cleanNote('下雨了  但还是出门了'), '下雨了 但还是出门了');
  assert.equal(cleanNote('跑了 5 km'), '跑了 5 km');
  assert.equal(cleanNote(' \n\t '), '');
  const long = '一'.repeat(NOTE_LIMIT + 5) + '🌧';
  assert.equal([...cleanNote(long)].length, NOTE_LIMIT);
  assert.equal(isDay('2026-11-06'), true);
  assert.equal(isDay('2026-11-6'), false);
  assert.equal(isDay(20261106), false);
  assert.equal(dayPrintFileName('2026-11-06'), '显影-印样-2026-11-06.jpg');
});

test('a day sheet keeps every frame inside the margins, apart, below the note and clear of the footer', () => {
  for (let count = 1; count <= 20; count++) {
    for (let noteLines = 0; noteLines <= 3; noteLines++) {
      const layout = daySheetLayout(count, noteLines);
      assert.equal(layout.frames.length, count);
      assert.ok(layout.paperHeight >= PAPER.height);
      const textBottom = noteLines ? layout.noteBaseline + (noteLines - 1) * 54 + 10 : SHEET_HEADER_RULE;
      layout.frames.forEach((frame, index) => {
        assert.ok(frame.x >= 72 - 1e-6 && frame.x + frame.width <= PAPER.width - 72 + 1e-6, `frame ${index} of ${count} leaves the margin`);
        assert.ok(frame.y > textBottom, `frame ${index} of ${count} covers the header or note`);
        assert.ok(frame.y + frame.height + layout.caption <= layout.paperHeight - 104 - 40, `frame ${index} of ${count} runs into the footer`);
        for (const other of layout.frames.slice(index + 1)) {
          const apart = frame.x + frame.width <= other.x || other.x + other.width <= frame.x
            || frame.y + frame.height + layout.caption <= other.y || other.y + other.height + layout.caption <= frame.y;
          assert.ok(apart, `frames overlap with ${count} moments`);
        }
      });
    }
  }
  assert.deepEqual([1, 3, 4, 5, 9].map(count => daySheetLayout(count, 0).columns), [1, 2, 2, 3, 3]);
  assert.ok(daySheetLayout(15, 0).paperHeight > PAPER.height, 'a long day makes a longer sheet');
});
