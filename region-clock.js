// A reference clock, independent of the date used for the calendar grid.
export const CLOCK_ZONES = {
  CN: { timeZone: 'Asia/Shanghai', city: ['北京', 'Beijing'] },
  US: { timeZone: 'America/New_York', city: ['纽约（美东）', 'New York (ET)'] },
  SG: { timeZone: 'Asia/Singapore', city: ['新加坡', 'Singapore'] },
};

const formatters = new Map();
export function regionClock(region, instant = new Date()) {
  if (!formatters.has(region)) {
    formatters.set(region, new Intl.DateTimeFormat('en-GB', {
      timeZone: CLOCK_ZONES[region].timeZone,
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
    }));
  }
  const parts = Object.fromEntries(formatters.get(region).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { time: `${parts.hour}:${parts.minute}`, offset: parts.timeZoneName.replace(/^GMT/, 'UTC').replace('-', '−') };
}
