# Website chat

A chat bubble for websites. Visitors talk to the same bot as on WhatsApp, and their finished request lands in the CRM as a lead with the source `web`.

**Every CRM user has their own chat.** Its code carries the user's chat key, so the CRM knows whose chat a visitor is using: leads from it are given to that user (they appear in that user's Leads list, and that user is notified), and it can have its own look and its own list of websites.

## Add it to a site

Open **CRM → Website chat** (in the side menu, below Assistant). Under **Your chat**, press **Copy** and paste the line into the website, inside `<head>` or anywhere in `<body>`, on every page that should show the chat:

```html
<script src="https://YOUR-CRM-API-DOMAIN/webchat.js" data-key="wc_…" async></script>
```

It works with or without `async`/`defer`, and also through Google Tag Manager (Custom HTML tag) or a WordPress "header and footer scripts" plugin.

Use **Open test page** to try the chat before adding it anywhere. Requests completed there are real leads, given to you.

If someone copies your code onto a site you do not want, press **Make a new code**: the old code stops working at once, and you paste the new one into your own sites.

Website leads from a user's own chat do not use that user's lead credits.

## Your chat (every user)

| Setting | Meaning |
|---|---|
| Show my chat on websites | Off hides your bubble everywhere. |
| Language, title, welcome message, colour, bubble position | What visitors see. Empty fields use the agency defaults. |
| Websites allowed to show the chat | One site per line, e.g. `https://agency.com`. Another site that copies your code gets nothing. While empty, the agency list is used. |

## For admins

**Everyone's chats** lists each user's chat (it appears once the user has opened the Website chat page), how many website leads it brought in, and when it was last used. An admin can switch any user's chat off or give it a new code.

**Agency defaults** apply to every chat:

| Setting | Meaning |
|---|---|
| Allow website chats | Off hides every user's chat on every website. |
| Language, title, welcome message, colour, position | Used where a user left the field empty. Empty colour uses the agency colour from Branding. |
| Websites allowed to show the chat | Used by chats whose user has not listed their own sites. While empty, `WEBCHAT_ALLOWED_ORIGINS` on the server is used; empty in all places means **any site** (a warning shows). The backend's own test page is always allowed. |
| Confirm the phone number with a code | Before any chat starts, a 6-digit code is sent to the number on WhatsApp. 10 minutes valid, 5 tries, 3 codes per chat, one new code per minute. Each code is one WhatsApp message. |
| Show staff replies inside the website chat | Needs the phone code. Replies sent from the Inbox still go to WhatsApp, and also appear in the visitor's chat (it checks every few seconds while open, and shows a red dot on the bubble when closed). Only replies sent after the number was confirmed are shown. |

**Shared code without a user** (under Agency defaults): code pasted before every user had a chat has no `data-key`. It keeps working with the agency defaults, but its leads are not given to anyone; assign them from the Leads page.

Optional attributes on the script tag override the settings for one site: `data-lang` (`ar`/`en`), `data-title`, `data-color` (hex), `data-side` (`left`/`right`), `data-api` (backend URL, if different from where the script is loaded).

## Server settings

| Variable | Meaning |
|---|---|
| `WEBCHAT_PUBLIC_URL` | Public address of the backend, including any path it is served under, e.g. `https://api.agency.com/travel`. Used in the code and test page shown in the CRM. If empty, `BACKEND_URL` is used, then the request's own address plus a proxy's `X-Forwarded-Prefix`. A localhost address is never given to a live site. |
| `WEBCHAT_ALLOWED_ORIGINS` | Fallback list of allowed sites (comma separated) while the list in Settings is empty. |
| `WEBCHAT_RATE_LIMIT_PER_MINUTE` | Messages per minute per visitor IP (default 20). Each number may also start at most 3 chats a minute, and each chat send 12 messages a minute. |

## How it behaves

- The visitor enters a name and phone number, then chats. Local numbers are understood: `05x` becomes +972, `059`/`056` become +970.
- The conversation uses the phone number, exactly like WhatsApp: the same bot questions, the same lead, the same "Pause AI" takeover. If one customer chats on two users' sites, it is still one conversation, and the lead belongs to the user whose chat created it.
- The lead remembers where the visitor came from: the website, the page, the referring site and campaign tags (`utm_*`, Google `gclid`, Facebook `fbclid`). It shows on the lead page as "From the website agency.com · chat of Ahmed · via instagram / winter". Campaign tags from the landing page are kept while the visitor browses the site.
- An existing contact's name is never overwritten by what a visitor types.
- Each chat has its own random key kept in the visitor's browser (only a hash is stored). Chats unused for 30 days end.

## Without the phone code

If "Confirm the phone number" is off, someone can type another person's number. They will not see that person's earlier messages or any staff replies (the widget only shows the bot replies to its own messages), but their messages join that person's conversation, and later automatic WhatsApp messages go to the number that was typed. Turning the code on closes both gaps.
