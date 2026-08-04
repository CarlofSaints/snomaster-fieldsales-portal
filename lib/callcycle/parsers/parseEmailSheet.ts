import * as XLSX from 'xlsx';
import { ParsedEntry, ReferenceData, TeamControlEntry } from '../types';
import {
  findDayHeaderRow, extractStoreCode, isStoreCell, addOrMergeEntry,
  detectCycleFromText, findDayColumns, extractNameFromSectionHeader,
  resolveNameToEmail,
} from './parserUtils';

/**
 * Email-sheet format: Sheet names are email addresses (e.g. "ntethelelo@iram.co.za").
 * Some sheets may still be named by person name (mixed file like Lucky 2026).
 * Day headers in early rows, stores below. May have week sections.
 *
 * Enhanced: supports "Name week X &Y" section headers within a sheet,
 * allowing multiple users per sheet (e.g. Josh's file with Petro + Joshua sections).
 */
export function parseEmailSheet(
  workbook: XLSX.WorkBook,
  references: ReferenceData,
  teamControl?: TeamControlEntry[],
): { entries: ParsedEntry[]; warnings: string[] } {
  const entries: ParsedEntry[] = [];
  const warnings: string[] = [];

  // Build email lookup from reference data
  const emailLookup = new Map<string, { email: string; firstName: string; surname: string }>();
  for (const u of references.users) {
    const fullName = `${u.firstName} ${u.surname}`.toLowerCase().trim();
    if (fullName && fullName !== ' ') {
      emailLookup.set(fullName, { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    }
    if (u.firstName) {
      emailLookup.set(u.firstName.toLowerCase().trim(), { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    }
    emailLookup.set(u.userEmail.toLowerCase().trim(), { email: u.userEmail, firstName: u.firstName, surname: u.surname });
    // Also key by email local part (handles name-only sheet names like "Petro")
    const local = u.userEmail.split('@')[0].toLowerCase().trim();
    if (local && !emailLookup.has(local)) {
      emailLookup.set(local, { email: u.userEmail, firstName: u.firstName || local, surname: u.surname || '' });
    }
  }

  // Collect all team member emails for fuzzy matching
  const teamEmails: string[] = [];
  if (teamControl) {
    const seen = new Set<string>();
    for (const t of teamControl) {
      const e = t.memberEmail.toLowerCase();
      if (!seen.has(e)) { seen.add(e); teamEmails.push(t.memberEmail); }
      const le = t.teamLeaderEmail.toLowerCase();
      if (!seen.has(le)) { seen.add(le); teamEmails.push(t.teamLeaderEmail); }
    }
  } else {
    // Fallback: use reference user emails
    for (const u of references.users) {
      teamEmails.push(u.userEmail);
    }
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
    if (data.length < 2) continue;

    // --- Resolve sheet-level user identity ---
    let sheetEmail = '';
    let sheetFirstName = '';
    let sheetSurname = '';

    if (sheetName.includes('@')) {
      sheetEmail = sheetName.trim().toLowerCase();
      const ref = emailLookup.get(sheetEmail);
      sheetFirstName = ref?.firstName || sheetName.split('@')[0];
      sheetSurname = ref?.surname || '';

      // Team leader validation
      if (teamControl) {
        const isTeamLeader = teamControl.some(t => t.teamLeaderEmail.toLowerCase() === sheetEmail);
        if (!isTeamLeader) {
          warnings.push(`Team leader "${sheetEmail}" (sheet name) not found in Team Control file`);
        }
      }
    } else {
      const personName = sheetName.trim();
      if (personName.toLowerCase() === 'blank') continue;
      const ref = emailLookup.get(personName.toLowerCase());
      if (ref) {
        sheetEmail = ref.email;
        sheetFirstName = ref.firstName || personName.split(/\s+/)[0] || personName;
        sheetSurname = ref.surname || personName.split(/\s+/).slice(1).join(' ') || '';
      } else {
        // emailLookup may lack firstName entries (team control has no names).
        // Use resolveNameToEmail to match via email local part / fuzzy.
        const resolved = resolveNameToEmail(personName, emailLookup, teamEmails);
        if (resolved.email) {
          sheetEmail = resolved.email;
          sheetFirstName = resolved.firstName;
          sheetSurname = resolved.surname;
          warnings.push(resolved.warning);
        } else {
          sheetFirstName = personName.split(/\s+/)[0] || personName;
          sheetSurname = personName.split(/\s+/).slice(1).join(' ') || '';
        }
      }
    }

    // --- Pre-scan: detect if file has "Name week" section headers ---
    let hasSectionHeaders = false;
    for (const row of data) {
      if (!row) continue;
      for (const cell of row) {
        const cellStr = String(cell || '').trim();
        if (cellStr && extractNameFromSectionHeader(cellStr)) {
          hasSectionHeaders = true;
          break;
        }
      }
      if (hasSectionHeaders) break;
    }

    // If no section headers and no sheet email, skip (backward compat)
    if (!hasSectionHeaders && !sheetEmail) {
      warnings.push(`Sheet "${sheetName}" will not be loaded — no email address found. Label the sheet with the user's Perigee email address or add an "Email:" marker above each cycle table.`);
      continue;
    }

    // Find day header row — scan up to 50 rows to handle files with preamble
    const dayResult = findDayHeaderRow(data, 50);
    if (!dayResult) {
      warnings.push(`No day columns found in sheet "${sheetName}"`);
      continue;
    }
    const { dayColumns, dayRowIdx } = dayResult;

    // --- Mutable state tracking ---
    let activeEmail = sheetEmail;
    let activeFirstName = sheetFirstName;
    let activeSurname = sheetSurname;
    let currentCycle = 'Week 1&3';
    let inStoreBlock = false; // true once we've seen day headers after a section switch

    // Check for cycle info in rows before the day headers
    for (let r = 0; r < dayRowIdx; r++) {
      const row = data[r] || [];
      const rowStrs = row.map(c => String(c || '').trim());

      // Check each cell for section header
      for (const cellStr of rowStrs) {
        if (!cellStr) continue;
        const section = extractNameFromSectionHeader(cellStr);
        if (section) {
          const resolved = resolveNameToEmail(section.name, emailLookup, teamEmails);
          warnings.push(resolved.warning);
          activeEmail = resolved.email;
          activeFirstName = resolved.firstName;
          activeSurname = resolved.surname;
          currentCycle = section.cycle;
          inStoreBlock = false;

          // Validate against team control
          if (teamControl && resolved.email) {
            validateMemberAgainstTeamControl(resolved.email, sheetEmail, teamControl, warnings);
          }
        }
      }

      // Also check for standalone cycle markers
      const rowText = rowStrs.join(' ');
      const detected = detectCycleFromText(rowText);
      if (detected) {
        currentCycle = detected;
      }
    }

    // The first day header row means we're in a store block
    inStoreBlock = true;
    let currentDayColumns = dayColumns;

    // Parse stores
    for (let rowIdx = dayRowIdx + 1; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx] || [];
      const rowStrs = row.map(c => String(c || '').trim());

      // --- Check each cell for "Name week X &Y" section header ---
      let sectionSwitched = false;
      const storeCellsOnThisRow: { col: number; day: string; value: string }[] = [];

      for (let col = 0; col < rowStrs.length; col++) {
        const cellStr = rowStrs[col];
        if (!cellStr) continue;

        const section = extractNameFromSectionHeader(cellStr);
        if (section) {
          const resolved = resolveNameToEmail(section.name, emailLookup, teamEmails);
          warnings.push(resolved.warning);
          activeEmail = resolved.email;
          activeFirstName = resolved.firstName;
          activeSurname = resolved.surname;
          currentCycle = section.cycle;
          inStoreBlock = false;
          sectionSwitched = true;

          // Validate against team control
          if (teamControl && resolved.email) {
            validateMemberAgainstTeamControl(resolved.email, sheetEmail, teamControl, warnings);
          }
        }
      }

      // If this row had a section header, also check if there are store cells
      // on the same row (edge case in Josh's file — store entry alongside header)
      if (sectionSwitched) {
        // Still collect stores from this row if day columns have data
        for (const { col, day } of currentDayColumns) {
          const cellValue = String(row[col] || '').trim();
          if (cellValue && isStoreCell(cellValue) && !extractNameFromSectionHeader(cellValue)) {
            storeCellsOnThisRow.push({ col, day, value: cellValue });
          }
        }
        // If we found stores on the section-header row, process them
        // (section header sets the active user, and stores on same row use that user)
        if (storeCellsOnThisRow.length > 0) {
          inStoreBlock = true; // allow these stores
          for (const { day, value } of storeCellsOnThisRow) {
            const { storeName, storeCode } = extractStoreCode(value);
            if (!storeName) continue;
            addOrMergeEntry(entries, {
              userEmail: activeEmail,
              firstName: activeFirstName,
              surname: activeSurname,
              storeId: storeCode,
              storeName,
              cycle: currentCycle,
              day,
            });
          }
        }
        continue;
      }

      // Check for standalone cycle switch (row that's just "week 2 & 4" etc.)
      const rowJoined = rowStrs.join(' ');
      const newCycle = detectCycleFromText(rowJoined);
      if (newCycle) {
        currentCycle = newCycle;
        continue;
      }

      // Check if this is another day header row
      const dayCols = findDayColumns(row);
      if (dayCols.length >= 3) {
        currentDayColumns = dayCols;
        inStoreBlock = true; // day headers mean we're ready for stores
        continue;
      }

      // Skip empty rows
      if (rowStrs.every(s => !s)) continue;

      // Only parse stores if we're in a store block (have seen day headers after last section switch)
      if (!inStoreBlock) continue;

      // Parse store entries
      for (const { col, day } of currentDayColumns) {
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
          cycle: currentCycle,
          day,
        });
      }
    }
  }

  return { entries, warnings };
}

/** Validate a resolved member email against team control data */
function validateMemberAgainstTeamControl(
  memberEmail: string,
  sheetEmail: string,
  teamControl: TeamControlEntry[],
  warnings: string[],
): void {
  const memberLower = memberEmail.toLowerCase();
  const entry = teamControl.find(t => t.memberEmail.toLowerCase() === memberLower);

  if (!entry) {
    warnings.push(`User "${memberEmail}" not found in Team Control file`);
    return;
  }

  // Check if their team leader matches the sheet email
  if (sheetEmail && entry.teamLeaderEmail.toLowerCase() !== sheetEmail.toLowerCase()) {
    warnings.push(
      `User "${memberEmail}" is assigned to team leader "${entry.teamLeaderEmail}" in Team Control, but appears on sheet "${sheetEmail}"`
    );
  }
}
