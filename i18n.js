// Display language only. Dates used for calculations and the active holiday
// region are deliberately independent of this preference.
export const LANGUAGE_KEY = 'cal:language';
let language = 'zh-CN';
export const getLanguage = () => language;
export const setLanguage = (value) => { language = value === 'en' ? 'en' : 'zh-CN'; };
export const english = () => language === 'en';
export const t = (zh, en) => english() ? en : zh;
export const dateLabel = (date, options) => new Intl.DateTimeFormat(language, options).format(date);
export const daysLabel = (n, noun = 'day') => `${n} ${noun}${n === 1 ? '' : 's'}`;

const holidayEn = {
  元旦: 'New Year’s Day', 元旦节: 'New Year’s Day', 春节: 'Chinese New Year', 清明: 'Qingming Festival', 清明节: 'Qingming Festival',
  劳动节: 'Labour Day', 端午: 'Dragon Boat Festival', 端午节: 'Dragon Boat Festival', 中秋: 'Mid-Autumn Festival', 中秋节: 'Mid-Autumn Festival', 国庆: 'National Day', 国庆节: 'National Day',
  '马丁·路德·金纪念日': 'Martin Luther King Jr. Day', 华盛顿诞辰: 'Washington’s Birthday', 阵亡将士纪念日: 'Memorial Day', 六月节: 'Juneteenth',
  美国独立日: 'Independence Day', 美国劳动节: 'Labor Day', 哥伦布日: 'Columbus Day', 退伍军人节: 'Veterans Day', 感恩节: 'Thanksgiving', 圣诞节: 'Christmas Day',
  开斋节: 'Hari Raya Puasa', 耶稣受难日: 'Good Friday', 投票日: 'Polling Day', 卫塞节: 'Vesak Day', 哈芝节: 'Hari Raya Haji', 新加坡国庆日: 'National Day', 屠妖节: 'Deepavali',
  成人节: 'Coming of Age Day', 建国纪念日: 'National Foundation Day', 天皇诞辰: 'Emperor’s Birthday', 春分日: 'Vernal Equinox Day', 昭和日: 'Shōwa Day',
  宪法纪念日: 'Constitution Memorial Day', 绿之日: 'Greenery Day', 儿童节: 'Children’s Day', 海之日: 'Marine Day', 山之日: 'Mountain Day', 敬老日: 'Respect for the Aged Day',
  秋分日: 'Autumnal Equinox Day', 体育日: 'Sports Day', 文化日: 'Culture Day', 劳动感谢日: 'Labour Thanksgiving Day', 国民休息日: 'Citizens’ Holiday',
  复活节星期一: 'Easter Monday', 五月初银行假日: 'Early May Bank Holiday', 春季银行假日: 'Spring Bank Holiday', 夏季银行假日: 'Summer Bank Holiday', 节礼日: 'Boxing Day',
  二战胜利日: 'Victory in Europe Day', 耶稣升天节: 'Ascension Day', 圣灵降临节星期一: 'Whit Monday', 法国国庆日: 'Bastille Day', 圣母升天节: 'Assumption Day', 诸圣节: 'All Saints’ Day', 停战纪念日: 'Armistice Day',
  人权日: 'Human Rights Day', 家庭日: 'Family Day', 自由日: 'Freedom Day', 青年日: 'Youth Day', 全国妇女节: 'National Women’s Day', 遗产日: 'Heritage Day', 和解日: 'Day of Reconciliation', 善意日: 'Day of Goodwill',
  印度共和国日: 'Republic Day', 洒红节: 'Holi', 罗摩诞辰: 'Ram Navami', 摩诃毗罗诞辰: 'Mahavir Jayanti', 安贝德卡诞辰: 'Ambedkar Jayanti',
  穆哈兰姆节: 'Muharram', 印度独立日: 'Independence Day', 圣纪节: 'Milad-un-Nabi', 克里希纳诞辰: 'Janmashtami', 甘地诞辰: 'Gandhi Jayanti', 十胜节: 'Dussehra', 古鲁那纳克诞辰: 'Guru Nanak’s Birthday',
  蒂拉登特斯纪念日: 'Tiradentes Day', 巴西独立日: 'Independence Day', 阿帕雷西达圣母日: 'Our Lady of Aparecida', 追思亡者节: 'All Souls’ Day', 共和国宣告日: 'Proclamation of the Republic', 黑人意识日: 'Black Awareness Day',
  澳大利亚日: 'Australia Day', 复活节星期六: 'Easter Saturday', 复活节星期日: 'Easter Sunday', 澳新军团日: 'Anzac Day', 国王诞辰: 'King’s Birthday',
  沙特开斋节: 'Eid al-Fitr', 宰牲节: 'Eid al-Adha', 沙特国庆日: 'Saudi National Day', 沙特建国日: 'Founding Day',
  除夕: 'Chinese New Year’s Eve', 元宵节: 'Lantern Festival', 龙抬头: 'Dragon Head Festival', 七夕节: 'Qixi Festival', 中元节: 'Ghost Festival', 重阳节: 'Double Ninth Festival', 腊八节: 'Laba Festival', 小年: 'Little New Year',
};
export function holidayLabel(name) {
  if (!english()) return name;
  return name.split('、').map((part) => Object.hasOwn(holidayEn, part) ? holidayEn[part] : part).join(' / ');
}

const activityEn = {
  出行: 'Travel', 移徙: 'Move', 入宅: 'Move in', 嫁娶: 'Marry', 订盟: 'Get engaged', 开市: 'Open a business', 理发: 'Get a haircut', 装修: 'Renovate', 安床: 'Set up a bed',
};
export const activityName = ({ term, label }) => english() ? activityEn[term] || label : label;

const staticText = {
  appTitle: ['摸鱼日历', 'Moyu Calendar'], regionTitle: ['假期地区', 'Holiday region'],
  guideLink: ['使用指南', 'Guide'],
  regionCN: ['中国大陆', 'Mainland China'], regionUS: ['美国联邦', 'US Federal'], regionSG: ['新加坡', 'Singapore'],
  regionJP: ['日本', 'Japan'], regionGB: ['英格兰和威尔士', 'England & Wales'],
  regionFR: ['法国本土', 'Metropolitan France'], regionZA: ['南非', 'South Africa'],
  regionIN: ['印度（德里中央机关）', 'India (Delhi Central Govt.)'], regionBR: ['巴西', 'Brazil'],
  regionAU: ['澳大利亚（新南威尔士州）', 'Australia (NSW)'], regionSA: ['沙特阿拉伯（金融业）', 'Saudi Arabia (Financial Sector)'],
  clockTitle: ['时钟时区', 'Clock time zone'], clockAuto: ['跟随假期地区', 'Follow holiday region'],
  today: ['回到今天', 'Today'], todayShort: ['今天', 'Today'],
  weekday1: ['一', 'Mon'], weekday2: ['二', 'Tue'], weekday3: ['三', 'Wed'], weekday4: ['四', 'Thu'], weekday5: ['五', 'Fri'], weekday6: ['六', 'Sat'], weekday0: ['日', 'Sun'],
  holiday: ['法定假', 'Public holiday'], makeup: ['调休补班', 'Make-up workday'], weekend: ['周末', 'Weekend'], suitable: ['宜（筛选中）', 'Suitable (filtered)'],
  yi: ['宜', 'Suitable'], ji: ['忌', 'Avoid'], leaveTitle: ['🎉 拼假攻略', '🎉 Leave planner'], leaveLabel: ['拼假攻略', 'Leave planner'],
  leaveCoverage: ['拼假攻略仅覆盖已收录假期数据的连续日期。', 'Plans only cover dates with confirmed holiday data.'], countTitle: ['区间工作日数', 'Count workdays'], addTitle: ['N 个工作日后', 'Add workdays'],
  start: ['起：', 'From:'], end: ['止：', 'To:'], calculate: ['计算', 'Calculate'],
  addNote: ['N 可为负（向前数）。N=0 返回起始日本身。', 'Use a negative N to go back. Zero returns the start date.'], source: ['数据源：', 'Source:'],
  prev: ['上月', 'Previous month'], next: ['下月', 'Next month'], theme: ['切换深色模式', 'Toggle dark mode'],
  activityLabel: ['按活动筛选宜办的日子', 'Filter suitable dates by activity'], findActivity: ['找最近一天 →', 'Find next date →'],
  legacyNote: ['术语和详细解释保留中文原文。', 'Traditional terms and detailed notes are shown in Chinese.'],
};
export function translateStatic(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(...staticText[el.dataset.i18n]);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(...staticText[el.dataset.i18nLabel]));
  root.documentElement.lang = language;
  root.title = t(...staticText.appTitle);
}
