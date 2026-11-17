import type { AdventureDetail } from '../shared/events.ts';
import type { Locale } from '../shared/locale.ts';

function escaped(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
}
function fold(line: string) {
  const lines: string[] = [];
  let part = '';
  for (const char of line) {
    if (Buffer.byteLength(part + char) > 75) { lines.push(part); part = ` ${char}`; }
    else part += char;
  }
  lines.push(part);
  return lines.join('\r\n');
}
const utc = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function eventCalendar(event: AdventureDetail, locale: Locale = 'en'): string {
  const russian = locale === 'ru';
  const location = event.meetingDetails && event.location.kind === 'city' ? event.meetingDetails
    : event.place ? `${event.place.name}, ${event.place.address}`
    : event.location.kind === 'online' && russian ? 'Онлайн' : event.location.name;
  const description = event.descriptionMarkdown
    + (event.meetingDetails && event.location.kind === 'online' ? `\n\n${russian ? 'Ссылка на звонок' : 'Call link'}: ${event.meetingDetails}` : '')
    + (event.meetingMapUrl ? `\n\n${russian ? 'Точка на карте' : 'Map pin'}: ${event.meetingMapUrl}` : '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QUESTR//Adventures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${event.id}@questr`, `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(event.startsAt)}`, `DTEND:${utc(event.endsAt)}`,
    `SUMMARY:${escaped(event.title)}`, `DESCRIPTION:${escaped(description)}`, `LOCATION:${escaped(location)}`,
    ...(event.status === 'cancelled' ? ['STATUS:CANCELLED'] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${russian ? 'Вылазка начнётся через час' : 'Adventure starts in one hour'}`, 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
