/**
 * ============================================================
 *  csvStockTransformer.js — MediFinder Stock CSV Normalizer
 *  Transforms messy/non-standard CSV stock data into the exact
 *  format required by the upload-stock Edge Function.
 *
 *  Usage (browser):
 *    const result = CSVStockTransformer.transform(rawCsvString);
 *    // result.csv        → normalized CSV string ready to upload
 *    // result.warnings   → array of {row, field, original, fixed, note}
 *    // result.unfixable  → array of {row, field, value, reason} — must fix manually
 *    // result.stats      → { total, transformed, clean, unfixable }
 *
 *  Drop this file before PharmStockManagement.js in your HTML.
 * ============================================================
 */

const CSVStockTransformer = (() => {
  'use strict';

  // ── System-defined output columns (exact order) ─────────────
  const OUTPUT_HEADERS = [
    'product_name', 'brand', 'category', 'generic_name', 'strength',
    'dosage_form', 'release_type', 'manufacturer', 'batch_no',
    'supplier_name', 'purchase_price', 'original_price', 'discounted_price',
    'pack_size', 'quantity', 'prescription_required', 'reorder_level',
    'manufacture_date', 'expiry_date'
  ];

  // Required fields (can never be empty after transformation)
  const REQUIRED_FIELDS = [
    'product_name', 'generic_name', 'strength', 'dosage_form',
    'manufacturer', 'batch_no', 'original_price', 'pack_size',
    'quantity', 'prescription_required', 'reorder_level', 'expiry_date'
  ];

  // ── Enum maps ────────────────────────────────────────────────

  // Dosage form: maps common aliases → canonical value
  const DOSAGE_FORM_MAP = {
    // TABLET
    'tablet': 'TABLET', 'tab': 'TABLET', 'tabs': 'TABLET', 'tablets': 'TABLET',
    'pill': 'TABLET', 'pills': 'TABLET', 'tbl': 'TABLET', 'oral tablet': 'TABLET',
    // CAPSULE
    'capsule': 'CAPSULE', 'cap': 'CAPSULE', 'caps': 'CAPSULE', 'capsules': 'CAPSULE',
    'softgel': 'CAPSULE', 'soft gel': 'CAPSULE', 'soft gelatin': 'CAPSULE',
    // SYRUP
    'syrup': 'SYRUP', 'syr': 'SYRUP', 'syp': 'SYRUP', 'oral liquid': 'SYRUP',
    'oral solution': 'SYRUP', 'elixir': 'SYRUP',
    // INJECTION
    'injection': 'INJECTION', 'inj': 'INJECTION', 'injectable': 'INJECTION',
    'im injection': 'INJECTION', 'iv injection': 'INJECTION', 'iv': 'INJECTION',
    'im': 'INJECTION', 'ampule': 'INJECTION', 'ampoule': 'INJECTION', 'vial': 'INJECTION',
    // DROPS
    'drops': 'DROPS', 'drop': 'DROPS', 'eye drops': 'DROPS', 'ear drops': 'DROPS',
    'nasal drops': 'DROPS', 'ophthalmic drops': 'DROPS',
    // CREAM
    'cream': 'CREAM', 'crm': 'CREAM', 'topical cream': 'CREAM',
    // OINTMENT
    'ointment': 'OINTMENT', 'oint': 'OINTMENT', 'ung': 'OINTMENT', 'unguent': 'OINTMENT',
    'topical ointment': 'OINTMENT',
    // INHALER
    'inhaler': 'INHALER', 'mdi': 'INHALER', 'metered dose inhaler': 'INHALER',
    'dpi': 'INHALER', 'dry powder inhaler': 'INHALER', 'rotacap': 'INHALER',
    // PATCH
    'patch': 'PATCH', 'transdermal patch': 'PATCH', 'td patch': 'PATCH',
    // SUPPOSITORY
    'suppository': 'SUPPOSITORY', 'supp': 'SUPPOSITORY', 'rectal': 'SUPPOSITORY',
    // POWDER
    'powder': 'POWDER', 'pwd': 'POWDER', 'sachet': 'POWDER', 'granules': 'POWDER',
    // SUSPENSION
    'suspension': 'SUSPENSION', 'susp': 'SUSPENSION', 'oral suspension': 'SUSPENSION',
    // GEL
    'gel': 'GEL', 'jelly': 'GEL', 'topical gel': 'GEL',
    // LOTION
    'lotion': 'LOTION', 'lot': 'LOTION',
    // SOLUTION
    'solution': 'SOLUTION', 'sol': 'SOLUTION', 'soln': 'SOLUTION',
    // SPRAY
    'spray': 'SPRAY', 'nasal spray': 'SPRAY', 'oral spray': 'SPRAY',
    // ENEMA
    'enema': 'ENEMA', 'rectal enema': 'ENEMA',
    // PESSARY
    'pessary': 'PESSARY', 'vaginal tablet': 'PESSARY', 'vaginal suppository': 'PESSARY',
    // IMPLANT
    'implant': 'IMPLANT', 'subcutaneous implant': 'IMPLANT',
  };

  // Release type aliases
  const RELEASE_TYPE_MAP = {
    'immediate': 'IMMEDIATE', 'ir': 'IMMEDIATE', 'immediate release': 'IMMEDIATE',
    'standard': 'IMMEDIATE', 'normal': 'IMMEDIATE', 'regular': 'IMMEDIATE',
    'extended': 'EXTENDED', 'er': 'EXTENDED', 'extended release': 'EXTENDED',
    'xr': 'EXTENDED', 'xl': 'EXTENDED', 'la': 'EXTENDED', 'long acting': 'EXTENDED',
    'delayed': 'DELAYED', 'dr': 'DELAYED', 'delayed release': 'DELAYED',
    'enteric coated': 'DELAYED', 'ec': 'DELAYED',
    'sustained': 'SUSTAINED', 'sr': 'SUSTAINED', 'sustained release': 'SUSTAINED',
    'slow release': 'SUSTAINED',
    'modified': 'MODIFIED', 'mr': 'MODIFIED', 'modified release': 'MODIFIED',
    'controlled': 'MODIFIED', 'cr': 'MODIFIED', 'controlled release': 'MODIFIED',
  };

  // Boolean synonyms
  const TRUE_VALS  = new Set(['true', '1', 'yes', 'y', 'required', 'rx', 'rx required', 'prescription', 'x']);
  const FALSE_VALS = new Set(['false', '0', 'no', 'n', 'not required', 'otc', 'over the counter', '']);

  // ── Column name alias map ────────────────────────────────────
  // Maps every reasonable variant → canonical field name
  const COLUMN_ALIAS_MAP = {
    // product_name
    'product_name': 'product_name', 'productname': 'product_name',
    'product name': 'product_name', 'medicine name': 'product_name',
    'medicine': 'product_name', 'drug name': 'product_name',
    'drug': 'product_name', 'item name': 'product_name',
    'item': 'product_name', 'name': 'product_name',
    'product': 'product_name', 'med name': 'product_name',
    'medication': 'product_name', 'medication name': 'product_name',

    // brand
    'brand': 'brand', 'brand name': 'brand', 'brandname': 'brand',
    'trade name': 'brand', 'tradename': 'brand', 'trade': 'brand',
    'company brand': 'brand',

    // category
    'category': 'category', 'cat': 'category', 'drug category': 'category',
    'therapeutic category': 'category', 'type': 'category', 'class': 'category',
    'drug class': 'category', 'therapeutic class': 'category',
    'drug type': 'category', 'medicine type': 'category',

    // generic_name
    'generic_name': 'generic_name', 'generic name': 'generic_name',
    'genericname': 'generic_name', 'generic': 'generic_name',
    'active ingredient': 'generic_name', 'active_ingredient': 'generic_name',
    'ingredient': 'generic_name', 'composition': 'generic_name',
    'salt': 'generic_name', 'formula': 'generic_name',
    'chemical name': 'generic_name', 'inn': 'generic_name',

    // strength
    'strength': 'strength', 'dose': 'strength', 'dosage': 'strength',
    'potency': 'strength', 'concentration': 'strength', 'conc': 'strength',
    'mg': 'strength', 'dose strength': 'strength', 'drug strength': 'strength',

    // dosage_form
    'dosage_form': 'dosage_form', 'dosage form': 'dosage_form',
    'dosageform': 'dosage_form', 'form': 'dosage_form',
    'drug form': 'dosage_form', 'formulation': 'dosage_form',
    'presentation': 'dosage_form', 'route': 'dosage_form',

    // release_type
    'release_type': 'release_type', 'release type': 'release_type',
    'releasetype': 'release_type', 'release': 'release_type',
    'release mechanism': 'release_type', 'drug release': 'release_type',

    // manufacturer
    'manufacturer': 'manufacturer', 'mfr': 'manufacturer', 'mfg': 'manufacturer',
    'maker': 'manufacturer', 'made by': 'manufacturer', 'manufactured by': 'manufacturer',
    'company': 'manufacturer', 'pharma company': 'manufacturer',
    'manufacturing company': 'manufacturer', 'producer': 'manufacturer',
    'lab': 'manufacturer', 'laboratory': 'manufacturer',

    // batch_no
    'batch_no': 'batch_no', 'batch no': 'batch_no', 'batch number': 'batch_no',
    'batchno': 'batch_no', 'batch': 'batch_no', 'lot no': 'batch_no',
    'lot number': 'batch_no', 'lot': 'batch_no', 'lot_no': 'batch_no',

    // supplier_name
    'supplier_name': 'supplier_name', 'supplier name': 'supplier_name',
    'supplier': 'supplier_name', 'vendor': 'supplier_name',
    'vendor name': 'supplier_name', 'distributor': 'supplier_name',
    'distributor name': 'supplier_name', 'wholesaler': 'supplier_name',

    // purchase_price
    'purchase_price': 'purchase_price', 'purchase price': 'purchase_price',
    'purchaseprice': 'purchase_price', 'cost': 'purchase_price',
    'cost price': 'purchase_price', 'buying price': 'purchase_price',
    'buy price': 'purchase_price', 'net price': 'purchase_price',
    'net cost': 'purchase_price', 'pp': 'purchase_price',
    'landed cost': 'purchase_price',

    // original_price
    'original_price': 'original_price', 'original price': 'original_price',
    'originalprice': 'original_price', 'mrp': 'original_price',
    'retail price': 'original_price', 'selling price': 'original_price',
    'unit price': 'original_price', 'price': 'original_price',
    'sale price': 'original_price', 'sp': 'original_price',
    'rsp': 'original_price', 'max retail price': 'original_price',
    'maximum retail price': 'original_price',

    // discounted_price
    'discounted_price': 'discounted_price', 'discounted price': 'discounted_price',
    'discountedprice': 'discounted_price', 'discount price': 'discounted_price',
    'offer price': 'discounted_price', 'promo price': 'discounted_price',
    'promotional price': 'discounted_price', 'special price': 'discounted_price',
    'dp': 'discounted_price',

    // pack_size
    'pack_size': 'pack_size', 'pack size': 'pack_size', 'packsize': 'pack_size',
    'pack': 'pack_size', 'units per pack': 'pack_size',
    'tablets per pack': 'pack_size', 'strips': 'pack_size',
    'pieces': 'pack_size', 'pcs': 'pack_size', 'qty per pack': 'pack_size',
    'count': 'pack_size', 'tab per pack': 'pack_size',

    // quantity
    'quantity': 'quantity', 'qty': 'quantity', 'stock': 'quantity',
    'stock quantity': 'quantity', 'available': 'quantity',
    'available quantity': 'quantity', 'units': 'quantity',
    'total quantity': 'quantity', 'no of packs': 'quantity',
    'packs': 'quantity', 'current stock': 'quantity',

    // prescription_required
    'prescription_required': 'prescription_required',
    'prescription required': 'prescription_required',
    'prescriptionrequired': 'prescription_required',
    'rx required': 'prescription_required', 'rx': 'prescription_required',
    'prescription': 'prescription_required', 'requires prescription': 'prescription_required',
    'is prescription': 'prescription_required',

    // reorder_level
    'reorder_level': 'reorder_level', 'reorder level': 'reorder_level',
    'reorderlevel': 'reorder_level', 'reorder': 'reorder_level',
    'min stock': 'reorder_level', 'minimum stock': 'reorder_level',
    'reorder point': 'reorder_level', 'minimum quantity': 'reorder_level',
    'min qty': 'reorder_level', 'safety stock': 'reorder_level',

    // manufacture_date
    'manufacture_date': 'manufacture_date', 'manufacture date': 'manufacture_date',
    'manufacturedate': 'manufacture_date', 'mfg date': 'manufacture_date',
    'manufacturing date': 'manufacture_date', 'mfr date': 'manufacture_date',
    'date of manufacture': 'manufacture_date', 'dom': 'manufacture_date',
    'mfg_date': 'manufacture_date', 'prod date': 'manufacture_date',

    // expiry_date
    'expiry_date': 'expiry_date', 'expiry date': 'expiry_date',
    'expirydate': 'expiry_date', 'expiry': 'expiry_date',
    'exp date': 'expiry_date', 'exp_date': 'expiry_date',
    'expiration date': 'expiry_date', 'expiration': 'expiry_date',
    'exp': 'expiry_date', 'use by': 'expiry_date',
    'best before': 'expiry_date', 'valid till': 'expiry_date',
    'valid upto': 'expiry_date', 'date of expiry': 'expiry_date',
    'doe': 'expiry_date',
  };

  // ── Month name map for date parsing ─────────────────────────
  const MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04',
    june: '06', july: '07', august: '08', september: '09',
    october: '10', november: '11', december: '12',
  };

  // ============================================================
  //  PARSERS
  // ============================================================

  /**
   * Parse raw CSV string → array of {header: value} objects.
   * Handles: quoted fields, commas inside quotes, CRLF + LF, BOM.
   */
  function parseCSV(raw) {
    // Strip BOM
    const text = raw.replace(/^\uFEFF/, '').trim();
    const lines = [];
    let line = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"')            { inQuotes = false; }
        else                            { cell += ch; }
      } else {
        if (ch === '"')                 { inQuotes = true; }
        else if (ch === ',')            { line.push(cell.trim()); cell = ''; }
        else if (ch === '\r' && next === '\n') {
          line.push(cell.trim()); cell = '';
          lines.push(line); line = []; i++;
        } else if (ch === '\n' || ch === '\r') {
          line.push(cell.trim()); cell = '';
          lines.push(line); line = [];
        } else { cell += ch; }
      }
    }
    if (cell !== '' || line.length) { line.push(cell.trim()); lines.push(line); }

    // Remove fully empty trailing lines
    while (lines.length && lines[lines.length - 1].every(c => c === '')) lines.pop();

    if (lines.length < 2) return { headers: [], rows: [] };

    const rawHeaders = lines[0];
    const rows = lines.slice(1)
      .filter(l => l.some(c => c !== '')) // skip blank rows
      .map(l => {
        const obj = {};
        rawHeaders.forEach((h, i) => { obj[h] = l[i] !== undefined ? l[i] : ''; });
        return obj;
      });

    return { headers: rawHeaders, rows };
  }

  /**
   * Map raw CSV headers → canonical field names.
   * Returns { mapping: {rawHeader: canonicalField}, unmapped: [rawHeader] }
   */
  function mapHeaders(rawHeaders) {
    const mapping = {};
    const unmapped = [];

    rawHeaders.forEach(raw => {
      const key = raw.trim().toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
      // Try exact alias map
      if (COLUMN_ALIAS_MAP[key]) {
        mapping[raw] = COLUMN_ALIAS_MAP[key];
      } else if (COLUMN_ALIAS_MAP[key.replace(/ /g, '_')]) {
        // Try underscore variant
        mapping[raw] = COLUMN_ALIAS_MAP[key.replace(/ /g, '_')];
      } else {
        // Fuzzy match: find the alias whose canonical name or key is most similar
        let best = null, bestScore = 0;
        for (const [alias, canonical] of Object.entries(COLUMN_ALIAS_MAP)) {
          const score = stringSimilarity(key, alias);
          if (score > bestScore && score > 0.75) { bestScore = score; best = canonical; }
        }
        if (best) { mapping[raw] = best; }
        else      { unmapped.push(raw); }
      }
    });

    return { mapping, unmapped };
  }

  /** Simple Dice coefficient similarity (0–1) */
  function stringSimilarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams = s => {
      const bg = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const bg2 = s.slice(i, i + 2);
        bg.set(bg2, (bg.get(bg2) || 0) + 1);
      }
      return bg;
    };
    const aMap = bigrams(a), bMap = bigrams(b);
    let intersect = 0;
    for (const [key, count] of aMap) {
      if (bMap.has(key)) intersect += Math.min(count, bMap.get(key));
    }
    return (2 * intersect) / (a.length + b.length - 2);
  }

  // ============================================================
  //  DATE TRANSFORMER
  // ============================================================

  /**
   * Try to parse any date string → YYYY-MM-DD.
   * Returns null if unparseable.
   * Handles:
   *   DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
   *   DD-MM-YYYY, MM-DD-YYYY, YYYY-MM-DD
   *   DD.MM.YYYY, YYYY.MM.DD
   *   Jan 15 2026, 15 Jan 2026, January 15, 2026
   *   MM/YYYY (assumes day=01)
   *   MMYYYY or MMYY (assumes day=01)
   */
  function normalizeDate(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;

    // Already correct
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      return isNaN(d) ? null : s;
    }

    let day = null, month = null, year = null;

    // ── Try: "Jan 2026" or "Jan-2026" (no day — use 01)
    const monYear = s.match(/^([a-z]+)[\s\-](\d{4})$/i);
    if (monYear) {
      const m = MONTH_MAP[monYear[1].toLowerCase()];
      if (m) { day = '01'; month = m; year = monYear[2]; }
    }

    // ── Try: "Jan 15 2026" or "15 Jan 2026" or "January 15, 2026"
    if (!day) {
      const named1 = s.match(/^([a-z]+)\s+(\d{1,2})[,\s]+(\d{4})$/i);
      const named2 = s.match(/^(\d{1,2})\s+([a-z]+)[,\s]+(\d{4})$/i);
      if (named1) {
        const m = MONTH_MAP[named1[1].toLowerCase()];
        if (m) { day = named1[2].padStart(2,'0'); month = m; year = named1[3]; }
      } else if (named2) {
        const m = MONTH_MAP[named2[2].toLowerCase()];
        if (m) { day = named2[1].padStart(2,'0'); month = m; year = named2[3]; }
      }
    }

    // ── Try: numeric formats with separators (/ - .)
    if (!day) {
      const sep = s.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
      if (sep) {
        let [, p1, p2, p3] = sep;
        // Normalize 2-digit year
        if (p3.length === 2) p3 = (parseInt(p3) >= 50 ? '19' : '20') + p3;
        if (p1.length === 4) {
          // YYYY/MM/DD
          year = p1; month = p2.padStart(2,'0'); day = p3.padStart(2,'0');
        } else if (parseInt(p1) > 12) {
          // DD/MM/YYYY — day cannot be > 12 if it's a month
          day = p1.padStart(2,'0'); month = p2.padStart(2,'0'); year = p3;
        } else if (parseInt(p2) > 12) {
          // MM/DD/YYYY — but we prefer DD/MM for pharma (Pakistani context)
          // If p2 > 12 it must be a day
          day = p2.padStart(2,'0'); month = p1.padStart(2,'0'); year = p3;
        } else {
          // Ambiguous — assume DD/MM/YYYY (Pakistan convention)
          day = p1.padStart(2,'0'); month = p2.padStart(2,'0'); year = p3;
        }
      }
    }

    // ── Try: MM/YYYY (no day)
    if (!day) {
      const monYearNum = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
      if (monYearNum) {
        day = '01'; month = monYearNum[1].padStart(2,'0'); year = monYearNum[2];
      }
    }

    if (day && month && year && year.length === 4) {
      const iso = `${year}-${month}-${day}`;
      const d = new Date(iso);
      if (!isNaN(d) && d.getFullYear() === parseInt(year)) return iso;
    }

    return null; // unparseable
  }

  // ============================================================
  //  NUMERIC TRANSFORMER
  // ============================================================

  /**
   * Strip currency symbols, commas, spaces → clean numeric string.
   * Returns '' if empty or truly unparseable.
   */
  function normalizeNumeric(raw) {
    if (!raw) return '';
    let s = raw.toString().trim();
    // Strip currency prefixes: Rs., PKR, $, £, €, ₨, etc.
    s = s.replace(/^(Rs\.?|PKR\.?|USD|INR|usd|rs\.?|\$|£|€|₨|₹)\s*/i, '');
    // Remove thousand separators (commas), allow decimal dot
    s = s.replace(/,/g, '');
    // Remove trailing/leading spaces
    s = s.trim();
    if (s === '' || isNaN(Number(s))) return '';
    return s;
  }

  // ============================================================
  //  STRENGTH NORMALIZER
  // ============================================================

  /**
   * Try to ensure strength has a unit.
   * "500" → we CANNOT assume unit, just uppercase and warn.
   * "500mg" → "500MG"
   * "500 mg" → "500MG"
   * "250ml" → "250ML"
   * "5%" → "5%"
   */
  function normalizeStrength(raw) {
    if (!raw) return { value: '', fixed: false };
    let s = raw.toString().trim();
    // Uppercase and remove spaces between number and unit
    s = s.toUpperCase().replace(/(\d)\s+(MG|ML|MCG|IU|MEQ|MMOL|G|KG|%|MG\/ML|MCG\/ML|MG\/5ML|MG\/ML)$/, '$1$2');
    // Already has a unit?
    const hasUnit = /\d\s*(MG|ML|MCG|IU|MEQ|MMOL|G|KG|%|MG\/ML|MCG\/ML|MG\/5ML|MG\/ML|UNITS?)$/i.test(s);
    return { value: s, fixed: hasUnit };
  }

  // ============================================================
  //  BATCH NO NORMALIZER
  // ============================================================

  /** Replace spaces with dashes, uppercase */
  function normalizeBatchNo(raw) {
    if (!raw) return '';
    return raw.toString().trim().toUpperCase().replace(/\s+/g, '-');
  }

  // ============================================================
  //  BOOLEAN NORMALIZER
  // ============================================================

  function normalizeBoolean(raw) {
    if (raw === null || raw === undefined) return null;
    const s = raw.toString().trim().toLowerCase();
    if (TRUE_VALS.has(s)) return 'true';
    if (FALSE_VALS.has(s)) return 'false';
    return null; // unfixable
  }

  // ============================================================
  //  ROW TRANSFORMER
  // ============================================================

  function transformRow(rawObj, canonicalMap, rowIndex) {
    const warnings = [];
    const unfixable = [];

    const warn  = (field, original, fixed, note) => warnings.push({ row: rowIndex, field, original, fixed: String(fixed), note });
    const unfix = (field, value, reason)          => unfixable.push({ row: rowIndex, field, value: String(value), reason });

    // ── 1. Remap columns using canonicalMap
    const row = {};
    for (const [rawHeader, canonical] of Object.entries(canonicalMap)) {
      if (rawObj[rawHeader] !== undefined) {
        // If two raw headers map to the same canonical field, prefer the non-empty one
        const existing = row[canonical];
        const incoming = rawObj[rawHeader];
        if (existing === undefined || (existing === '' && incoming !== '')) {
          row[canonical] = incoming;
        }
      }
    }

    // ── 2. Ensure all output columns exist (fill missing with '')
    OUTPUT_HEADERS.forEach(h => { if (row[h] === undefined) row[h] = ''; });

    const out = {};

    // ── 3. Text fields — trim
    const textFields = ['product_name','brand','category','manufacturer','supplier_name'];
    textFields.forEach(f => { out[f] = (row[f] || '').toString().trim(); });

    // ── 4. Upper-text fields
    ['generic_name'].forEach(f => {
      out[f] = (row[f] || '').toString().trim().toUpperCase();
    });

    // ── 5. dosage_form
    const rawDF = (row['dosage_form'] || '').toString().trim();
    const dfKey = rawDF.toLowerCase().replace(/\s+/g, ' ');
    if (DOSAGE_FORM_MAP[dfKey]) {
      const fixed = DOSAGE_FORM_MAP[dfKey];
      if (fixed !== rawDF.toUpperCase()) warn('dosage_form', rawDF, fixed, 'Normalized to standard enum value');
      out['dosage_form'] = fixed;
    } else if (rawDF.toUpperCase() === rawDF && rawDF !== '') {
      // Already uppercase — keep it, edge function will validate
      out['dosage_form'] = rawDF;
    } else if (rawDF !== '') {
      out['dosage_form'] = rawDF.toUpperCase();
      warn('dosage_form', rawDF, out['dosage_form'], 'Uppercased — verify this is a valid dosage form');
    } else {
      out['dosage_form'] = '';
    }

    // ── 6. release_type
    const rawRT = (row['release_type'] || '').toString().trim();
    const rtKey = rawRT.toLowerCase().replace(/\s+/g, ' ');
    if (!rawRT) {
      out['release_type'] = '';
    } else if (RELEASE_TYPE_MAP[rtKey]) {
      const fixed = RELEASE_TYPE_MAP[rtKey];
      if (fixed !== rawRT.toUpperCase()) warn('release_type', rawRT, fixed, 'Normalized to standard enum value');
      out['release_type'] = fixed;
    } else {
      out['release_type'] = rawRT.toUpperCase();
      warn('release_type', rawRT, out['release_type'], 'Uppercased — verify this is a valid release type');
    }

    // ── 7. strength
    const { value: strengthVal, fixed: hasUnit } = normalizeStrength(row['strength']);
    out['strength'] = strengthVal;
    if (strengthVal && !hasUnit) {
      warn('strength', row['strength'], strengthVal, 'No unit detected — add MG, ML, etc. (e.g. 500MG)');
    } else if (strengthVal !== row['strength']) {
      warn('strength', row['strength'], strengthVal, 'Normalized casing/spacing');
    }

    // ── 8. batch_no
    const rawBatch = (row['batch_no'] || '').toString().trim();
    const normBatch = normalizeBatchNo(rawBatch);
    out['batch_no'] = normBatch;
    if (normBatch && normBatch !== rawBatch) warn('batch_no', rawBatch, normBatch, 'Spaces replaced with dashes, uppercased');

    // ── 9. Numeric fields
    const numFields = [
      { field: 'purchase_price',   required: false },
      { field: 'original_price',   required: true  },
      { field: 'discounted_price', required: false },
    ];
    numFields.forEach(({ field, required }) => {
      const raw = (row[field] || '').toString();
      if (!raw.trim()) { out[field] = ''; return; }
      const norm = normalizeNumeric(raw);
      if (norm === '') {
        if (required) unfix(field, raw, 'Cannot parse as a number — must be a valid positive number');
        else out[field] = '';
        return;
      }
      if (norm !== raw.trim()) warn(field, raw, norm, 'Removed currency symbol/formatting');
      out[field] = norm;
    });

    // ── 10. Integer fields
    const intFields = [
      { field: 'pack_size',    required: true  },
      { field: 'quantity',     required: true  },
      { field: 'reorder_level',required: true  },
    ];
    intFields.forEach(({ field, required }) => {
      const raw = (row[field] || '').toString();
      if (!raw.trim()) { out[field] = ''; return; }
      const norm = normalizeNumeric(raw);
      const asNum = Number(norm);
      if (norm === '' || isNaN(asNum)) {
        if (required) unfix(field, raw, `Cannot parse as a whole number`);
        else out[field] = '';
        return;
      }
      // Round to integer if float was given
      const intVal = Math.round(asNum).toString();
      if (intVal !== raw.trim()) warn(field, raw, intVal, 'Rounded to whole number');
      out[field] = intVal;
    });

    // ── 11. prescription_required
    const rawRx = (row['prescription_required'] || '').toString();
    const normRx = normalizeBoolean(rawRx);
    if (normRx === null && rawRx.trim() !== '') {
      unfix('prescription_required', rawRx, 'Cannot determine true/false — use: true, false, yes, no, 1, 0');
      out['prescription_required'] = rawRx;
    } else if (normRx === null) {
      out['prescription_required'] = 'false'; // sensible default for empty
      warn('prescription_required', rawRx, 'false', 'Empty value defaulted to false (OTC)');
    } else {
      if (normRx !== rawRx.toLowerCase().trim()) warn('prescription_required', rawRx, normRx, 'Normalized to true/false');
      out['prescription_required'] = normRx;
    }

    // ── 12. Date fields
    ['manufacture_date', 'expiry_date'].forEach(field => {
      const raw = (row[field] || '').toString().trim();
      if (!raw) { out[field] = ''; return; }
      const normed = normalizeDate(raw);
      if (!normed) {
        if (field === 'expiry_date') unfix(field, raw, 'Cannot parse date — use YYYY-MM-DD (e.g. 2026-06-30)');
        else { out[field] = ''; warn(field, raw, '', 'Cannot parse date — cleared. Fix manually if needed.'); }
      } else {
        if (normed !== raw) warn(field, raw, normed, 'Date format converted to YYYY-MM-DD');
        out[field] = normed;
      }
    });

    return { row: out, warnings, unfixable };
  }

  // ============================================================
  //  CSV SERIALIZER
  // ============================================================

  function escapeCSVCell(val) {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serializeCSV(rows) {
    const lines = [OUTPUT_HEADERS.join(',')];
    rows.forEach(row => {
      lines.push(OUTPUT_HEADERS.map(h => escapeCSVCell(row[h] || '')).join(','));
    });
    return lines.join('\r\n');
  }

  // ============================================================
  //  MAIN TRANSFORM FUNCTION
  // ============================================================

  /**
   * @param {string} rawCsvString — The raw CSV file contents
   * @returns {{
   *   csv: string,             — Normalized CSV ready to download/upload
   *   warnings: Array,         — Fixable issues that were auto-corrected
   *   unfixable: Array,        — Issues that need manual correction
   *   skippedColumns: Array,   — Raw column names that couldn't be mapped
   *   stats: Object
   * }}
   */
  function transform(rawCsvString) {
    const { headers, rows } = parseCSV(rawCsvString);

    if (!headers.length || !rows.length) {
      return {
        csv: OUTPUT_HEADERS.join(',') + '\r\n',
        warnings: [],
        unfixable: [{ row: 'N/A', field: 'file', value: '', reason: 'File is empty or could not be parsed' }],
        skippedColumns: [],
        stats: { total: 0, transformed: 0, clean: 0, unfixable: 0 }
      };
    }

    const { mapping, unmapped } = mapHeaders(headers);

    const allWarnings  = [];
    const allUnfixable = [];
    const outputRows   = [];
    let cleanCount = 0;

    rows.forEach((rawRow, i) => {
      const rowNum = i + 2; // 1-indexed + header row
      const { row, warnings, unfixable } = transformRow(rawRow, mapping, rowNum);
      outputRows.push(row);
      allWarnings.push(...warnings);
      allUnfixable.push(...unfixable);
      if (warnings.length === 0 && unfixable.length === 0) cleanCount++;
    });

    const rowsWithUnfixable = new Set(allUnfixable.map(u => u.row)).size;

    return {
      csv:            serializeCSV(outputRows),
      warnings:       allWarnings,
      unfixable:      allUnfixable,
      skippedColumns: unmapped,
      stats: {
        total:      rows.length,
        transformed: allWarnings.length > 0 ? new Set(allWarnings.map(w => w.row)).size : 0,
        clean:      cleanCount,
        unfixable:  rowsWithUnfixable,
      }
    };
  }

  // ── Public API ───────────────────────────────────────────────
  return { transform };

})();


// ============================================================
//  INTEGRATION HELPER — drop this into PharmStockManagement.js
//  where you currently call parseAndValidateCSV()
// ============================================================

/**
 * Call this before your existing client-side validation.
 *
 *   const file = event.target.files[0];
 *   const raw  = await file.text();
 *   const result = CSVStockTransformer.transform(raw);
 *
 *   if (result.unfixable.length > 0) {
 *     // Show unfixable errors to user — they MUST fix these before upload
 *     showTransformErrors(result.unfixable);
 *     return;
 *   }
 *
 *   if (result.warnings.length > 0) {
 *     // Optionally show what was auto-fixed (nice UX)
 *     showTransformWarnings(result.warnings);
 *   }
 *
 *   // Pass result.csv to your existing CSV parser as if it was the original file
 *   const cleanFile = new File([result.csv], file.name, { type: 'text/csv' });
 *   handleCSVFile(cleanFile); // your existing function
 */
