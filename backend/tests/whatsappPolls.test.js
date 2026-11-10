import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { handleIncomingLeadMessage, whatsappSenders } from '../controllers/whatsappLead.js';
import { createConversation, updateConversation } from '../services/leads.js';
import {
  datesMatch,
  hotelOptionGroups,
  hotelOptionPoll,
  nextHotelOptionChoice,
  packageDecisionPoll,
  parseHotelOptionChoice,
  tailorPackageQuote,
} from '../services/packageOffer.js';
import { createPredefinedQuote, deletePredefinedQuote, shortestStayNights } from '../services/predefinedQuotes.js';
import {
  chatPhone,
  handlePollResults,
  optionForVote,
  parsePollResults,
  pickPollForVote,
  providerMessageId,
} from '../services/whatsappPolls.js';
import { processPollVote } from '../routes/whatsapp.js';

/** Hotel X sold for 7, 8 or 9 nights from the same day, at three prices. */
const hotelX = (overrides = {}) => ({
  id: 'x',
  title: 'Hotel X October',
  quote_type: 'hotel',
  destination: 'Antalya',
  currency: 'USD',
  travel_date: '2027-10-10',
  return_date: '2027-10-19',
  items: [
    { id: 'x7', item_type: 'hotel', hotel_name: 'Hotel X', room_name: 'Double', board_name: 'All inclusive', nights: 7, check_in: '2027-10-10', check_out: '2027-10-17', price: 700, sort_order: 0 },
    { id: 'x8', item_type: 'hotel', hotel_name: 'Hotel X', room_name: 'Double', board_name: 'All inclusive', nights: 8, check_in: '2027-10-10', check_out: '2027-10-18', price: 800, sort_order: 1 },
    { id: 'x9', item_type: 'hotel', hotel_name: 'Hotel X', room_name: 'Double', board_name: 'All inclusive', nights: 9, check_in: '2027-10-10', check_out: '2027-10-19', price: 900, sort_order: 2 },
  ],
  ...overrides,
});

const pollResults = (options, { id = 'WA-1', jid = '971501234567@s.whatsapp.net' } = {}) => ({
  event: 'poll.results',
  data: {
    key: { id, remoteJid: jid, fromMe: true },
    pollResult: options.map(([name, voters = []]) => ({ name, voters })),
  },
});

describe('one hotel, several stays', () => {
  it('treats the 7, 8 and 9 night versions of a hotel as one choice', () => {
    const groups = hotelOptionGroups(hotelX());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].options.length, 3);
  });

  it('puts the stay that matches the requested dates first', () => {
    const group = nextHotelOptionChoice(hotelX(), { travel_date: '2027-10-10', return_date: '2027-10-18' });
    assert.equal(group.options[0].id, 'x8');
  });

  it('offers the package for a return date that is one of its stays', () => {
    assert.equal(datesMatch({ travel_date: '2027-10-10', return_date: '2027-10-17' }, hotelX()), true);
    assert.equal(datesMatch({ travel_date: '2027-10-10', return_date: '2027-10-19' }, hotelX()), true);
    assert.equal(datesMatch({ travel_date: '2027-10-10', return_date: '2027-10-16' }, hotelX()), false);
    assert.equal(datesMatch({ travel_date: '2027-10-11', return_date: '2027-10-17' }, hotelX()), false);
  });

  it('prices, dates and counts nights from the one stay chosen', () => {
    const tailored = tailorPackageQuote(hotelX(), {}, ['x8']);
    assert.deepEqual(tailored.items.map((item) => item.id), ['x8']);
    assert.equal(tailored.display_total, 800);
    assert.equal(tailored.nights, 8);
    assert.equal(tailored.return_date, '2027-10-18');
  });

  it('counts a period package by its shortest stay, not the sum of the alternatives', () => {
    assert.equal(shortestStayNights(hotelX().items), 7);
    assert.equal(shortestStayNights([...hotelX().items, { hotel_name: 'Hotel Y', nights: 3 }]), 10);
  });
});

describe('a hotel sold as many stay windows (The Parma Taksim)', () => {
  const windows = [
    ['2026-12-24', '2026-12-31', 7], ['2026-12-25', '2026-12-29', 4], ['2026-12-26', '2026-12-30', 4],
    ['2026-12-27', '2026-12-31', 4], ['2026-12-29', '2027-01-05', 7], ['2027-01-02', '2027-01-09', 7],
  ];
  const parma = {
    id: 'parma',
    quote_type: 'hotel',
    destination: 'Istanbul',
    travel_date: '2026-12-24',
    return_date: '2027-01-09',
    items: windows.map(([check_in, check_out, nights], index) => ({
      id: `w${index}`, item_type: 'hotel', hotel_name: 'The Parma Taksim', room_name: 'Double Room',
      check_in, check_out, nights, price: 1399, sort_order: index,
    })),
  };

  it('offers only the window that starts on the requested check-in, so there is nothing to ask', () => {
    const demand = { travel_date: '2026-12-24', return_date: '2026-12-31' };
    assert.equal(nextHotelOptionChoice(parma, demand), null);
    const tailored = tailorPackageQuote(parma, demand, []);
    assert.deepEqual(tailored.items.map((item) => item.id), ['w0']);
    assert.equal(tailored.display_total, 1399);
  });

  it('labels the windows by their dates when they start on different days', () => {
    const group = nextHotelOptionChoice(parma, { travel_date: '2026-12-28', return_date: '2027-01-01' });
    const labels = hotelOptionPoll(group).options.map((option) => option.label);
    assert.equal(labels.length, 6, 'no window starts on the 28th, so all are offered');
    assert.equal(new Set(labels).size, 6);
    assert.ok(labels.every((label) => !/\(\d+\)$/.test(label)), 'no "(3)" suffixes needed');
    assert.ok(labels.includes('Double Room · 25 Dec → 29 Dec · 4 nights · USD 1,399'));
  });
});

describe('several hotels, or rooms, for the same nights', () => {
  const stay = (id, hotel_name, room_name, price, check_in = '2026-12-24', check_out = '2026-12-31') => ({
    id, item_type: 'hotel', hotel_name, room_name, check_in, check_out, nights: 7, price,
  });
  const newYear = {
    id: 'ny', quote_type: 'hotel', destination: 'Istanbul', travel_date: '2026-12-24', return_date: '2026-12-31',
    total_price: 1399,
    items: [stay('p', 'The Parma Taksim', null, 1399), stay('k', 'Kent Hotel', null, 1399), stay('r', 'Ryalin Old Town', null, 1249)],
  };
  const demand = { travel_date: '2026-12-24', return_date: '2026-12-31', adults_count: 2, children_count: 0 };

  it('asks which hotel, instead of booking a stay in all of them', () => {
    const group = nextHotelOptionChoice(newYear, demand);
    assert.equal(group.choice, 'hotel');
    const poll = hotelOptionPoll(group);
    assert.equal(poll.question, 'Which hotel would you like?');
    assert.deepEqual(poll.options.map((option) => option.value).sort(), ['k', 'p', 'r']);
    assert.ok(poll.options.some((option) => option.label === 'Kent Hotel · 7 nights · USD 1,399'));
  });

  it('books only the hotel chosen, at its own price', () => {
    const tailored = tailorPackageQuote(newYear, demand, ['k']);
    assert.deepEqual(tailored.items.map((item) => item.id), ['k']);
    assert.equal(tailored.display_total, 1399);
    assert.equal(tailored.nights, 7);
    assert.equal(nextHotelOptionChoice(newYear, demand, ['k']), null, 'nothing left to ask');
  });

  it('asks for the room when one hotel has several rooms for those nights', () => {
    const rooms = { ...newYear, items: [stay('d', 'Kent Hotel', 'Double Room', 1399), stay('t', 'Kent Hotel', 'Triple Room', 1650), stay('f', 'Kent Hotel', 'Family Suite', 1990)] };
    const group = nextHotelOptionChoice(rooms, demand);
    assert.equal(group.choice, undefined);
    const poll = hotelOptionPoll(group);
    assert.match(poll.question, /^Kent Hotel — choose one option/);
    assert.deepEqual(poll.options.map((option) => option.label), [
      'Double Room · 7 nights · USD 1,399', 'Triple Room · 7 nights · USD 1,650', 'Family Suite · 7 nights · USD 1,990',
    ]);
    assert.deepEqual(tailorPackageQuote(rooms, demand, ['t']).items.map((item) => item.id), ['t']);
  });

  it('keeps hotels on consecutive nights as one trip (a split stay)', () => {
    const split = {
      ...newYear,
      items: [stay('a', 'Atlantis', null, 900, '2026-11-01', '2026-11-04'), stay('j', 'Jumeirah', null, 500, '2026-11-04', '2026-11-06')],
    };
    assert.equal(nextHotelOptionChoice(split, { travel_date: '2026-11-01', return_date: '2026-11-06' }), null);
    assert.equal(hotelOptionGroups(split).length, 2);
  });

  it('joins a hotel that overlaps two others into the same choice', () => {
    const bridged = {
      ...newYear,
      items: [stay('a', 'A', null, 1, '2026-12-01', '2026-12-04'), stay('c', 'C', null, 1, '2026-12-05', '2026-12-08'), stay('b', 'B', null, 1, '2026-12-03', '2026-12-06')],
    };
    const groups = hotelOptionGroups(bridged);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].hotels, ['A', 'C', 'B']);
  });
});

describe('the hotel option poll', () => {
  const group = hotelOptionGroups(hotelX())[0];

  it('lists each option with its stay and price, standing for its item id', () => {
    const poll = hotelOptionPoll(group);
    assert.match(poll.question, /Hotel X/);
    assert.deepEqual(poll.options.map((option) => option.value), ['x7', 'x8', 'x9']);
    assert.equal(poll.options[0].label, 'Double · All inclusive · 7 nights · USD 700');
    assert.equal(poll.options[2].label, 'Double · All inclusive · 9 nights · USD 900');
  });

  it('keeps labels distinct, since votes come back as label text', () => {
    const twins = { hotel_name: 'Twin', options: [{ id: 'a', room_name: 'Room', price: 1 }, { id: 'b', room_name: 'Room', price: 1 }] };
    const labels = hotelOptionPoll(twins).options.map((option) => option.label);
    assert.equal(new Set(labels).size, 2);
  });

  it('is skipped beyond WhatsApp’s 12 options, so the numbered text is sent instead', () => {
    const many = { hotel_name: 'Big', options: Array.from({ length: 13 }, (_, i) => ({ id: `o${i}`, room_name: `Room ${i}` })) };
    assert.equal(hotelOptionPoll(many), null);
    assert.equal(hotelOptionPoll({ hotel_name: 'One', options: [{ id: 'a' }] }), null);
  });

  it('is in Arabic for an Arabic conversation', () => {
    assert.match(hotelOptionPoll(group, 'ar').options[0].label, /ليال/);
    assert.match(packageDecisionPoll('ar').options[0].label, /نعم/);
  });

  it('reads a typed answer as the option number or the stay — never a number inside the text', () => {
    assert.equal(parseHotelOptionChoice('2', group).id, 'x8');
    assert.equal(parseHotelOptionChoice('option 3', group).id, 'x9');
    assert.equal(parseHotelOptionChoice('7 nights please', group).id, 'x7', '"7" is the stay, not option 7');
    assert.equal(parseHotelOptionChoice('the 9 night one', group).id, 'x9');
    assert.equal(parseHotelOptionChoice('maybe', group), null);
  });
});

describe('reading poll votes', () => {
  const stored = {
    id: 'p1',
    phone: '971501234567',
    kind: 'hotel_option',
    provider_message_id: 'WA-1',
    options: [
      { label: '7 nights · USD 700', value: 'x7' },
      { label: '8 nights · USD 800', value: 'x8' },
    ],
  };

  it('takes the phone number from a normal chat id only', () => {
    assert.equal(chatPhone('971501234567@s.whatsapp.net'), '971501234567');
    assert.equal(chatPhone('971501234567:12@s.whatsapp.net'), '971501234567');
    assert.equal(chatPhone('1203630000@g.us'), null);
    assert.equal(chatPhone('8823749234@lid'), null);
  });

  it('parses the webhook and finds the voted option by its stored value', () => {
    const result = parsePollResults(pollResults([['7 nights · USD 700'], ['8 nights · USD 800', ['971501234567@s.whatsapp.net']]]));
    assert.equal(result.messageId, 'WA-1');
    assert.deepEqual(optionForVote(stored, result), { label: '8 nights · USD 800', value: 'x8' });
  });

  it('matches the poll by message id, then by phone, and never a poll with other options', () => {
    const vote = parsePollResults(pollResults([['7 nights · USD 700', ['v']], ['8 nights · USD 800']]));
    const other = { ...stored, id: 'p2', phone: '971509999999', provider_message_id: null };
    assert.equal(pickPollForVote(vote, [other, stored]).id, 'p1');

    const byPhone = parsePollResults(pollResults([['7 nights · USD 700', ['v']], ['8 nights · USD 800']], { id: 'unknown' }));
    assert.equal(pickPollForVote(byPhone, [other, stored]).id, 'p1');

    const different = parsePollResults(pollResults([['Yes', ['v']], ['No']]));
    assert.equal(pickPollForVote(different, [stored]), null);
  });

  it('takes the phone from the voter id when the chat id is hidden, and tolerates spacing changes', () => {
    const vote = parsePollResults(
      pollResults([['7 nights  ·  USD 700', ['971501234567@s.whatsapp.net']], ['8 nights · USD 800']], { id: 'x', jid: '88@lid' }),
    );
    const other = { ...stored, id: 'p9', phone: '971509999999', provider_message_id: null };
    assert.equal(pickPollForVote(vote, [other, stored]).id, 'p1');
    assert.equal(optionForVote(stored, vote).value, 'x7');
  });

  it('never lets a known number answer someone else’s poll', () => {
    const vote = parsePollResults(pollResults([['7 nights · USD 700', ['v']], ['8 nights · USD 800']], { id: 'x', jid: '971500000001@s.whatsapp.net' }));
    assert.equal(pickPollForVote(vote, [stored]), null);
  });

  it('uses a hidden-id (@lid) vote only when one open poll has those options', () => {
    const lid = parsePollResults(pollResults([['7 nights · USD 700', ['v']], ['8 nights · USD 800']], { id: 'x', jid: '88@lid' }));
    assert.equal(pickPollForVote(lid, [stored]).id, 'p1');
    assert.equal(pickPollForVote(lid, [stored, { ...stored, id: 'p3', phone: '971500000000' }]), null);
  });

  it('reads the message id Wasender returns for a sent message', () => {
    assert.equal(providerMessageId({ data: { msgId: 100000 } }), '100000');
    assert.equal(providerMessageId({ data: { key: { id: 'ABC' } } }), 'ABC');
    assert.equal(providerMessageId({}), null);
  });

  it('acts on a vote once, and ignores a poll with no single vote', async () => {
    const choices = [];
    let open = true;
    const deps = {
      findOpen: async () => (open ? [stored] : []),
      claim: async (id, value) => (open ? ((open = false), { ...stored, answer_value: value }) : null),
      onChoice: async (vote) => choices.push(vote.option.value),
    };
    const voted = pollResults([['7 nights · USD 700'], ['8 nights · USD 800', ['971501234567@s.whatsapp.net']]]);
    assert.equal(await handlePollResults(pollResults([['7 nights · USD 700'], ['8 nights · USD 800']]), deps), 'no_single_vote');
    assert.equal(await handlePollResults(voted, deps), 'handled');
    assert.equal(await handlePollResults(voted, deps), 'no_open_poll');
    assert.deepEqual(choices, ['x8']);
  });
});

describe('WhatsApp flow with polls', () => {
  const quoteIds = [];
  const phones = [];
  let sent;
  const realSenders = { ...whatsappSenders };

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  beforeEach(() => {
    sent = [];
    whatsappSenders.text = async (to, text) => {
      sent.push({ type: 'text', to, text });
      return { data: { msgId: sent.length } };
    };
    whatsappSenders.poll = async (to, poll) => {
      sent.push({ type: 'poll', to, ...poll });
      return { data: { msgId: `poll-${sent.length}` } };
    };
  });

  after(async () => {
    Object.assign(whatsappSenders, realSenders);
    if (phones.length) {
      await query(`DELETE FROM whatsapp_polls WHERE phone = ANY($1::text[])`, [phones]);
      await query(`DELETE FROM messages WHERE from_number = ANY($1::text[]) OR to_number = ANY($1::text[])`, [phones]);
      await query(`DELETE FROM leads WHERE phone = ANY($1::text[])`, [phones]);
      await query(`DELETE FROM conversations WHERE phone = ANY($1::text[])`, [phones]);
    }
    for (const id of quoteIds) await deletePredefinedQuote(id);
    try {
      const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
      await getHotelQuoteQueue().close();
    } catch {
      /* ignore */
    }
  });

  async function startWithCompleteRequest(destination, phone, dates) {
    const conversation = await createConversation(phone);
    await updateConversation(conversation.id, {
      collected: {
        booking_type: 'hotel',
        destination,
        ...dates,
        adults_count: 2,
        children_count: 0,
        children_ages: [],
      },
      language: 'en',
      status: 'active',
    });
  }

  /** What Wasender would post when the customer taps `label` on the last poll sent. */
  function voteOn(label, phone) {
    const poll = sent.filter((message) => message.type === 'poll').pop();
    return pollResults(
      poll.options.map((name) => [name, name === label ? [`${phone}@s.whatsapp.net`] : []]),
      { id: 'not-the-same-id', jid: `${phone}@s.whatsapp.net` },
    );
  }

  it('sends the hotel’s stays as a poll, books only the one voted for, and takes YES by poll', async () => {
    const destination = `PollCity${Date.now()}`;
    const phone = `97155${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const { id, ...fields } = hotelX({ destination, title: `${destination} Hotel X` });
    const quote = await createPredefinedQuote({
      ...fields,
      items: fields.items.map(({ id: itemId, ...item }) => item),
    });
    quoteIds.push(quote.id);
    const itemFor = (nights) => quote.items.find((item) => Number(item.nights) === nights);

    await startWithCompleteRequest(destination, phone, { travel_date: '2027-10-10', return_date: '2027-10-17' });
    const asked = await handleIncomingLeadMessage({ from: phone, text: 'ok' });
    assert.equal(asked.awaiting_hotel_option, true);

    const optionsPoll = sent.find((message) => message.type === 'poll');
    assert.ok(optionsPoll, 'the options go out as a WhatsApp poll');
    assert.equal(optionsPoll.options.length, 3);
    assert.match(optionsPoll.options[0], /7 nights · USD 700/, 'the stay matching the dates comes first');
    assert.equal(sent.filter((message) => message.type === 'text').length, 0, 'no numbered text list as well');

    const stored = (await query(`SELECT * FROM whatsapp_polls WHERE phone = $1 AND status = 'open'`, [phone])).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kind, 'hotel_option');

    // The customer prefers 9 nights after all, and taps it.
    const nineNights = optionsPoll.options.find((label) => /9 nights/.test(label));
    const vote = voteOn(nineNights, phone);
    sent = [];
    assert.equal(await processPollVote(vote), 'handled');
    assert.equal(await processPollVote(vote), 'no_open_poll', 'Wasender re-sending the result changes nothing');

    const [details, decision] = sent;
    assert.equal(details.type, 'text');
    assert.match(details.text, /9 nights/);
    assert.match(details.text, /USD 900/);
    assert.doesNotMatch(details.text, /USD 700|USD 800/, 'only the chosen stay is offered');
    assert.doesNotMatch(details.text, /Reply YES/, 'the YES / NO question is the poll');
    assert.equal(decision.type, 'poll');
    assert.deepEqual(decision.options, ['Yes, book this package', 'No, search other hotels']);

    const yes = voteOn('Yes, book this package', phone);
    sent = [];
    assert.equal(await processPollVote(yes), 'handled');
    const lead = (await query(`SELECT * FROM leads WHERE phone = $1`, [phone])).rows[0];
    assert.equal(lead.predefined_quote_id, quote.id);
    assert.deepEqual(lead.raw_collected._selected_package_item_ids, [String(itemFor(9).id)]);
    assert.match(sent[0].text, /attached to your request/);

    const inbox = (await query(`SELECT body, raw FROM messages WHERE from_number = $1 AND direction = 'inbound' ORDER BY created_at`, [phone])).rows;
    assert.ok(inbox.some((row) => row.body === nineNights && row.raw.poll_vote), 'the vote shows in the inbox');
  });

  it('falls back to the numbered text question when the poll can’t be sent, and a typed number still works', async () => {
    const destination = `PollFail${Date.now()}`;
    const phone = `97156${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const { id, ...fields } = hotelX({ destination, title: `${destination} Hotel X` });
    const quote = await createPredefinedQuote({ ...fields, items: fields.items.map(({ id: itemId, ...item }) => item) });
    quoteIds.push(quote.id);

    whatsappSenders.poll = async () => {
      throw new Error('Wasender poll send failed (422)');
    };
    await startWithCompleteRequest(destination, phone, { travel_date: '2027-10-10', return_date: '2027-10-18' });
    await handleIncomingLeadMessage({ from: phone, text: 'ok' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /1\. Double · All inclusive · 8 nights · USD 800 — recommended/);
    const polls = (await query(`SELECT status FROM whatsapp_polls WHERE phone = $1`, [phone])).rows;
    assert.deepEqual(polls.map((row) => row.status), ['failed']);

    sent = [];
    const priced = await handleIncomingLeadMessage({ from: phone, text: '3' });
    assert.equal(priced.awaiting_hotel_option, false);
    assert.match(sent.map((message) => message.text).join('\n'), /9 nights.*USD 900|USD 900/s);
  });

  it('does not treat a stale vote as a request, and tells the customer to ask again', async () => {
    const phone = `97157${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    await createConversation(phone);
    const result = await handleIncomingLeadMessage({
      from: phone,
      text: 'Yes, book this package',
      choice: { kind: 'package_decision', value: 'yes' },
    });
    assert.equal(result.ignored_vote, true);
    assert.equal(result.lead, undefined, 'no lead is made from the option text');
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /no longer open/);
  });

  it('still takes a vote cast after the conversation timed out', async () => {
    const destination = `PollLate${Date.now()}`;
    const phone = `97158${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const { id, ...fields } = hotelX({ destination, title: `${destination} Hotel X` });
    const quote = await createPredefinedQuote({ ...fields, items: fields.items.map(({ id: itemId, ...item }) => item) });
    quoteIds.push(quote.id);

    await startWithCompleteRequest(destination, phone, { travel_date: '2027-10-10', return_date: '2027-10-17' });
    await handleIncomingLeadMessage({ from: phone, text: 'ok' });
    const label = sent.find((message) => message.type === 'poll').options.find((name) => /8 nights/.test(name));
    const vote = voteOn(label, phone);

    // The customer taps an hour later; the conversation has expired in the meantime.
    await query(
      `UPDATE conversations SET status = 'expired', updated_at = NOW() - interval '1 hour' WHERE phone = $1`,
      [phone],
    );
    sent = [];
    assert.equal(await processPollVote(vote), 'handled');
    assert.match(sent[0].text, /8 nights/);
    assert.match(sent[0].text, /USD 800/);
    assert.doesNotMatch(sent.map((message) => message.text || '').join(' '), /timed out|start again/);
  });
});
