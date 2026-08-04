import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Blank, correctly-shaped Excel templates — one per accepted call cycle layout,
 * plus the two Perigee control files. These exist so a manager who does not
 * already have a file in one of the recognised shapes has something to fill in.
 *
 * Deliberately unauthenticated: the workbooks are empty scaffolding with
 * example@example.com placeholders and contain no SnoMaster data. That also
 * lets the upload page link to them directly with a plain <a download>.
 */

const VALID_TYPES = ['store', 'team', 'cc-team-leader', 'cc-user', 'cc-user-4wk'] as const;
type TemplateType = (typeof VALID_TYPES)[number];

/** SnoMaster brand red, as an ExcelJS ARGB. */
const COL_BRAND = 'FFE31E1C';
const BRAND_NAME = 'SnoMaster';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') as TemplateType | null;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `Invalid type. Use ?type=${VALID_TYPES.join(' | ')}` },
      { status: 400 },
    );
  }

  const workbook = new ExcelJS.Workbook();

  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const tenant = { name: BRAND_NAME };

  let filename: string;

  if (type === 'store') {
    const sheet = workbook.addWorksheet('Stores');
    sheet.columns = [
      { header: 'COUNTRY', key: 'country', width: 15 },
      { header: 'PROVINCE', key: 'province', width: 20 },
      { header: 'CHANNEL', key: 'channel', width: 20 },
      { header: 'STORE NAME', key: 'storeName', width: 35 },
      { header: 'STORE CODE', key: 'storeCode', width: 15 },
      { header: 'ACTIVE', key: 'active', width: 10 },
      { header: 'LONGITUDE', key: 'longitude', width: 15 },
      { header: 'LATITUDE', key: 'latitude', width: 15 },
      { header: 'LOCATION STATUS', key: 'locationStatus', width: 18 },
      { header: 'IGNORE LOCATION DATA', key: 'ignoreLocationData', width: 22 },
      { header: 'EMAIL', key: 'email', width: 30 },
      { header: 'CREATED BY', key: 'createdBy', width: 20 },
      { header: 'UPDATED BY', key: 'updatedBy', width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_BRAND } };
      cell.font = headerFont;
    });

    filename = `${tenant.name} - Store Control Template.xlsx`;
  } else if (type === 'team') {
    const sheet = workbook.addWorksheet('Teams');
    sheet.columns = [
      { header: 'TEAM NAME', key: 'teamName', width: 20 },
      { header: 'TEAM LEADER', key: 'teamLeader', width: 25 },
      { header: 'TEAM LEADER ID', key: 'teamLeaderId', width: 15 },
      { header: 'MEMBER EMAIL', key: 'memberEmail', width: 30 },
      { header: 'MEMBER ID', key: 'memberId', width: 15 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COL_BRAND } };
      cell.font = headerFont;
    });

    filename = `${tenant.name} - Team Control Template.xlsx`;
  } else if (type === 'cc-team-leader') {
    buildTeamLeaderTemplate(workbook, COL_BRAND, headerFont);
    filename = `${tenant.name} - Call Cycle Template (Team Leader).xlsx`;
  } else if (type === 'cc-user') {
    buildUserTemplate(workbook, COL_BRAND, headerFont);
    filename = `${tenant.name} - Call Cycle Template (User Sheets).xlsx`;
  } else {
    buildUser4wkTemplate(workbook, COL_BRAND, headerFont);
    filename = `${tenant.name} - Call Cycle Template (User 4wk).xlsx`;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Call Cycle template builders                                       */
/* ------------------------------------------------------------------ */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SAMPLE_STORES = [
  'PNP Greenstone - HC05',
  'Checkers Sandton - SA12',
  'Spar Fourways - FW03',
  'Woolworths Rosebank - RB07',
  'Pick n Pay Norwood - NW01',
  'Game Menlyn - ML09',
];

function applyDayHeader(
  sheet: ExcelJS.Worksheet,
  row: number,
  startCol: number,
  brandArgb: string,
  font: Partial<ExcelJS.Font>,
) {
  for (let i = 0; i < DAYS.length; i++) {
    const cell = sheet.getCell(row, startCol + i);
    cell.value = DAYS[i];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandArgb } };
    cell.font = font;
    cell.alignment = { horizontal: 'center' };
  }
}

function setColWidths(sheet: ExcelJS.Worksheet, startCol: number, count: number, width: number) {
  for (let i = 0; i < count; i++) {
    sheet.getColumn(startCol + i).width = width;
  }
}

/** Style a marker cell (Email: / Week:) */
function markerCell(sheet: ExcelJS.Worksheet, row: number, col: number, text: string) {
  const cell = sheet.getCell(row, col);
  cell.value = text;
  cell.font = { bold: true, size: 11 };
}

/** Add sample stores across day columns */
function addSampleStores(sheet: ExcelJS.Worksheet, startRow: number, startCol: number, rowCount: number) {
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < DAYS.length; c++) {
      const storeIdx = (r * DAYS.length + c) % SAMPLE_STORES.length;
      const cell = sheet.getCell(startRow + r, startCol + c);
      cell.value = SAMPLE_STORES[storeIdx];
      cell.font = { size: 10, color: { argb: 'FF999999' } };
    }
  }
}

/* ---------- Team Leader (marker format) ---------- */

function buildTeamLeaderTemplate(
  wb: ExcelJS.Workbook,
  brandArgb: string,
  headerFont: Partial<ExcelJS.Font>,
) {
  const sheet = wb.addWorksheet('teamleader@example.com');
  setColWidths(sheet, 1, 6, 28);

  // Instructions row
  const instrCell = sheet.getCell(1, 1);
  instrCell.value = 'Sheet name = Team Leader\'s Perigee email address. Add Email: and Week: markers above each person\'s cycle table.';
  instrCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sheet.mergeCells(1, 1, 1, 6);

  // --- Person 1 ---
  let r = 3;
  markerCell(sheet, r, 1, 'Email: rep1@example.com');
  r++;
  markerCell(sheet, r, 1, 'Week: 1&3');
  r++;
  applyDayHeader(sheet, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet, r, 1, 3);
  r += 3;

  // Week 2&4 for same person
  r++;
  markerCell(sheet, r, 1, 'Week: 2&4');
  r++;
  applyDayHeader(sheet, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet, r, 1, 2);
  r += 2;

  // --- Person 2 ---
  r += 2;
  markerCell(sheet, r, 1, 'Email: rep2@example.com');
  r++;
  markerCell(sheet, r, 1, 'Week: 1&3');
  r++;
  applyDayHeader(sheet, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet, r, 1, 2);
}

/* ---------- User Sheets (email-sheet format) ---------- */

function buildUserTemplate(
  wb: ExcelJS.Workbook,
  brandArgb: string,
  headerFont: Partial<ExcelJS.Font>,
) {
  // Sheet 1 — example user
  const sheet1 = wb.addWorksheet('user1@example.com');
  setColWidths(sheet1, 1, 6, 28);

  const instrCell = sheet1.getCell(1, 1);
  instrCell.value = 'Sheet name = user\'s Perigee email address. Add Week: markers to separate cycle blocks.';
  instrCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sheet1.mergeCells(1, 1, 1, 6);

  let r = 3;
  markerCell(sheet1, r, 1, 'Week 1&3');
  r++;
  applyDayHeader(sheet1, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet1, r, 1, 3);
  r += 3;

  r++;
  markerCell(sheet1, r, 1, 'Week 2&4');
  r++;
  applyDayHeader(sheet1, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet1, r, 1, 2);

  // Sheet 2 — second user (shows multi-sheet pattern)
  const sheet2 = wb.addWorksheet('user2@example.com');
  setColWidths(sheet2, 1, 6, 28);

  r = 1;
  markerCell(sheet2, r, 1, 'Week 1&3');
  r++;
  applyDayHeader(sheet2, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet2, r, 1, 3);
  r += 3;

  r++;
  markerCell(sheet2, r, 1, 'Week 2&4');
  r++;
  applyDayHeader(sheet2, r, 1, brandArgb, headerFont);
  r++;
  addSampleStores(sheet2, r, 1, 2);
}

/* ---------- User Sheets 4wk (4-week format) ---------- */

function buildUser4wkTemplate(
  wb: ExcelJS.Workbook,
  brandArgb: string,
  headerFont: Partial<ExcelJS.Font>,
) {
  const sheet = wb.addWorksheet('user@example.com');
  sheet.getColumn(1).width = 14;
  setColWidths(sheet, 2, 6, 28);

  // Instructions row
  const instrCell = sheet.getCell(1, 1);
  instrCell.value = 'Sheet name = user\'s Perigee email address. Column A = WEEK N markers. Columns B–G = Monday–Saturday. Column H onwards is ignored.';
  instrCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sheet.mergeCells(1, 1, 1, 7);

  // Day headers in row 2 (cols B–G)
  applyDayHeader(sheet, 2, 2, brandArgb, headerFont);

  const ROWS_PER_WEEK = 4;

  for (let week = 1; week <= 4; week++) {
    const blockStart = 3 + (week - 1) * (ROWS_PER_WEEK + 1); // +1 gap row between blocks

    // WEEK N marker in col A (first row of block)
    const weekCell = sheet.getCell(blockStart, 1);
    weekCell.value = `WEEK ${week}`;
    weekCell.font = { bold: true, size: 11 };
    weekCell.alignment = { vertical: 'middle' };

    // Merge col A across the block rows
    if (ROWS_PER_WEEK > 1) {
      sheet.mergeCells(blockStart, 1, blockStart + ROWS_PER_WEEK - 1, 1);
    }

    // Sample stores in cols B–G
    addSampleStores(sheet, blockStart, 2, ROWS_PER_WEEK);
  }

  // Second sheet to show multi-sheet pattern
  const sheet2 = wb.addWorksheet('user2@example.com');
  sheet2.getColumn(1).width = 14;
  setColWidths(sheet2, 2, 6, 28);

  applyDayHeader(sheet2, 1, 2, brandArgb, headerFont);

  for (let week = 1; week <= 4; week++) {
    const blockStart = 2 + (week - 1) * (ROWS_PER_WEEK + 1);

    const weekCell = sheet2.getCell(blockStart, 1);
    weekCell.value = `WEEK ${week}`;
    weekCell.font = { bold: true, size: 11 };
    weekCell.alignment = { vertical: 'middle' };

    if (ROWS_PER_WEEK > 1) {
      sheet2.mergeCells(blockStart, 1, blockStart + ROWS_PER_WEEK - 1, 1);
    }

    addSampleStores(sheet2, blockStart, 2, ROWS_PER_WEEK);
  }
}
