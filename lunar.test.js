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

  check('6. 公历法定节日不依赖官方数据：2027 元旦/劳动节/国庆有标签，普通日为空', () => {
    eq(getDayInfo('2027-01-01').solarFestival, '元旦节');
    eq(getDayInfo('2027-05-01').solarFestival, '劳动节');
    eq(getDayInfo('2027-10-01').solarFestival, '国庆节');
    eq(getDayInfo('2027-12-25').solarFestival, ''); // 圣诞等非法定节日不上标签
    eq(getDayInfo('2027-02-06').festival, '春节');
  });

  check('7. 宜忌覆盖层：2345 差异日(2026-06-05 芒种边界)显示 2345 原文', () => {
    const info = getDayInfo('2026-06-05');
    // 2345 当天用旧月建口径，与 lunar.js 快照不同 → 必须跟随 2345
    eq(info.yi[0], '嫁娶');
    eq(info.yi.includes('会亲友'), true);
    eq(info.ji.includes('入宅'), true); // lunar.js 该日忌为"无"，2345 有具体条目
  });

  check('8. 宜忌覆盖层：非覆盖日不受影响，仍走 lunar.js 计算', () => {
    const info = getDayInfo('2026-06-04'); // 覆盖表相邻日，不应有 override
    eq(info.yi.includes('作灶'), true);    // lunar.js 快照值
    eq(info.ji.includes('破土'), true);
  });

  return results;
}
