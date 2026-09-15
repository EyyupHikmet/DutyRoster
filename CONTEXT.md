# DutyRoster

A school principal's tool for planning a month of teachers' overnight dormitory supervision duty: who stays with the boarding students on each day, fairly and within each teacher's limits. The interface speaks Turkish; each term lists the Turkish word the interface uses for it.

## Language

### Duty posts

**Duty post**:
A place that needs overnight supervision, such as a dormitory or a building on the campus. Each duty post has its own staff, and every month it can have its own schedule. Duty posts last across months.
_Turkish_: Nöbet Yeri
_Avoid_: Schedule, dormitory, building, unit

### People and availability

**Staff**:
The teachers of one duty post, who can be given duty there. A teacher belongs to exactly one duty post.
_Turkish_: Kadro
_Avoid_: Roster, teacher list

**Priority**:
A per-teacher weight that decides whose claim on a duty day wins among teachers in the same position for it. Being below one's effective target outranks a preference, and a preference outranks a higher priority.
_Turkish_: Öncelik
_Avoid_: Seniority, Kıdem

**Availability**:
A teacher's standing on one date: **Preferred**, **Available** or **Unavailable**.
_Turkish_: Uygunluk

**Preferred**:
A date on which a teacher would like to be on duty.
_Turkish_: Tercih Edilen

**Available**:
A date on which a teacher can be on duty but hasn't asked for it.
_Turkish_: Uygun

**Unavailable**:
A date on which a teacher cannot be given duty, for any reason.
_Turkish_: Uygun Değil
_Avoid_: On leave, İzinli, time off

### Duties and days

**School day**:
A date on which lessons take place, so teachers are in class for part of the day.

**Duty**:
One teacher supervising the student dormitory for one date, including staying the night. On a school day it covers the time after school; on any other date it covers the whole day. A duty is never measured in hours.
_Turkish_: Nöbet
_Avoid_: Shift, hours

**Duty day**:
A date in the month on which the dormitory needs duty.
_Turkish_: Nöbet günü

**Non-duty day**:
A date on which the dormitory needs no duty, such as when it is closed for a religious holiday. A non-duty day is not necessarily a holiday, and a holiday is not necessarily a non-duty day.
_Avoid_: Holiday, tatil

**Extra duty day**:
A duty day that is paid at the extra rate, as the principal marks it. Weekend duty days and holidays on which the dormitory stays open are typically extra.
_Turkish_: Ekstra nöbet günü (legend: Nöbet Farkı)

**Standard duty day**:
A duty day paid at the normal rate.
_Turkish_: Standart nöbet günü

**Slot**:
One teacher position on a duty day.
_Turkish_: Slot

**Required count**:
The number of slots a duty day asks for: the **Default required count** unless the day has its own.
_Turkish_: Nöbetçi Sayısı (default: Varsayılan Nöbetçi Sayısı)
_Avoid_: Teachers per day, headcount

**Open slot**:
A slot that no teacher fills in the schedule.
_Turkish_: Boş Slot
_Avoid_: Unfilled, skipped

**Open day**:
A duty day with at least one open slot.
_Avoid_: Unfilled day, skipped day, Boş Gün (it suggests nobody is on duty at all)

**Pin**:
A teacher fixed to a specific duty day by the principal, before the schedule is generated. A pin always wins, over the teacher's duty target and over their availability.
_Turkish_: Sabitle
_Avoid_: Manual assignment, fixed assignment

### Targets

**Duty target**:
The number of duties a teacher should receive in a month.
_Turkish_: Nöbet hedefi
_Avoid_: Target hours, hedef saat

**Usual target**:
A teacher's duty target for any month that doesn't override it.

**Monthly target**:
A duty target set for one teacher in one specific month, overriding their usual target.

**Effective target**:
The duty target that applies to a teacher in a given month: the monthly target if one is set, otherwise the usual target.

### Partner groups

**Partner group**:
A set of two or more teachers the principal wants on duty together on some days of a month.
_Turkish_: Nöbet grubu
_Avoid_: Duty group, group

**Group goal**:
The number of shared duty days a partner group should have in a month. It is separate from each member's duty target.
_Turkish_: Ortak nöbet günü sayısı
_Avoid_: Group target

**Shared duty day**:
A duty day on which every member of a partner group is on duty.
_Turkish_: Ortak nöbet günü

**Short group**:
A partner group whose schedule has fewer shared duty days than its group goal.
_Avoid_: Unfilled group, incomplete group

### Generating the schedule

**Schedule**:
One duty post's assignment of teachers to duty days for a month.
_Turkish_: Nöbet Çizelgesi
_Avoid_: Roster, shift plan

**Distribution rule**:
The principle that decides which eligible teacher is considered first for a duty day. Under every rule, a teacher below their effective target comes before one who has reached it, and a preferred date before an available one; the rule only decides between teachers still tied after that. It changes who gets duty, never whether the schedule obeys the constraints.
_Turkish_: Dağıtım Kuralı
_Avoid_: Strategy, mode

**Even**:
The distribution rule that spreads duties equally among teachers still below their effective target. A teacher who has reached their target is given a duty only when no teacher below target can take it.
_Turkish_: Eşit Dağıt (Adalet)

**Priority first**:
The distribution rule that breaks ties in favour of higher priority, so a high-priority teacher takes every date they prefer until they reach their effective target.
_Turkish_: Öncelikli
_Avoid_: Seniority first, Kıdem Öncelikli

**Target-focused**:
The distribution rule that favours teachers furthest below their effective target.
_Turkish_: Dengeli (Hedef Odaklı)

**Random**:
The distribution rule that breaks ties at random.
_Turkish_: Rastgele Doldur

**Target cap**:
The rule that no teacher is given more duties than their effective target, except through pins. With it on, a slot is left open rather than a target exceeded.
_Turkish_: Aylık hedefleri kesinlikle aşma
_Avoid_: Respect targets, hard target

**No back-to-back duties**:
The rule that no teacher is on duty on two adjacent calendar dates, meaning two nights in a row at the dormitory.
_Turkish_: Aynı öğretmene üst üste iki gün verme
_Avoid_: Consecutive days

**Stuck day**:
The duty day at which generating the schedule gave up because no assignment could be found. It is where the search got stuck, not necessarily the cause.
_Turkish_: Sıkışma
_Avoid_: Error date, failure date

**Duty report**:
The exported workbook of one or more schedules, each with its teachers' duty totals, plus a running total when it holds more than one.
_Turkish_: Nöbet Raporu
_Avoid_: Excel export, Excel file

### The month

**Month setup**:
Everything the principal has configured for one duty post in one month. A teacher's availability is not part of it: it belongs to the teacher.

**Draft**:
A month setup for which no schedule has been generated yet.
_Avoid_: Unsaved changes (a separate thing: edits not yet written)

**School year**:
The twelve months from Eylül to the following Ağustos.
_Turkish_: Eğitim-öğretim yılı

### Approval

**Approve**:
To make a generated schedule official, keeping a frozen copy of it permanently. A schedule has at most one approved schedule, so approving it again replaces the earlier copy. Approving does not lock the month: its setup can still be changed and its schedule generated again.
_Turkish_: Onayla

**Approved schedule**:
The frozen copy of a schedule made when the principal approves it, together with everything its duty report needs: the duty post's name, teacher names, effective targets, extra duty days and non-duty days. Later changes to the staff or the month setup never alter it. It may contain open slots.
_Turkish_: Onaylı Çizelge
_Avoid_: Saved schedule, archive, final schedule

**Approval date**:
The moment a schedule was approved.
_Turkish_: Onay tarihi

**Running total**:
Each teacher's duties added up across every schedule included in one duty report. Teachers are matched by name, so a teacher renamed between schedules counts as two.
_Avoid_: Annual total (it covers only what the report includes)
