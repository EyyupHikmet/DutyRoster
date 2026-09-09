import { describe, it, expect } from "vitest";
import {
  getDaysInMonth,
  formatDateYYYYMMDD,
  getMonthDatesWithPadding,
  getDutyDates,
  shiftDate,
} from "../src/utils/dateUtils";

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

  // getDutyDates is the single definition of "which days of this month are
  // duty days" — weekdays minus holidays, plus any weekend explicitly opted
  // in. Both the solver run and the export gap check read it, so they can
  // never disagree about which days were supposed to be covered.
  it("Test 4: getDutyDates - hafta içi günler, tatiller hariç", () => {
    // September 2026 starts on a Tuesday and has 22 weekdays.
    const dates = getDutyDates(2026, 9, [], []);
    expect(dates.length, "Eylül 2026'da 22 hafta içi gün var").toBe(22);
    expect(dates, "Hafta sonu dahil edilmemeli").not.toContain("2026-09-05"); // Saturday
    expect(dates, "Hafta sonu dahil edilmemeli").not.toContain("2026-09-06"); // Sunday
    expect(dates[0], "İlk nöbet günü 1 Eylül olmalı").toBe("2026-09-01");
  });

  it("Test 5: getDutyDates - tatil olarak işaretlenen hafta içi gün çıkarılır", () => {
    const dates = getDutyDates(2026, 9, ["2026-09-01", "2026-09-02"], []);
    expect(dates.length, "İki tatil düşülmeli").toBe(20);
    expect(dates).not.toContain("2026-09-01");
    expect(dates).not.toContain("2026-09-02");
  });

  it("Test 6: getDutyDates - nöbet günü seçilen hafta sonu eklenir", () => {
    const dates = getDutyDates(2026, 9, [], ["2026-09-05"]);
    expect(dates.length, "Bir hafta sonu eklenmeli").toBe(23);
    expect(dates, "Nöbet günü seçilen cumartesi dahil olmalı").toContain("2026-09-05");
    expect(dates, "Seçilmeyen pazar hariç kalmalı").not.toContain("2026-09-06");
  });

  it("Test 7: getDutyDates - sonuç kronolojik sırada döner", () => {
    const dates = getDutyDates(2026, 9, [], ["2026-09-05"]);
    const sorted = [...dates].sort();
    expect(dates, "Günler tarih sırasında olmalı").toEqual(sorted);
  });

  // shiftDate underpins the "no back-to-back duties" rule: the solver asks
  // "is this teacher on duty the day before/after?", which is a question about
  // adjacent CALENDAR days, so the arithmetic has to survive month, year and
  // leap-day boundaries — and must not drift by a day in any timezone.
  it("Test 8: shiftDate - günü bir ileri ve bir geri kaydırır", () => {
    expect(shiftDate("2026-10-14", 1)).toBe("2026-10-15");
    expect(shiftDate("2026-10-14", -1)).toBe("2026-10-13");
  });

  it("Test 9: shiftDate - ay sınırını aşar", () => {
    expect(shiftDate("2026-10-31", 1), "Ay sonundan sonraki ayın 1'ine").toBe("2026-11-01");
    expect(shiftDate("2026-11-01", -1), "Ay başından önceki ayın sonuna").toBe("2026-10-31");
  });

  it("Test 10: shiftDate - yıl sınırını aşar", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("Test 11: shiftDate - artık yılın 29 Şubat'ını atlamaz", () => {
    expect(shiftDate("2028-02-28", 1), "2028 artık yıl, 29 Şubat var").toBe("2028-02-29");
    expect(shiftDate("2026-02-28", 1), "2026 artık yıl değil").toBe("2026-03-01");
  });
});
