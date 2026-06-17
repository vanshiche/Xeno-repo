/**
 * DataVault — CSV Processor
 * Robust CSV parsing (RFC 4180), chunked splitting, file export
 */

class CSVProcessor {
  /**
   * Parse a raw CSV string → { headers, rows, rawRows }
   * Handles: quoted fields, embedded newlines, escaped quotes, BOM
   */
  static parse(text) {
    // Strip BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const rows     = [];
    let headers    = null;
    let i          = 0;
    const n        = text.length;

    function parseField() {
      if (i < n && text[i] === '"') {
        // Quoted field
        i++;
        let val = '';
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { val += '"'; i += 2; }
            else { i++; break; }
          } else {
            val += text[i++];
          }
        }
        return val;
      } else {
        let val = '';
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          val += text[i++];
        }
        return val;
      }
    }

    function parseRow() {
      const row = [];
      while (i < n && text[i] !== '\n' && text[i] !== '\r') {
        row.push(parseField());
        if (i < n && text[i] === ',') i++;
      }
      // Skip \r\n or \n
      if (i < n && text[i] === '\r') i++;
      if (i < n && text[i] === '\n') i++;
      return row;
    }

    // First row = headers
    const headerRow = parseRow();
    headers = headerRow.map(h => h.trim());

    // Remaining rows
    let rowCount = 0;
    const rawRows = [];
    while (i < n) {
      // Skip blank lines
      if ((text[i] === '\n' || text[i] === '\r')) {
        if (text[i] === '\r') i++;
        if (i < n && text[i] === '\n') i++;
        continue;
      }
      const rawRow = parseRow();
      if (rawRow.length === 0 || (rawRow.length === 1 && rawRow[0] === '')) continue;

      // Build object
      const obj = {};
      headers.forEach((h, idx) => {
        const v = (rawRow[idx] ?? '').trim();
        obj[h] = v === '' ? null : v;
      });

      // ── Skip fully blank rows (every field is null/empty) ──
      const isBlankRow = headers.every(h => obj[h] === null || obj[h] === '');
      if (isBlankRow) continue;

      rawRows.push(rawRow);
      rows.push(obj);
      rowCount++;
    }

    return { headers, rows, rawRows, rowCount };
  }

  /**
   * Convert array of row-objects back to CSV string
   */
  static toCSV(headers, rows, includeIssueCol = false) {
    const cols = includeIssueCol ? [...headers, '_validation_issues'] : headers;
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [cols.map(escape).join(',')];
    rows.forEach(row => {
      lines.push(cols.map(c => escape(row[c])).join(','));
    });
    return lines.join('\n');
  }

  /**
   * Split rows into chunks of `chunkSize`
   * Returns array of { index, rows, startRow, endRow }
   */
  static chunk(rows, chunkSize) {
    const chunks = [];
    let idx = 0;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const slice = rows.slice(start, start + chunkSize);
      chunks.push({
        index:    idx++,
        rows:     slice,
        startRow: start + 1,
        endRow:   start + slice.length,
      });
    }
    return chunks;
  }

  /**
   * Trigger browser download of a string as a file
   */
  static download(content, filename, mimeType = 'text/csv;charset=utf-8;') {
    const blob = new Blob(['\uFEFF' + content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
  }

  /**
   * Format file size nicely
   */
  static formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Read file as text — returns Promise<string>
   */
  static readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * Progressive parse with progress callback
   * onProgress(pct, rowsProcessed)
   * Returns Promise<ParseResult>
   */
  static async parseWithProgress(file, onProgress) {
    const text = await CSVProcessor.readFile(file);
    onProgress(30, 0);
    await new Promise(r => setTimeout(r, 50)); // yield for UI
    const result = CSVProcessor.parse(text);
    onProgress(100, result.rowCount);
    return result;
  }
}

window.CSVProcessor = CSVProcessor;
