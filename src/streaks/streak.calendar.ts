const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function istDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shiftIstDate(dateKey: string, days: number): string {
  const noon = new Date(`${dateKey}T12:00:00+05:30`);
  return istDateKey(new Date(noon.getTime() + days * 86_400_000));
}

export function endOfIstDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999+05:30`);
}

function weekdayIndex(dateKey: string): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(new Date(`${dateKey}T12:00:00+05:30`));
  const index = WEEK.indexOf(label as (typeof WEEK)[number]);
  return index === -1 ? 0 : index;
}

export type WeekCell = {
  label: string;
  date: string;
  state: 'done' | 'today' | 'upcoming' | 'missed';
};

export function weekCells(today: string, covered: Set<string>, activeToday: boolean): WeekCell[] {
  const start = shiftIstDate(today, -weekdayIndex(today));
  return WEEK.map((label, index) => {
    const date = shiftIstDate(start, index);
    let state: WeekCell['state'] = 'missed';
    if (date > today) state = 'upcoming';
    else if (date === today && activeToday) state = 'today';
    else if (covered.has(date)) state = 'done';
    else if (date === today) state = 'today';
    return { label, date, state };
  });
}

export function coveredDates(lastPaidOn: string | null, days: number): Set<string> {
  const covered = new Set<string>();
  if (!lastPaidOn || days < 1) return covered;
  let cursor = lastPaidOn;
  for (let i = 0; i < days; i += 1) {
    covered.add(cursor);
    cursor = shiftIstDate(cursor, -1);
  }
  return covered;
}
