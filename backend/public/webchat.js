/*
 * Travel CRM website chat widget.
 *
 * Add to any page, in <head> or <body>, with or without defer/async:
 *   <script src="https://YOUR-CRM-API/webchat.js" data-key="wc_…"></script>
 *
 * data-key is the code of one CRM user's chat (CRM → Website chat): leads from it
 * go to that user, and its look comes from that user's settings. Without it, the
 * agency's shared chat is used and leads are not given to anyone.
 *
 * The look (language, colour, title, greeting, side) comes from CRM Settings →
 * Website chat. These optional attributes on the script tag override it for one site:
 *   data-key    The user's chat code
 *   data-api    Base URL of the CRM backend (default: where this file was loaded from)
 *   data-lang   ar | en
 *   data-title  Header text
 *   data-color  Main colour, e.g. #0f766e
 *   data-side   left | right
 */
(function () {
  'use strict';
  if (window.__travelWebchatLoaded) return;
  window.__travelWebchatLoaded = true;

  // Must be read now: document.currentScript is only set while this file first runs.
  var script = document.currentScript || document.querySelector('script[src*="webchat.js"]');
  var attr = function (name) {
    var v = script && script.getAttribute('data-' + name);
    return v && v.trim() ? v.trim() : '';
  };
  var scriptOrigin = '';
  try { scriptOrigin = new URL(script.src, location.href).origin; } catch (e) { scriptOrigin = ''; }
  var API = (attr('api') || scriptOrigin).replace(/\/$/, '');
  var CHAT_KEY = /^wc_[A-Za-z0-9_-]{20,64}$/.test(attr('key')) ? attr('key') : '';
  // The key goes in the address of every call, so the server knows whose chat this is.
  function endpoint(path) {
    return API + '/api/public/webchat/' + path + (CHAT_KEY ? '?key=' + encodeURIComponent(CHAT_KEY) : '');
  }

  // Campaign tags of the page the visitor landed on, kept while they browse the site.
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var UTM_KEY = 'travelWebchat:utm';
  function landingUtm() {
    var found = {};
    try {
      var params = new URLSearchParams(location.search);
      UTM_KEYS.forEach(function (k) { var v = params.get(k); if (v) found[k] = v.slice(0, 200); });
      if (Object.keys(found).length) { sessionStorage.setItem(UTM_KEY, JSON.stringify(found)); return found; }
      return JSON.parse(sessionStorage.getItem(UTM_KEY) || 'null') || {};
    } catch (e) { return found; }
  }
  var UTM = landingUtm();
  var REFERRER = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : '';

  function whenReady(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function post(path, data) {
    return fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, status: res.status, data: body || {} }; });
    });
  }

  fetch(endpoint('config'))
    .then(function (res) {
      if (res.status === 404) console.warn('[webchat] this chat code is not valid any more; copy the new code from the CRM');
      else if (!res.ok) console.warn('[webchat] this website is not allowed to use this chat');
      return res.ok ? res.json() : null;
    })
    .then(function (config) {
      if (!config) return;
      if (!config.enabled) return;
      whenReady(function () { start(config); });
    })
    .catch(function () { console.warn('[webchat] could not reach the chat server'); });

  function start(config) {
    var LANG = (attr('lang') || config.language) === 'en' ? 'en' : 'ar';
    var RTL = LANG === 'ar';
    var colorAttr = attr('color');
    var COLOR = /^#[0-9a-fA-F]{3,8}$/.test(colorAttr) ? colorAttr : (/^#[0-9a-fA-F]{6}$/.test(config.color || '') ? config.color : '#0f766e');
    var sideAttr = attr('side') || config.side || (RTL ? 'left' : 'right');
    var SIDE = sideAttr === 'right' ? 'right' : 'left';
    var VERIFY = Boolean(config.verify_phone);
    var STAFF = Boolean(config.show_staff_replies);

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
        paused: STAFF ? 'أحد أفراد فريقنا سيرد عليك هنا وعلى واتساب.' : 'أحد أفراد فريقنا سيتابع معك عبر واتساب.',
        first: 'مرحبا',
        privacy: 'سنستخدم رقمك للتواصل معك بخصوص رحلتك.',
        restart: 'محادثة جديدة',
        codeIntro: 'أرسلنا رمزاً من 6 أرقام إلى واتساب على الرقم {phone}. اكتبه هنا لنبدأ.',
        code: 'رمز التحقق',
        verify: 'تأكيد',
        resend: 'أرسل رمزاً جديداً',
        resent: 'أرسلنا رمزاً جديداً.',
        changeNumber: 'تغيير الرقم',
        badCode: 'اكتب الرمز المكوّن من 6 أرقام',
        expired: 'انتهت المحادثة السابقة. ابدأ من جديد من فضلك.',
        staff: 'فريقنا',
        newReply: 'رد جديد من فريقنا'
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
        paused: STAFF ? 'A team member will reply to you here and on WhatsApp.' : 'A team member will continue with you on WhatsApp.',
        first: 'Hello',
        privacy: 'We will use your number to contact you about your trip.',
        restart: 'New chat',
        codeIntro: 'We sent a 6-digit code to WhatsApp on {phone}. Enter it here to start.',
        code: 'Code',
        verify: 'Confirm',
        resend: 'Send a new code',
        resent: 'We sent a new code.',
        changeNumber: 'Change number',
        badCode: 'Enter the 6-digit code',
        expired: 'Your previous chat ended. Please start again.',
        staff: 'Our team',
        newReply: 'New reply from our team'
      }
    }[LANG];
    var TITLE = attr('title') || config.title || T.title;
    var INTRO = config.greeting || T.intro;

    // Each chat keeps its own conversation, so two users' chats on one site do not mix.
    var KEY = 'travelWebchat:v2' + (CHAT_KEY ? ':' + CHAT_KEY : '');
    function load() {
      try {
        var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved) return saved;
        // Chats started before this version had no token: keep the name and number only.
        var old = JSON.parse(localStorage.getItem('travelWebchat:v1') || 'null');
        return old ? { name: old.name || '', phone: old.phone || '', messages: [] } : null;
      } catch (e) { return null; }
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: memory only */ }
    }

    var state = load() || { name: '', phone: '', messages: [] };
    state.messages = state.messages || [];

    var host = document.createElement('div');
    host.setAttribute('data-travel-webchat', '');
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var css = [
      ':host{all:initial}',
      '*{box-sizing:border-box;font-family:' + (RTL ? '"Noto Sans Arabic","IBM Plex Sans Arabic",' : '') + 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
      '.btn{position:fixed;bottom:20px;' + SIDE + ':20px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:0;background:' + COLOR + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);display:grid;place-items:center}',
      '.btn svg{width:28px;height:28px}',
      '.dot{position:absolute;top:4px;' + (SIDE === 'left' ? 'right' : 'left') + ':4px;width:14px;height:14px;border-radius:50%;background:#dc2626;border:2px solid #fff;display:none}',
      '.btn.unread .dot{display:block}',
      '.panel{position:fixed;bottom:90px;' + SIDE + ':20px;z-index:2147483000;width:min(370px,calc(100vw - 24px));height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;color:#111827;font-size:14px}',
      '.panel.open{display:flex}',
      '.head{background:' + COLOR + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.head b{font-size:15px}',
      '.head button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:13px;opacity:.9}',
      '.body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}',
      '.msg{max-width:85%;padding:9px 12px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}',
      '.me{align-self:flex-end;background:' + COLOR + ';color:#fff}',
      '.bot{align-self:flex-start;background:#fff;border:1px solid #e5e7eb}',
      '.staff{align-self:flex-start;background:#ecfdf5;border:1px solid #a7f3d0}',
      '.who{display:block;font-size:11px;font-weight:600;color:#047857;margin-bottom:2px}',
      '.note{align-self:center;color:#6b7280;font-size:12px;text-align:center}',
      'form{display:flex;flex-direction:column;gap:8px;padding:14px}',
      'label{font-size:12px;color:#4b5563;display:flex;flex-direction:column;gap:4px}',
      'input,textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;color:#111827;background:#fff}',
      'input:focus,textarea:focus{outline:2px solid ' + COLOR + ';outline-offset:-1px;border-color:transparent}',
      '.code{letter-spacing:6px;text-align:center;font-size:20px}',
      '.primary{background:' + COLOR + ';color:#fff;border:0;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600;cursor:pointer}',
      '.primary:disabled{opacity:.5;cursor:default}',
      '.link{background:transparent;border:0;color:' + COLOR + ';font-size:13px;cursor:pointer;padding:4px;text-decoration:underline}',
      '.link:disabled{color:#9ca3af;cursor:default;text-decoration:none}',
      '.row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
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
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="dot"></span>';

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
      var cls = role === 'me' ? 'msg me' : role === 'note' ? 'note' : role === 'staff' ? 'msg staff' : 'msg bot';
      var node = el('div', { class: cls, dir: 'auto' });
      if (role === 'staff') node.appendChild(el('span', { class: 'who', text: T.staff }));
      node.appendChild(document.createTextNode(text));
      body.appendChild(node);
      body.scrollTop = body.scrollHeight;
      return node;
    }

    function remember(role, text) {
      state.messages.push({ role: role, text: text });
      state.messages = state.messages.slice(-60);
      save();
    }

    function removeComposer() {
      if (composer && composer.parentNode) composer.parentNode.removeChild(composer);
    }

    function resetSession(note) {
      state = { name: state.name, phone: state.phone, messages: [] };
      save();
      stopPolling();
      removeComposer();
      renderStart(note);
    }

    function renderStart(note) {
      body.innerHTML = '';
      removeComposer();
      if (note) addBubble('note', note);
      addBubble('bot', INTRO);
      var nameInput = el('input', { type: 'text', autocomplete: 'name', maxlength: '80', value: state.name || '' });
      var phoneInput = el('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: '20', value: state.phone || '' });
      var err = el('div', { class: 'err', role: 'alert' });
      var startBtn = el('button', { class: 'primary', type: 'submit', text: T.start });
      var form = el('form', {}, [
        el('label', {}, [document.createTextNode(T.name), nameInput]),
        el('label', {}, [document.createTextNode(T.phone), phoneInput]),
        err,
        startBtn,
        el('div', { class: 'small', text: T.privacy })
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        var phone = phoneInput.value.replace(/[^\d+]/g, '');
        if (name.length < 2) { err.textContent = T.badName; return; }
        if (phone.replace(/\D/g, '').length < 9) { err.textContent = T.badPhone; return; }
        err.textContent = '';
        startBtn.disabled = true;
        post('session', {
          name: name,
          phone: phone,
          language: LANG,
          page_url: location.href,
          page_title: document.title,
          referrer: REFERRER,
          utm: UTM
        })
          .then(function (r) {
            if (!r.ok) { err.textContent = r.data.error || T.error; return; }
            state = { name: name, phone: phone, token: r.data.token, verified: Boolean(r.data.verified), messages: [], cursor: null };
            save();
            if (state.verified) beginChat(); else renderCode();
          })
          .catch(function () { err.textContent = T.error; })
          .then(function () { startBtn.disabled = false; });
      });
      body.appendChild(form);
      setTimeout(function () { (state.name ? phoneInput : nameInput).focus(); }, 50);
    }

    function renderCode() {
      body.innerHTML = '';
      removeComposer();
      addBubble('bot', T.codeIntro.replace('{phone}', state.phone));
      var codeInput = el('input', { class: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', dir: 'ltr', 'aria-label': T.code });
      var err = el('div', { class: 'err', role: 'alert' });
      var verifyBtn = el('button', { class: 'primary', type: 'submit', text: T.verify });
      var resendBtn = el('button', { class: 'link', type: 'button', text: T.resend });
      var changeBtn = el('button', { class: 'link', type: 'button', text: T.changeNumber });
      var form = el('form', {}, [
        el('label', {}, [document.createTextNode(T.code), codeInput]),
        err,
        verifyBtn,
        el('div', { class: 'row' }, [resendBtn, changeBtn])
      ]);
      // A new code can be asked for after a minute.
      function cooldown() {
        resendBtn.disabled = true;
        setTimeout(function () { resendBtn.disabled = false; }, 60000);
      }
      cooldown();
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = codeInput.value.replace(/\D/g, '');
        if (code.length !== 6) { err.textContent = T.badCode; return; }
        verifyBtn.disabled = true;
        post('verify', { token: state.token, code: code })
          .then(function (r) {
            if (r.status === 401) { resetSession(T.expired); return; }
            if (!r.ok) { err.textContent = r.data.error || T.error; return; }
            state.verified = true;
            save();
            beginChat();
          })
          .catch(function () { err.textContent = T.error; })
          .then(function () { verifyBtn.disabled = false; });
      });
      resendBtn.addEventListener('click', function () {
        cooldown();
        post('resend', { token: state.token, language: LANG })
          .then(function (r) {
            if (r.status === 401) { resetSession(T.expired); return; }
            err.textContent = r.ok ? T.resent : (r.data.error || T.error);
          })
          .catch(function () { err.textContent = T.error; });
      });
      changeBtn.addEventListener('click', function () { resetSession(); });
      body.appendChild(form);
      setTimeout(function () { codeInput.focus(); }, 50);
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
      startPolling();
    }

    function beginChat() {
      renderChat();
      if (!state.messages.length) sendText(T.first);
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
      post('message', { token: state.token, text: text, language: LANG })
        .then(function (r) {
          typing.remove();
          if (r.status === 401) { resetSession(T.expired); return; }
          if (r.data && r.data.code === 'needs_code') { state.verified = false; save(); renderCode(); return; }
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

    // Staff replies: asked for every few seconds while the chat is open, less often when closed.
    var pollTimer = null;
    var polling = false;
    function stopPolling() {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    }
    function startPolling() {
      if (!STAFF || !state.token || !state.verified || pollTimer) return;
      schedule(1500);
    }
    function schedule(ms) {
      stopPolling();
      pollTimer = setTimeout(poll, ms);
    }
    function isOpen() { return panel.classList.contains('open'); }
    function poll() {
      pollTimer = null;
      if (!state.token || !state.verified) return;
      if (document.hidden || polling) { schedule(isOpen() ? 6000 : 30000); return; }
      polling = true;
      post('updates', { token: state.token, after: state.cursor || null })
        .then(function (r) {
          if (r.status === 401) { state.token = null; state.verified = false; save(); return; }
          if (!r.ok || !r.data.enabled) return;
          state.cursor = r.data.cursor || state.cursor;
          (r.data.messages || []).forEach(function (m) {
            remember('staff', m.text);
            if (isOpen() && composer && composer.parentNode) addBubble('staff', m.text);
          });
          save();
          if ((r.data.messages || []).length && !isOpen()) {
            button.classList.add('unread');
            button.setAttribute('aria-label', T.open + ' — ' + T.newReply);
          }
        })
        .catch(function () { /* try again next time */ })
        .then(function () {
          polling = false;
          if (state.token && state.verified && !pollTimer) schedule(isOpen() ? 6000 : 30000);
        });
    }

    function open() {
      panel.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      button.classList.remove('unread');
      button.setAttribute('aria-label', T.open);
      if (state.token && state.verified) renderChat();
      else if (state.token && VERIFY) renderCode();
      else renderStart();
      if (pollTimer) schedule(1000);
    }
    function close() {
      panel.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', function () { isOpen() ? close() : open(); });
    closeBtn.addEventListener('click', close);
    restartBtn.addEventListener('click', function () {
      state = { name: state.name, phone: '', messages: [] };
      save();
      stopPolling();
      renderStart();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // A returning visitor with a confirmed chat still hears back from staff.
    startPolling();
  }
})();
