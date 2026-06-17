/**
 * DataVault — Validation Engine
 * Supports: Customer data · Order-level · Product-level · Payment mode
 * Country-specific phone rules, date/time validators, payment method checks, data integrity
 */

const PHONE_RULES = {
  IN:    { name: 'India',          digits: [10],      regex: /^[6-9]\d{9}$/ },
  SG:    { name: 'Singapore',      digits: [8],       regex: /^[689]\d{7}$/ },
  US:    { name: 'United States',  digits: [10],      regex: /^[2-9]\d{9}$/ },
  GB:    { name: 'United Kingdom', digits: [10],      regex: /^[1-9]\d{9}$/ },
  AE:    { name: 'UAE',            digits: [9],       regex: /^5\d{8}$/ },
  AU:    { name: 'Australia',      digits: [9],       regex: /^[4-9]\d{8}$/ },
  DE:    { name: 'Germany',        digits: [10, 11],  regex: /^[1-9]\d{9,10}$/ },
  FR:    { name: 'France',         digits: [9],       regex: /^[1-9]\d{8}$/ },
  JP:    { name: 'Japan',          digits: [10, 11],  regex: /^[0-9]\d{9,10}$/ },
  MULTI: { name: 'Multi-country',  digits: [7,8,9,10,11,12], regex: /^\d{7,12}$/ },
};

const DATE_FORMATS = {
  'YYYY-MM-DD': {
    regex: /^(\d{4})-(\d{2})-(\d{2})$/,
    parse: m => ({ y: +m[1], mo: +m[2], d: +m[3] }),
  },
  'DD/MM/YYYY': {
    regex: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    parse: m => ({ y: +m[3], mo: +m[2], d: +m[1] }),
  },
  'MM/DD/YYYY': {
    regex: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    parse: m => ({ y: +m[3], mo: +m[1], d: +m[2] }),
  },
  'DD-MM-YYYY': {
    regex: /^(\d{2})-(\d{2})-(\d{4})$/,
    parse: m => ({ y: +m[3], mo: +m[2], d: +m[1] }),
  },
};

// ── Valid value sets for categorical fields ────────────────────────────────────

const VALID_PAYMENT_MODES = new Set([
  'cash', 'card', 'credit card', 'debit card', 'upi', 'net banking', 'netbanking',
  'net_banking', 'bank transfer', 'bank_transfer', 'wallet', 'paytm', 'gpay',
  'google pay', 'phonepe', 'phone pe', 'neft', 'rtgs', 'imps', 'cheque', 'check',
  'emi', 'cod', 'cash on delivery', 'online', 'offline', 'prepaid', 'postpaid',
]);

const VALID_ORDER_STATUSES = new Set([
  'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled',
  'canceled', 'refunded', 'returned', 'failed', 'completed', 'on hold', 'on_hold',
  'draft', 'active', 'inactive', 'closed', 'open', 'partial',
]);

const VALID_PAYMENT_STATUSES = new Set([
  'paid', 'unpaid', 'pending', 'failed', 'refunded', 'partially paid',
  'partial', 'success', 'successful', 'processing', 'completed', 'cancelled',
  'authorized', 'captured', 'voided',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripPhone(val) {
  if (!val && val !== 0) return '';
  return String(val).replace(/[\s\-\(\)\+\.]/g, '');
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function isValidCalendarDate(y, mo, d) {
  if (y < 1900 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  const maxDays = [0, 31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= maxDays[mo];
}

function autoDetectDateFormat(val) {
  // Try in priority order: unambiguous formats first.
  // YYYY-MM-DD is unambiguous. DD-MM-YYYY is the Indian/UK standard.
  const priority = ['YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'];
  for (const fmt of priority) {
    const rule = DATE_FORMATS[fmt];
    const m = String(val).match(rule.regex);
    if (m) {
      const p = rule.parse(m);
      if (isValidCalendarDate(p.y, p.mo, p.d)) return fmt;
    }
  }
  return null;
}

function isValidEmail(val) {
  if (!val || String(val).trim() === '') return { valid: false, isWarning: true, reason: 'Missing email address' };
  const s = String(val).trim();
  if (s === 'NULL' || s.toLowerCase() === 'null') return { valid: false, isWarning: true, reason: 'NULL email value' };
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(s)) return { valid: false, reason: 'Invalid email format' };
  if (s.includes('..')) return { valid: false, reason: 'Consecutive dots in email' };
  if (s.length > 254) return { valid: false, reason: 'Email exceeds RFC max length (254)' };
  return { valid: true };
}

function isValidAmount(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, reason: 'Empty amount field' };
  const s = String(val).trim().replace(/,/g, '').replace(/₹|\$|€|£/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return { valid: false, reason: `"${val}" is not a valid number` };
  if (n < 0)          return { valid: true, isWarning: true, reason: 'Negative amount — verify if credit/refund' };
  if (n === 0)        return { valid: true, isWarning: true, reason: 'Zero amount — verify if intentional' };
  if (n > 10_000_000) return { valid: true, isWarning: true, reason: 'Unusually large amount (>1 Cr) — verify' };
  return { valid: true };
}

function isValidTimeStr(val) {
  if (!val || String(val).trim() === '') return { valid: false, reason: 'Empty time value' };
  const s = String(val).trim();
  const re = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
  if (!re.test(s)) return { valid: false, reason: `"${val}" must be HH:MM or HH:MM:SS (24-hr)` };
  return { valid: true };
}

function isValidQuantity(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, reason: 'Empty quantity' };
  const n = Number(String(val).trim().replace(/,/g, ''));
  if (isNaN(n) || !Number.isInteger(n)) return { valid: false, reason: `"${val}" is not a whole number` };
  if (n < 0)   return { valid: false, reason: 'Quantity cannot be negative' };
  if (n === 0) return { valid: true, isWarning: true, reason: 'Zero quantity — verify if intentional' };
  if (n > 100000) return { valid: true, isWarning: true, reason: `Unusually large quantity (${n}) — verify` };
  return { valid: true };
}

function isValidPaymentMode(val) {
  if (!val || String(val).trim() === '') return { valid: false, reason: 'Missing payment mode' };
  const s = String(val).trim().toLowerCase();
  if (!VALID_PAYMENT_MODES.has(s)) {
    return {
      valid: false,
      reason: `Unknown payment mode: "${val}"`,
      fix: `Expected one of: Cash, Card, UPI, Net Banking, Wallet, COD, EMI, Bank Transfer`,
    };
  }
  return { valid: true };
}

function isValidOrderStatus(val) {
  if (!val || String(val).trim() === '') return { valid: false, reason: 'Missing order status' };
  const s = String(val).trim().toLowerCase();
  if (!VALID_ORDER_STATUSES.has(s)) {
    return {
      valid: false,
      reason: `Unknown order status: "${val}"`,
      fix: `Expected: Pending, Confirmed, Processing, Shipped, Delivered, Cancelled, Refunded, etc.`,
    };
  }
  return { valid: true };
}

function isValidPaymentStatus(val) {
  if (!val || String(val).trim() === '') return { valid: false, reason: 'Missing payment status' };
  const s = String(val).trim().toLowerCase();
  if (!VALID_PAYMENT_STATUSES.has(s)) {
    return {
      valid: false,
      reason: `Unknown payment status: "${val}"`,
      fix: `Expected: Paid, Unpaid, Pending, Failed, Refunded, Partial, Success, etc.`,
    };
  }
  return { valid: true };
}

function isValidSKU(val) {
  if (!val || String(val).trim() === '') return { valid: false, isWarning: true, reason: 'Missing SKU/product code' };
  const s = String(val).trim();
  if (s.length < 2) return { valid: false, reason: `SKU "${s}" too short (min 2 chars)` };
  if (s.length > 50) return { valid: true, isWarning: true, reason: `SKU "${s}" is unusually long (>50 chars)` };
  return { valid: true };
}

// ── Column-type heuristics ────────────────────────────────────────────────────
// Covers: Customer · Order-level · Product-level · Payment mode fields

const COLUMN_PATTERNS = {
  // Identifiers
  id: /^(id|row_id|sl_no|sr_no|serial_no|sno|s\.no|customer_id|cust_id|user_id|order_id|order_no|order_number|product_id|prod_id|item_id|transaction_id|txn_id|invoice_id|invoice_no|booking_id|ref_id|reference_id|shipment_id|delivery_id|return_id|refund_id)$/i,

  // Contact
  phone:   /^(phone|mobile|cell|contact|tel|ph|ph_no|phone_no|phone_number|phonenumber|mobile_no|mobile_number|contact_no|contact_number|customer_phone|cust_phone|billing_phone|shipping_phone)$/i,
  email:   /^(email|e_mail|email_address|emailid|mail|customer_email|cust_email|billing_email|user_email)$/i,

  // Date fields
  date:    /^(date|signup_date|order_date|order_dt|created_at|created_date|purchase_date|transaction_date|txn_date|invoice_date|delivery_date|shipping_date|dispatch_date|return_date|dob|joining_date|manufacture_date|expiry_date|expiration_date)$/i,

  // Time fields
  time:    /^(time|order_time|transaction_time|txn_time|created_time|delivery_time|shipping_time|dispatch_time|pickup_time)$/i,

  // Monetary
  amount:  /^(amount|price|total|total_amount|total_price|cost|revenue|value|payment|payment_amount|amt|order_amount|order_total|order_value|subtotal|sub_total|mrp|selling_price|base_price|unit_price|item_price|discount|discount_amount|tax|tax_amount|gst|cgst|sgst|igst|shipping_cost|delivery_charge|net_amount|gross_amount|final_amount|invoice_amount|refund_amount|cod_amount)$/i,

  // Quantity / numeric product fields
  quantity:/^(quantity|qty|units|count|no_of_items|item_count|pieces|pcs|ordered_qty|shipped_qty|returned_qty)$/i,

  // Payment mode — critical for transaction data
  payment_mode: /^(payment_mode|payment_method|pay_mode|pay_method|mode_of_payment|payment_type|pay_type|transaction_type|txn_type|mode)$/i,

  // Order / payment status
  order_status:   /^(order_status|order_state|status|fulfillment_status|delivery_status|shipment_status|return_status)$/i,
  payment_status: /^(payment_status|pay_status|txn_status|transaction_status|settlement_status)$/i,

  // Product fields
  sku:     /^(sku|sku_code|product_code|prod_code|item_code|barcode|asin|isbn|mpn|model_no|part_no|article_no)$/i,
  name:    /^(name|full_name|customer_name|first_name|last_name|product_name|prod_name|item_name|category|sub_category|brand|description|product_description)$/i,

  // Location
  country: /^(country|country_code|nation|shipping_country|billing_country)$/i,
  city:    /^(city|location|region|state|district|zip|pincode|pin_code|postal_code|billing_city|shipping_city)$/i,
};

function detectColumnType(colName) {
  // Exact match first
  for (const [type, re] of Object.entries(COLUMN_PATTERNS)) {
    if (re.test(colName.trim())) return type;
  }
  // Fuzzy: check if colName contains any keyword
  const lower = colName.toLowerCase().replace(/[\s_-]/g, '');
  if (lower.includes('phone') || lower.includes('mobile')) return 'phone';
  if (lower.includes('email') || lower.includes('mail'))   return 'email';
  if (lower.includes('date'))                              return 'date';
  if (lower.includes('time'))                              return 'time';
  if (lower.includes('amount') || lower.includes('price') || lower.includes('cost')) return 'amount';
  if (lower.includes('qty') || lower.includes('quantity')) return 'quantity';
  if (lower.includes('paymentmode') || lower.includes('paymode') || lower.includes('modeofpayment')) return 'payment_mode';
  if (lower.includes('paymentstatus') || lower.includes('paystatus')) return 'payment_status';
  if (lower.includes('orderstatus') || lower.includes('status'))      return 'order_status';
  if (lower.includes('sku') || lower.includes('productcode'))         return 'sku';
  return 'text';
}

/**
 * Detect what kind of dataset was uploaded based on detected column types.
 * Returns: 'customer' | 'transaction' | 'product' | 'mixed' | 'unknown'
 */
function detectDatasetType(headers) {
  const types = new Set(headers.map(h => detectColumnType(h)));
  const hasOrder   = types.has('payment_mode') || types.has('order_status') || types.has('payment_status');
  const hasProduct = types.has('sku') || types.has('quantity');
  const hasCustomer = types.has('phone') || types.has('email');
  if (hasOrder && hasProduct && hasCustomer) return 'mixed';
  if (hasOrder || hasProduct) return 'transaction';
  if (hasCustomer) return 'customer';
  return 'unknown';
}

// ── Core Validator ────────────────────────────────────────────────────────────

class ValidationEngine {
  constructor(options = {}) {
    this.country      = options.country      || 'IN';
    this.dateFormat   = options.dateFormat   || 'AUTO';
    this.chunkSize    = options.chunkSize    || 10000;
    this.checks       = {
      phone:          options.phone          !== false,
      date:           options.date           !== false,
      email:          options.email          !== false,
      amount:         options.amount         !== false,
      duplicates:     options.duplicates     !== false,
      payment_mode:   options.payment_mode   !== false,
      order_status:   options.order_status   !== false,
      payment_status: options.payment_status !== false,
      quantity:       options.quantity       !== false,
      sku:            options.sku            !== false,
    };
    this.phoneRule = PHONE_RULES[this.country] || PHONE_RULES['IN'];
  }

  validatePhone(val, colName) {
    const raw = String(val ?? '');
    if (raw.trim() === '' || raw.toLowerCase() === 'null') {
      return { valid: false, type: 'error', reason: 'Missing phone number', fix: 'Obtain phone number from records' };
    }
    const stripped = stripPhone(raw);
    if (this.country === 'MULTI') {
      if (/^\d{7,12}$/.test(stripped)) return { valid: true };
      return { valid: false, type: 'error', reason: `Phone "${raw}" invalid digit count (expected 7–12)`, fix: 'Verify and correct the phone number' };
    }
    const rule = this.phoneRule;
    if (!rule.regex.test(stripped)) {
      const expected = rule.digits.join(' or ');
      return {
        valid: false, type: 'error',
        reason: `Phone "${raw}" invalid for ${rule.name} (expected ${expected}-digit local number)`,
        fix: `Strip country code/spaces; ensure ${expected}-digit format`,
      };
    }
    return { valid: true };
  }

  validateDate(val) {
    if (!val || String(val).trim() === '' || String(val).toLowerCase() === 'null') {
      return { valid: false, type: 'error', reason: 'Missing or NULL date', fix: 'Provide a valid date value' };
    }
    const s = String(val).trim();
    const fmt = this.dateFormat === 'AUTO' ? autoDetectDateFormat(s) : this.dateFormat;
    if (!fmt) {
      return { valid: false, type: 'error', reason: `Date "${s}" does not match any known format`, fix: 'Use DD-MM-YYYY or YYYY-MM-DD (ISO 8601)' };
    }
    const rule = DATE_FORMATS[fmt];
    const m = s.match(rule.regex);
    if (!m) {
      return { valid: false, type: 'error', reason: `Date "${s}" doesn't match format ${fmt}`, fix: `Expected: ${fmt}` };
    }
    const { y, mo, d } = rule.parse(m);
    if (!isValidCalendarDate(y, mo, d)) {
      return { valid: false, type: 'error', reason: `"${s}" is not a valid calendar date`, fix: 'Check day/month values — e.g. Feb 30 is invalid' };
    }
    const dt = new Date(y, mo - 1, d);
    if (dt > new Date()) {
      return { valid: true, isWarning: true, type: 'warning', reason: `Date "${s}" is in the future`, fix: 'Verify — may be a scheduled/future order' };
    }
    return { valid: true };
  }

  validateTime(val) {
    const r = isValidTimeStr(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: 'Use 24-hr format HH:MM or HH:MM:SS' };
    return { valid: true };
  }

  validateEmail(val) {
    const r = isValidEmail(val);
    if (!r.valid && r.isWarning) return { valid: true, isWarning: true, type: 'warning', reason: r.reason, fix: 'Collect email from customer — field is blank' };
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: 'Provide a valid email address' };
    return { valid: true };
  }

  validateAmount(val) {
    const r = isValidAmount(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: 'Provide a valid numeric amount' };
    if (r.isWarning) return { valid: true, isWarning: true, type: 'warning', reason: r.reason, fix: 'Confirm the amount is correct' };
    return { valid: true };
  }

  validateQuantity(val) {
    const r = isValidQuantity(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: 'Provide a valid whole-number quantity ≥ 0' };
    if (r.isWarning) return { valid: true, isWarning: true, type: 'warning', reason: r.reason, fix: 'Verify quantity is correct' };
    return { valid: true };
  }

  validatePaymentMode(val) {
    const r = isValidPaymentMode(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: r.fix || 'Use a recognised payment mode' };
    return { valid: true };
  }

  validateOrderStatus(val) {
    const r = isValidOrderStatus(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: r.fix || 'Use a recognised order status' };
    return { valid: true };
  }

  validatePaymentStatus(val) {
    const r = isValidPaymentStatus(val);
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: r.fix || 'Use a recognised payment status' };
    return { valid: true };
  }

  validateSKU(val) {
    const r = isValidSKU(val);
    if (!r.valid && r.isWarning) return { valid: true, isWarning: true, type: 'warning', reason: r.reason, fix: 'Populate the SKU/product code field' };
    if (!r.valid) return { valid: false, type: 'error', reason: r.reason, fix: 'Provide a valid SKU or product code' };
    return { valid: true };
  }

  validateId(val, colName) {
    if (val === '' || val === null || val === undefined || String(val).toLowerCase() === 'null') {
      return { valid: false, type: 'error', reason: `${colName} is empty or NULL`, fix: 'ID fields must not be empty — check source data' };
    }
    return { valid: true };
  }

  validateCell(colName, colType, val) {
    switch (colType) {
      case 'phone':          return this.checks.phone          ? this.validatePhone(val, colName)    : null;
      case 'email':          return this.checks.email          ? this.validateEmail(val)              : null;
      case 'date':           return this.checks.date           ? this.validateDate(val)               : null;
      case 'time':           return this.checks.date           ? this.validateTime(val)               : null;
      case 'amount':         return this.checks.amount         ? this.validateAmount(val)             : null;
      case 'quantity':       return this.checks.quantity       ? this.validateQuantity(val)           : null;
      case 'payment_mode':   return this.checks.payment_mode   ? this.validatePaymentMode(val)        : null;
      case 'order_status':   return this.checks.order_status   ? this.validateOrderStatus(val)        : null;
      case 'payment_status': return this.checks.payment_status ? this.validatePaymentStatus(val)      : null;
      case 'sku':            return this.checks.sku            ? this.validateSKU(val)                : null;
      case 'id':             return this.validateId(val, colName);
      default:               return null;
    }
  }

  /**
   * Validate a full dataset (array of row-objects).
   * Returns { issues, cleanRows, errorRows, duplicateRows, colProfiles, datasetType }
   */
  validate(rows, headers) {
    const issues        = [];
    const cleanRows     = [];
    const errorRows     = [];
    const duplicateRows = [];
    const seenKeys      = new Map();

    // Column type mapping
    const colTypes = {};
    headers.forEach(h => { colTypes[h] = detectColumnType(h); });

    // Identify ID-like column for duplicate key
    const idCol = headers.find(h => colTypes[h] === 'id') || headers[0];

    // Dataset type detection
    const datasetType = detectDatasetType(headers);

    // Per-column stats
    const colStats = {};
    headers.forEach(h => {
      colStats[h] = { total: 0, nulls: 0, empty: 0, errors: 0, uniqueVals: new Set() };
    });

    rows.forEach((row, i) => {
      const rowIdx    = i + 2; // 1-indexed with header row
      let rowHasErr   = false;
      const rowIssues = [];

      // ── Duplicate check ──
      if (this.checks.duplicates) {
        const key = headers.map(h => String(row[h] ?? '').trim().toLowerCase()).join('|');
        if (seenKeys.has(key)) {
          const dupIssue = {
            row: rowIdx, column: idCol, value: row[idCol],
            type: 'duplicate',
            reason: `Duplicate row — first seen at row ${seenKeys.get(key)}`,
            fix: 'Remove duplicate entry or verify if intentional (e.g., multi-item order)',
          };
          issues.push(dupIssue);
          rowHasErr = true;
          rowIssues.push(dupIssue);
          duplicateRows.push(row);
        } else {
          seenKeys.set(key, rowIdx);
        }
      }

      // ── Cell-level checks ──
      headers.forEach(h => {
        const val  = row[h];
        const stat = colStats[h];
        stat.total++;

        const strVal = String(val ?? '').trim();
        if (val === null || val === undefined || strVal === '') stat.empty++;
        else if (strVal.toLowerCase() === 'null') stat.nulls++;
        else stat.uniqueVals.add(strVal.toLowerCase());

        const result = this.validateCell(h, colTypes[h], val);
        if (result && !result.valid) {
          const issueType = result.type || 'error';
          const issue = {
            row: rowIdx, column: h, value: String(val ?? ''),
            type: issueType, reason: result.reason, fix: result.fix,
          };
          issues.push(issue);
          rowIssues.push(issue);
          stat.errors++;
          // Only hard errors cause a row to fail; warnings keep the row in cleanRows
          if (issueType === 'error') rowHasErr = true;
        } else if (result && result.isWarning) {
          const issue = {
            row: rowIdx, column: h, value: String(val ?? ''),
            type: 'warning', reason: result.reason, fix: result.fix,
          };
          issues.push(issue);
          rowIssues.push(issue);
          stat.errors++;
          // Advisory only — row still passes
        }
      });

      if (rowHasErr) {
        errorRows.push({ ...row, _issues: rowIssues.map(x => x.reason).join('; ') });
      } else {
        cleanRows.push(row);
      }
    });

    // Build per-column profiles
    const colProfiles = headers.map(h => {
      const s = colStats[h];
      const fillRate  = s.total > 0 ? ((s.total - s.empty - s.nulls) / s.total * 100).toFixed(1) : 0;
      const errorRate = s.total > 0 ? (s.errors / s.total * 100).toFixed(1) : 0;
      return {
        name: h,
        type: colTypes[h],
        total: s.total,
        nulls: s.nulls,
        empty: s.empty,
        errors: s.errors,
        uniqueCount: s.uniqueVals.size,
        fillRate: parseFloat(fillRate),
        errorRate: parseFloat(errorRate),
      };
    });

    return { issues, cleanRows, errorRows, duplicateRows, colProfiles, datasetType };
  }
}

// Exports
window.ValidationEngine  = ValidationEngine;
window.detectColumnType  = detectColumnType;
window.detectDatasetType = detectDatasetType;
window.PHONE_RULES       = PHONE_RULES;
window.VALID_PAYMENT_MODES   = VALID_PAYMENT_MODES;
window.VALID_ORDER_STATUSES  = VALID_ORDER_STATUSES;
window.VALID_PAYMENT_STATUSES = VALID_PAYMENT_STATUSES;
