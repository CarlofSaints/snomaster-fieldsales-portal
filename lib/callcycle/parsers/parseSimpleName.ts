import * as XLSX from 'xlsx';
import { ParsedEntry, ReferenceData } from '../types';
import { findDayHeaderRow, extractStoreCode, isStoreCell, addOrMergeEntry, detectCycleFromText, findDayColumns } from './parserUtils';

/**
 * Simple name format: Each sheet = one person named by sheet name.
 * Day headers in the first few rows, stores below.
 * NO "week" text in headers (unlike josh-standard).
 * May have a second week section separated by blank rows + new day headers.
 * Needs reference data to look up email from person name.
 *
 * Files: FS & NC 2026, LIMPOPO, MP, many Liza sheets
 */
export function parseSimpleName(workbook: XLSX.WorkBook, references: ReferenceData): { entries: ParsedEntry[]; warnings: string[] } {
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
    if (data.length < 2) continue;

    // Sheet name is the person's name
    const personName = sheetName.trim();
    if (personName.toLowerCase() === 'blank') continue;

    // Skip empty sheets
    const hasContent = data.some(row =>
      (row || []).some(c => String(c || '').trim().length > 0)
    );
    if (!hasContent) continue;

    // Look up person in reference data
    const ref = emailLookup.get(personName.toLowerCase());
    const userEmail = ref?.email || '';
    const firstName = ref?.firstName || personName.split(/\s+/)[0] || personName;
    const surname = ref?.surname || personName.split(/\s+/).slice(1).join(' ') || '';

    if (!userEmail) {
      warnings.push(`Sheet "${sheetName}" will not be loaded — no email address found. Label the sheet with the user's Perigee email address or add an "Email:" marker above each cycle table.`);
      continue;
    }

    // These files typically have NO week indicators,
    // meaning the schedule applies to ALL weeks (Week 1&3 AND Week 2&4).
    // We'll parse stores and assign to "Every Week" first, then check for sections.
    let currentCycle = 'Week 1&3';
    let hasSecondSection = false;

    // Check if the file has a second week section
    let secondDayHeaderIdx = -1;
    const firstDayResult = findDayHeaderRow(data, 5);
    if (firstDayResult) {
      // Look for another day header row further down
      for (let r = firstDayResult.dayRowIdx + 2; r < data.length; r++) {
        const row = data[r] || [];
        const rowText = row.map(c => String(c || '').trim()).join(' ');

        // If we find cycle text, mark as having second section
        if (detectCycleFromText(rowText)) {
          hasSecondSection = true;
        }

        const dayCols = findDayColumns(row);
        if (dayCols.length >= 3 && r > firstDayResult.dayRowIdx + 1) {
          secondDayHeaderIdx = r;
          break;
        }
      }
    }

    // If there's no second section and no week text, this is an "every week" schedule
    // We duplicate entries for both Week 1&3 and Week 2&4
    const everyWeek = !hasSecondSection;

    // Now parse the sheet section by section
    let currentDayColumns: { col: number; day: string }[] = [];
    let inStoreBlock = false;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const rowStrs = row.map(c => String(c || '').trim());
      const rowJoined = rowStrs.join(' ');

      // Check for cycle switch
      const newCycle = detectCycleFromText(rowJoined);
      if (newCycle) {
        currentCycle = newCycle;
        inStoreBlock = false;
        continue;
      }

      // Check if this is a day header row
      const dayCols = findDayColumns(row);
      if (dayCols.length >= 3) {
        currentDayColumns = dayCols;
        inStoreBlock = true;

        // If this is the second day header and we detected week sections,
        // it's the Week 2&4 section
        if (rowIdx === secondDayHeaderIdx && hasSecondSection) {
          currentCycle = 'Week 2&4';
        }
        continue;
      }

      if (!inStoreBlock || currentDayColumns.length === 0) continue;

      // Skip empty rows
      if (rowStrs.every(s => !s)) continue;

      // Parse store entries
      for (const { col, day } of currentDayColumns) {
        const cellValue = String(row[col] || '').trim();
        if (!isStoreCell(cellValue)) continue;

        const { storeName, storeCode } = extractStoreCode(cellValue);
        if (!storeName) continue;

        // Add for current cycle
        addOrMergeEntry(entries, {
          userEmail: userEmail,
          firstName,
          surname,
          storeId: storeCode,
          storeName,
          cycle: currentCycle,
          day,
        });

        // If every-week schedule, also add for Week 2&4
        if (everyWeek && currentCycle === 'Week 1&3') {
          addOrMergeEntry(entries, {
            userEmail: userEmail,
            firstName,
            surname,
            storeId: storeCode,
            storeName,
            cycle: 'Week 2&4',
            day,
          });
        }
      }
    }
  }

  return { entries, warnings };
}
