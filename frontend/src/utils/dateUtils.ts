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
