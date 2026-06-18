/**
 * DataVault — Main Application Controller
 * Orchestrates: upload → parse → validate → display → export
 */

/* ── State ──────────────────────────────────────────────────────────────────── */
const STATE = {
  file:                null,
  parsed:              null,   // { headers, rows, rowCount }
  validation:          null,   // { issues, cleanRows, errorRows, colProfiles }
  fixedRows:           null,   // auto-repaired copy of ALL rows
  fixSummary:          null,   // { totalFixes, byColumn, fixLog }
  filteredIssues:      [],
  currentFilter:       'all',
  analyticsFilterType: null,
  analyticsFilterCol:  null,
  currentPage:         1,
  pageSize:            25,
  searchQuery:         '',
};

/* ── DOM Refs ────────────────────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

/* ── Toast ────────────────────────────────────────────────────────────────────── */
function toast(title, msg, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      <p class="toast-title">${title}</p>
      <p class="toast-msg">${msg}</p>
    </div>
  `;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 4000);
}

/* ── Nav scroll ──────────────────────────────────────────────────────────────── */
window.addEventListener('scroll', () => {
  document.querySelector('.nav').classList.toggle('scrolled', window.scrollY > 40);
});

/* ── Drop Zone ───────────────────────────────────────────────────────────────── */
const dropzone = $('dropzone');
const fileInput = $('file-input');

$('browse-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    toast('Invalid File', 'Please upload a CSV file (.csv)', 'error');
    return;
  }
  STATE.file = file;
  $('file-name-display').textContent = file.name;
  $('file-meta-display').textContent = `${CSVProcessor.formatBytes(file.size)} · Last modified: ${new Date(file.lastModified).toLocaleDateString()}`;
  $('file-info-card').style.display = 'flex';

  // Quick column sniff to show dataset type badge before full validation
  const reader = new FileReader();
  reader.onload = e => {
    const firstLine = e.target.result.split(/\r?\n/)[0];
    const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, '').trim());
    const dsType = detectDatasetType(headers);
    showDatasetBadge(dsType, headers);
  };
  reader.readAsText(file.slice(0, 2048)); // Only read first 2 KB for header

  toast('File Ready', `"${file.name}" loaded. Click Run Validation to proceed.`, 'success');
}

function showDatasetBadge(dsType, headers) {
  const badge = $('dataset-type-badge');
  const label = $('ds-type-label');
  const icon  = $('ds-icon');
  badge.style.display = 'flex';
  badge.className = 'dataset-type-badge'; // reset

  const dsMap = {
    customer:    { label: 'Customer Dataset',     icon: '👤', cls: 'ds-customer' },
    transaction: { label: 'Transaction Dataset',  icon: '🧾', cls: 'ds-transaction' },
    mixed:       { label: 'Mixed Dataset',        icon: '📦', cls: 'ds-mixed' },
    unknown:     { label: 'Generic Dataset',      icon: '📊', cls: 'ds-unknown' },
  };
  const info = dsMap[dsType] || dsMap.unknown;
  label.textContent = info.label;
  icon.textContent  = info.icon;
  badge.classList.add(info.cls);
}

$('clear-btn').addEventListener('click', () => {
  STATE.file = null; STATE.parsed = null; STATE.validation = null;
  STATE.fixedRows = null; STATE.fixSummary = null;
  STATE.analyticsFilterType = null; STATE.analyticsFilterCol = null;
  fileInput.value = '';
  $('file-info-card').style.display = 'none';
  $('dataset-type-badge').style.display = 'none';
  ['validation-section', 'preview-section', 'profile-section', 'export-section', 'analytics-section'].forEach(id => {
    if ($(id)) $(id).style.display = 'none';
  });
});

/* ── Run Validation ───────────────────────────────────────────────────────────── */
$('validate-btn').addEventListener('click', async () => {
  if (!STATE.file) return;

  // Show processing
  const overlay = $('processing-overlay');
  const bar     = $('processing-bar');
  const label   = $('processing-label');
  const sub     = $('processing-sub');
  overlay.style.display = 'flex';
  bar.style.width = '0%';
  label.textContent = 'Parsing CSV…';
  sub.textContent   = '0 rows processed';
  $('validate-btn').disabled = true;

  try {
    const parsed = await CSVProcessor.parseWithProgress(STATE.file, (pct, rows) => {
      bar.style.width = pct + '%';
      label.textContent = pct < 60 ? 'Parsing CSV…' : 'Running validation rules…';
      sub.textContent   = `${rows.toLocaleString()} rows processed`;
    });

    STATE.parsed = parsed;
    bar.style.width = '60%';
    label.textContent = 'Running validation…';
    sub.textContent   = `${parsed.rowCount.toLocaleString()} rows found`;
    await new Promise(r => setTimeout(r, 80));

    // Build engine from UI options
    const engine = new ValidationEngine({
      country:        $('country-select').value,
      dateFormat:     $('date-format-select').value,
      chunkSize:      parseInt($('chunk-size-input').value) || 10000,
      phone:          $('toggle-phone').checked,
      date:           $('toggle-date').checked,
      email:          $('toggle-email').checked,
      amount:         $('toggle-amount').checked,
      duplicates:     $('toggle-duplicates').checked,
      payment_mode:   $('toggle-payment-mode').checked,
      order_status:   $('toggle-order-status').checked,
      payment_status: $('toggle-payment-status').checked,
      quantity:       $('toggle-quantity').checked,
      sku:            $('toggle-quantity').checked,
    });

    const result = engine.validate(parsed.rows, parsed.headers);
    STATE.validation = result;

    // ── Run Auto-Fix on ALL rows immediately after validation ──
    label.textContent = 'Applying auto-fixes…';
    await new Promise(r => setTimeout(r, 40));
    const { fixedRows, fixSummary } = autoFix(parsed.rows, parsed.headers, {
      country:    $('country-select').value,
      dateFormat: $('date-format-select').value,
    });
    STATE.fixedRows  = fixedRows;
    STATE.fixSummary = fixSummary;

    bar.style.width = '100%';
    label.textContent = 'Complete!';

    await new Promise(r => setTimeout(r, 400));
    overlay.style.display = 'none';
    $('validate-btn').disabled = false;

    // Update dataset type badge with confirmed type from validation
    showDatasetBadge(result.datasetType, parsed.headers);

    renderValidationResults(parsed, result);
    const fixMsg = fixSummary.totalFixes > 0
      ? ` · ${fixSummary.totalFixes.toLocaleString()} values auto-fixed`
      : '';
    toast('Validation Complete', `${parsed.rowCount.toLocaleString()} rows · ${result.issues.length} issues found${fixMsg}`, result.issues.length === 0 ? 'success' : 'warning');

    // Scroll to results
    setTimeout(() => $('validation-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  } catch (err) {
    overlay.style.display = 'none';
    $('validate-btn').disabled = false;
    toast('Processing Error', err.message || 'Failed to process file', 'error');
    console.error(err);
  }
});

/* ── Render Results ───────────────────────────────────────────────────────────── */
function renderValidationResults(parsed, result) {
  const { rows } = parsed;
  const { issues, cleanRows, errorRows, duplicateRows, colProfiles } = result;

  // Show sections
  $('validation-section').style.display = 'block';
  $('analytics-section').style.display  = 'block';
  $('preview-section').style.display    = 'block';
  $('profile-section').style.display    = 'block';
  $('export-section').style.display     = 'block';

  // Reset analytics filters
  STATE.analyticsFilterType = null;
  STATE.analyticsFilterCol  = null;

  // ── Summary cards ──
  const errors   = issues.filter(i => i.type === 'error').length;
  const warnings = issues.filter(i => i.type === 'warning').length;
  const dups     = issues.filter(i => i.type === 'duplicate').length;
  const passRows = cleanRows.length;

  $('sum-total').textContent = rows.length.toLocaleString();
  $('sum-pass').textContent  = passRows.toLocaleString();
  $('sum-warn').textContent  = warnings.toLocaleString();
  $('sum-error').textContent = errors.toLocaleString();
  $('sum-dup').textContent   = dups.toLocaleString();

  $('validation-subtitle').textContent =
    `Analysed ${rows.length.toLocaleString()} rows · ${issues.length} total issues (${errors} errors, ${warnings} warnings, ${dups} duplicates)`;

  // ── Quality ring ──
  const qualityPct = rows.length > 0 ? Math.round(cleanRows.length / rows.length * 100) : 100;
  $('quality-pct').textContent = qualityPct + '%';
  const circ = 2 * Math.PI * 66; // r=66
  const arc  = document.getElementById('quality-arc');
  setTimeout(() => {
    arc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)';
    arc.style.strokeDashoffset = circ * (1 - qualityPct / 100);
  }, 200);

  // ── Issue table ──
  STATE.filteredIssues = [...issues];
  STATE.currentFilter  = 'all';
  STATE.currentPage    = 1;
  STATE.searchQuery    = '';
  $('table-search').value = '';
  renderIssueTable();

  // ── Data preview ──
  renderPreview(parsed, result);

  // ── Column profiles ──
  renderProfiles(colProfiles, rows.length);

  // ── Quality Analytics Dashboard ──
  renderAnalytics(parsed, result);

  // ── Export meta ──
  $('export-cleaned-meta').textContent =
    `${cleanRows.length.toLocaleString()} clean rows · ${parsed.headers.length} columns`;
  $('export-error-meta').textContent =
    `${errorRows.length.toLocaleString()} rows with errors`;

  // ── Auto-Fix export meta ──
  const fs = STATE.fixSummary;
  if (fs && $('export-autofix-meta')) {
    const colsFixed = Object.keys(fs.byColumn).length;
    $('export-autofix-meta').textContent = fs.totalFixes > 0
      ? `${rows.length.toLocaleString()} rows · ${fs.totalFixes.toLocaleString()} values repaired across ${colsFixed} column${colsFixed !== 1 ? 's' : ''}`
      : `${rows.length.toLocaleString()} rows · no repairs needed — data already clean`;

    // Render the per-column fix breakdown chips
    const breakdown = $('autofix-breakdown');
    if (breakdown) {
      breakdown.innerHTML = '';
      if (fs.totalFixes > 0) {
        Object.entries(fs.byColumn)
          .sort((a, b) => b[1] - a[1])
          .forEach(([col, count]) => {
            const chip = document.createElement('span');
            chip.className = 'autofix-chip';
            chip.textContent = `${col}: ${count.toLocaleString()}`;
            breakdown.appendChild(chip);
          });
      }
    }
  }

  updateChunkMeta();
}

/* ── Issue Table ─────────────────────────────────────────────────────────────── */
function applyFilters() {
  let issues = STATE.validation?.issues || [];
  if (STATE.currentFilter !== 'all') {
    issues = issues.filter(i => i.type === STATE.currentFilter);
  }
  if (STATE.analyticsFilterType) {
    issues = issues.filter(i => i.type === STATE.analyticsFilterType);
  }
  if (STATE.analyticsFilterCol) {
    issues = issues.filter(i => i.column === STATE.analyticsFilterCol);
  }
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    issues = issues.filter(i =>
      String(i.row).includes(q) ||
      (i.column || '').toLowerCase().includes(q) ||
      (i.reason || '').toLowerCase().includes(q) ||
      (i.value  || '').toLowerCase().includes(q)
    );
  }
  STATE.filteredIssues = issues;
  STATE.currentPage = 1;
}

function renderIssueTable() {
  const issues = STATE.filteredIssues;
  const total  = issues.length;
  const pages  = Math.max(1, Math.ceil(total / STATE.pageSize));
  const page   = Math.min(STATE.currentPage, pages);
  const start  = (page - 1) * STATE.pageSize;
  const slice  = issues.slice(start, start + STATE.pageSize);

  const tbody = $('error-tbody');
  tbody.innerHTML = '';

  if (slice.length === 0) {
    $('table-empty').style.display = 'flex';
  } else {
    $('table-empty').style.display = 'none';
    slice.forEach(issue => {
      const tr = document.createElement('tr');
      const badgeClass = { error: 'badge-error', warning: 'badge-warning', duplicate: 'badge-duplicate' }[issue.type] || 'badge-info';
      tr.innerHTML = `
        <td>${issue.row}</td>
        <td>${esc(issue.column)}</td>
        <td title="${esc(issue.value)}">${truncate(esc(issue.value), 30)}</td>
        <td><span class="badge-type ${badgeClass}">${issue.type}</span></td>
        <td>${esc(issue.reason)}</td>
        <td class="fix-suggestion">${esc(issue.fix || '—')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Pagination
  $('pagination-info').textContent = total === 0 ? 'No issues' : `Showing ${start + 1}–${Math.min(start + STATE.pageSize, total)} of ${total.toLocaleString()}`;
  $('page-num').textContent = page;
  $('page-prev').disabled = page <= 1;
  $('page-next').disabled = page >= pages;
  STATE.currentPage = page;
}

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.currentFilter = btn.dataset.filter;
    applyFilters();
    renderIssueTable();
  });
});

// Search
$('table-search').addEventListener('input', e => {
  STATE.searchQuery = e.target.value.trim();
  applyFilters();
  renderIssueTable();
});

// Pagination
$('page-prev').addEventListener('click', () => { STATE.currentPage--; renderIssueTable(); });
$('page-next').addEventListener('click', () => { STATE.currentPage++; renderIssueTable(); });

/* ── Preview ────────────────────────────────────────────────────────────────── */
function renderPreview(parsed, result) {
  const { headers, rows } = parsed;
  const errorMap = {};
  result.issues.forEach(issue => {
    if (!errorMap[issue.row]) errorMap[issue.row] = {};
    errorMap[issue.row][issue.column] = issue.type;
  });

  // Header
  const thead = $('preview-thead');
  thead.innerHTML = `<tr><th class="row-num">#</th>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;

  // Up to 50 rows
  const tbody = $('preview-tbody');
  tbody.innerHTML = '';
  const preview = rows.slice(0, 50);
  preview.forEach((row, i) => {
    const rowIdx = i + 2;
    const rowErrors = errorMap[rowIdx] || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="row-num">${rowIdx}</td>` +
      headers.map(h => {
        const errType = rowErrors[h];
        const cls = errType === 'error' ? 'cell-error' : errType === 'warning' ? 'cell-warn' : '';
        return `<td class="${cls}" title="${esc(String(row[h] ?? ''))}">${truncate(esc(String(row[h] ?? '')), 28)}</td>`;
      }).join('');
    tbody.appendChild(tr);
  });
}

/* ── Column Profiles ────────────────────────────────────────────────────────── */
function renderProfiles(colProfiles, totalRows) {
  const grid = $('profile-grid');
  grid.innerHTML = '';
  colProfiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'profile-card fade-in';
    const fillPct  = p.fillRate;
    const errPct   = p.errorRate;
    const uniquePct = totalRows > 0 ? (p.uniqueCount / totalRows * 100).toFixed(1) : 0;
    const fillColor = fillPct > 90 ? 'fill-green' : fillPct > 60 ? 'fill-orange' : 'fill-red';

    card.innerHTML = `
      <div class="profile-col-name">${esc(p.name)} <span style="font-weight:400;font-size:11px;color:var(--text-tertiary)">(${p.type})</span></div>
      <div class="profile-rows">
        <div class="profile-row"><span class="profile-key">Total values</span><span class="profile-val">${p.total.toLocaleString()}</span></div>
        <div class="profile-row"><span class="profile-key">Null / Empty</span><span class="profile-val">${(p.nulls + p.empty).toLocaleString()}</span></div>
        <div class="profile-row"><span class="profile-key">Unique values</span><span class="profile-val">${p.uniqueCount.toLocaleString()}</span></div>
        <div class="profile-row"><span class="profile-key">Validation errors</span><span class="profile-val" style="color:${p.errors > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'}">${p.errors.toLocaleString()}</span></div>
      </div>
      <div class="profile-bar-wrap">
        <div class="profile-bar-label">Fill rate: ${fillPct}%</div>
        <div class="profile-bar"><div class="profile-bar-fill ${fillColor}" style="width:${fillPct}%"></div></div>
      </div>
      <div class="profile-bar-wrap">
        <div class="profile-bar-label">Error rate: ${errPct}%</div>
        <div class="profile-bar"><div class="profile-bar-fill ${errPct > 0 ? 'fill-red' : 'fill-green'}" style="width:${errPct}%"></div></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ── Export ─────────────────────────────────────────────────────────────────── */
$('download-clean-btn').addEventListener('click', () => {
  if (!STATE.validation || !STATE.parsed) return;
  const { cleanRows }  = STATE.validation;
  const { headers }    = STATE.parsed;
  const csv = CSVProcessor.toCSV(headers, cleanRows);
  const baseName = (STATE.file?.name || 'data').replace(/\.csv$/i, '');
  CSVProcessor.download(csv, `${baseName}_cleaned.csv`);
  toast('Download Started', `${cleanRows.length.toLocaleString()} clean rows exported`, 'success');
});

$('download-errors-btn').addEventListener('click', () => {
  if (!STATE.validation || !STATE.parsed) return;
  const { errorRows } = STATE.validation;
  const { headers }   = STATE.parsed;
  if (errorRows.length === 0) { toast('No Errors', 'There are no error rows to export.', 'info'); return; }
  const csv = CSVProcessor.toCSV(headers, errorRows, true);
  const baseName = (STATE.file?.name || 'data').replace(/\.csv$/i, '');
  CSVProcessor.download(csv, `${baseName}_errors.csv`);
  toast('Download Started', `${errorRows.length.toLocaleString()} error rows exported`, 'success');
});

/* ── Auto-Fix Download ───────────────────────────────────────────────────────── */
$('download-autofix-btn').addEventListener('click', () => {
  if (!STATE.fixedRows || !STATE.parsed) return;
  const { headers } = STATE.parsed;
  const baseName    = (STATE.file?.name || 'data').replace(/\.csv$/i, '');

  // 1. Download the repaired full dataset
  const csv = CSVProcessor.toCSV(headers, STATE.fixedRows);
  CSVProcessor.download(csv, `${baseName}_autoFixed.csv`);

  const fs = STATE.fixSummary;
  toast('Auto-Fix Downloaded', `${STATE.fixedRows.length.toLocaleString()} rows · ${fs.totalFixes.toLocaleString()} values repaired`, 'success');
});

$('download-fixlog-btn').addEventListener('click', () => {
  if (!STATE.fixSummary || !STATE.fixSummary.fixLog.length) {
    toast('No Fix Log', 'No repairs were made — nothing to log.', 'info');
    return;
  }
  const baseName = (STATE.file?.name || 'data').replace(/\.csv$/i, '');
  const logHeaders = ['row', 'column', 'action', 'original', 'fixed'];
  const logRows    = STATE.fixSummary.fixLog.map(e => ({
    row: e.row, column: e.column, action: e.action,
    original: e.original, fixed: e.fixed,
  }));
  const csv = CSVProcessor.toCSV(logHeaders, logRows);
  CSVProcessor.download(csv, `${baseName}_fixLog.csv`);
  toast('Fix Log Downloaded', `${logRows.length.toLocaleString()} repair records exported`, 'info');
});

function updateChunkMeta() {
  if (!STATE.validation || !STATE.parsed) return;
  const chunkSize = parseInt($('chunk-size-export').value) || 10000;
  const total     = STATE.validation.cleanRows.length;
  const chunks    = Math.ceil(total / chunkSize);
  $('export-chunk-meta').textContent =
    `${total.toLocaleString()} clean rows → ${chunks} chunk${chunks === 1 ? '' : 's'} of ≤${chunkSize.toLocaleString()} rows each`;
}

$('chunk-size-export').addEventListener('input', updateChunkMeta);

$('preview-chunks-btn').addEventListener('click', () => {
  if (!STATE.validation || !STATE.parsed) return;
  const { cleanRows } = STATE.validation;
  const { headers }   = STATE.parsed;
  const chunkSize     = parseInt($('chunk-size-export').value) || 10000;
  const chunks        = CSVProcessor.chunk(cleanRows, chunkSize);
  const list          = $('chunk-list');
  list.innerHTML      = '';
  list.style.display  = 'grid';

  const baseName = (STATE.file?.name || 'data').replace(/\.csv$/i, '');
  chunks.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chunk-item';
    item.innerHTML = `
      <div>
        <div class="chunk-item-label">Chunk ${c.index + 1}</div>
        <div class="chunk-item-meta">Rows ${c.startRow.toLocaleString()}–${c.endRow.toLocaleString()} · ${c.rows.length.toLocaleString()} rows</div>
      </div>
      <button class="chunk-dl-btn" data-chunk="${c.index}">↓ DL</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.chunk-dl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx   = parseInt(btn.dataset.chunk);
      const chunk = chunks[idx];
      const csv   = CSVProcessor.toCSV(headers, chunk.rows);
      CSVProcessor.download(csv, `${baseName}_chunk_${idx + 1}.csv`);
    });
  });

  toast('Chunks Ready', `${chunks.length} chunks previewed. Click ↓ DL to download each.`, 'info');
  updateChunkMeta();
});

$('download-chunks-btn').addEventListener('click', async () => {
  if (!STATE.validation || !STATE.parsed) return;
  const { cleanRows } = STATE.validation;
  const { headers }   = STATE.parsed;
  const chunkSize     = parseInt($('chunk-size-export').value) || 10000;
  const chunks        = CSVProcessor.chunk(cleanRows, chunkSize);
  const baseName      = (STATE.file?.name || 'data').replace(/\.csv$/i, '');

  for (let i = 0; i < chunks.length; i++) {
    const csv = CSVProcessor.toCSV(headers, chunks[i].rows);
    CSVProcessor.download(csv, `${baseName}_chunk_${i + 1}.csv`);
    await new Promise(r => setTimeout(r, 400)); // Slight delay to avoid browser blocking
  }
  toast('All Chunks Downloaded', `${chunks.length} file${chunks.length > 1 ? 's' : ''} downloaded`, 'success');
});

/* ── Utilities ──────────────────────────────────────────────────────────────── */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/* ── Visual Quality Analytics Dashboard ──────────────────────────────────────── */
function renderAnalytics(parsed, result) {
  const { rows, headers } = parsed;
  const { issues, cleanRows } = result;

  const totalRows = rows.length;
  const warningsCount = issues.filter(i => i.type === 'warning').length;
  const errorCount = issues.filter(i => i.type === 'error').length;
  const duplicateCount = issues.filter(i => i.type === 'duplicate').length;
  const cleanCount = cleanRows.length;

  // 1. Calculate Health Score
  let healthScore = 100;
  if (totalRows > 0) {
    const warningPenalty = warningsCount * 0.15;
    // Duplicates and errors count as 0-health rows
    healthScore = Math.max(0, Math.round(((cleanCount - warningPenalty) / totalRows) * 100));
  }

  // Update gauge text with animation
  const scoreVal = $('health-score-val');
  if (scoreVal) {
    let start = 0;
    const duration = 1000;
    const startTime = performance.now();
    function animateCount(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress * (2 - progress); // easeOutQuad
      const current = Math.round(start + ease * (healthScore - start));
      scoreVal.textContent = current + '%';
      if (progress < 1) {
        requestAnimationFrame(animateCount);
      }
    }
    requestAnimationFrame(animateCount);
  }

  // Update gauge status text & colors
  const statusVal = $('health-status-val');
  if (statusVal) {
    let status = 'Excellent';
    if (healthScore < 40) {
      status = 'Critical';
      statusVal.style.color = 'var(--accent-red)';
    } else if (healthScore < 60) {
      status = 'Needs Work';
      statusVal.style.color = 'var(--accent-orange)';
    } else if (healthScore < 80) {
      status = 'Fair';
      statusVal.style.color = 'var(--accent-orange)';
    } else if (healthScore < 95) {
      status = 'Good';
      statusVal.style.color = 'var(--accent-blue)';
    } else {
      status = 'Excellent';
      statusVal.style.color = 'var(--accent-green)';
    }
    statusVal.textContent = status;
  }

  // Animate Gauge Arc
  const gaugeArc = $('health-gauge-arc');
  if (gaugeArc) {
    const circ = 2 * Math.PI * 72; // ~452.39
    gaugeArc.style.strokeDashoffset = circ * (1 - healthScore / 100);
  }

  // Update metrics numbers
  if ($('health-clean-rows')) $('health-clean-rows').textContent = cleanCount.toLocaleString();
  if ($('health-warning-rows')) $('health-warning-rows').textContent = warningsCount.toLocaleString();
  if ($('health-error-rows')) $('health-error-rows').textContent = errorCount.toLocaleString();
  if ($('health-dup-rows')) $('health-dup-rows').textContent = duplicateCount.toLocaleString();

  // 2. Issue Type Breakdown (Donut Chart)
  const totalIssues = errorCount + warningsCount + duplicateCount;
  const donutGroup = $('donut-slices-group');
  const donutTotal = $('donut-total-issues');
  const donutLegend = $('donut-legend');

  if (donutTotal) donutTotal.textContent = totalIssues.toLocaleString();

  if (donutGroup && donutLegend) {
    donutGroup.innerHTML = '';
    donutLegend.innerHTML = '';

    const types = [
      { key: 'error', label: 'Hard Errors', count: errorCount, color: 'var(--accent-red)', dotClass: 'dot-error' },
      { key: 'warning', label: 'Warnings', count: warningsCount, color: 'var(--accent-orange)', dotClass: 'dot-warning' },
      { key: 'duplicate', label: 'Duplicates', count: duplicateCount, color: 'var(--accent-purple)', dotClass: 'dot-dup' },
    ];

    if (totalIssues === 0) {
      // Draw 100% clean donut
      donutGroup.innerHTML = `
        <circle class="donut-slice" cx="85" cy="85" r="65" fill="none" stroke="var(--accent-green)" stroke-width="14"
          stroke-dasharray="408.41 408.41" stroke-dashoffset="0" style="cursor: default;" />
      `;
      donutLegend.innerHTML = `
        <div class="legend-item" style="cursor: default;">
          <span class="legend-dot dot-clean"></span>
          <span class="legend-label-text">All Data Healthy</span>
          <span class="legend-val-text">100%</span>
        </div>
      `;
    } else {
      const circ = 2 * Math.PI * 65; // ~408.41
      let accumAngle = 0;

      types.forEach(t => {
        const pct = t.count / totalIssues;
        const sliceCirc = pct * circ;
        const offset = -accumAngle;
        accumAngle += sliceCirc;

        if (t.count > 0) {
          const slice = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          slice.setAttribute('class', 'donut-slice');
          slice.setAttribute('cx', '85');
          slice.setAttribute('cy', '85');
          slice.setAttribute('r', '65');
          slice.setAttribute('stroke', t.color);
          slice.setAttribute('stroke-dasharray', `${sliceCirc} ${circ}`);
          slice.setAttribute('stroke-dashoffset', offset);
          if (STATE.analyticsFilterType === t.key) {
            slice.classList.add('active');
          }

          // Interactive click on slice
          slice.addEventListener('click', () => {
            toggleAnalyticsFilter('type', t.key);
          });

          donutGroup.appendChild(slice);
        }

        // Render Legend Item
        const pctText = totalIssues > 0 ? Math.round(t.count / totalIssues * 100) : 0;
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item' + (STATE.analyticsFilterType === t.key ? ' active' : '');
        legendItem.innerHTML = `
          <span class="legend-dot ${t.dotClass}"></span>
          <span class="legend-label-text">${t.label}</span>
          <span class="legend-val-text">${t.count.toLocaleString()} (${pctText}%)</span>
        `;
        legendItem.addEventListener('click', () => {
          toggleAnalyticsFilter('type', t.key);
        });
        donutLegend.appendChild(legendItem);
      });
    }
  }

  // 3. Issue Distribution by Column (Stacked Horizontal Bar Chart)
  const colIssuesList = $('column-issues-list');
  if (colIssuesList) {
    colIssuesList.innerHTML = '';

    // Calculate issues count by column
    const colIssues = {};
    headers.forEach(h => {
      colIssues[h] = { error: 0, warning: 0, duplicate: 0, total: 0 };
    });

    issues.forEach(i => {
      const col = i.column;
      const type = i.type;
      if (colIssues[col]) {
        colIssues[col][type]++;
        colIssues[col].total++;
      }
    });

    // Determine column type map for tagging
    const colTypes = {};
    headers.forEach(h => {
      colTypes[h] = detectColumnType(h);
    });

    // Sort: most issues first, then normal columns
    const sortedCols = [...headers].sort((a, b) => {
      const countA = colIssues[a].total;
      const countB = colIssues[b].total;
      if (countA !== countB) return countB - countA; // DESC issues
      return a.localeCompare(b); // Alphabetical tie-breaker
    });

    sortedCols.forEach(col => {
      const stats = colIssues[col];
      const errPct = totalRows > 0 ? (stats.error / totalRows * 100) : 0;
      const warnPct = totalRows > 0 ? (stats.warning / totalRows * 100) : 0;
      const dupPct = totalRows > 0 ? (stats.duplicate / totalRows * 100) : 0;
      const passPct = Math.max(0, 100 - errPct - warnPct - dupPct);

      const colRow = document.createElement('div');
      colRow.className = 'column-issue-row' + (STATE.analyticsFilterCol === col ? ' active' : '');
      colRow.innerHTML = `
        <div class="col-info-row">
          <span class="col-name-text">
            ${esc(col)}
            <span class="col-type-tag">${esc(colTypes[col])}</span>
          </span>
          <span class="col-issue-count" style="color: ${stats.total > 0 ? 'var(--text-primary)' : 'var(--accent-green)'}">
            ${stats.total > 0 ? `${stats.total.toLocaleString()} issue${stats.total !== 1 ? 's' : ''}` : 'Healthy'}
          </span>
        </div>
        <div class="col-stacked-bar">
          <div class="stacked-segment segment-error" style="width: ${errPct}%" title="Errors: ${stats.error.toLocaleString()} (${errPct.toFixed(1)}%)"></div>
          <div class="stacked-segment segment-warning" style="width: ${warnPct}%" title="Warnings: ${stats.warning.toLocaleString()} (${warnPct.toFixed(1)}%)"></div>
          <div class="stacked-segment segment-duplicate" style="width: ${dupPct}%" title="Duplicates: ${stats.duplicate.toLocaleString()} (${dupPct.toFixed(1)}%)"></div>
          <div class="stacked-segment segment-passed" style="width: ${passPct}%" title="Passed: ${(totalRows - stats.total).toLocaleString()} (${passPct.toFixed(1)}%)"></div>
        </div>
      `;

      colRow.addEventListener('click', () => {
        toggleAnalyticsFilter('col', col);
      });

      colIssuesList.appendChild(colRow);
    });
  }

  // Update Reset button visibility
  const resetBtn = $('analytics-reset-filter');
  if (resetBtn) {
    resetBtn.style.display = (STATE.analyticsFilterType || STATE.analyticsFilterCol) ? 'inline-block' : 'none';
  }
}

function toggleAnalyticsFilter(filterType, value) {
  if (filterType === 'type') {
    if (STATE.analyticsFilterType === value) {
      STATE.analyticsFilterType = null; // Toggle off
    } else {
      STATE.analyticsFilterType = value;
      STATE.analyticsFilterCol = null; // Clear other chart filters
    }
  } else if (filterType === 'col') {
    if (STATE.analyticsFilterCol === value) {
      STATE.analyticsFilterCol = null; // Toggle off
    } else {
      STATE.analyticsFilterCol = value;
      STATE.analyticsFilterType = null; // Clear other chart filters
    }
  }

  // Sync Issues Table and Re-render Chart states
  applyFilters();
  renderIssueTable();

  // Re-run renderAnalytics to update highlights/active states on cards
  renderAnalytics(STATE.parsed, STATE.validation);
}

// Reset button listener wire-up
const resetFilterBtn = $('analytics-reset-filter');
if (resetFilterBtn) {
  resetFilterBtn.addEventListener('click', () => {
    STATE.analyticsFilterType = null;
    STATE.analyticsFilterCol = null;
    applyFilters();
    renderIssueTable();
    renderAnalytics(STATE.parsed, STATE.validation);
  });
}

/* ── Init ───────────────────────────────────────────────────────────────────── */
console.log('%cDataVault v1.0 — Transaction Validation Platform', 'color:#0a84ff;font-weight:bold;font-size:14px;');
console.log('Built for the Xeno Implementation Internship Assignment');
