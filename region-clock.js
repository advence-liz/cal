// A reference clock, independent of the date used for the calendar grid.
export const CLOCK_ZONES = {
  CN: { timeZone: 'Asia/Shanghai', city: ['北京', 'Beijing'] },
  US: { timeZone: 'America/New_York', city: ['纽约（美东）', 'New York (ET)'] },
  SG: { timeZone: 'Asia/Singapore', city: ['新加坡', 'Singapore'] },
  JP: { timeZone: 'Asia/Tokyo', city: ['东京', 'Tokyo'] },
  GB: { timeZone: 'Europe/London', city: ['伦敦', 'London'] },
  FR: { timeZone: 'Europe/Paris', city: ['巴黎', 'Paris'] },
  ZA: { timeZone: 'Africa/Johannesburg', city: ['约翰内斯堡', 'Johannesburg'] },
  US_WEST: { timeZone: 'America/Los_Angeles', city: ['洛杉矶（美西）', 'Los Angeles (PT)'] },
  DE: { timeZone: 'Europe/Berlin', city: ['柏林', 'Berlin'] },
  IN: { timeZone: 'Asia/Kolkata', city: ['新德里', 'New Delhi'] },
  BR: { timeZone: 'America/Sao_Paulo', city: ['圣保罗', 'São Paulo'] },
  AU: { timeZone: 'Australia/Sydney', city: ['悉尼', 'Sydney'] },
  SA: { timeZone: 'Asia/Riyadh', city: ['利雅得', 'Riyadh'] },
  UTC: { timeZone: 'UTC', city: ['协调世界时', 'UTC'] },
};

export const AUTO_CLOCK_ZONE = 'auto';
export function clockZoneFor(region, preference) {
  if (Object.hasOwn(CLOCK_ZONES, preference)) return preference;
  return Object.hasOwn(CLOCK_ZONES, region) ? region : 'CN';
}

const formatters = new Map();
export function regionClock(region, instant = new Date()) {
  if (!formatters.has(region)) {
    formatters.set(region, new Intl.DateTimeFormat('en-GB', {
      timeZone: CLOCK_ZONES[region].timeZone,
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
    }));
  }
  const parts = Object.fromEntries(formatters.get(region).formatToParts(instant).map(({ type, value }) => [type, value]));
  const offset = parts.timeZoneName.replace(/^GMT/, 'UTC').replace('-', '−');
  return { time: `${parts.hour}:${parts.minute}`, offset: offset === 'UTC+0' ? 'UTC' : offset };
}
