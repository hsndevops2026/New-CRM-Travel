/**
 * Words printed on the customer's quotation PDF, in Arabic and English. Item names and
 * notes stay as the agent wrote them; only the PDF's own labels change.
 */

const STRINGS = {
  en: {
    travel_quotation: 'Travel quotation',
    quotation: 'Quotation',
    quote_v: 'Quote v{n}',
    issued: 'Issued {date}',
    travel_quote: 'Travel quote',
    prepared_for: 'Prepared for {name}',
    your_quotation: 'Your travel quotation',
    route: 'Route',
    destination: 'Destination',
    dates: 'Dates',
    duration: 'Duration',
    travellers: 'Travellers',
    included: "What's included",
    included_item: 'Included',
    includes: 'Includes: {text}',
    total_price: 'Total price',
    for_travellers: 'For {who}',
    valid_until: 'Valid until {date}',
    notes: 'Notes',
    terms: 'Terms',
    questions: 'Questions? Contact {agency}',
    prepared_by: 'Prepared by {agency}',
    page_of: 'Page {n} of {count}',
  },
  ar: {
    travel_quotation: 'عرض سعر رحلة',
    quotation: 'عرض سعر',
    quote_v: 'عرض رقم {n}',
    issued: 'تاريخ الإصدار {date}',
    travel_quote: 'عرض سعر رحلة',
    prepared_for: 'مقدّم إلى {name}',
    your_quotation: 'عرض سعر رحلتك',
    route: 'المسار',
    destination: 'الوجهة',
    dates: 'التواريخ',
    duration: 'المدة',
    travellers: 'المسافرون',
    included: 'ما يشمله العرض',
    included_item: 'مشمول',
    includes: 'يشمل: {text}',
    total_price: 'السعر الإجمالي',
    for_travellers: 'المسافرون: {who}',
    valid_until: 'صالح حتى {date}',
    notes: 'ملاحظات',
    terms: 'الشروط',
    questions: 'عندك أسئلة؟ تواصل مع {agency}',
    prepared_by: 'إعداد {agency}',
    page_of: 'صفحة {n} من {count}',
  },
};

export function pdfLang(value) {
  return value === 'en' ? 'en' : value === 'ar' ? 'ar' : 'en';
}

export function L(lang, key, vars = {}) {
  const table = STRINGS[pdfLang(lang)] || STRINGS.en;
  const template = table[key] ?? STRINGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? '').toString());
}

export function nightsLabel(nights, lang) {
  const n = Number(nights);
  if (!n) return null;
  if (pdfLang(lang) === 'ar') {
    if (n === 1) return 'ليلة واحدة';
    if (n === 2) return 'ليلتان';
    return n <= 10 ? `${n} ليالٍ` : `${n} ليلة`;
  }
  return `${n} night${n === 1 ? '' : 's'}`;
}

export function travellersLabel(adults, children, lang) {
  const a = Number(adults) || 0;
  const c = Number(children) || 0;
  const parts = [];
  if (pdfLang(lang) === 'ar') {
    const adult = (n) => (n === 1 ? 'بالغ واحد' : n === 2 ? 'بالغان' : n <= 10 ? `${n} بالغين` : `${n} بالغًا`);
    const child = (n) => (n === 1 ? 'طفل واحد' : n === 2 ? 'طفلان' : n <= 10 ? `${n} أطفال` : `${n} طفلًا`);
    if (a || !c) parts.push(adult(a));
    if (c) parts.push(child(c));
    return parts.join('، ');
  }
  if (a || !c) parts.push(`${a} adult${a === 1 ? '' : 's'}`);
  if (c) parts.push(`${c} child${c === 1 ? '' : 'ren'}`);
  return parts.join(', ');
}

/** "12 ديسمبر 2026" with Latin digits, the way the office writes dates in Arabic. */
export function dateLabel(value, lang) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const locale = pdfLang(lang) === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateRangeLabel(from, to, lang) {
  const ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(from ?? ''));
  const mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(to ?? ''));
  if (ma && mb && ma[1] === mb[1] && ma[2] === mb[2] && ma[3] !== mb[3]) {
    // Same month: "12–18 ديسمبر 2026".
    const locale = pdfLang(lang) === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
    const month = new Date(`${ma[1]}-${ma[2]}-15T12:00:00`).toLocaleDateString(locale, { month: 'long' });
    return `${Number(ma[3])}–${Number(mb[3])} ${month} ${ma[1]}`;
  }
  const a = dateLabel(from, lang);
  const b = dateLabel(to, lang);
  if (a && b) return a === b ? a : `${a} - ${b}`;
  return a || b || null;
}
