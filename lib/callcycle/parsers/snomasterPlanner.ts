import ExcelJS from 'exceljs';

/**
 * SnoMaster monthly "STORE VISIT PLANNER" parser.
 *
 * Nothing like the iRAM formats. A planner is ONE rep, ONE month, laid out as a
 * calendar: every store is a row, every day of the month is a column, and a
 * planned visit is marked in the cell where they cross.
 *
 *          | ... |  DATE | 1   2   3   4  ...      <- day-of-month row
 *          | ... |       | SAT SUN MON TUE ...     <- weekday row (above DATE)
 *   1 | Makro Carnivile  |         ##              <- shaded = visit on the 3rd
 *
 * Perigee wants cycle weeks + weekday names, not dates. Those are the same
 * thing: the Nth occurrence of a weekday in a month is always ceil(date / 7),
 * because the first occurrence of any weekday necessarily falls on day 1-7.
 * So "shaded on Mon the 3rd and Mon the 17th" is exactly "Week 1&3, Monday".
 *
 * ── How a visit is marked ────────────────────────────────────────────────
 * Two ways, both supported, because relying on fill colour alone proved
 * fragile across real files:
 *
 *   1. A TYPED MARKER — any of `1`, `x`, `y`, `v` (case-insensitive). Preferred:
 *      it survives re-theming, copy-paste and Excel version drift.
 *   2. A FILL COLOUR matched against the legend block at the top of the sheet.
 *      The legend is read FROM THE SHEET rather than hardcoded, because it
 *      genuinely differs per rep, and the same label uses different colours in
 *      different files.
 *
 * Colour matching is deliberately tolerant: one real file's grid used the same
 * theme grey as its legend but a different tint, which an exact match would
 * have silently read as "no visits at all".
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface PlannerLegendEntry {
  /** Colour key as read from the sheet, e.g. "FFC00000" or "T0/-0.250". */
  fill: string;
  /** Legend label, uppercased, e.g. "PLANNING". '' when the colour is used in the grid but absent from the legend. */
  label: string;
  /** How many store-row cells actually carry this colour. */
  cellCount: number;
  /** Our suggestion — the caller confirms it. */
  suggestedIsVisit: boolean;
  /** True when this colour appears in the grid but nowhere in the legend. */
  unknown: boolean;
}

export interface PlannerStoreRow {
  /** Row index in the sheet (1-based), so the UI can point at it. */
  rowNumber: number;
  /** The rep's own numbering in the left column. */
  index: string;
  /** Store name exactly as typed by the rep — typos and all. */
  storeName: string;
  /** Section/region heading this store sat under, e.g. "JOBURG NORTH & EAST (4)". */
  section: string;
  /** Store code, if the rep filled the STORE CODE column (usually empty). */
  storeCode: string;
  /** Each marked day: the day-of-month, its weekday, and how it was marked. */
  marks: { day: number; weekday: string; via: 'marker' | 'fill'; fill: string; text: string }[];
}

export interface PlannerSheet {
  sheetName: string;
  /** Title cell text, e.g. "NTANDO - STORE VISIT PLANNER TEMP 2026". */
  title: string;
  /** Section heading above the calendar, e.g. "SNOMASTER GAUTENG STORES PLANNING". */
  regionTitle: string;
  /** Rep name as inferred from the title cell (may be ''). */
  repName: string;
  /** Month 1-12 as proven by the grid's own weekday/day-count alignment. */
  gridMonth: number | null;
  gridYear: number | null;
  /** Month named in the sheet name, if any. */
  sheetNameMonth: number | null;
  /** Month named in the title cell, if any. */
  titleMonth: number | null;
  /** Year named anywhere in the sheet name or title. */
  namedYear: number | null;
  legend: PlannerLegendEntry[];
  stores: PlannerStoreRow[];
  /** True when any cell was marked with a typed marker rather than a colour. */
  usesTypedMarkers: boolean;
  /** True when a SITE CODE column was found, so stores resolve by code not name. */
  hasCodeColumn: boolean;
  /** How many store rows actually carry a code. */
  storesWithCodes: number;
  warnings: string[];
}

export interface PlannerParseResult {
  sheets: PlannerSheet[];
  warnings: string[];
}

// ── Constants ────────────────────────────────────────────────────────────

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Typed in-store markers. `1` is the one we ask reps to use. */
const VISIT_MARKERS = new Set(['1', 'X', 'Y', 'V', '✓', '✔']);

const MONTHS: Record<string, number> = {
  JANUARY: 1, JANUARIE: 1, JAN: 1,
  FEBRUARY: 2, FEBRUARIE: 2, FEB: 2,
  MARCH: 3, MAART: 3, MAR: 3,
  APRIL: 4, APR: 4,
  MAY: 5, MEI: 5,
  JUNE: 6, JUNIE: 6, JUN: 6,
  JULY: 7, JULIE: 7, JUL: 7,
  AUGUST: 8, AUGUSTUS: 8, AUG: 8,
  SEPTEMBER: 9, SEP: 9, SEPT: 9,
  OCTOBER: 10, OKTOBER: 10, OCT: 10, OKT: 10,
  NOVEMBER: 11, NOV: 11,
  DECEMBER: 12, DESEMBER: 12, DEC: 12, DES: 12,
};

/**
 * Legend labels that never mean "the rep was in this store selling".
 * BA / Ambassador in-store days are explicitly excluded: Carl confirmed those
 * are a different activity and must not become call cycle rows.
 */
const NON_VISIT_LABELS = [
  'WEEKEND', 'LEAVE', 'DAY OFF', 'OFF SICK', 'SICK', 'OFFICE', 'PUBLIC HOLIDAY',
  'HOLIDAY', 'SHOW', 'TRAVEL', 'REPAIR', 'TRAINING', 'BA IN STORE', 'BA', 'AMBASSEDOR',
  'AMBASSADOR', 'IN STORES', 'PLANNING LEAVE',
];

/** Labels that DO mean the rep is in the store on that day. */
const VISIT_LABELS = ['PLANNING', 'PLANNED', 'VISIT', 'VISITED', 'CALL'];

// ── Cell helpers ─────────────────────────────────────────────────────────

function txt(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const rich = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (rich.richText) return rich.richText.map(t => t.text).join('');
    if (rich.result !== undefined) return String(rich.result);
    if (rich.text !== undefined) return String(rich.text);
    return '';
  }
  return String(v);
}

/**
 * A stable key for a cell's fill. Theme colours are kept as `T<index>/<tint>`
 * because ExcelJS gives no RGB for them; plain colours come back as ARGB.
 * Returns '' for no fill, and for plain white — Excel writes white-on-white for
 * cells that are visually empty, and treating that as a colour would mark the
 * whole calendar.
 */
export function fillKey(cell: ExcelJS.Cell): string {
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || f.pattern === 'none') return '';
  // ExcelJS types fgColor as Partial<Color>, which omits `tint` even though the
  // library populates it for theme colours — and tint is exactly what separates
  // one legend entry from another here.
  const fg = (f as ExcelJS.FillPattern).fgColor as
    (Partial<ExcelJS.Color> & { theme?: number; tint?: number }) | undefined;
  if (!fg) return '';
  if (fg.argb) {
    const argb = fg.argb.toUpperCase();
    if (argb === 'FFFFFFFF' || argb === '00000000') return '';
    return argb;
  }
  if (fg.theme !== undefined) {
    const tint = Number(fg.tint ?? 0);
    // theme 0 with no tint is the plain white background.
    if (fg.theme === 0 && Math.abs(tint) < 0.001) return '';
    return `T${fg.theme}/${tint.toFixed(3)}`;
  }
  return '';
}

/**
 * Do two fill keys refer to the same colour, allowing for the drift seen in
 * real files? Same theme within a tint tolerance counts as a match (one rep's
 * grid used T0/-0.350 against a legend of T0/-0.250 — visibly the same grey).
 */
function fillsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.match(/^T(\d+)\/(-?[\d.]+)$/);
  const tb = b.match(/^T(\d+)\/(-?[\d.]+)$/);
  if (ta && tb && ta[1] === tb[1]) {
    return Math.abs(Number(ta[2]) - Number(tb[2])) <= 0.15;
  }
  return false;
}

function normLabel(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Our default guess at whether a legend label means "in store". */
function labelIsVisit(label: string): boolean {
  const l = normLabel(label);
  if (!l) return false;
  // Non-visit wins on a tie: "BA IN STORE" contains neither VISIT nor PLANNING,
  // but "TRAINING IN STORE" must not be caught by a loose "IN STORE" rule.
  if (NON_VISIT_LABELS.some(n => l.includes(n))) return false;
  return VISIT_LABELS.some(v => l.includes(v));
}

function findMonthInText(s: string): number | null {
  const up = s.toUpperCase();
  // Longest names first so AUGUSTUS doesn't match AUG and stop.
  const names = Object.keys(MONTHS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(up)) return MONTHS[name];
  }
  return null;
}

function findYearInText(s: string): number | null {
  const m = s.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** Rep name from a title like "NTANDO - STORE VISIT PLANNER TEMP 2026". */
function repNameFromTitle(title: string): string {
  const m = title.match(/^\s*([A-Za-z][A-Za-z'\-. ]{1,30}?)\s*[-–—]\s*STORE/i);
  if (m) return m[1].trim();
  const m2 = title.match(/^\s*([A-Za-z][A-Za-z'\-.]{1,20})\s*[-–—]/);
  return m2 ? m2[1].trim() : '';
}

/** Rep name from a filename like "STORE CALL PLANNER RUBEN-LEON.xlsx". */
export function repNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const m = base.match(/(?:CALL\s*PLANNER|PLANNER|VISIT)\s+([A-Za-z][A-Za-z'\- ]*)$/i);
  if (m) return m[1].trim();
  const words = base.split(/[\s_]+/).filter(Boolean);
  return words.length ? words[words.length - 1] : '';
}

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Locate the calendar. The anchor is a cell literally reading "DATE" whose
 * right-hand neighbours run 1, 2, 3… — that held on every real file despite the
 * store-name column sitting in column B, C or D and the header block being
 * 7, 9 or 10 rows deep.
 */
function locateGrid(ws: ExcelJS.Worksheet): { dateRow: number; labelCol: number; dateStartCol: number } | null {
  const maxScanRow = Math.min(ws.rowCount, 25);
  const maxCol = Math.min(ws.columnCount, 60);

  for (let r = 1; r <= maxScanRow; r++) {
    const row = ws.getRow(r);

    // Find the calendar by its DAY NUMBERS — a run of 1, 2, 3, … at least 28
    // long. Anchoring on the run rather than on "the cell right of DATE" is
    // what makes this survive inserted columns: one planner gained a site-code
    // column between the DATE label and day 1, which an adjacency check missed
    // entirely and reported as "no calendar found".
    for (let c = 1; c <= maxCol; c++) {
      if (txt(row.getCell(c)).trim() !== '1') continue;
      let run = 1;
      while (c + run <= ws.columnCount && txt(row.getCell(c + run)).trim() === String(run + 1)) run++;
      if (run < 28) continue;

      // The label column holds the store names. Prefer the cell literally
      // reading DATE on this row; otherwise take the nearest text cell to the
      // left of the run.
      let labelCol = -1;
      for (let lc = c - 1; lc >= 1; lc--) {
        if (txt(row.getCell(lc)).trim().toUpperCase() === 'DATE') { labelCol = lc; break; }
      }
      if (labelCol < 0) {
        for (let lc = c - 1; lc >= 1; lc--) {
          if (txt(row.getCell(lc)).trim()) { labelCol = lc; break; }
        }
      }
      if (labelCol < 0) continue;

      return { dateRow: r, labelCol, dateStartCol: c };
    }
  }
  return null;
}

/**
 * Headers that mean "the Perigee code for this store".
 *
 * Matched on the HEADER TEXT, never on a column position: reps insert and shift
 * columns, and the code column has already appeared in different places in
 * different files. Whichever column carries one of these labels is the code
 * column, wherever it ends up.
 */
const CODE_HEADERS = [
  'SITE CODE', 'SITECODE', 'SITE CODES',
  'STORE CODE', 'STORECODE', 'STORE CODES',
  'PERIGEE CODE', 'PERIGEECODE', 'PERIGEE SITE CODE',
  'SITE ID', 'STORE ID', 'CODE',
];

/**
 * Find the store-code column.
 *
 * Never by position — the planners disagree with each other and are actively
 * being edited, so the code has turned up in different columns in different
 * files. Instead, in priority order:
 *
 *  1. A column sitting BETWEEN the store names and day 1. That gap only exists
 *     because someone inserted a column there, and the only reason to insert
 *     one is the site code. This catches a freshly inserted column even before
 *     anyone has typed a header over it.
 *  2. Any column whose header text matches a known code label.
 *
 * Returns -1 when there is no code column, in which case matching falls back to
 * the (far less reliable) store name.
 */
function locateCodeColumn(
  ws: ExcelJS.Worksheet,
  dateRow: number,
  labelCol: number,
  dateStartCol: number,
): number {
  const headerText = (c: number) => {
    // Look a couple of rows past the date row too: on one planner the SITE CODE
    // label was typed on the first region row, below the calendar header.
    for (let r = 1; r <= dateRow + 2; r++) {
      const v = txt(ws.getRow(r).getCell(c)).trim().toUpperCase().replace(/\s+/g, ' ');
      if (v && CODE_HEADERS.includes(v)) return true;
    }
    return false;
  };

  // 1. The gap between the names and the calendar.
  const gap: number[] = [];
  for (let c = labelCol + 1; c < dateStartCol; c++) gap.push(c);
  if (gap.length > 0) {
    const labelled = gap.find(headerText);
    if (labelled) return labelled;
    // Exactly one unexplained column here is the inserted code column.
    if (gap.length === 1) return gap[0];
  }

  // 2. A labelled column anywhere in the header block.
  const maxCol = Math.max(labelCol + 2, 10);
  for (let c = 1; c <= maxCol; c++) {
    if (c >= dateStartCol) break;
    if (headerText(c)) return c;
  }

  return -1;
}

export function parseSnoMasterPlanner(workbook: ExcelJS.Workbook, filename = ''): PlannerParseResult {
  const sheets: PlannerSheet[] = [];
  const warnings: string[] = [];

  for (const ws of workbook.worksheets) {
    const grid = locateGrid(ws);
    if (!grid) {
      warnings.push(`Sheet "${ws.name}": no calendar found (expected a cell reading "DATE" followed by 1, 2, 3…). Skipped.`);
      continue;
    }
    const { dateRow, labelCol, dateStartCol } = grid;
    const sheetWarnings: string[] = [];
    const codeCol = locateCodeColumn(ws, dateRow, labelCol, dateStartCol);

    // Day numbers, and the weekday header directly above them.
    const days: number[] = [];
    const weekdays: string[] = [];
    for (let c = dateStartCol; c <= ws.columnCount; c++) {
      const d = txt(ws.getRow(dateRow).getCell(c)).trim();
      if (!/^\d+$/.test(d)) break;
      days.push(Number(d));
      weekdays.push(txt(ws.getRow(dateRow - 1).getCell(c)).trim().toUpperCase());
    }
    if (days.length < 28) {
      warnings.push(`Sheet "${ws.name}": only ${days.length} day columns found — expected a full month. Skipped.`);
      continue;
    }

    // Legend: label + colour, read from the header block above the weekday row.
    // The label sits in the first calendar column, spanning the rest.
    const legendByFill = new Map<string, string>();
    for (let r = 1; r < dateRow - 1; r++) {
      const cell = ws.getRow(r).getCell(dateStartCol);
      const label = txt(cell).trim();
      const fill = fillKey(cell);
      if (label && fill && !legendByFill.has(fill)) legendByFill.set(fill, label.toUpperCase());
    }

    const title = (() => {
      for (let r = 1; r <= 4; r++) {
        const t = txt(ws.getRow(r).getCell(labelCol)).trim();
        if (t) return t;
      }
      return '';
    })();
    const regionTitle = txt(ws.getRow(dateRow - 1).getCell(labelCol)).trim();

    // Prove the month from the grid itself: only one month of the named year has
    // this many days AND starts on this weekday. That is a far stronger signal
    // than the sheet name, which reps edit inconsistently.
    const namedYear = findYearInText(ws.name) ?? findYearInText(title) ?? null;
    const candidateYears = namedYear ? [namedYear] : [new Date().getFullYear(), new Date().getFullYear() + 1];
    let gridMonth: number | null = null;
    let gridYear: number | null = null;
    let matches = 0;
    for (const y of candidateYears) {
      for (let m = 0; m < 12; m++) {
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const firstWeekday = WEEKDAYS[new Date(y, m, 1).getDay()];
        if (daysInMonth === days.length && firstWeekday === weekdays[0]) {
          matches++;
          gridMonth = m + 1;
          gridYear = y;
        }
      }
    }
    if (matches !== 1) {
      gridMonth = matches === 0 ? null : gridMonth;
      if (matches === 0) {
        sheetWarnings.push(
          `The calendar has ${days.length} days starting on a ${weekdays[0] || '?'}, which matches no month in ${candidateYears.join(' or ')}. The weekday row and the date row disagree.`,
        );
      }
    }

    // Walk the store rows. A store row has a number in the column left of the
    // name; anything else at that depth is a region/section heading.
    const stores: PlannerStoreRow[] = [];
    const fillCounts = new Map<string, number>();
    let currentSection = '';
    let usesTypedMarkers = false;

    for (let r = dateRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = txt(row.getCell(labelCol)).trim();
      const idxCell = labelCol > 1 ? txt(row.getCell(labelCol - 1)).trim() : '';

      const isStoreRow = !!name && /^\d+$/.test(idxCell);
      if (!isStoreRow) {
        // Section heading — it may sit in column A or in the name column.
        const heading = name || txt(row.getCell(1)).trim();
        if (heading && !/^\d+$/.test(heading)) currentSection = heading;
        continue;
      }

      // The Perigee code, read from whichever column carries the SITE CODE
      // header. A typed code is authoritative — it removes the guesswork that
      // name matching against ~94,000 stores would otherwise require.
      let storeCode = codeCol > 0 ? txt(row.getCell(codeCol)).trim() : '';
      // A bare row number in that column is the rep's own numbering, not a code.
      if (/^\d{1,3}$/.test(storeCode) && storeCode === idxCell) storeCode = '';

      const marks: PlannerStoreRow['marks'] = [];
      for (let i = 0; i < days.length; i++) {
        const cell = row.getCell(dateStartCol + i);
        const cellText = txt(cell).trim();
        const fill = fillKey(cell);
        if (fill) fillCounts.set(fill, (fillCounts.get(fill) || 0) + 1);

        if (VISIT_MARKERS.has(cellText.toUpperCase())) {
          usesTypedMarkers = true;
          marks.push({ day: days[i], weekday: weekdays[i], via: 'marker', fill, text: cellText });
        } else if (fill) {
          marks.push({ day: days[i], weekday: weekdays[i], via: 'fill', fill, text: cellText });
        }
      }

      stores.push({ rowNumber: r, index: idxCell, storeName: name, section: currentSection, storeCode, marks });
    }

    // Build the legend the caller will confirm: every colour actually used in
    // the grid, matched back to a legend label where we can.
    const legend: PlannerLegendEntry[] = [];
    for (const [fill, count] of [...fillCounts.entries()].sort((a, b) => b[1] - a[1])) {
      let label = legendByFill.get(fill) || '';
      if (!label) {
        for (const [lf, ll] of legendByFill) {
          if (fillsMatch(fill, lf)) { label = ll; break; }
        }
      }
      legend.push({
        fill,
        label,
        cellCount: count,
        suggestedIsVisit: labelIsVisit(label),
        unknown: !label,
      });
    }

    // Legend colours that never appear in the grid are still worth offering, so
    // a rep who shaded nothing this month still sees their own key.
    for (const [fill, label] of legendByFill) {
      if (legend.some(l => l.fill === fill)) continue;
      legend.push({ fill, label, cellCount: 0, suggestedIsVisit: labelIsVisit(label), unknown: false });
    }

    if (usesTypedMarkers) {
      sheetWarnings.push('This sheet marks in-store days with a typed marker — colours are ignored for those cells.');
    }

    const storesWithCodes = stores.filter(s => s.storeCode).length;
    if (codeCol < 0) {
      sheetWarnings.push(
        'No SITE CODE column found, so stores have to be matched on their names. Add a "SITE CODE" column with the Perigee code to make this exact.',
      );
    } else if (storesWithCodes < stores.length) {
      sheetWarnings.push(
        `${stores.length - storesWithCodes} of ${stores.length} store rows have no site code — those fall back to name matching.`,
      );
    }

    sheets.push({
      sheetName: ws.name,
      title,
      regionTitle,
      repName: repNameFromTitle(title) || repNameFromFilename(filename),
      gridMonth,
      gridYear,
      sheetNameMonth: findMonthInText(ws.name),
      titleMonth: findMonthInText(title),
      namedYear,
      legend,
      stores,
      usesTypedMarkers,
      hasCodeColumn: codeCol > 0,
      storesWithCodes,
      warnings: sheetWarnings,
    });
  }

  if (sheets.length === 0 && warnings.length === 0) {
    warnings.push('No usable planner sheets found in this workbook.');
  }

  return { sheets, warnings };
}

// ── Cycle derivation ─────────────────────────────────────────────────────

export interface DerivedStoreCycle {
  storeName: string;
  storeCode: string;
  section: string;
  rowNumber: number;
  /** Every week-of-month this store is visited in, 1-6. Summary only. */
  weeks: number[];
  /** Every weekday used across all weeks, Mon-Sun order. Summary only. */
  days: string[];
  /**
   * The load-bearing one: which days in WHICH week.
   *
   * A store is very often visited on a different weekday each week — one real
   * planner had Wed in week 1, Thu in week 2, Mon in week 3, Tue in week 4.
   * Collapsing that to "weeks 1-4 × Mon,Tue,Wed,Thu" would claim 16 visits
   * instead of 4, so days stay attached to their own week and become one
   * schedule row each. Perigee's WEEK1..WEEK6 columns are per-week day lists,
   * so this maps onto the export exactly.
   */
  perWeek: { week: number; days: string[] }[];
  /** Every marked day, for showing the rep what we read. */
  visitDays: { day: number; weekday: string; week: number }[];
}

const DAY_ORDER: Record<string, number> = {
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
};

function titleCaseDay(weekday: string): string {
  const w = weekday.trim().toUpperCase();
  const found = WEEKDAYS.find(d => d === w);
  if (!found) return '';
  return found.charAt(0) + found.slice(1).toLowerCase();
}

/**
 * Turn a sheet's marks into per-store cycle weeks + weekdays.
 *
 * `visitFills` is the set of fill keys the user confirmed mean "in store".
 * Typed markers always count, whatever their colour.
 */
export function deriveCycles(sheet: PlannerSheet, visitFills: string[]): DerivedStoreCycle[] {
  const visitSet = new Set(visitFills);
  const out: DerivedStoreCycle[] = [];

  for (const store of sheet.stores) {
    const visitDays: DerivedStoreCycle['visitDays'] = [];

    for (const mark of store.marks) {
      const counts = mark.via === 'marker'
        || visitSet.has(mark.fill)
        || [...visitSet].some(v => fillsMatch(mark.fill, v));
      if (!counts) continue;

      const weekday = titleCaseDay(mark.weekday);
      if (!weekday) continue;
      // The Nth occurrence of a weekday in a month is always ceil(date / 7).
      visitDays.push({ day: mark.day, weekday, week: Math.ceil(mark.day / 7) });
    }

    if (visitDays.length === 0) continue;

    const weeks = [...new Set(visitDays.map(v => v.week))].sort((a, b) => a - b);
    const days = [...new Set(visitDays.map(v => v.weekday))]
      .sort((a, b) => (DAY_ORDER[a] ?? 9) - (DAY_ORDER[b] ?? 9));

    // Keep each week's days with that week — see the note on `perWeek`.
    const byWeek = new Map<number, Set<string>>();
    for (const v of visitDays) {
      if (!byWeek.has(v.week)) byWeek.set(v.week, new Set());
      byWeek.get(v.week)!.add(v.weekday);
    }
    const perWeek = [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, set]) => ({
        week,
        days: [...set].sort((a, b) => (DAY_ORDER[a] ?? 9) - (DAY_ORDER[b] ?? 9)),
      }));

    out.push({
      storeName: store.storeName,
      storeCode: store.storeCode,
      section: store.section,
      rowNumber: store.rowNumber,
      weeks,
      days,
      perWeek,
      visitDays: visitDays.sort((a, b) => a.day - b.day),
    });
  }

  return out;
}

/** Perigee cycle string, e.g. [1,3] -> "Week 1&3". */
export function weeksToCycle(weeks: number[]): string {
  return weeks.length ? `Week ${weeks.join('&')}` : '';
}

/**
 * Collapse a store's per-week days into as few schedule rows as possible.
 *
 * Weeks that share an identical day list merge into one row ("Week 1&3" +
 * Monday); weeks that differ stay separate. That keeps the common case tidy
 * without ever flattening a varying pattern into a wrong cross product.
 */
export function cycleToEntryGroups(cycle: DerivedStoreCycle): { cycle: string; days: string[] }[] {
  const byDayList = new Map<string, { weeks: number[]; days: string[] }>();
  for (const { week, days } of cycle.perWeek) {
    const key = days.join('|');
    if (!byDayList.has(key)) byDayList.set(key, { weeks: [], days });
    byDayList.get(key)!.weeks.push(week);
  }
  return [...byDayList.values()]
    .sort((a, b) => a.weeks[0] - b.weeks[0])
    .map(g => ({ cycle: weeksToCycle(g.weeks.sort((a, b) => a - b)), days: g.days }));
}
