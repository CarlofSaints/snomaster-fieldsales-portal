import * as XLSX from 'xlsx';
import { ParsedEntry, ReferenceData } from '../types';
import {
  findDayColumns,
  extractStoreCode,
  isStoreCell,
  addOrMergeEntry,
  detectCycleFromText,
  extractEmailFromMarker,
  extractWeekFromMarker,
  extractMarkersFromRow,
} from './parserUtils';

/**
 * Marker format: Sheets contain explicit `Email:` and `Week:` markers in the
 * rows above each day-header row. This enables multiple people's call cycles
 * on a single sheet.
 *
 * Algorithm per sheet:
 * 1. Scan rows top to bottom
 * 2. Accumulate Email: and Week: markers as encountered
 * 3. When a day header row is found → start a section using accumulated markers
 * 4. Parse stores until next marker / empty row / end of sheet
 * 5. Reset and repeat for next section
 */
export function parseMarkerFormat(
  workbook: XLSX.WorkBook,
  references: ReferenceData,
): { entries: ParsedEntry[]; warnings: string[] } {
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

    // Skip blank sheets
    const hasContent = data.some(row =>
      (row || []).some(c => String(c || '').trim().length > 0),
    );
    if (!hasContent) continue;

    const trimmedSheet = sheetName.trim();
    if (trimmedSheet.toLowerCase() === 'blank') continue;

    // Accumulated markers for the current section
    let pendingEmail: string | null = null;
    let pendingWeek: string | null = null;

    // Active section state
    let activeEmail = '';
    let activeFirstName = '';
    let activeSurname = '';
    let activeCycle = 'Week 1&3';
    let activeDayColumns: { col: number; day: string }[] = [];
    let inStoreBlock = false;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const rowStrs = row.map(c => String(c || '').trim());

      // Scan for Email: / Week: markers — check individual cells AND joined row
      // (handles both "Email: user@x.com" in one cell and "EMAIL:" in col A + email in col C)
      let foundMarker = false;

      // First try individual cells
      for (const cellStr of rowStrs) {
        if (!cellStr) continue;

        const emailMarker = extractEmailFromMarker(cellStr);
        if (emailMarker) {
          if (inStoreBlock) { inStoreBlock = false; activeDayColumns = []; }
          pendingEmail = emailMarker;
          foundMarker = true;
        }

        const weekMarker = extractWeekFromMarker(cellStr);
        if (weekMarker) {
          if (inStoreBlock) { inStoreBlock = false; activeDayColumns = []; }
          pendingWeek = weekMarker;
          foundMarker = true;
        }
      }

      // If no markers found in individual cells, try the joined row (split markers)
      if (!foundMarker) {
        const rowMarkers = extractMarkersFromRow(row);
        if (rowMarkers.email) {
          if (inStoreBlock) { inStoreBlock = false; activeDayColumns = []; }
          pendingEmail = rowMarkers.email;
          foundMarker = true;
        }
        if (rowMarkers.week) {
          if (inStoreBlock) { inStoreBlock = false; activeDayColumns = []; }
          pendingWeek = rowMarkers.week;
          foundMarker = true;
        }
      }

      // If this row only has markers, skip to next row
      if (foundMarker) {
        // Also check if this row is a day header (markers + days on same row)
        const dayCols = findDayColumns(row);
        if (dayCols.length < 3) continue;
        // Fall through to handle the day header below
      }

      // Check if this row is a day header row
      const dayCols = findDayColumns(row);
      if (dayCols.length >= 3) {
        // Resolve email for this section
        let sectionEmail = pendingEmail || '';
        let sectionFirstName = '';
        let sectionSurname = '';

        if (sectionEmail) {
          const ref = emailLookup.get(sectionEmail.toLowerCase());
          sectionFirstName = ref?.firstName || sectionEmail.split('@')[0];
          sectionSurname = ref?.surname || '';
        } else {
          // Fall back to sheet name
          if (trimmedSheet.includes('@')) {
            sectionEmail = trimmedSheet.toLowerCase();
            const ref = emailLookup.get(sectionEmail);
            sectionFirstName = ref?.firstName || sectionEmail.split('@')[0];
            sectionSurname = ref?.surname || '';
          } else {
            // Try reference lookup by person name
            const ref = emailLookup.get(trimmedSheet.toLowerCase());
            if (ref) {
              sectionEmail = ref.email;
              sectionFirstName = ref.firstName;
              sectionSurname = ref.surname;
            }
          }
        }

        // Hard fail: no email at all
        if (!sectionEmail) {
          warnings.push(
            `Sheet "${sheetName}" will not be loaded — no email address found. Add an "Email:" marker above each cycle table.`,
          );
          // Skip to end of this section: advance until next Email marker or end of sheet
          inStoreBlock = false;
          activeDayColumns = [];
          pendingEmail = null;
          pendingWeek = null;
          // Continue scanning for the next Email: marker
          continue;
        }

        // Resolve cycle
        const sectionCycle = pendingWeek || detectCycleFromText(rowStrs.join(' ')) || 'Week 1&3';
        if (!pendingWeek) {
          // Check rows just above for cycle text
          let foundCycle: string | null = null;
          for (let back = rowIdx - 1; back >= Math.max(0, rowIdx - 3); back--) {
            const backRow = (data[back] || []).map(c => String(c || '').trim()).join(' ');
            foundCycle = detectCycleFromText(backRow);
            if (foundCycle) break;
          }
          if (foundCycle) {
            activeCycle = foundCycle;
          } else {
            activeCycle = sectionCycle;
            if (pendingEmail && !pendingWeek) {
              warnings.push(
                `Sheet "${sheetName}" — no "Week:" marker found for ${sectionEmail}. Defaulting to "Week 1&3".`,
              );
            }
          }
        } else {
          activeCycle = sectionCycle;
        }

        activeEmail = sectionEmail;
        activeFirstName = sectionFirstName;
        activeSurname = sectionSurname;
        activeDayColumns = dayCols;
        inStoreBlock = true;

        // Reset pending markers for next section
        pendingEmail = null;
        pendingWeek = null;
        continue;
      }

      // If not in a store block, skip
      if (!inStoreBlock || activeDayColumns.length === 0) continue;

      // All-empty row ends the section
      if (rowStrs.every(s => !s)) {
        continue;
      }

      // Check for cycle switch mid-section (e.g. "Week 2&4" text row)
      const rowJoined = rowStrs.join(' ');
      const midCycle = detectCycleFromText(rowJoined);
      if (midCycle) {
        activeCycle = midCycle;
        // Check if this row also has new day headers
        const newDayCols = findDayColumns(row);
        if (newDayCols.length >= 3) {
          activeDayColumns = newDayCols;
        }
        continue;
      }

      // Parse store entries
      for (const { col, day } of activeDayColumns) {
        const cellValue = String(row[col] || '').trim();
        if (!isStoreCell(cellValue)) continue;

        const { storeName, storeCode } = extractStoreCode(cellValue);
        if (!storeName) continue;

        addOrMergeEntry(entries, {
          userEmail: activeEmail,
          firstName: activeFirstName,
          surname: activeSurname,
          storeId: storeCode,
          storeName,
          cycle: activeCycle,
          day,
        });
      }
    }
  }

  return { entries, warnings };
}
