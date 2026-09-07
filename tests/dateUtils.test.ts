import { describe, it, expect } from "vitest";
import { getDaysInMonth, formatDateYYYYMMDD, getMonthDatesWithPadding } from "../src/utils/dateUtils";

// Migrated from the original hand-rolled tsx-executed assert script onto vitest.
// Assertions/conditions preserved verbatim from the pre-migration version.

describe("Tarih Yardımcı Programı Testleri (dateUtils)", () => {
  it("Test 1: getDaysInMonth - Regular and Leap years", () => {
    // 2026 is not a leap year, Feb has 28 days
    const feb2026 = getDaysInMonth(2026, 2);
    expect(feb2026.length, "Şubat 2026 28 gün olmalı").toBe(28);
    expect(feb2026[0].getDate(), "Şubat 2026 ilk günü 1 olmalı").toBe(1);
    expect(feb2026[27].getDate(), "Şubat 2026 son günü 28 olmalı").toBe(28);

    // 2028 is a leap year, Feb has 29 days
    const feb2028 = getDaysInMonth(2028, 2);
    expect(feb2028.length, "Şubat 2028 (Artık Yıl) 29 gün olmalı").toBe(29);
    expect(feb2028[28].getDate(), "Şubat 2028 son günü 29 olmalı").toBe(29);

    // Oct has 31 days
    const oct2026 = getDaysInMonth(2026, 10);
    expect(oct2026.length, "Ekim 2026 31 gün olmalı").toBe(31);
  });

  it("Test 2: formatDateYYYYMMDD", () => {
    const d1 = new Date(2026, 8, 5); // Sept 5th, 2026 (0-indexed month 8 is Sept)
    expect(formatDateYYYYMMDD(d1), "5 Eylül 2026 formatı 2026-09-05 olmalı").toBe("2026-09-05");

    const d2 = new Date(2026, 11, 31); // Dec 31st, 2026
    expect(formatDateYYYYMMDD(d2), "31 Aralık 2026 formatı 2026-12-31 olmalı").toBe("2026-12-31");
  });

  it("Test 3: getMonthDatesWithPadding - Calendars grid alignment", () => {
    // Sept 1st, 2026 is a Tuesday (shiftedFirstDayIdx should be 1, so 1 leading null pad)
    const sept2026Padded = getMonthDatesWithPadding(2026, 9);
    expect(sept2026Padded[0], "Eylül 2026 Salı ile başladığı için ilk hücre boş/null olmalı").toBe(
      null
    );
    expect(sept2026Padded[1], "Eylül 2026 ikinci hücre dolu olmalı (1 Eylül)").not.toBe(null);
    expect(sept2026Padded[1]?.getDate(), "Eylül 2026 ilk günü 1 Eylül olmalı").toBe(1);

    // Padding list length must be multiple of 7 (complete weeks rows)
    expect(sept2026Padded.length % 7, "Takvim grid hücre sayısı 7'nin katı olmalı").toBe(0);
  });
});
