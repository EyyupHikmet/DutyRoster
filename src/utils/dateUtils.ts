// Formatted month names in Turkish
export const MONTHS_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", 
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

// Week days in Turkish
export const DAYS_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/**
 * Generates an array of Date objects for every day in a given month.
 */
export const getDaysInMonth = (year: number, month: number): Date[] => {
  const date = new Date(year, month - 1, 1);
  const days: Date[] = [];
  while (date.getMonth() === month - 1) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
};

/**
 * Formats a Date object as a YYYY-MM-DD string.
 */
export const formatDateYYYYMMDD = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Generates an array of Date objects for the monthly calendar grid,
 * including leading and trailing null pads for proper weekday alignments.
 */
export const getMonthDatesWithPadding = (year: number, month: number): (Date | null)[] => {
  const dates = getDaysInMonth(year, month);
  if (dates.length === 0) return [];

  const paddedList: (Date | null)[] = [];
  
  // Get the first weekday of the month (0: Sun, 1: Mon, ..., 6: Sat)
  const firstDayIdx = dates[0].getDay();
  // Shift so week starts on Monday (0: Mon, 1: Tue, ..., 5: Sat, 6: Sun)
  const shiftedFirstDayIdx = firstDayIdx === 0 ? 6 : firstDayIdx - 1;

  // Fill initial padding
  for (let i = 0; i < shiftedFirstDayIdx; i++) {
    paddedList.push(null);
  }

  // Fill dates
  for (const d of dates) {
    paddedList.push(d);
  }

  // Fill trailing padding to round to complete week row (multiple of 7)
  while (paddedList.length % 7 !== 0) {
    paddedList.push(null);
  }

  return paddedList;
};
