/*
 * Travel CRM website chat widget.
 *
 * Add to any page:
 *   <script src="https://YOUR-CRM-API/webchat.js" data-lang="ar" defer></script>
 *
 * Optional attributes on the script tag:
 *   data-api    Base URL of the CRM backend (default: where this file was loaded from)
 *   data-lang   ar | en (default ar)
 *   data-title  Header text
 *   data-color  Main colour, e.g. #0f766e
 *   data-side   left | right (default: left for Arabic, right for English)
 */
(function () {
  'use strict';
  if (window.__travelWebchatLoaded) return;
  window.__travelWebchatLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="webchat.js"]');
  var attr = function (name, fallback) {
    var v = script && script.getAttribute('data-' + name);
    return v && v.trim() ? v.trim() : fallback;
  };
  var scriptOrigin = '';
  try { scriptOrigin = new URL(script.src, location.href).origin; } catch (e) { scriptOrigin = ''; }
  var API = attr('api', scriptOrigin).replace(/\/$/, '');
  var LANG = attr('lang', 'ar') === 'en' ? 'en' : 'ar';
  var RTL = LANG === 'ar';
  var COLOR = /^#[0-9a-fA-F]{3,8}$/.test(attr('color', '')) ? attr('color', '') : '#0f766e';
  var SIDE = attr('side', RTL ? 'left' : 'right') === 'right' ? 'right' : 'left';

  var T = {
    ar: {
      title: 'تحدث معنا',
      open: 'افتح المحادثة',
      close: 'إغلاق',
      intro: 'أهلاً بك! اكتب اسمك ورقم هاتفك لنبدأ، وسنساعدك في حجز رحلتك.',
      name: 'الاسم',
      phone: 'رقم الهاتف (واتساب)',
      start: 'ابدأ المحادثة',
      placeholder: 'اكتب رسالتك…',
      send: 'إرسال',
      typing: 'جارٍ الكتابة…',
      badName: 'اكتب اسمك من فضلك',
      badPhone: 'اكتب رقم هاتف صحيح',
      error: 'تعذّر الإرسال، حاول مرة أخرى',
      paused: 'أحد أفراد فريقنا سيتابع معك عبر واتساب.',
      first: 'مرحبا',
      privacy: 'سنستخدم رقمك للتواصل معك بخصوص رحلتك.',
      restart: 'محادثة جديدة'
    },
    en: {
      title: 'Chat with us',
      open: 'Open chat',
      close: 'Close',
      intro: 'Welcome! Enter your name and phone number to start, and we will help you book your trip.',
      name: 'Name',
      phone: 'Phone number (WhatsApp)',
      start: 'Start chat',
      placeholder: 'Type your message…',
      send: 'Send',
      typing: 'Typing…',
      badName: 'Please enter your name',
      badPhone: 'Please enter a valid phone number',
      error: 'Could not send, please try again',
      paused: 'A team member will continue with you on WhatsApp.',
      first: 'Hello',
      privacy: 'We will use your number to contact you about your trip.',
      restart: 'New chat'
    }
  }[LANG];
  var TITLE = attr('title', T.title);

  var KEY = 'travelWebchat:v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || null; } catch (e) { return null; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: memory only */ }
  }

  var state = load() || { name: '', phone: '', messages: [] };

  var host = document.createElement('div');
  host.setAttribute('data-travel-webchat', '');
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:' + (RTL ? '"Noto Sans Arabic","IBM Plex Sans Arabic",' : '') + 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.btn{position:fixed;bottom:20px;' + SIDE + ':20px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:0;background:' + COLOR + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);display:grid;place-items:center}',
    '.btn svg{width:28px;height:28px}',
    '.panel{position:fixed;bottom:90px;' + SIDE + ':20px;z-index:2147483000;width:min(370px,calc(100vw - 24px));height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;color:#111827;font-size:14px}',
    '.panel.open{display:flex}',
    '.head{background:' + COLOR + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.head b{font-size:15px}',
    '.head button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:13px;opacity:.9}',
    '.body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}',
    '.msg{max-width:85%;padding:9px 12px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}',
    '.me{align-self:flex-end;background:' + COLOR + ';color:#fff}',
    '.bot{align-self:flex-start;background:#fff;border:1px solid #e5e7eb}',
    '.note{align-self:center;color:#6b7280;font-size:12px;text-align:center}',
    'form{display:flex;flex-direction:column;gap:8px;padding:14px}',
    'label{font-size:12px;color:#4b5563;display:flex;flex-direction:column;gap:4px}',
    'input,textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;color:#111827;background:#fff}',
    'input:focus,textarea:focus{outline:2px solid ' + COLOR + ';outline-offset:-1px;border-color:transparent}',
    '.primary{background:' + COLOR + ';color:#fff;border:0;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;cursor:pointer}',
    '.primary:disabled{opacity:.5;cursor:default}',
    '.err{color:#b91c1c;font-size:12px;min-height:16px}',
    '.composer{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;flex-direction:row}',
    '.composer textarea{flex:1;resize:none;height:42px;max-height:110px}',
    '.small{font-size:11px;color:#6b7280}',
    '@media (max-width:480px){.panel{' + SIDE + ':12px;bottom:84px}}'
  ].join('\n');

  root.innerHTML = '';
  var style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') node.textContent = props[k];
      else if (k === 'class') node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  var button = el('button', { class: 'btn', type: 'button', 'aria-label': T.open, 'aria-expanded': 'false' });
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': TITLE, dir: RTL ? 'rtl' : 'ltr', lang: LANG });
  var restartBtn = el('button', { type: 'button', text: T.restart });
  var closeBtn = el('button', { type: 'button', text: T.close });
  var head = el('div', { class: 'head' }, [el('b', { text: TITLE }), el('span', {}, [restartBtn, document.createTextNode('  '), closeBtn])]);
  var body = el('div', { class: 'body', 'aria-live': 'polite' });
  panel.appendChild(head);
  panel.appendChild(body);
  root.appendChild(panel);
  root.appendChild(button);

  var sending = false;

  function addBubble(role, text) {
    var cls = role === 'me' ? 'msg me' : role === 'note' ? 'note' : 'msg bot';
    var node = el('div', { class: cls, dir: 'auto', text: text });
    body.appendChild(node);
    body.scrollTop = body.scrollHeight;
    return node;
  }

  function renderStart() {
    body.innerHTML = '';
    addBubble('bot', T.intro);
    var nameInput = el('input', { type: 'text', autocomplete: 'name', maxlength: '80', value: state.name || '' });
    var phoneInput = el('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: '20', value: state.phone || '' });
    var err = el('div', { class: 'err', role: 'alert' });
    var start = el('button', { class: 'primary', type: 'submit', text: T.start });
    var form = el('form', {}, [
      el('label', {}, [document.createTextNode(T.name), nameInput]),
      el('label', {}, [document.createTextNode(T.phone), phoneInput]),
      err,
      start,
      el('div', { class: 'small', text: T.privacy })
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameInput.value.trim();
      var phone = phoneInput.value.replace(/[^\d+]/g, '');
      if (name.length < 2) { err.textContent = T.badName; return; }
      if (phone.replace(/\D/g, '').length < 9) { err.textContent = T.badPhone; return; }
      state = { name: name, phone: phone, messages: [] };
      save(state);
      renderChat();
      sendText(T.first);
    });
    body.appendChild(form);
    setTimeout(function () { (state.name ? phoneInput : nameInput).focus(); }, 50);
  }

  var composer = null;
  var input = null;
  var sendBtn = null;

  function renderChat() {
    body.innerHTML = '';
    state.messages.forEach(function (m) { addBubble(m.role, m.text); });
    if (!composer) {
      input = el('textarea', { rows: '1', placeholder: T.placeholder, 'aria-label': T.placeholder, dir: 'auto', maxlength: '2000' });
      sendBtn = el('button', { class: 'primary', type: 'button', text: T.send });
      composer = el('div', { class: 'composer' }, [input, sendBtn]);
      sendBtn.addEventListener('click', function () { sendText(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input.value); }
      });
    }
    if (!composer.parentNode) panel.appendChild(composer);
    setTimeout(function () { input.focus(); }, 50);
  }

  function remember(role, text) {
    state.messages.push({ role: role, text: text });
    state.messages = state.messages.slice(-60);
    save(state);
  }

  function sendText(raw) {
    var text = String(raw || '').trim();
    if (!text || sending) return;
    sending = true;
    if (input) { input.value = ''; }
    if (sendBtn) sendBtn.disabled = true;
    addBubble('me', text);
    remember('me', text);
    var typing = addBubble('note', T.typing);
    fetch(API + '/api/public/webchat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: state.name, phone: state.phone, text: text })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        typing.remove();
        if (!r.ok) { addBubble('note', (r.data && r.data.error) || T.error); return; }
        (r.data.replies || []).forEach(function (reply) { addBubble('bot', reply); remember('bot', reply); });
        if (r.data.ai_paused && !(r.data.replies || []).length) { addBubble('note', T.paused); }
      })
      .catch(function () { typing.remove(); addBubble('note', T.error); })
      .then(function () {
        sending = false;
        if (sendBtn) sendBtn.disabled = false;
      });
  }

  function open() {
    panel.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    if (state.name && state.phone) renderChat(); else renderStart();
  }
  function close() {
    panel.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  closeBtn.addEventListener('click', close);
  restartBtn.addEventListener('click', function () {
    state = { name: state.name, phone: '', messages: [] };
    save(state);
    if (composer && composer.parentNode) composer.parentNode.removeChild(composer);
    renderStart();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
