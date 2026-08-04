import * as XLSX from 'xlsx';

export type FileFormat = 'marker' | 'josh-standard' | 'ash-region' | 'josh-alt' | 'email-sheet' | 'simple-name' | 'user-4wk' | 'unknown';

const DAYS_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function rowHasDays(row: string[], minMatch = 3): boolean {
  let count = 0;
  for (const cell of row) {
    const lc = cell.toLowerCase().trim();
    if (DAYS_SHORT.some(d => lc.startsWith(d))) count++;
  }
  return count >= minMatch;
}

export function detectFormat(workbook: XLSX.WorkBook): FileFormat {
  const sheetNames = workbook.SheetNames.map(s => s.trim());

  // MARKER format (highest priority): any sheet with "Week:" or "Email:" markers in first ~30 rows
  // Markers may be in a single cell ("Week: 1,3") or split across cells (A="WEEK:", C="1,3")
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    const scanRows = Math.min(30, data.length);
    for (let r = 0; r < scanRows; r++) {
      const row = data[r] || [];
      // Check individual cells first
      for (const cell of row) {
        const s = String(cell || '');
        if (/week\s*:\s*\d/i.test(s) || /email\s*:\s*\S+@/i.test(s)) {
          return 'marker';
        }
      }
      // Check joined row for split markers (label in col A, value in col B/C)
      const joined = row.map(c => String(c || '').trim()).join(' ');
      if (/week\s*:\s*\d/i.test(joined) || /email\s*:\s*\S+@/i.test(joined)) {
        return 'marker';
      }
    }
  }

  // Josh ALT: sheets named "Week 1&3" and "Week 2&4"
  const lowerNames = sheetNames.map(s => s.toLowerCase());
  const hasWeek13 = lowerNames.some(s => s.includes('week 1') && s.includes('3'));
  const hasWeek24 = lowerNames.some(s => s.includes('week 2') && s.includes('4'));
  if (hasWeek13 && hasWeek24 && lowerNames.length <= 4) {
    return 'josh-alt';
  }

  // Check for email-as-sheet-name pattern
  const emailSheets = sheetNames.filter(s => s.includes('@'));
  if (emailSheets.length > 0) {
    // Sub-check: do email sheets have WEEK N markers in col A?
    // If so, this is a user-4wk format (V7 Master File with preamble rows),
    // not the simpler email-sheet format that uses Week:/Email: markers.
    const sampleSheet = workbook.Sheets[emailSheets[0]];
    if (sampleSheet) {
      const sampleData = XLSX.utils.sheet_to_json<(string | number | null)[]>(sampleSheet, { header: 1 });
      let weekMarkerCount = 0;
      for (let r = 0; r < Math.min(60, sampleData.length); r++) {
        const colA = String((sampleData[r] || [])[0] || '').trim();
        if (/^week\s*[:\s]*\d+$/i.test(colA)) weekMarkerCount++;
      }
      if (weekMarkerCount >= 2) return 'user-4wk';
    }
    return 'email-sheet';
  }

  // Ash format: any sheet where row 1 has an email address
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length > 0) {
      const row1 = (data[0] || []).map(c => String(c || ''));
      if (row1.some(c => c.includes('@'))) {
        return 'ash-region';
      }
    }
  }

  // Josh Standard: sheets with "week" text in the first few rows (before day headers)
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length < 3) continue;

    // Check first 3 rows for "week" text
    for (let r = 0; r < Math.min(3, data.length); r++) {
      const row = (data[r] || []).map(c => String(c || '').toLowerCase());
      if (row.some(c => c.includes('week'))) {
        return 'josh-standard';
      }
    }
  }

  // Simple name format: sheets named after people, day headers in first few rows
  // This is the fallback for any file with day-of-week headers
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    for (let r = 0; r < Math.min(5, data.length); r++) {
      const row = (data[r] || []).map(c => String(c || ''));
      if (rowHasDays(row)) {
        return 'simple-name';
      }
    }
  }

  return 'unknown';
}
