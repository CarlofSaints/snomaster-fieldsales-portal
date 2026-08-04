import * as XLSX from 'xlsx';
import { ParsedEntry, ReferenceData } from '../types';
import { findDayHeaderRow, extractStoreCode, isStoreCell, addOrMergeEntry, detectCycleFromText, findDayColumns } from './parserUtils';

/**
 * Josh Standard format: Each sheet = one person.
 * Has "Name week 1&3" text in early rows, day headers below it.
 * Stores follow. May have a second "week 2&4" section later.
 * Sheet name is the person's name (looked up in reference data for email).
 */
export function parseJoshStandard(workbook: XLSX.WorkBook, references: ReferenceData): { entries: ParsedEntry[]; warnings: string[] } {
  const entries: ParsedEntry[] = [];
  const warnings: string[] = [];

  // Build email lookup from reference data
  const emailLookup = new Map<string, { email: string; firstName: string; surname: string }>();
  for (const u of references.users) {
    const fullName = `${u.firstName} ${u.surname}`.toLowerCase().trim();
    emailLookup.set(fullName, { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    emailLookup.set(u.firstName.toLowerCase().trim(), { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    emailLookup.set(u.userEmail.toLowerCase().trim(), { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    const local = u.userEmail.split('@')[0].toLowerCase().trim();
    if (local && !emailLookup.has(local)) {
      emailLookup.set(local, { email: u.userEmail, firstName: u.firstName || local, surname: u.surname || '' });
    }
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length < 3) continue;

    // Skip blank/template sheets
    const hasAnyContent = data.some(row =>
      (row || []).some(c => {
        const s = String(c || '').trim();
        return s.length > 0;
      })
    );
    if (!hasAnyContent) continue;

    // Sheet name is the person's name - look up email
    const personName = sheetName.trim();
    if (personName.toLowerCase() === 'blank') continue;

    const ref = emailLookup.get(personName.toLowerCase());
    const userEmail = ref?.email || '';
    const firstName = ref?.firstName || personName.split(/\s+/)[0] || personName;
    const surname = ref?.surname || personName.split(/\s+/).slice(1).join(' ') || '';

    if (!userEmail) {
      warnings.push(`Sheet "${sheetName}" will not be loaded — no email address found. Label the sheet with the user's Perigee email address or add an "Email:" marker above each cycle table.`);
      continue;
    }

    // Scan through the sheet looking for cycle headers + day headers + stores
    let currentCycle = 'Week 1&3';
    let currentDayColumns: { col: number; day: string }[] = [];
    let inStoreBlock = false;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const rowStrs = row.map(c => String(c || '').trim());
      const rowJoined = rowStrs.join(' ');

      // Check for cycle header
      const newCycle = detectCycleFromText(rowJoined);
      if (newCycle) {
        currentCycle = newCycle;
        inStoreBlock = false; // Reset - need new day headers
        continue;
      }

      // Check if this row is a day header row
      const dayCols = findDayColumns(row);
      if (dayCols.length >= 3) {
        currentDayColumns = dayCols;
        inStoreBlock = true;
        continue;
      }

      // If we haven't found day columns yet, skip
      if (!inStoreBlock || currentDayColumns.length === 0) continue;

      // Check if entire row is empty - may signal end of a section
      const allEmpty = rowStrs.every(s => !s);
      if (allEmpty) continue;

      // Parse store entries from day columns
      for (const { col, day } of currentDayColumns) {
        const cellValue = String(row[col] || '').trim();
        if (!isStoreCell(cellValue)) continue;

        const { storeName, storeCode } = extractStoreCode(cellValue);
        if (!storeName) continue;

        addOrMergeEntry(entries, {
          userEmail: userEmail,
          firstName,
          surname,
          storeId: storeCode,
          storeName,
          cycle: currentCycle,
          day,
        });
      }
    }
  }

  return { entries, warnings };
}
