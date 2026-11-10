import { query } from '../config/database.js';

export async function replaceLeadQuotes(leadId, result) {
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];

  await query(`DELETE FROM flight_quotes WHERE lead_id = $1`, [leadId]);

  for (const quote of quotes) {
    await query(
      `INSERT INTO flight_quotes (
        lead_id,
        external_id,
        price,
        currency,
        outbound,
        inbound,
        raw
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        leadId,
        quote.id || null,
        quote.price,
        quote.currency || 'USD',
        JSON.stringify(quote.outbound || null),
        JSON.stringify(quote.inbound || null),
        JSON.stringify(quote),
      ],
    );
  }

  return quotes.length;
}

export async function listQuotesForLead(leadId) {
  const result = await query(
    `SELECT id, lead_id, external_id, price, currency, outbound, inbound, created_at
     FROM flight_quotes
     WHERE lead_id = $1
     ORDER BY price NULLS LAST, created_at ASC`,
    [leadId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    external_id: row.external_id,
    price: row.price != null ? Number(row.price) : null,
    currency: row.currency || 'USD',
    outbound: row.outbound,
    inbound: row.inbound,
    created_at: row.created_at,
  }));
}
