# Website chat

A chat bubble for the agency's websites (the landing page and the booking site). Visitors talk to the same bot as on WhatsApp, and their request lands in the CRM as a lead.

## Add it to a site

Paste this line before `</body>` on every page where the chat should appear:

```html
<script src="https://YOUR-CRM-API-DOMAIN/webchat.js" data-lang="ar" defer></script>
```

Replace `YOUR-CRM-API-DOMAIN` with the domain of the CRM backend.

Optional attributes:

| Attribute | Values | Default |
|---|---|---|
| `data-lang` | `ar` or `en` | `ar` |
| `data-title` | header text | "تحدث معنا" / "Chat with us" |
| `data-color` | a hex colour, e.g. `#0f766e` | `#0f766e` |
| `data-side` | `left` or `right` | left for Arabic, right for English |
| `data-api` | backend URL, if different from where the script is loaded | the script's own domain |

## Settings on the server

| Variable | Meaning |
|---|---|
| `WEBCHAT_ALLOWED_ORIGINS` | Comma-separated list of the sites allowed to use the chat, e.g. `https://agency.com,https://booking.agency.com`. Empty allows any site; set it in production. |
| `WEBCHAT_RATE_LIMIT_PER_MINUTE` | Messages per minute per visitor IP (default 20). Each phone number is also limited to 12 a minute. |

## How it behaves

- The visitor enters a name and phone number, then chats. Local numbers are understood: `05x` becomes +972, `059`/`056` become +970.
- The conversation uses the phone number, exactly like WhatsApp: the same bot questions, the same lead, the same "Pause AI" takeover. Leads from the site show source `web`.
- Staff replies go to the customer on **WhatsApp**, not into the website chat.
- An existing contact's name is never overwritten by what a visitor types.

## Known limits (phone numbers are not verified)

The owner chose to start chats without a WhatsApp code. Because of that:

- Someone can type another person's number. They will not see that person's earlier messages or staff replies (the widget only shows the bot replies to its own messages), but their messages join that person's conversation.
- When a lead is completed from the website, later automatic WhatsApp messages (for example package offers) go to the number that was typed.

Adding a one-time WhatsApp code before the chat starts would close both gaps.
