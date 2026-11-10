/** Customer-safe view of a locked quote. Never expose supplier costs or markup. */
export function publicQuoteSnapshot(value) {
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value || {};
  const lead = snapshot.lead || {};
  return {
    title: snapshot.title,
    version_number: snapshot.version_number,
    currency: snapshot.currency,
    notes: snapshot.notes,
    valid_until: snapshot.valid_until,
    lead: {
      destination: lead.destination,
      origin: lead.origin,
      travel_date: lead.travel_date,
      return_date: lead.return_date,
      nights: lead.nights,
      adults_count: lead.adults_count,
      children_count: lead.children_count,
      customer_name: lead.customer_name,
      booking_type: lead.booking_type,
    },
    items: (Array.isArray(snapshot.items) ? snapshot.items : []).map((item) => {
      const meta = item.meta || {};
      return {
        label: item.label,
        description: item.description,
        quantity: item.quantity,
        meta: {
          hotel_name: meta.hotel_name,
          room_type: meta.room_type,
          board_name: meta.board_name,
          check_in: meta.check_in,
          check_out: meta.check_out,
          nights: meta.nights,
          airline: meta.airline,
          cancellation_policy: meta.cancellation_policy,
          cancellation_terms: meta.cancellation_terms,
          includes: meta.includes,
        },
      };
    }),
    pricing: { selling_price: snapshot.pricing?.selling_price },
  };
}
