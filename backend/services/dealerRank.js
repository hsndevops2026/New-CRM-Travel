export function pickBestDealerOffer(offers = []) {
  const usable = offers.filter((row) => row?.id);
  if (!usable.length) return null;

  const score = (row) => {
    const ext = row.extracted || {};
    const total = Number(ext.total_price);
    const perNight = Number(ext.price_per_night);
    const price = Number.isFinite(total)
      ? total
      : Number.isFinite(perNight)
        ? perNight
        : Number.POSITIVE_INFINITY;
    const board = String(ext.board_name || '').toLowerCase();
    const boardBonus = /half|breakfast|all.?inclusive|\bhb\b|\bfb\b/.test(board) ? 0 : 1;
    const cancel = String(ext.cancellation_terms || '').toLowerCase();
    const cancelPenalty = /non.?refund|no refund/.test(cancel) ? 1 : 0;
    return { price, boardBonus, cancelPenalty };
  };

  const sorted = [...usable].sort((a, b) => {
    const left = score(a);
    const right = score(b);
    if (left.price !== right.price) return left.price - right.price;
    if (left.boardBonus !== right.boardBonus) return left.boardBonus - right.boardBonus;
    return left.cancelPenalty - right.cancelPenalty;
  });

  const winner = sorted[0];
  const ext = winner.extracted || {};
  const priceLabel = ext.total_price != null ? ` (${ext.total_price}${ext.currency ? ` ${ext.currency}` : ''})` : '';
  const hotel = ext.hotel_name ? ` at ${ext.hotel_name}` : '';
  return {
    id: winner.id,
    reason: `Lowest price${priceLabel}${hotel}, considering board and cancellation.`,
  };
}
