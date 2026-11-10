export const texts = {
  en: {
    agentWillContact: "Our agent will contact you soon.",
    humanHandover: "A team member will continue this conversation with you.",
    reminderPrefix: "Reminder:",
    when: "When:",
    hiName: "Hi {name},",
    hi: "Hi,",
    welcomeMessage: "Welcome 👋\nDo you need a hotel booking or a flight booking?\nReply with: hotel or flight",
    detailsPromptFlight: "Great — flight booking ✈️\nPlease send:\n1) Departure city\n2) Arrival city\n3) Departure date and return date\n4) Number of adults\n5) Number of children and their ages\n6) Any notes (optional)",
    detailsPromptHotel: "Great — hotel booking 🏨\nPlease send:\n1) Destination\n2) Check-in and check-out dates\n3) Number of adults\n4) Number of children and their ages\n5) Hotel name (optional)\n6) Any notes (optional)",
    incompleteData: "Please provide the remaining details.",
  },
  ar: {
    agentWillContact: "شكراً لك. سيتواصل معك مندوبنا قريباً.",
    humanHandover: "سيقوم أحد أفراد فريقنا بمتابعة المحادثة معك.",
    reminderPrefix: "تذكير:",
    when: "الوقت:",
    hiName: "مرحباً {name}،",
    hi: "مرحباً،",
    welcomeMessage: "مرحباً بك 👋\nهل تريد حجز فندق أم حجز طيران؟\nأرسل: فندق أو طيران",
    detailsPromptFlight: "ممتاز، حجز طيران ✈️\nأرسل لنا:\n1) مدينة المغادرة\n2) مدينة الوصول\n3) تاريخ المغادرة وتاريخ العودة\n4) عدد البالغين\n5) عدد الأطفال وأعمارهم\n6) أي ملاحظات (اختياري)",
    detailsPromptHotel: "ممتاز، حجز فندق 🏨\nأرسل لنا:\n1) الوجهة\n2) تاريخ الوصول وتاريخ المغادرة\n3) عدد البالغين\n4) عدد الأطفال وأعمارهم\n5) اسم الفندق (اختياري)\n6) أي ملاحظات (اختياري)",
    incompleteData: "من فضلك أكمل البيانات المطلوبة.",
  }
};

/**
 * Retrieves a localized string based on the preferred language.
 */
export function getCustomerText(key, lang = 'ar', replacements = {}) {
  const dictionary = texts[lang] || texts['ar'];
  let text = dictionary[key] || texts['en'][key] || key;
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}
