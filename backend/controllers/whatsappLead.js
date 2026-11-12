import { handleRatingReply } from '../services/automations.js';
import { notifyCustomerMessage, notifyNewLead, safeNotify } from '../services/notifications.js';
import { getAiHandover, hasArabic, isHumanRequest, pauseAi } from '../services/aiHandover.js';
import { getCustomerText } from '../services/customerTexts.js';
import {
  getActiveConversationOrExpire,
  createConversation,
  updateConversation,
  createLead,
  getLeadById,
  attachPredefinedQuoteToLead,
  startQuoteFetchForLead,
  findLatestLeadByPhone,
  declinePackageOffer,
  reopenConversationForVote,
} from '../services/leads.js';
import { processUserMessage, getMissingFields } from '../services/openaiLead.js';
import { sendPollMessage, sendTextMessage } from '../services/wasender.js';
import {
  closePoll,
  openPoll,
  providerMessageId,
  setPollProviderMessageId,
} from '../services/whatsappPolls.js';
import {
  findMessageByProviderId,
  saveMessage,
  linkConversationMessagesToLead,
} from '../services/messages.js';
import { handleIncomingDealerReply } from '../services/dealerRequests.js';
import { isDealerReplyMessage } from '../utils/dealerReply.js';
import { getPredefinedQuote } from '../services/predefinedQuotes.js';
import {
  clearPackageOffer,
  findMatchingPackage,
  finishHotelOptionSelection,
  formatHotelOptionQuestion,
  formatPackageOfferMessage,
  hotelOptionPoll,
  nextHotelOptionChoice,
  packageDecisionPoll,
  parseHotelOptionChoice,
  parsePackageDecision,
  pendingHotelOptionSelection,
  pendingPackageOffer,
  searchLabel,
  selectedPackageItemIds,
  tailorPackageQuote,
  withHotelOptionSelection,
  withPackageOffer,
} from '../services/packageOffer.js';

function normalizePhone(phone) {
  return String(phone || '')
    .replace(/@.*$/, '')
    .replace(/[^\d+]/g, '');
}

function idleMinutes() {
  const minutes = Number(process.env.CONVERSATION_IDLE_MINUTES || 5);
  return Math.max(1, Number.isFinite(minutes) ? minutes : 5);
}

/** How replies reach WhatsApp. Tests swap these for fakes. */
export const whatsappSenders = { text: sendTextMessage, poll: sendPollMessage };

async function persistOutbound(phone, body, { leadId = null, conversationId = null, raw = {} } = {}) {
  try {
    const resolvedLeadId = leadId || (await findLatestLeadByPhone(phone))?.id || null;
    await saveMessage({
      leadId: resolvedLeadId,
      conversationId,
      direction: 'outbound',
      channel: 'whatsapp',
      toNumber: phone,
      body,
      status: 'sent',
      raw: { kind: 'customer', ...raw },
    });
  } catch (error) {
    console.error('Failed to persist outbound message:', error.message);
  }
}

export async function replyToUser(phone, text, skipWhatsApp, { leadId = null, conversationId = null } = {}) {
  if (!skipWhatsApp && text) {
    try {
      await whatsappSenders.text(phone, text);
      console.log('Reply sent:', text);
    } catch (error) {
      console.error('Failed to send WhatsApp reply:', error.message);
    }
  }
  if (!text) return;
  await persistOutbound(phone, text, { leadId, conversationId });
}

/**
 * Asks the customer to pick one option, as a WhatsApp poll (Wasender has no buttons).
 * The poll is stored first so its vote can be mapped back to `option.value`. If the poll
 * can't be sent, or there is none (more than 12 options, the CRM simulator), the numbered
 * `text` question goes instead — typed answers are understood either way.
 */
async function askWithPoll(phone, { text, poll, kind, context = {} }, skipWhatsApp, { leadId = null, conversationId = null } = {}) {
  if (skipWhatsApp || !poll) {
    await replyToUser(phone, text, skipWhatsApp, { leadId, conversationId });
    return;
  }

  let stored = null;
  try {
    stored = await openPoll({
      phone,
      conversationId,
      leadId,
      kind,
      question: poll.question,
      options: poll.options,
      context,
    });
    const response = await whatsappSenders.poll(phone, {
      question: poll.question,
      options: poll.options.map((option) => option.label),
    });
    await setPollProviderMessageId(stored.id, providerMessageId(response));
    console.log(`Poll sent (${kind}):`, poll.question);
  } catch (error) {
    console.error('Failed to send WhatsApp poll, sending the question as text:', error.message);
    if (stored) await closePoll(stored.id, 'failed').catch(() => {});
    await replyToUser(phone, text, skipWhatsApp, { leadId, conversationId });
    return;
  }

  const body = [`📊 ${poll.question}`, ...poll.options.map((option) => `○ ${option.label}`)].join('\n');
  await persistOutbound(phone, body, {
    leadId,
    conversationId,
    raw: { poll: { id: stored.id, kind, question: poll.question, options: poll.options.map((option) => option.label) } },
  });
}

/** Sends one hotel's options as a poll; returns the text form for the API result. */
async function askHotelOption(phone, { quote, group, language }, skipWhatsApp, ids) {
  const text = formatHotelOptionQuestion(group, language);
  await askWithPoll(
    phone,
    { text, poll: hotelOptionPoll(group, language), kind: 'hotel_option', context: { package_id: quote.id, hotel: group.hotel_name } },
    skipWhatsApp,
    ids,
  );
  return text;
}

/**
 * Sends a package offer: its details as a message, then YES / NO as a poll. Returns the
 * whole offer as text (with the YES / NO line) for the API result and the simulator.
 */
async function sendPackageOffer(phone, { quote, language, kind }, skipWhatsApp, ids) {
  const full = formatPackageOfferMessage(quote, language, { kind });
  if (skipWhatsApp) {
    await replyToUser(phone, full, true, ids);
    return full;
  }
  await replyToUser(phone, formatPackageOfferMessage(quote, language, { kind, question: false }), false, ids);
  const question = full.split('\n').pop();
  await askWithPoll(
    phone,
    { text: question, poll: packageDecisionPoll(language, kind), kind: 'package_decision', context: { package_id: quote.id } },
    false,
    ids,
  );
  return full;
}

function packagePayload(quote) {
  if (!quote) return null;
  return { id: quote.id, title: quote.title, destination: quote.destination };
}

async function handleHotelOptionDecision({ conversation, phone, text, choice, skipWhatsApp, source }) {
  const pending = pendingHotelOptionSelection(conversation.collected);
  if (!pending) return null;

  const language = conversation.language || 'en';
  const quote = await getPredefinedQuote(pending.packageId);
  const lead = await getLeadById(pending.leadId);
  if (!quote || !lead) return null;

  const group = nextHotelOptionChoice(quote, conversation.collected, pending.selectedItemIds);
  if (!group) {
    const tailored = tailorPackageQuote(quote, conversation.collected, pending.selectedItemIds);
    const collected = finishHotelOptionSelection(conversation.collected, tailored.selected_item_ids);
    await updateConversation(conversation.id, { collected, status: 'active' });
    const reply = await sendPackageOffer(
      phone,
      { quote: tailored, language, kind: lead.booking_type || 'hotel' },
      skipWhatsApp,
      { leadId: lead.id, conversationId: conversation.id },
    );
    return {
      phone,
      complete: false,
      missing: [],
      collected,
      reply,
      restart_notice: null,
      restarted: false,
      lead,
      awaiting_package: true,
      awaiting_hotel_option: false,
      predefined_quote: packagePayload(tailored),
      source,
    };
  }

  // A poll vote names the option's item id; a typed reply is read as a number or name.
  const chosen =
    choice?.kind === 'hotel_option'
      ? group.options.find((item) => String(item.id) === String(choice.value)) || null
      : choice
        ? null
        : parseHotelOptionChoice(text, group);
  if (!chosen) {
    const reply = await askHotelOption(phone, { quote, group, language }, skipWhatsApp, { leadId: lead.id, conversationId: conversation.id });
    return {
      phone,
      complete: false,
      missing: [],
      collected: conversation.collected,
      reply,
      restart_notice: null,
      restarted: false,
      lead,
      awaiting_package: true,
      awaiting_hotel_option: true,
      predefined_quote: packagePayload(quote),
      source,
    };
  }

  const selected = [...pending.selectedItemIds, String(chosen.id)];
  const nextGroup = nextHotelOptionChoice(quote, conversation.collected, selected);
  if (nextGroup) {
    const collected = withHotelOptionSelection(conversation.collected, {
      packageId: pending.packageId,
      leadId: pending.leadId,
      selectedItemIds: selected,
    });
    await updateConversation(conversation.id, { collected, status: 'active' });
    const reply = await askHotelOption(phone, { quote, group: nextGroup, language }, skipWhatsApp, { leadId: lead.id, conversationId: conversation.id });
    return {
      phone,
      complete: false,
      missing: [],
      collected,
      reply,
      restart_notice: null,
      restarted: false,
      lead,
      awaiting_package: true,
      awaiting_hotel_option: true,
      predefined_quote: packagePayload(quote),
      source,
    };
  }

  const tailored = tailorPackageQuote(quote, conversation.collected, selected);
  const collected = finishHotelOptionSelection(conversation.collected, tailored.selected_item_ids);
  await updateConversation(conversation.id, { collected, status: 'active' });
  const reply = await sendPackageOffer(
    phone,
    { quote: tailored, language, kind: lead.booking_type || 'hotel' },
    skipWhatsApp,
    { leadId: lead.id, conversationId: conversation.id },
  );
  return {
    phone,
    complete: false,
    missing: [],
    collected,
    reply,
    restart_notice: null,
    restarted: false,
    lead,
    awaiting_package: true,
    awaiting_hotel_option: false,
    predefined_quote: packagePayload(tailored),
    source,
  };
}

async function handlePackageDecision({ conversation, phone, text, choice, skipWhatsApp, source }) {
  const pending = pendingPackageOffer(conversation.collected);
  if (!pending) return null;

  const language = conversation.language || 'en';
  const decision =
    choice?.kind === 'package_decision' && ['yes', 'no'].includes(choice.value)
      ? choice.value
      : choice
        ? null
        : parsePackageDecision(text);
  const quote = await getPredefinedQuote(pending.packageId);
  const lead = await getLeadById(pending.leadId);

  if (!decision) {
    const kind = lead?.booking_type || 'hotel';
    const search = searchLabel(kind, language);
    const reply =
      language === 'ar'
        ? `من فضلك أجب بنعم لأخذ هذه الباقة، أو لا للبحث عن ${search} كالمعتاد.`
        : `Please reply YES to take this package, or NO to search ${search} as usual.`;
    await askWithPoll(
      phone,
      { text: reply, poll: packageDecisionPoll(language, kind), kind: 'package_decision', context: { package_id: pending.packageId } },
      skipWhatsApp,
      { leadId: pending.leadId, conversationId: conversation.id },
    );
    return {
      phone,
      complete: false,
      missing: [],
      collected: conversation.collected,
      reply,
      restart_notice: null,
      restarted: false,
      lead,
      awaiting_package: true,
      predefined_quote: packagePayload(quote),
    };
  }

  const collected = clearPackageOffer(conversation.collected);

  if (decision === 'yes') {
    const selectedItemIds = selectedPackageItemIds(conversation.collected);
    const attached = quote
      ? await attachPredefinedQuoteToLead(pending.leadId, quote.id, { selectedItemIds })
      : lead;
    await updateConversation(conversation.id, {
      collected,
      status: 'completed',
    });
    const reply =
      language === 'ar'
        ? 'رائع، تم ربط طلبك بهذه الباقة. سيتواصل معك مندوبنا قريباً.'
        : 'Great — this package is now attached to your request. Our agent will contact you soon.';
    await replyToUser(phone, reply, skipWhatsApp, {
      leadId: pending.leadId,
      conversationId: conversation.id,
    });
    console.log('Package accepted for lead:', pending.leadId, quote?.id);
    return {
      phone,
      complete: true,
      missing: [],
      collected,
      reply,
      restart_notice: null,
      restarted: false,
      lead: attached,
      awaiting_package: false,
      awaiting_hotel_option: false,
      predefined_quote: packagePayload(quote),
      source,
    };
  }

  const currentLead = await getLeadById(pending.leadId);
  const liveLead = currentLead?.pending_package_offer_id
    ? await declinePackageOffer(pending.leadId)
    : await startQuoteFetchForLead(pending.leadId);
  await updateConversation(conversation.id, {
    collected,
    status: 'completed',
  });
  const searching = searchLabel(lead?.booking_type, language);
  const reply =
    language === 'ar'
      ? `حسناً، سنبحث عن ${searching} حسب تواريخك. سيتواصل معك مندوبنا قريباً.`
      : `Okay — we will search ${searching} for your dates. Our agent will contact you soon.`;
  await replyToUser(phone, reply, skipWhatsApp, {
    leadId: pending.leadId,
    conversationId: conversation.id,
  });
  console.log('Package declined for lead:', pending.leadId);
  return {
    phone,
    complete: true,
    missing: [],
    collected,
    reply,
    restart_notice: null,
    restarted: false,
    lead: liveLead,
    awaiting_package: false,
    awaiting_hotel_option: false,
    predefined_quote: null,
    source,
  };
}

/**
 * Handle one inbound WhatsApp text message for travel lead collection.
 * @param {{ from: string, text: string, skipWhatsApp?: boolean, source?: string,
 *   providerMessageId?: string, messageMeta?: object,
 *   choice?: { kind: 'hotel_option'|'package_decision', value: string, conversationId?: string } }} opts
 *   `messageMeta` is merged into the stored inbound message's `raw` (e.g. to mark a
 *   transcribed voice note) and surfaces to the inbox as `meta`.
 *   `choice` is a WhatsApp poll vote, already mapped to what the option stands for (a
 *   package item id, or yes / no). `text` is then the option's label, kept for the inbox.
 */
export async function handleIncomingLeadMessage({
  from,
  text,
  skipWhatsApp = false,
  source = 'whatsapp',
  providerMessageId = null,
  messageMeta = {},
  choice = null,
}) {
  const phone = normalizePhone(from);
  const messageText = (text || '').trim();

  if (!phone || !messageText) {
    console.log('Skipping empty phone/text message');
    return null;
  }

  // Dealer RFQ replies (REQ-XXXXXX) must not start customer intake.
  if (isDealerReplyMessage(messageText)) {
    console.log(`[whatsapp] routing dealer reply from ${phone}: ${messageText.slice(0, 80)}`);
    const result = await handleIncomingDealerReply({
      from: phone,
      groupId: '',
      text: messageText,
      messageId: providerMessageId,
      raw: {},
      skipWhatsApp,
    });
    return {
      phone,
      complete: false,
      missing: [],
      collected: {},
      reply: skipWhatsApp
        ? ''
        : '✅ Dealer quote received. Our team will review it shortly.',
      dealer_reply: true,
      ...result,
    };
  }

  console.log(`Processing lead message from ${phone}: ${messageText}`);

  // A poll vote answers the conversation the poll was sent in, even if it has since timed out.
  if (choice?.conversationId) {
    const reopened = await reopenConversationForVote(choice.conversationId, phone);
    console.log(`[poll] vote for conversation ${choice.conversationId}: ${reopened ? 'open' : 'superseded'}`);
  }

  const { conversation: existing, restarted } = await getActiveConversationOrExpire(phone);
  let conversation = existing;
  let restartNotice = null;

  if (!conversation) {
    conversation = await createConversation(phone);
    if (restarted) {
      restartNotice = `Your previous booking request timed out after ${idleMinutes()} minutes of inactivity. Let's start again — how can I help you today?`;
      await replyToUser(phone, restartNotice, skipWhatsApp, { conversationId: conversation.id });
    }
  }

  const existingLead = await findLatestLeadByPhone(phone);

  // Queued jobs are retried, and a retry re-enters here with the same WhatsApp
  // message id. If the inbound row is already stored, inserting it again would show
  // the customer's message twice in the inbox.
  const alreadyStored = providerMessageId
    ? await findMessageByProviderId(providerMessageId)
    : null;
  if (!alreadyStored) {
    await saveMessage({
      leadId: existingLead?.id || null,
      conversationId: conversation.id,
      direction: 'inbound',
      channel: 'whatsapp',
      providerId: providerMessageId || null,
      fromNumber: phone,
      body: messageText,
      status: 'received',
      raw: { kind: 'customer', ...messageMeta },
    });
  }

  // "5" after our welcome-back message is a trip rating, not a new request.
  if (!skipWhatsApp && await handleRatingReply(phone, messageText).catch(() => false)) {
    return { phone, complete: false, missing: [], collected: {}, reply: '', rating: true };
  }

  // Human takeover: an agent is handling this customer, so the bot stays quiet.
  const handover = await getAiHandover(phone);
  if (handover.paused) {
    console.log(`[handover] AI paused for ${phone}; message stored, no bot reply`);
    await safeNotify(() => notifyCustomerMessage(phone, { text: messageText }));
    return { phone, complete: false, missing: [], collected: conversation.collected || {}, reply: '', ai_paused: true };
  }
  if (isHumanRequest(messageText)) {
    await pauseAi(phone, { reason: 'customer_request' });
    await safeNotify(() => notifyCustomerMessage(phone, { text: messageText, humanRequested: true }));
    const reply = getCustomerText('humanHandover', hasArabic(messageText) ? 'ar' : 'en');
    await replyToUser(phone, reply, skipWhatsApp, { conversationId: conversation.id, leadId: existingLead?.id || null });
    return { phone, complete: false, missing: [], collected: conversation.collected || {}, reply, ai_paused: true, human_requested: true };
  }

  const pendingHotelOption = await handleHotelOptionDecision({
    conversation,
    phone,
    text: messageText,
    choice,
    skipWhatsApp,
    source,
  });
  if (pendingHotelOption) {
    return { ...pendingHotelOption, restart_notice: restartNotice, restarted };
  }

  const pendingDecision = await handlePackageDecision({
    conversation,
    phone,
    text: messageText,
    choice,
    skipWhatsApp,
    source,
  });
  if (pendingDecision) {
    return { ...pendingDecision, restart_notice: restartNotice, restarted };
  }

  // A vote on a poll whose question is no longer open here (the conversation timed out or
  // moved on). Its option text is not a travel request, so it must not reach intake.
  if (choice) {
    console.log(`[poll] vote from ${phone} no longer matches an open question — not acted on`);
    const reply = restarted
      ? ''
      : conversation.language === 'ar'
        ? 'عذراً، هذا الخيار لم يعد متاحاً. أرسل طلبك من جديد وسنساعدك.'
        : 'Sorry, that choice is no longer open. Please send your request again and we will help you.';
    if (reply) await replyToUser(phone, reply, skipWhatsApp, { conversationId: conversation.id });
    return { phone, complete: false, missing: [], collected: conversation.collected || {}, reply, ignored_vote: true, restart_notice: restartNotice, restarted };
  }

  const result = await processUserMessage({
    text: messageText,
    collected: conversation.collected || {},
    languageHint: conversation.language,
  });

  // Greeting with no progress yet → keep asking for details
  // Greeting after partial data → still merge any new fields and ask for missing ones
  const missing = result.missing?.length
    ? result.missing
    : getMissingFields(result.collected);

  // Start the catalogue query as soon as destination and dates are known. We only create
  // the lead / show the offer after the remaining traveller fields are complete, because
  // occupancy is needed to rank a hotel's room options correctly.
  const bookingType = result.collected?.booking_type || 'hotel';
  const packageQueryEligible =
    ['hotel', 'flight', 'package'].includes(bookingType) &&
    Boolean(result.collected?.destination && result.collected?.travel_date && result.collected?.return_date) &&
    (bookingType === 'hotel' || Boolean(result.collected?.origin));
  const packageCandidate = packageQueryEligible
    ? await findMatchingPackage(result.collected)
    : null;
  const matchedPackage = result.complete ? packageCandidate : null;

  let lead = null;
  let awaitingPackage = false;
  let awaitingHotelOption = false;
  let reply = result.reply;
  let predefinedQuote = null;
  let conversationStatus = result.complete ? 'completed' : 'active';
  let collected = result.collected;
  // Package offers are sent through polls (below); everything else is one text reply.
  let sendReply = (ids) => replyToUser(phone, reply, skipWhatsApp, ids);

  if (result.complete) {
    lead = await createLead({
      conversationId: conversation.id,
      phone,
      collected: result.collected,
      summary: result.summary,
      status: 'new',
      source: ['whatsapp', 'crm', 'csv', 'web'].includes(source) ? source : 'whatsapp',
      skipQuoteFetch: Boolean(matchedPackage),
      pendingPackageOfferId: matchedPackage?.id || null,
    });
    console.log('Lead created:', lead.id, result.summary);
    void safeNotify(() => notifyNewLead(lead.id));
    await linkConversationMessagesToLead(conversation.id, lead.id);

    if (matchedPackage) {
      awaitingPackage = true;
      conversationStatus = 'active';
      const baseCollected = withPackageOffer(result.collected, {
        packageId: matchedPackage.id,
        leadId: lead.id,
      });
      const firstChoice = nextHotelOptionChoice(matchedPackage, result.collected, []);
      if (firstChoice) {
        awaitingHotelOption = true;
        collected = withHotelOptionSelection(baseCollected, {
          packageId: matchedPackage.id,
          leadId: lead.id,
        });
        reply = formatHotelOptionQuestion(firstChoice, result.language);
        sendReply = (ids) =>
          askHotelOption(phone, { quote: matchedPackage, group: firstChoice, language: result.language }, skipWhatsApp, ids);
      } else {
        const tailored = tailorPackageQuote(matchedPackage, result.collected, []);
        collected = finishHotelOptionSelection(baseCollected, tailored.selected_item_ids);
        const offer = { quote: tailored, language: result.language, kind: result.collected?.booking_type || 'hotel' };
        reply = formatPackageOfferMessage(tailored, result.language, { kind: offer.kind });
        sendReply = (ids) => sendPackageOffer(phone, offer, skipWhatsApp, ids);
      }
      predefinedQuote = packagePayload(matchedPackage);
      console.log('Offered predefined package', matchedPackage.id, 'for lead', lead.id);
    }
  } else {
    console.log('Lead incomplete. Missing:', missing.join(', ') || 'none');
  }

  await updateConversation(conversation.id, {
    collected,
    language: result.language,
    status: conversationStatus,
  });

  // After the conversation is saved, so a quick poll vote finds the question it answers.
  await sendReply({
    leadId: lead?.id || existingLead?.id || null,
    conversationId: conversation.id,
  });

  return {
    phone,
    complete: Boolean(result.complete) && !awaitingPackage,
    missing,
    collected,
    reply,
    restart_notice: restartNotice,
    restarted,
    lead,
    awaiting_package: awaitingPackage,
    awaiting_hotel_option: awaitingHotelOption,
    predefined_quote: predefinedQuote,
  };
}
