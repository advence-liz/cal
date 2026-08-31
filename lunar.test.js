import { getDayInfo } from './lunar-adapter.js';
import { makeRunner } from './test-harness.js';

export function runTests() {
  const { results, check, eq } = makeRunner();

  check('1. 2024-02-10 春节, 正月初一', () => {
    const info = getDayInfo('2024-02-10');
    eq(info.festival, '春节');
    eq(info.fullLabel, '甲辰年 正月初一');
    eq(info.dayLabel, '正月'); // day===1 branch shows the month name + "月"
  });

  check('2. 2024-09-17 中秋节, 八月十五', () => {
    const info = getDayInfo('2024-09-17');
    eq(info.festival, '中秋节');
    eq(info.fullLabel, '甲辰年 八月十五');
  });

  check('3. 普通日无节日/节气 → 空字符串', () => {
    const info = getDayInfo('2026-09-01');
    eq(info.festival, '');
    eq(info.jieqi, '');
    eq(info.fullLabel, '丙午年 七月二十');
  });

  check('4. 极端年份不抛错，返回可用结果（防御性 try/catch 允许但不强制）', () => {
    const info = getDayInfo('1000-01-01');
    eq(typeof info.fullLabel, 'string');
  });

  check('5. 2026-10-01 宜/忌列表（黄历吉凶）', () => {
    const info = getDayInfo('2026-10-01');
    eq(info.yi.includes('出行'), true);
    eq(info.yi.includes('移徙'), true);
    eq(info.ji.includes('嫁娶'), true);
    eq(info.ji.includes('开市'), true);
  });

  return results;
}
