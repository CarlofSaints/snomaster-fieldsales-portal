import * as XLSX from 'xlsx';
import { ParsedEntry } from '../types';
import { findDayHeaderRow, extractStoreCode, isStoreCell, addOrMergeEntry, detectCycleFromText } from './parserUtils';

/**
 * Ash format: Row 1 = name + email, Row 2 = day headers, stores below.
 * May have week cycle sections mid-sheet.
 */
export function parseAshFormat(workbook: XLSX.WorkBook): { entries: ParsedEntry[]; warnings: string[] } {
  const entries: ParsedEntry[] = [];
  const warnings: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length < 3) continue;

    // Row 1: find email and name
    const row1 = (data[0] || []).map(c => String(c || '').trim());
    let userEmail = '';
    let firstName = '';
    let surname = '';

    for (const cell of row1) {
      if (cell.includes('@')) {
        userEmail = cell.toLowerCase();
      }
    }

    for (const cell of row1) {
      if (cell && !cell.includes('@')) {
        const parts = cell.split(/\s+/).filter(p => p && !p.toLowerCase().includes('week'));
        if (parts.length >= 1) {
          firstName = parts[0];
          surname = parts.slice(1).join(' ');
          break;
        }
      }
    }

    if (!userEmail) {
      warnings.push(`No email found in row 1 of sheet "${sheetName}"`);
      continue;
    }

    // Find day columns (usually row 2)
    const dayResult = findDayHeaderRow(data, 5);
    if (!dayResult) {
      warnings.push(`No day columns found in sheet "${sheetName}"`);
      continue;
    }
    const { dayColumns, dayRowIdx } = dayResult;

    // Determine initial cycle from row 1 or default
    let currentCycle = 'Week 1&3';
    const row1Str = row1.join(' ');
    const detectedCycle = detectCycleFromText(row1Str);
    if (detectedCycle) currentCycle = detectedCycle;

    // Parse stores from rows below day headers
    for (let rowIdx = dayRowIdx + 1; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const firstCell = String(row[0] || '').trim();

      // Check for cycle switch
      const cycleSwitchText = row.map(c => String(c || '').trim()).join(' ');
      const newCycle = detectCycleFromText(cycleSwitchText);
      if (newCycle) {
        currentCycle = newCycle;
        // Check if this row also has a new day header
        const newDayResult = findDayHeaderRow([data[rowIdx + 1] || []], 1);
        if (newDayResult) {
          // Skip the week label + day header row
          rowIdx++;
        }
        continue;
      }

      // Check if this is another day header row (after a blank section)
      const rowDays = findDayHeaderRow([row], 1);
      if (rowDays && rowDays.dayColumns.length >= 3) {
        continue; // Skip day header rows
      }

      // Parse store entries
      for (const { col, day } of dayColumns) {
        const cellValue = String(row[col] || '').trim();
        if (!isStoreCell(cellValue)) continue;

        const { storeName, storeCode } = extractStoreCode(cellValue);
        if (!storeName) continue;

        addOrMergeEntry(entries, {
          userEmail,
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
