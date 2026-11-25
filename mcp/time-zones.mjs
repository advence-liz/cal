import { Temporal } from '@js-temporal/polyfill';

export const zonedInstant = (instant, timeZone) => Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(timeZone);
export const utcTime = instant => Temporal.Instant.fromEpochMilliseconds(instant).toString();
export function localDayStart(date, timeZone) {
  return Temporal.PlainDate.from(date).toZonedDateTime(timeZone).epochMilliseconds;
}
export function localInstant(datetime, timeZone) {
  // Treat Z like an explicit zero offset: it must also agree with the named source zone.
  return Temporal.ZonedDateTime.from(`${datetime.replace(/Z$/, '+00:00')}[${timeZone}]`, {
    disambiguation: 'reject', offset: 'reject',
  });
}

export function convertTimeZone(datetime, from_tz, to_tz) {
  const source = localInstant(datetime, from_tz);
  const target = source.withTimeZone(to_tz);
  return { from_tz, to_tz, local: target.toPlainDateTime().toString(), offset: target.offset, utc: source.toInstant().toString() };
}

export function localTimes(timeZones, instant = Date.now()) {
  return { utc: utcTime(instant), times: timeZones.map(time_zone => {
    const target = zonedInstant(instant, time_zone);
    return { time_zone, local: target.toPlainDateTime().toString(), offset: target.offset };
  }) };
}
