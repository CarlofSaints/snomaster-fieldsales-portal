import ExcelJS from 'exceljs';

/**
 * Build a monthly planner for a rep to fill in.
 *
 * This exists to stop the problems at source rather than detecting them later.
 * Every hand-made planner that came back had at least one of: a month in the
 * title that disagreed with the calendar, a shading colour absent from its own
 * legend, an inserted column that moved the grid, or an empty site-code column.
 *
 * A generated planner has none of those — the dates and weekday headers are
 * computed from the month, the site codes are already filled in, and the rep is
 * asked to type `1` rather than shade a cell, which is unambiguous and survives
 * copy-paste and re-theming.
 *
 * Kept out of the route handler so it can be parsed back by the planner parser
 * in a test: a template our own reader cannot read would be worse than useless.
 */

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const BRAND = 'FFE31E1C';
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };

/** Day types other than "in store" — these stay colours, they aren't cycle data. */
const LEGEND: { label: string; argb: string }[] = [
  { label: 'WEEKENDS', argb: 'FFC00000' },
  { label: 'LEAVE', argb: 'FF00B050' },
  { label: 'OFFICE DAY', argb: 'FFFFFF00' },
  { label: 'PUBLIC HOLIDAY', argb: 'FF00B0F0' },
  { label: 'SHOWS (SETUP / SET DOWN)', argb: 'FF7F7F7F' },
  { label: 'BA IN STORE', argb: 'FFB4C6E7' },
];

export interface TemplateStore {
  code: string;
  name: string;
  channel: string;
}

export interface TemplateSheet {
  /** Perigee email, or '' for a blank sheet. */
  email: string;
  teamName?: string;
  stores: TemplateStore[];
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

export function buildPlannerTemplate(
  month: number,
  year: number,
  sheets: TemplateSheet[],
): ExcelJS.Workbook {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const wb = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const repLabel = (sheet.email ? sheet.email.split('@')[0] : 'REP').toUpperCase();
    // The sheet name states the month, and the upload cross-checks it against
    // the calendar — so a generated planner can never fail that check.
    const sheetName = `${repLabel} ${MONTH_NAMES[month - 1].toUpperCase()} ${year}`.slice(0, 31);
    const ws = wb.addWorksheet(sheetName);

    // A: index | B: store name | C: site code | D..: the calendar
    const COL_IDX = 1, COL_NAME = 2, COL_CODE = 3, COL_DAY1 = 4;
    ws.getColumn(COL_IDX).width = 5;
    ws.getColumn(COL_NAME).width = 42;
    ws.getColumn(COL_CODE).width = 12;
    for (let i = 0; i < daysInMonth; i++) ws.getColumn(COL_DAY1 + i).width = 4;

    const title = ws.getCell(1, COL_NAME);
    title.value = `${repLabel} - STORE VISIT PLANNER - ${MONTH_NAMES[month - 1].toUpperCase()} ${year}`;
    title.font = { bold: true, size: 12 };

    const instr = ws.getCell(2, COL_NAME);
    instr.value = 'Type 1 in the cell for every day you will be IN STORE. Do not shade it — type the number.';
    instr.font = { bold: true, size: 10, color: { argb: 'FF9A3412' } };

    const instr2 = ws.getCell(3, COL_NAME);
    instr2.value = 'Use the colours below only for non-selling days. Do not change the SITE CODE column.';
    instr2.font = { size: 9, color: { argb: 'FF6B7280' } };

    if (sheet.email) {
      const who = ws.getCell(4, COL_NAME);
      who.value = `Perigee user: ${sheet.email}${sheet.teamName ? `   Team: ${sheet.teamName}` : ''}`;
      who.font = { size: 9, color: { argb: 'FF6B7280' } };
    }

    // ── Day-type key ──
    let r = 6;
    ws.getCell(r, COL_NAME).value = 'DAY TYPE KEY';
    ws.getCell(r, COL_NAME).font = { bold: true, size: 9 };
    r++;

    // In-store comes first and shows the MARKER, not a colour.
    const markerCell = ws.getCell(r, COL_CODE);
    markerCell.value = 1;
    markerCell.font = { bold: true, size: 11 };
    markerCell.alignment = { horizontal: 'center' };
    markerCell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
    ws.getCell(r, COL_NAME).value = 'IN STORE  (type the number 1)';
    ws.getCell(r, COL_NAME).font = { bold: true, size: 9 };
    r++;

    for (const l of LEGEND) {
      ws.getCell(r, COL_NAME).value = l.label;
      ws.getCell(r, COL_NAME).font = { size: 9 };
      fill(ws.getCell(r, COL_CODE), l.argb);
      r++;
    }

    // ── Calendar header ──
    const weekdayRow = r + 1;
    const dateRow = weekdayRow + 1;

    for (let i = 0; i < daysInMonth; i++) {
      const c = COL_DAY1 + i;
      const wd = ws.getCell(weekdayRow, c);
      wd.value = WEEKDAYS[(firstWeekday + i) % 7];
      wd.font = { ...HEADER_FONT, size: 7 };
      wd.alignment = { textRotation: 90, horizontal: 'center', vertical: 'bottom' };
      fill(wd, BRAND);

      const dc = ws.getCell(dateRow, c);
      dc.value = i + 1;
      dc.font = HEADER_FONT;
      dc.alignment = { horizontal: 'center' };
      fill(dc, BRAND);
    }
    ws.getRow(weekdayRow).height = 52;

    for (const [col, label] of [[COL_IDX, '#'], [COL_NAME, 'STORE NAME'], [COL_CODE, 'SITE CODE']] as const) {
      const cell = ws.getCell(weekdayRow, col);
      cell.value = label;
      cell.font = HEADER_FONT;
      fill(cell, BRAND);
    }
    // `DATE` in the store-name column is what the parser anchors on.
    const dateLabel = ws.getCell(dateRow, COL_NAME);
    dateLabel.value = 'DATE';
    dateLabel.font = HEADER_FONT;
    fill(dateLabel, BRAND);
    for (const col of [COL_IDX, COL_CODE]) fill(ws.getCell(dateRow, col), BRAND);

    // ── Store rows ──
    let n = 0;
    let currentChannel = '';
    let row = dateRow + 1;

    for (const s of sheet.stores) {
      if (s.channel && s.channel !== currentChannel) {
        currentChannel = s.channel;
        const head = ws.getCell(row, COL_NAME);
        head.value = s.channel;
        head.font = { bold: true, size: 9 };
        for (const c of [COL_IDX, COL_NAME, COL_CODE]) fill(ws.getCell(row, c), 'FFF3F4F6');
        row++;
      }

      ws.getCell(row, COL_IDX).value = ++n;
      ws.getCell(row, COL_NAME).value = s.name;
      const code = ws.getCell(row, COL_CODE);
      code.value = s.code;
      code.font = { color: { argb: 'FF6B7280' } };
      code.alignment = { horizontal: 'center' };

      // Pre-shade weekends so the shape of the month is visible.
      for (let i = 0; i < daysInMonth; i++) {
        const wd = (firstWeekday + i) % 7;
        if (wd === 0 || wd === 6) fill(ws.getCell(row, COL_DAY1 + i), 'FFC00000');
      }
      row++;
    }

    if (sheet.stores.length === 0) {
      const note = ws.getCell(row, COL_NAME);
      note.value = 'No stores on file yet — add them here with their Perigee site codes.';
      note.font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };
    }

    ws.views = [{ state: 'frozen', xSplit: COL_CODE, ySplit: dateRow }];
  }

  return wb;
}
