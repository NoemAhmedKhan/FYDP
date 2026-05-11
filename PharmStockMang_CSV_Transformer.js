/**
 * ============================================================
 *  PharmStockMang_CSV_Transformer.js — MediFinder Stock CSV Normalizer
 *  Updated for new schema: box_quantity + loose_units, BAT-XXXX batch,
 *  full release_type names, expanded dosage_form list, category enum,
 *  YES/NO prescription_required, separator rules for generic_name.
 *
 *  Usage:
 *    const result = CSVStockTransformer.transform(rawCsvString);
 *    result.csv          → normalized CSV ready to pass to validator
 *    result.warnings     → auto-fixed items (shown as "X fields auto-formatted")
 *    result.unfixable    → hard errors, shown in error table, upload blocked
 *    result.skippedColumns → column names that couldn't be mapped
 *    result.stats        → { total, transformed, clean, unfixable }
 * ============================================================
 */

const CSVStockTransformer = (() => {
  'use strict';

  // ── System-defined output columns (exact order) ─────────────
  const OUTPUT_HEADERS = [
    'product_name', 'brand', 'category', 'generic_name', 'strength',
    'dosage_form', 'release_type', 'manufacturer', 'batch_no',
    'supplier_name', 'purchase_price', 'original_price', 'discounted_price',
    'pack_size', 'box_quantity', 'loose_units', 'prescription_required',
    'reorder_level', 'manufacture_date', 'expiry_date'
  ];

  // Required fields (can never be empty after transformation)
  const REQUIRED_FIELDS = [
    'product_name', 'generic_name', 'strength', 'dosage_form',
    'manufacturer', 'batch_no', 'original_price', 'pack_size',
    'box_quantity', 'loose_units', 'prescription_required', 'reorder_level', 'expiry_date'
  ];

  // ── Valid enums ──────────────────────────────────────────────

  const VALID_DOSAGE_FORMS = new Set([
    'TABLET', 'CAPSULE', 'SYRUP', 'DROPS', 'INJECTION', 'INFUSION',
    'CREAM', 'OINTMENT', 'LOTION', 'GEL', 'SPRAY', 'SOLUTION',
    'SUSPENSION', 'SACHET', 'SOFTGEL', 'POWDER', 'PATCH',
    'SUPPOSITORY', 'INHALER', 'FACE WASH', 'SHAMPOO', 'SOAP',
    'TOOTHPASTE', 'OIL', 'GUMMIES', 'FOOD', 'SERUM'
  ]);

  const VALID_RELEASE_TYPES = new Set([
    'IMMEDIATE RELEASE', 'EXTENDED RELEASE', 'SUSTAINED RELEASE',
    'MODIFIED RELEASE', 'DELAYED RELEASE', 'CONTROLLED RELEASE', ''
  ]);

  const VALID_CATEGORIES = new Set([
    'ANTI-ULCERANT', 'ANTI-DIABETIC', 'ANTI-BACTERIAL', 'ANTI-INFLAMMATORY',
    'ANTI-HYPERTENSIVE', 'ANTI-LIPIDEMIC', 'ANTI-EPILEPTIC', 'ANTI-ALLERGY', 'ANTI-CONVULSANT',
    'ANTI-FUNGAL', 'ANTI-SPASMODIC', 'ANTI-COAGULANT', 'ANTI-ANEMIC', 'ANTI-CONVULSANT',
    'ANTI-DIARRHEAL', 'ANTI-DEPRESSANT', 'ANTI-PSYCHOTIC', 'ANTI-GOUT',
    'ANTI-VIRAL', 'ANTI-EMETIC', 'ANTI-OBESITY', 'ANTI-VERTIGO',
    'ASTHMA / COPD', 'COUGH & COLD', 'VITAMINS & SUPPLEMENTS', 'SKIN CARE',
    'OPHTHALMOLOGY', 'PAIN RELIEF', 'CARDIAC THERAPY', 'DIURETICS',
    'LAXATIVE', 'UROLOGY', 'MUSCLE RELAXANT', 'CORTICOSTEROID',
    'CORTICOSTEROID + ANTI-BACTERIAL', 'HORMONAL PRODUCTS', 'IMMUNOMODULATOR',
    'OSTEOPOROSIS', 'GASTROPROKINETIC', 'NEUROLOGY', 'SCABICIDE', 'HERBAL',
    "PARKINSON'S DISEASE", "ALZHEIMER'S DISEASE", 'LOCAL ANAESTHETIC', 'ANTI-RHEUMATIC', 'ANTI-AMOEBIC',
'ANTI-PYRETIC', 'ANTHELMINTIC', 'ORAL HEALTH CARE',
'EAR PREPARATIONS', 'ONCOLOGY', 'ANTISEPTIC',
'CORTICOSTEROID + ANTI-BACTERIAL + ANTI-FUNGAL',
'LIVER & BILE', 'ANTI-HAEMORRHOIDAL', 'HAIR CARE'
  ]);

  // ── Dosage form alias map → canonical value ──────────────────
  const DOSAGE_FORM_MAP = {
    // TABLET
    'tablet': 'TABLET', 'tab': 'TABLET', 'tabs': 'TABLET', 'tablets': 'TABLET',
    'pill': 'TABLET', 'pills': 'TABLET', 'tbl': 'TABLET', 'oral tablet': 'TABLET',
    // CAPSULE
    'capsule': 'CAPSULE', 'cap': 'CAPSULE', 'caps': 'CAPSULE', 'capsules': 'CAPSULE',
    'soft gelatin capsule': 'CAPSULE', 'hard gelatin': 'CAPSULE',
    // SOFTGEL (kept as its own form per spec)
    'softgel': 'SOFTGEL', 'soft gel': 'SOFTGEL', 'soft gelatin': 'SOFTGEL', 'softgel capsule': 'SOFTGEL','softgel capsules': 'SOFTGEL',
    // SYRUP
    'syrup': 'SYRUP', 'syr': 'SYRUP', 'syp': 'SYRUP', 'oral liquid': 'SYRUP', 'liquid': 'SYRUP','elixir': 'SYRUP',
    // INJECTION
    'injection': 'INJECTION', 'inj': 'INJECTION', 'injectable': 'INJECTION',
    'im injection': 'INJECTION', 'iv injection': 'INJECTION',
    'ampule': 'INJECTION', 'ampoule': 'INJECTION', 'vial': 'INJECTION',
    // INFUSION
    'infusion': 'INFUSION', 'iv infusion': 'INFUSION', 'intravenous infusion': 'INFUSION',
    // DROPS
    'drops': 'DROPS', 'drop': 'DROPS', 'eye drops': 'DROPS', 'ear drops': 'DROPS',
    'nasal drops': 'DROPS', 'ophthalmic drops': 'DROPS',
    // CREAM
    'cream': 'CREAM', 'crm': 'CREAM', 'topical cream': 'CREAM',
    // OINTMENT
    'ointment': 'OINTMENT', 'oint': 'OINTMENT', 'ung': 'OINTMENT',
    'topical ointment': 'OINTMENT',
    // LOTION
    'lotion': 'LOTION', 'lot': 'LOTION', 'topical lotion': 'LOTION',
    // GEL
    'gel': 'GEL', 'jelly': 'GEL', 'topical gel': 'GEL',
    // SPRAY
    'spray': 'SPRAY', 'nasal spray': 'SPRAY', 'oral spray': 'SPRAY',
    // SOLUTION
    'solution': 'SOLUTION', 'sol': 'SOLUTION', 'soln': 'SOLUTION',
    'oral solution': 'SOLUTION',
    // SUSPENSION
    'suspension': 'SUSPENSION', 'susp': 'SUSPENSION', 'oral suspension': 'SUSPENSION',
    // SACHET
    'sachet': 'SACHET', 'granules': 'SACHET', 'powder sachet': 'SACHET',
    // POWDER
    'powder': 'POWDER', 'pwd': 'POWDER',
    // PATCH
    'patch': 'PATCH', 'transdermal patch': 'PATCH', 'td patch': 'PATCH',
    // SUPPOSITORY
    'suppository': 'SUPPOSITORY', 'supp': 'SUPPOSITORY',
    // INHALER
    'inhaler': 'INHALER', 'mdi': 'INHALER', 'metered dose inhaler': 'INHALER',
    'dpi': 'INHALER', 'dry powder inhaler': 'INHALER', 'rotacap': 'INHALER',
    // FACE WASH
    'face wash': 'FACE WASH', 'facewash': 'FACE WASH', 'facial wash': 'FACE WASH',
    // SHAMPOO
    'shampoo': 'SHAMPOO',
    // SOAP
    'soap': 'SOAP', 'medicated soap': 'SOAP',
    // TOOTHPASTE
    'toothpaste': 'TOOTHPASTE', 'tooth paste': 'TOOTHPASTE', 'dental paste': 'TOOTHPASTE',
    // OIL
    'oil': 'OIL', 'topical oil': 'OIL', 'hair oil': 'OIL',
  };

  // ── Release type alias map → full canonical names ────────────
  const RELEASE_TYPE_MAP = {
    // IMMEDIATE RELEASE
    'immediate': 'IMMEDIATE RELEASE',
    'immediate release': 'IMMEDIATE RELEASE',
    'ir': 'IMMEDIATE RELEASE',
    'standard': 'IMMEDIATE RELEASE',
    'normal': 'IMMEDIATE RELEASE',
    'regular': 'IMMEDIATE RELEASE',
    // EXTENDED RELEASE
    'extended': 'EXTENDED RELEASE',
    'extended release': 'EXTENDED RELEASE',
    'er': 'EXTENDED RELEASE',
    'xr': 'EXTENDED RELEASE',
    'xl': 'EXTENDED RELEASE',
    'la': 'EXTENDED RELEASE',
    'long acting': 'EXTENDED RELEASE',
    // SUSTAINED RELEASE
    'sustained': 'SUSTAINED RELEASE',
    'sustained release': 'SUSTAINED RELEASE',
    'sr': 'SUSTAINED RELEASE',
    'slow release': 'SUSTAINED RELEASE',
    // MODIFIED RELEASE
    'modified': 'MODIFIED RELEASE',
    'modified release': 'MODIFIED RELEASE',
    'mr': 'MODIFIED RELEASE',
    // DELAYED RELEASE
    'delayed': 'DELAYED RELEASE',
    'delayed release': 'DELAYED RELEASE',
    'dr': 'DELAYED RELEASE',
    'enteric coated': 'DELAYED RELEASE',
    'ec': 'DELAYED RELEASE',
    // CONTROLLED RELEASE
    'controlled': 'CONTROLLED RELEASE',
    'controlled release': 'CONTROLLED RELEASE',
    'cr': 'CONTROLLED RELEASE',
  };

  // ── Column name alias map ─────────────────────────────────────
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
    'therapeutic category': 'category', 'class': 'category',
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
    'dose strength': 'strength', 'drug strength': 'strength',
    // dosage_form
    'dosage_form': 'dosage_form', 'dosage form': 'dosage_form',
    'dosageform': 'dosage_form', 'form': 'dosage_form',
    'drug form': 'dosage_form', 'formulation': 'dosage_form',
    'presentation': 'dosage_form',
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
    'tablets per pack': 'pack_size', 'pieces': 'pack_size',
    'pcs': 'pack_size', 'qty per pack': 'pack_size',
    'count': 'pack_size', 'tab per pack': 'pack_size',
    // box_quantity
    'box_quantity': 'box_quantity', 'box quantity': 'box_quantity',
    'boxquantity': 'box_quantity', 'boxes': 'box_quantity',
    'no of boxes': 'box_quantity', 'number of boxes': 'box_quantity',
    'stock boxes': 'box_quantity', 'qty boxes': 'box_quantity',
    'packs': 'box_quantity', 'no of packs': 'box_quantity',
    // loose_units
    'loose_units': 'loose_units', 'loose units': 'loose_units',
    'looseunits': 'loose_units', 'loose': 'loose_units',
    'open units': 'loose_units', 'extra units': 'loose_units',
    'partial': 'loose_units', 'individual units': 'loose_units',
    'spare units': 'loose_units',
    // prescription_required
    'prescription_required': 'prescription_required',
    'prescription required': 'prescription_required',
    'prescriptionrequired': 'prescription_required',
    'rx required': 'prescription_required', 'rx': 'prescription_required',
    'prescription': 'prescription_required',
    'requires prescription': 'prescription_required',
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

  // ── Month name map ────────────────────────────────────────────
  const MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04',
    june: '06', july: '07', august: '08', september: '09',
    october: '10', november: '11', december: '12',
  };

  // ============================================================
  //  CSV PARSER
  // ============================================================
  function parseCSV(raw) {
    const text = raw.replace(/^\uFEFF/, '').trim();
    const lines = [];
    let line = [], cell = '', inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
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
    while (lines.length && lines[lines.length - 1].every(c => c === '')) lines.pop();
    if (lines.length < 2) return { headers: [], rows: [] };

    const rawHeaders = lines[0];
    const rows = lines.slice(1)
      .filter(l => l.some(c => c !== ''))
      .map(l => {
        const obj = {};
        rawHeaders.forEach((h, i) => { obj[h] = l[i] !== undefined ? l[i] : ''; });
        return obj;
      });
    return { headers: rawHeaders, rows };
  }

  // ============================================================
  //  HEADER MAPPER
  // ============================================================
  function mapHeaders(rawHeaders) {
    const mapping = {}, unmapped = [];
    rawHeaders.forEach(raw => {
      const key = raw.trim().toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
      if (COLUMN_ALIAS_MAP[key]) {
        mapping[raw] = COLUMN_ALIAS_MAP[key];
      } else if (COLUMN_ALIAS_MAP[key.replace(/ /g, '_')]) {
        mapping[raw] = COLUMN_ALIAS_MAP[key.replace(/ /g, '_')];
      } else {
        let best = null, bestScore = 0;
        for (const [alias, canonical] of Object.entries(COLUMN_ALIAS_MAP)) {
          const score = stringSimilarity(key, alias);
          if (score > bestScore && score > 0.75) { bestScore = score; best = canonical; }
        }
        if (best) mapping[raw] = best;
        else      unmapped.push(raw);
      }
    });
    return { mapping, unmapped };
  }

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
  //  DATE NORMALIZER — any format → YYYY-MM-DD
  // ============================================================
  function normalizeDate(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      return isNaN(d) ? null : s;
    }
    let day = null, month = null, year = null;
    const monYear = s.match(/^([a-z]+)[\s\-](\d{4})$/i);
    if (monYear) {
      const m = MONTH_MAP[monYear[1].toLowerCase()];
      if (m) { day = '01'; month = m; year = monYear[2]; }
    }
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
    if (!day) {
      const sep = s.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
      if (sep) {
        let [, p1, p2, p3] = sep;
        if (p3.length === 2) p3 = (parseInt(p3) >= 50 ? '19' : '20') + p3;
        if (p1.length === 4) {
          year = p1; month = p2.padStart(2,'0'); day = p3.padStart(2,'0');
        } else if (parseInt(p1) > 12) {
          day = p1.padStart(2,'0'); month = p2.padStart(2,'0'); year = p3;
        } else if (parseInt(p2) > 12) {
          day = p2.padStart(2,'0'); month = p1.padStart(2,'0'); year = p3;
        } else {
          // Ambiguous → DD/MM/YYYY (Pakistan convention)
          day = p1.padStart(2,'0'); month = p2.padStart(2,'0'); year = p3;
        }
      }
    }
    if (!day) {
      const monYearNum = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
      if (monYearNum) { day = '01'; month = monYearNum[1].padStart(2,'0'); year = monYearNum[2]; }
    }
    if (day && month && year && year.length === 4) {
      const iso = `${year}-${month}-${day}`;
      const d = new Date(iso);
      if (!isNaN(d) && d.getFullYear() === parseInt(year)) return iso;
    }
    return null;
  }

  // ============================================================
  //  NUMERIC NORMALIZER — strip RS., PKR, commas
  // ============================================================
  function normalizeNumeric(raw) {
    if (!raw) return '';
    let s = raw.toString().trim();
    s = s.replace(/^(Rs\.?|PKR\.?|USD|INR|usd|rs\.?|\$|£|€|₨|₹)\s*/i, '');
    s = s.replace(/,/g, '').trim();
    if (s === '' || isNaN(Number(s))) return '';
    return s;
  }

  // ============================================================
  //  STRENGTH NORMALIZER
  // ============================================================
function normalizeStrength(raw) {
    if (!raw) return { value: '', fixed: false };
    let s = raw.toString().trim().toUpperCase();
    // Remove spaces around /
    s = s.replace(/\s*\/\s*/g, '/');
    // Remove spaces between digit and known unit
    s = s.replace(/(\d)\s+(BILLION CFU|CCID50|TCID50|MG\/KG|MG\/M2|KG\/NG|KG\/L|MG\/ML|MG\/G|MG\/5ML|MCG\/ACTUATION|G\/100ML|MG|MCG|MIU|MEQ|CFU|IU|ML|KG|NG|LF|G|U|%)(\b|\/)/g, '$1$2$3');
    const UNIT_PATTERN = /\d(BILLION CFU|CCID50|TCID50|MG\/KG|MG\/M2|MG\/M²|KG\/NG|KG\/L|MG\/ML|MG\/G|MG\/5ML|MCG\/ACTUATION|G\/100ML|MG|MCG|MIU|MEQ|CFU|IU|ML|KG|NG|LF|G|U|%)/i;
    const hasUnit = UNIT_PATTERN.test(s) || s === 'N/A';
    return { value: s, fixed: hasUnit };
  }

  // ============================================================
  //  BATCH NO NORMALIZER — attempt to format as BAT-XXXX
  // ============================================================
  function normalizeBatchNo(raw) {
    if (!raw) return '';
    let s = raw.toString().trim().toUpperCase();
    // Already correct
    if (/^BAT-\d{4}$/.test(s)) return s;
    // Replace spaces with dashes
    s = s.replace(/\s+/g, '-');
    // If it's purely digits with length 4, prepend BAT-
    if (/^\d{4}$/.test(s)) return `BAT-${s}`;
    // If it starts with BATCH or LOT, try to extract 4 digits
    const match = s.match(/(?:BATCH|BAT|LOT)[^0-9]*(\d{4})/);
    if (match) return `BAT-${match[1]}`;
    return s; // return as-is; validator will catch if still wrong
  }

  // ============================================================
  //  TRAILING DOT REMOVER — N2 rule for brand / manufacturer
  // ============================================================
  function removeTrailingDot(s) {
    if (!s) return s;
    return s.replace(/\s*\.\s*$/, '');
  }

  // ============================================================
  //  PRODUCT NAME CLEANER — N6, N7 rules
  // ============================================================
  function cleanProductName(raw, dosageFormCanonical) {
    if (!raw) return raw;
    let s = raw.toString().trim().toUpperCase();
    // N6: Remove trailing /, +, digits+slash, trailing comma
    s = s.replace(/[\s,\/\+]+$/, '').trim();
    s = s.replace(/\s+\d+\/\s*$/, '').trim();
    // N7: Remove duplicate dosage form word at end if present
    if (dosageFormCanonical) {
      const dfWords = dosageFormCanonical.split(' ');
      const lastWord = dfWords[dfWords.length - 1];
      // Check if product_name ends with the dosage form word repeated
      const dupPattern = new RegExp(`(\\b${lastWord}\\b)\\s+\\1\\s*$`, 'i');
      s = s.replace(dupPattern, lastWord);
    }
    return s;
  }

  // ============================================================
  //  GENERIC NAME NORMALIZER — N4, N5 rules
  // ============================================================
function normalizeGenericName(raw) {
    if (!raw) return '';
    let s = raw.toString().trim().toUpperCase();
    // Auto-fix: ' & ' and ' AND ' between words → ' + '
    s = s.replace(/\s+&\s+/g, ' + ');
    s = s.replace(/\b AND \b/g, ' + ');
    // Auto-fix: '/' → ' + ' (FDC separator mistake)
    s = s.replace(/\s*\/\s*/g, ' + ');
    // N4: Normalize + spacing → " + "
    s = s.replace(/\s*\+\s*/g, ' + ');
    // N5: Normalize comma spacing → ", "
    s = s.replace(/\s*,\s*/g, ', ');
    // Remove trailing separators
    s = s.replace(/[\s,+]+$/, '').trim();
    return s;
  }

  // ============================================================
  //  PRESCRIPTION REQUIRED NORMALIZER → YES or NO (spec)
  // ============================================================
  function normalizePrescription(raw) {
    if (raw === null || raw === undefined) return null;
    const s = raw.toString().trim().toLowerCase();
    const YES_VALS = new Set(['yes', 'true', '1', 'y', 'required', 'rx', 'rx required', 'prescription', 'x']);
    const NO_VALS  = new Set(['no', 'false', '0', 'n', 'not required', 'otc', 'over the counter', '']);
    if (YES_VALS.has(s)) return 'YES';
    if (NO_VALS.has(s))  return 'NO';
    return null;
  }

  // ============================================================
  //  ROW TRANSFORMER
  // ============================================================
  function transformRow(rawObj, canonicalMap, rowIndex) {
    const warnings  = [];
    const unfixable = [];
    const warn  = (field, original, fixed, note) => warnings.push({ row: rowIndex, field, original, fixed: String(fixed), note });
    const unfix = (field, value, reason)          => unfixable.push({ row: rowIndex, field, value: String(value), reason });

    // 1. Remap columns
    const row = {};
    for (const [rawHeader, canonical] of Object.entries(canonicalMap)) {
      if (rawObj[rawHeader] !== undefined) {
        const existing = row[canonical];
        const incoming = rawObj[rawHeader];
        if (existing === undefined || (existing === '' && incoming !== '')) {
          row[canonical] = incoming;
        }
      }
    }
    OUTPUT_HEADERS.forEach(h => { if (row[h] === undefined) row[h] = ''; });

    const out = {};

    // 2. dosage_form first — needed for product_name cleaning
    const rawDF = (row['dosage_form'] || '').toString().trim();
    const dfKey = rawDF.toLowerCase().replace(/\s+/g, ' ');
    let dosageFormCanonical = '';
    if (DOSAGE_FORM_MAP[dfKey]) {
      dosageFormCanonical = DOSAGE_FORM_MAP[dfKey];
      if (dosageFormCanonical !== rawDF.toUpperCase()) warn('dosage_form', rawDF, dosageFormCanonical, 'Normalized to standard value');
      out['dosage_form'] = dosageFormCanonical;
    } else if (VALID_DOSAGE_FORMS.has(rawDF.toUpperCase())) {
      dosageFormCanonical = rawDF.toUpperCase();
      out['dosage_form'] = dosageFormCanonical;
    } else if (rawDF !== '') {
      out['dosage_form'] = rawDF.toUpperCase();
      warn('dosage_form', rawDF, out['dosage_form'], 'Uppercased — verify this is a valid dosage form');
    } else {
      out['dosage_form'] = '';
    }

    // 3. product_name — N6, N7, N10
    const rawPN = (row['product_name'] || '').toString().trim();
    const cleanedPN = cleanProductName(rawPN, dosageFormCanonical);
    const upperPN = cleanedPN.toUpperCase();
    out['product_name'] = upperPN;
    if (upperPN !== rawPN.toUpperCase()) warn('product_name', rawPN, upperPN, 'Cleaned trailing artifacts / duplicate dosage word');
    else if (upperPN !== rawPN) warn('product_name', rawPN, upperPN, 'Converted to uppercase');

    // 4. brand — N2 (trailing dot), N10 (uppercase)
    const rawBrand = (row['brand'] || '').toString().trim();
    const cleanBrand = removeTrailingDot(rawBrand).toUpperCase();
    out['brand'] = cleanBrand;
    if (cleanBrand !== rawBrand.toUpperCase()) warn('brand', rawBrand, cleanBrand, 'Removed trailing dot / uppercased');

// 5. category — uppercase + normalize separators
    // & is valid INSIDE category names (e.g. COUGH & COLD)
    // + as separator between two category words → replace with ' & ' only if it
    // matches a known pattern; otherwise leave for validator to catch
    let rawCat = (row['category'] || '').toString().trim().toUpperCase();
    // Auto-fix: ' AND ' between words → ' & ' (common in category names)
    rawCat = rawCat.replace(/\bAND\b/g, '&');
    // Auto-fix: normalize & spacing → ' & '
    rawCat = rawCat.replace(/\s*&\s*/g, ' & ');
    // Auto-fix: '+' used as separator → ' & '
    rawCat = rawCat.replace(/\s*\+\s*/g, ' & ');
    out['category'] = rawCat.trim();
    if (rawCat.trim() !== (row['category'] || '').toString().trim().toUpperCase())
      warn('category', row['category'], rawCat.trim(), 'Normalized separator to & format');

    // 6. generic_name — N4, N5, N10
    const rawGN = (row['generic_name'] || '').toString().trim();
    const normGN = normalizeGenericName(rawGN);
    out['generic_name'] = normGN;
    if (normGN !== rawGN.toUpperCase().trim()) warn('generic_name', rawGN, normGN, 'Normalized separator spacing (N4/N5)');

    // 7. strength — N8 (spaces around /), N10
    const { value: strengthVal, fixed: hasUnit } = normalizeStrength(row['strength']);
    out['strength'] = strengthVal;
    if (strengthVal && !hasUnit) {
      warn('strength', row['strength'], strengthVal, 'No valid unit detected — add MG, ML, % etc.');
    } else if (strengthVal && strengthVal !== (row['strength'] || '').toString().trim().toUpperCase()) {
      warn('strength', row['strength'], strengthVal, 'Normalized spacing/casing');
    }

    // 8. release_type — map to full name
    const rawRT = (row['release_type'] || '').toString().trim();
    const rtKey = rawRT.toLowerCase().replace(/\s+/g, ' ');
    if (!rawRT) {
      out['release_type'] = '';
    } else if (RELEASE_TYPE_MAP[rtKey]) {
      const fixed = RELEASE_TYPE_MAP[rtKey];
      if (fixed !== rawRT.toUpperCase()) warn('release_type', rawRT, fixed, 'Normalized to full release type name');
      out['release_type'] = fixed;
    } else if (VALID_RELEASE_TYPES.has(rawRT.toUpperCase())) {
      out['release_type'] = rawRT.toUpperCase();
    } else {
      out['release_type'] = rawRT.toUpperCase();
      warn('release_type', rawRT, out['release_type'], 'Uppercased — verify this matches an allowed release type');
    }

    // 9. manufacturer — N2 (trailing dot), N10
    const rawMfr = (row['manufacturer'] || '').toString().trim();
    const cleanMfr = removeTrailingDot(rawMfr).toUpperCase();
    out['manufacturer'] = cleanMfr;
    if (cleanMfr !== rawMfr.toUpperCase()) warn('manufacturer', rawMfr, cleanMfr, 'Removed trailing dot / uppercased');

    // 10. supplier_name — N10
    out['supplier_name'] = (row['supplier_name'] || '').toString().trim().toUpperCase();

    // 11. batch_no — normalize toward BAT-XXXX
    const rawBatch = (row['batch_no'] || '').toString().trim();
    const normBatch = normalizeBatchNo(rawBatch);
    out['batch_no'] = normBatch;
    if (normBatch && normBatch !== rawBatch) warn('batch_no', rawBatch, normBatch, 'Normalized toward BAT-XXXX format');

    // 12. Numeric price fields — N3 (strip RS., commas)
    const numFields = [
      { field: 'purchase_price',   required: false },
      { field: 'original_price',   required: true  },
      { field: 'discounted_price', required: false },
    ];
    numFields.forEach(({ field, required }) => {
      const rawVal = (row[field] || '').toString();
      if (!rawVal.trim()) { out[field] = ''; return; }
      const normed = normalizeNumeric(rawVal);
      if (normed === '') {
        if (required) unfix(field, rawVal, 'Cannot parse as a number — must be a valid positive number (e.g. 65.00)');
        else out[field] = '';
        return;
      }
      if (normed !== rawVal.trim()) warn(field, rawVal, normed, 'Removed currency symbol/comma formatting (N3)');
      out[field] = normed;
    });

    // 13. pack_size — positive integer
    const rawPS = (row['pack_size'] || '').toString();
    if (!rawPS.trim()) {
      out['pack_size'] = '';
    } else {
      const normedPS = normalizeNumeric(rawPS);
      const asNum = Number(normedPS);
      if (normedPS === '' || isNaN(asNum) || asNum < 1) {
        unfix('pack_size', rawPS, 'Must be a positive integer (e.g. 10)');
        out['pack_size'] = '';
      } else {
        const intVal = Math.round(asNum).toString();
        if (intVal !== rawPS.trim()) warn('pack_size', rawPS, intVal, 'Rounded to whole number');
        out['pack_size'] = intVal;
      }
    }

    // 14. box_quantity — non-negative integer
    const rawBQ = (row['box_quantity'] || '').toString();
    if (!rawBQ.trim()) {
      out['box_quantity'] = '';
    } else {
      const normedBQ = normalizeNumeric(rawBQ);
      const asNum = Number(normedBQ);
      if (normedBQ === '' || isNaN(asNum) || asNum < 0) {
        unfix('box_quantity', rawBQ, 'Must be a non-negative integer (e.g. 50)');
        out['box_quantity'] = '';
      } else {
        const intVal = Math.round(asNum).toString();
        if (intVal !== rawBQ.trim()) warn('box_quantity', rawBQ, intVal, 'Rounded to whole number');
        out['box_quantity'] = intVal;
      }
    }

    // 15. loose_units — non-negative integer (cross-check vs pack_size done in validator)
    const rawLU = (row['loose_units'] || '').toString();
    if (!rawLU.trim()) {
      out['loose_units'] = '0'; // default to 0 if omitted
      if (rawLU.trim() === '') warn('loose_units', rawLU, '0', 'Empty value defaulted to 0');
    } else {
      const normedLU = normalizeNumeric(rawLU);
      const asNum = Number(normedLU);
      if (normedLU === '' || isNaN(asNum) || asNum < 0) {
        unfix('loose_units', rawLU, 'Must be a non-negative integer (e.g. 0 or 5)');
        out['loose_units'] = '';
      } else {
        const intVal = Math.round(asNum).toString();
        if (intVal !== rawLU.trim()) warn('loose_units', rawLU, intVal, 'Rounded to whole number');
        out['loose_units'] = intVal;
      }
    }

    // 16. prescription_required → YES or NO
    const rawRx = (row['prescription_required'] || '').toString();
    const normRx = normalizePrescription(rawRx);
    if (normRx === null && rawRx.trim() !== '') {
      unfix('prescription_required', rawRx, 'Cannot determine YES/NO — use: YES, NO, true, false, 1, 0');
      out['prescription_required'] = rawRx;
    } else if (normRx === null) {
      out['prescription_required'] = 'NO';
      warn('prescription_required', rawRx, 'NO', 'Empty value defaulted to NO (OTC)');
    } else {
      if (normRx !== rawRx.trim().toUpperCase()) warn('prescription_required', rawRx, normRx, 'Normalized to YES/NO');
      out['prescription_required'] = normRx;
    }

    // 17. reorder_level — positive integer (≥1)
    const rawRL = (row['reorder_level'] || '').toString();
    if (!rawRL.trim()) {
      out['reorder_level'] = '';
    } else {
      const normedRL = normalizeNumeric(rawRL);
      const asNum = Number(normedRL);
      if (normedRL === '' || isNaN(asNum)) {
        unfix('reorder_level', rawRL, 'Must be a positive integer ≥ 1');
        out['reorder_level'] = '';
      } else {
        const intVal = Math.round(asNum).toString();
        if (intVal !== rawRL.trim()) warn('reorder_level', rawRL, intVal, 'Rounded to whole number');
        out['reorder_level'] = intVal;
      }
    }

    // 18. Dates — N9
    ['manufacture_date', 'expiry_date'].forEach(field => {
      const rawD = (row[field] || '').toString().trim();
      if (!rawD) { out[field] = ''; return; }
      const normed = normalizeDate(rawD);
      if (!normed) {
        if (field === 'expiry_date') unfix(field, rawD, 'Cannot parse date — use YYYY-MM-DD (e.g. 2027-06-30)');
        else { out[field] = ''; warn(field, rawD, '', 'Cannot parse date — cleared. Fix manually if needed.'); }
      } else {
        if (normed !== rawD) warn(field, rawD, normed, 'Date format converted to YYYY-MM-DD (N9)');
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
  //  MAIN PUBLIC API
  // ============================================================
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
    const allWarnings = [], allUnfixable = [], outputRows = [];
    let cleanCount = 0;

    rows.forEach((rawRow, i) => {
      const rowNum = i + 2;
      const { row, warnings, unfixable } = transformRow(rawRow, mapping, rowNum);
      outputRows.push(row);
      allWarnings.push(...warnings);
      allUnfixable.push(...unfixable);
      if (warnings.length === 0 && unfixable.length === 0) cleanCount++;
    });

    return {
      csv:            serializeCSV(outputRows),
      warnings:       allWarnings,
      unfixable:      allUnfixable,
      skippedColumns: unmapped,
      stats: {
        total:       rows.length,
        transformed: allWarnings.length > 0 ? new Set(allWarnings.map(w => w.row)).size : 0,
        clean:       cleanCount,
        unfixable:   new Set(allUnfixable.map(u => u.row)).size,
      }
    };
  }

  return { transform };

})();
