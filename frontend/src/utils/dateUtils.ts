// Returns YYYY-MM-DD in the device's local timezone (not UTC)
export const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Returns the IANA timezone name (e.g. "Asia/Kolkata")
export const getTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

// Returns the last n calendar days as YYYY-MM-DD strings, most recent first
export const getLastNDates = (n: number): string[] => {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(getLocalDateString(d));
  }
  return dates;
};

// Returns all dates from startDate to endDate inclusive, oldest first
export const getDateRange = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  if (start > end) return [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(getLocalDateString(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
};
