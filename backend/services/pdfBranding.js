import { DEFAULT_AGENCY_SETTINGS } from './agencySettings.js';

export function resolvedBranding(agency = {}) {
  return { ...DEFAULT_AGENCY_SETTINGS, ...agency };
}

export function pdfSafeLogoUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.hostname === 'res.cloudinary.com' && parsed.pathname.includes('/image/upload/')) {
      parsed.pathname = parsed.pathname.replace('/image/upload/', '/image/upload/f_png/');
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function fetchBrandLogo(url) {
  const safeUrl = pdfSafeLogoUrl(url);
  if (!safeUrl) return null;
  try {
    const response = await fetch(safeUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!/^image\/(png|jpe?g)$/i.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 24 && buffer.length < 8_000_000 ? buffer : null;
  } catch {
    return null;
  }
}

export async function drawBrandedHeader(doc, agency, label) {
  const brand = resolvedBranding(agency);
  const modern = brand.quotation_template === 'modern';
  const pageWidth = doc.page.width;
  const margin = 48;
  const headerHeight = modern ? 104 : 78;
  const logo = await fetchBrandLogo(brand.logo_url);

  doc.rect(0, 0, pageWidth, headerHeight).fill(brand.primary_color);
  let nameX = margin;
  if (logo) {
    try {
      doc.image(logo, margin, modern ? 23 : 17, { fit: [52, modern ? 58 : 44], align: 'left', valign: 'center' });
      nameX = margin + 64;
    } catch {
      nameX = margin;
    }
  }

  doc.fillColor('#ffffff').fontSize(modern ? 21 : 18).text(brand.agency_name, nameX, modern ? 26 : 24, {
    width: pageWidth - nameX - margin - 120,
    ellipsis: true,
  });
  doc.fontSize(10).fillColor('#ffffff').opacity(0.78).text('Travel Quotation', nameX, modern ? 56 : 48);
  doc.opacity(1).fontSize(10).fillColor('#ffffff').text(label, margin, modern ? 42 : 32, {
    width: pageWidth - margin * 2,
    align: 'right',
  });
  return { brand, headerHeight, contentStartY: headerHeight + 22 };
}

export function brandedFooterText(agency) {
  const brand = resolvedBranding(agency);
  const contact = [brand.phone, brand.email, brand.website].filter(Boolean).join(' · ');
  return [
    `Prepared by ${brand.agency_name}`,
    brand.quotation_footer,
    contact,
  ].filter(Boolean).join(' · ');
}
