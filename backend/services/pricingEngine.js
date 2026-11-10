/**
 * Server-authoritative pricing engine.
 *
 * All monetary arithmetic is done here. The browser sends markup config and
 * selected items; the backend recalculates everything and the browser must
 * display the server's numbers verbatim.
 *
 * Supported markup types: 'percent' | 'fixed'
 * Supported rounding modes: 'none' | 'ceil' | 'floor' | 'round'
 */

const PRECISION = 4; // internal working precision (decimal places)

function d(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fix(n, places = PRECISION) {
  return Number(n.toFixed(places));
}

function applyRounding(value, mode) {
  switch (mode) {
    case 'ceil':  return Math.ceil(value);
    case 'floor': return Math.floor(value);
    case 'round': return Math.round(value);
    default:      return fix(value, 2);
  }
}

/**
 * Calculate full pricing breakdown for a quote draft.
 *
 * @param {object} params
 * @param {Array<{net_cost: number|null, quantity: number}>} params.items
 * @param {'percent'|'fixed'} params.markup_type
 * @param {number} params.markup_value
 * @param {number} params.extras_amount   — flat additional charge (taxes, fees, etc.)
 * @param {'none'|'ceil'|'floor'|'round'} params.rounding_mode
 * @returns {{
 *   net_total: number,
 *   markup_amount: number,
 *   extras_amount: number,
 *   subtotal: number,
 *   selling_price: number,
 *   gross_margin: number,
 *   gross_margin_pct: number|null,
 * }}
 */
export function calculatePricing({ items = [], markup_type, markup_value, extras_amount, rounding_mode }) {
  const markupType = markup_type === 'fixed' ? 'fixed' : 'percent';
  const markupValue = d(markup_value);
  const extras = d(extras_amount);
  const rounding = rounding_mode || 'none';

  // Sum net costs, treating null-cost items as 0
  const netTotal = items.reduce((sum, item) => {
    const cost = d(item.net_cost);
    const qty = Math.max(1, Math.trunc(d(item.quantity) || 1));
    return sum + cost * qty;
  }, 0);

  let markupAmount;
  if (markupType === 'fixed') {
    markupAmount = markupValue;
  } else {
    // percent — applied to net total only, not extras
    markupAmount = fix((netTotal * markupValue) / 100);
  }

  const subtotal = fix(netTotal + markupAmount);
  const rawSellingPrice = subtotal + d(extras);
  const sellingPrice = applyRounding(rawSellingPrice, rounding);
  const grossMargin = fix(sellingPrice - netTotal);
  const grossMarginPct = netTotal > 0 ? fix((grossMargin / sellingPrice) * 100, 2) : null;

  return {
    net_total: fix(netTotal, 2),
    markup_amount: fix(markupAmount, 2),
    extras_amount: fix(extras, 2),
    subtotal: fix(subtotal, 2),
    selling_price: sellingPrice,
    gross_margin: fix(grossMargin, 2),
    gross_margin_pct: grossMarginPct,
  };
}

/**
 * Validate markup config; throws with status 400 on invalid input.
 */
export function validateMarkupConfig({ markup_type, markup_value, extras_amount }) {
  const validTypes = new Set(['percent', 'fixed']);
  if (!validTypes.has(markup_type)) {
    const err = new Error('markup_type must be "percent" or "fixed"');
    err.status = 400;
    throw err;
  }

  const mv = Number(markup_value);
  if (!Number.isFinite(mv) || mv < 0) {
    const err = new Error('markup_value must be a non-negative number');
    err.status = 400;
    throw err;
  }

  if (markup_type === 'percent' && mv > 200) {
    const err = new Error('Percentage markup cannot exceed 200%');
    err.status = 400;
    throw err;
  }

  const ea = Number(extras_amount ?? 0);
  if (!Number.isFinite(ea) || ea < 0) {
    const err = new Error('extras_amount must be a non-negative number');
    err.status = 400;
    throw err;
  }
}
