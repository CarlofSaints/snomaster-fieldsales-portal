import * as XLSX from 'xlsx';
import { ParsedEntry, ReferenceData } from '../types';
import { findDayHeaderRow, extractStoreCode, isStoreCell, addOrMergeEntry } from './parserUtils';

/**
 * Josh ALT format: Sheets named "Week 1&3" and "Week 2&4".
 * Each sheet contains multiple users. Users identified by email or name lookup.
 * Day columns found by scanning first few rows.
 */
export function parseJoshAlt(workbook: XLSX.WorkBook, references: ReferenceData): { entries: ParsedEntry[]; warnings: string[] } {
  const entries: ParsedEntry[] = [];
  const warnings: string[] = [];

  // Build email lookup
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

    // Determine cycle from sheet name
    const nameLower = sheetName.toLowerCase();
    let currentCycle = 'Week 1&3';
    if (nameLower.includes('2') && nameLower.includes('4')) {
      currentCycle = 'Week 2&4';
    }

    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length < 2) continue;

    // Find day columns
    const dayResult = findDayHeaderRow(data, 10);
    if (!dayResult) {
      warnings.push(`No day columns found in sheet "${sheetName}"`);
      continue;
    }
    const { dayColumns, dayRowIdx } = dayResult;

    // Look for user identifiers (email or name) in cells
    let currentUserEmail = '';
    let currentFirstName = '';
    let currentSurname = '';

    for (let rowIdx = dayRowIdx + 1; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const firstCell = String(row[0] || '').trim();

      // Check if this row identifies a user (email)
      if (firstCell.includes('@')) {
        const ref = emailLookup.get(firstCell.toLowerCase());
        currentUserEmail = firstCell.toLowerCase();
        currentFirstName = ref?.firstName || firstCell.split('@')[0];
        currentSurname = ref?.surname || '';
        continue;
      }

      // Check if it's a name (not a store entry)
      if (firstCell && !firstCell.includes(' - ') && firstCell.length > 2) {
        const ref = emailLookup.get(firstCell.toLowerCase());
        if (ref) {
          currentUserEmail = ref.email;
          currentFirstName = ref.firstName;
          currentSurname = ref.surname;
          continue;
        }
      }

      if (!currentUserEmail) continue;

      // Parse store entries from day columns
      for (const { col, day } of dayColumns) {
        const cellValue = String(row[col] || '').trim();
        if (!isStoreCell(cellValue)) continue;

        const { storeName, storeCode } = extractStoreCode(cellValue);
        if (!storeName) continue;

        addOrMergeEntry(entries, {
          userEmail: currentUserEmail,
          firstName: currentFirstName,
          surname: currentSurname,
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
