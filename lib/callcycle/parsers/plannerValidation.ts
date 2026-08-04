import type { PlannerSheet } from './snomasterPlanner';

/**
 * Fail-closed validation for a SnoMaster planner.
 *
 * A planner states its month in three independent places — the sheet name, the
 * title cell, and the calendar grid itself — and in real files they disagree.
 * One rep's file was named "STORE VISITSAUGUST 2026" over a title reading
 * "JULY 2026 STORE VISIT PLANNER". Loading that would have silently produced a
 * cycle for the wrong month.
 *
 * So any disagreement is a BLOCKING error: nothing is saved, the user is told
 * exactly which three values conflict, and they fix the file and reload. That
 * matches how the duplicate-site-code check already behaves.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(m: number | null): string {
  return m && m >= 1 && m <= 12 ? MONTH_NAMES[m - 1] : 'not stated';
}

export interface PlannerIssue {
  sheetName: string;
  /** 'error' blocks the upload; 'warning' is shown but does not block. */
  level: 'error' | 'warning';
  title: string;
  detail: string;
  /** What the user should change in the file. */
  fix: string;
}

export interface PlannerValidation {
  issues: PlannerIssue[];
  /** True when at least one blocking error was found. */
  blocked: boolean;
}

export function validatePlannerSheet(sheet: PlannerSheet): PlannerIssue[] {
  const issues: PlannerIssue[] = [];
  const s = sheet.sheetName;

  // The grid is the ground truth: only one month has both this day-count and
  // this starting weekday. If it can't be pinned down, the sheet is malformed.
  if (!sheet.gridMonth) {
    issues.push({
      sheetName: s,
      level: 'error',
      title: 'The calendar does not match any real month',
      detail: 'The weekday row and the date row do not line up with any month of the stated year, so the days of the week in this planner are wrong.',
      fix: 'Check the weekday header row against the date row and correct whichever is out, then reload.',
    });
    return issues; // Nothing else can be trusted.
  }

  const grid = monthName(sheet.gridMonth);

  if (sheet.sheetNameMonth && sheet.sheetNameMonth !== sheet.gridMonth) {
    issues.push({
      sheetName: s,
      level: 'error',
      title: 'Sheet name and calendar disagree on the month',
      detail: `The sheet is named "${s}" which says ${monthName(sheet.sheetNameMonth)}, but the calendar itself is ${grid} (${sheet.gridYear}).`,
      fix: `Rename the sheet to ${grid}, or fix the dates, so they agree.`,
    });
  }

  if (sheet.titleMonth && sheet.titleMonth !== sheet.gridMonth) {
    issues.push({
      sheetName: s,
      level: 'error',
      title: 'Title and calendar disagree on the month',
      detail: `The title reads "${sheet.title}" which says ${monthName(sheet.titleMonth)}, but the calendar itself is ${grid} (${sheet.gridYear}).`,
      fix: `Update the title to ${grid}, or fix the dates, so they agree.`,
    });
  }

  if (sheet.sheetNameMonth && sheet.titleMonth && sheet.sheetNameMonth !== sheet.titleMonth) {
    issues.push({
      sheetName: s,
      level: 'error',
      title: 'Sheet name and title disagree on the month',
      detail: `The sheet name says ${monthName(sheet.sheetNameMonth)} but the title says ${monthName(sheet.titleMonth)}.`,
      fix: 'Make the sheet name and the title state the same month, then reload.',
    });
  }

  if (!sheet.sheetNameMonth && !sheet.titleMonth) {
    issues.push({
      sheetName: s,
      level: 'warning',
      title: 'No month stated in the sheet name or title',
      detail: `Neither the sheet name nor the title names a month. The calendar reads as ${grid} ${sheet.gridYear}, which is what will be used.`,
      fix: `Add "${grid} ${sheet.gridYear}" to the sheet name so this is unambiguous next month.`,
    });
  }

  if (!sheet.repName) {
    issues.push({
      sheetName: s,
      level: 'warning',
      title: 'Could not work out whose planner this is',
      detail: 'No rep name could be read from the title cell or the file name.',
      fix: 'Pick the rep manually below, or title the sheet like "NTANDO - STORE VISIT PLANNER".',
    });
  }

  if (sheet.stores.length === 0) {
    issues.push({
      sheetName: s,
      level: 'error',
      title: 'No store rows found',
      detail: 'The calendar was located but no numbered store rows were found beneath it.',
      fix: 'Check that each store row has its number in the column immediately left of the store name.',
    });
  }

  return issues;
}

export function validatePlanner(sheets: PlannerSheet[]): PlannerValidation {
  const issues = sheets.flatMap(validatePlannerSheet);
  return { issues, blocked: issues.some(i => i.level === 'error') };
}
