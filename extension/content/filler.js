/*
 * LazyForm fill engine.
 * Injected on demand (popup / shortcut) or by the optional auto-detect script.
 * Finds form controls, works out what each one is asking for, and fills it
 * from the profile saved in chrome.storage.local. It never submits a form.
 */
(() => {
  if (window.__lazyForm) return;

  const UI_ATTR = 'data-lazyform-ui';
  const MARK_ATTR = 'data-lazyform';

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------
  const norm = (s) =>
    String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-\[\]\.\/\\:()]+/g, ' ')
      .replace(/[*?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const clip = (s, n = 160) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  const STOP = new Set(
    'the a an of to and or for in on at is are be you your yours do does did have has with this that what which please if any as by from we our us will would can could select choose enter provide'.split(' ')
  );
  const tokens = (s) =>
    norm(s)
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''));

  function similarity(a, b) {
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((t) => B.has(t) && inter++);
    return inter / Math.min(A.size, B.size) * (inter / Math.max(A.size, B.size)) ** 0.25;
  }

  // ---------------------------------------------------------------------------
  // What each profile value looks like on a form
  // Order matters: earlier, more specific rules win ties.
  // ---------------------------------------------------------------------------
  const RULES = [
    { key: 'linkedin', re: /linked ?in/ },
    { key: 'github', re: /git ?hub/ },
    { key: 'twitter', re: /twitter|\bx handle\b|\bx com\b/ },
    { key: 'yearsExperience', re: /years? of (relevant |professional |total |work |industry )?experience|how many years|total experience|experience \(?in years|years experience/ },
    { key: 'currentSalary', re: /current (base )?(salary|ctc|compensation|pay)|present (salary|ctc)/ },
    { key: 'expectedSalary', re: /(expected|desired|target|expectation|requirement).{0,20}(salary|compensation|ctc|pay|remuneration)|(salary|compensation|pay|ctc).{0,20}(expect|desire|requirement)|^salary$/ },
    { key: 'rangeStart', re: /^(from|start|start date|date from|from date|start month|start year|started|date started)$|^(from|start) \(|^start date \(/, section: true },
    { key: 'rangeEnd', re: /^(to|end|end date|date to|to date|end month|end year|until|ended|date ended|graduation date)$|^(to|end) \(|^end date \(/, section: true },
    { key: 'currentlyHere', re: /currently work|i (currently )?work here|still (work|employed)|^current(ly)? (job|role|position|employer)$|^present$/, section: 'experience' },
    { key: 'jobDescription', re: /role description|job description|responsibilit|describe (your|the) (role|work)|^description$|achievements|what did you do/, section: 'experience' },
    { key: 'availableStartDate', re: /start date|earliest (possible )?(start|date)|date (you are )?available|available (to start|from)|when (can|could) you start|joining date|date of joining/ },
    { key: 'noticePeriod', re: /notice period|how (soon|quickly) can you (join|start)|notice (time|required|in days|days)|serving notice/ },
    { key: 'requireSponsorship', re: /sponsor/ },
    { key: 'authorizedToWork', re: /(legally )?(authori[sz]ed|eligible|permitted|allowed) to work|right to work|work authori[sz]ation|work permit|employment eligibility/ },
    { key: 'willingToRelocate', re: /relocat/ },
    { key: 'over18', re: /18 years|over 18|at least 18|eighteen|legal age/ },
    { key: 'pronouns', re: /pronoun/ },
    { key: 'hispanic', re: /hispanic|latin[oax]/ },
    { key: 'race', re: /\brace\b|ethnicity|ethnic/ },
    { key: 'gender', re: /gender|\bsex\b/, not: /transgender|orientation/ },
    { key: 'veteran', re: /veteran|military|armed forces/ },
    { key: 'disability', re: /disabilit/ },
    { key: 'email', re: /e ?mail/, not: /referr|manager|recruiter|reference/ },
    { key: 'phoneCountryCode', re: /country (dial |calling )?code|dial(ing)? code|phone (country|prefix)/ },
    { key: 'phone', re: /phone|mobile|\btel\b|telephone|cell|contact (number|no)|whats ?app/, not: /type|extension|\bext\b|referr|reference|manager/ },
    { key: 'preferredName', re: /preferred (first )?name|nick ?name|goes by|known as/ },
    { key: 'middleName', re: /middle (name|initial)/ },
    { key: 'firstName', re: /first ?name|given ?name|\bfname\b|fore ?name/, not: /referr|emergency|reference|manager|recruiter/ },
    { key: 'lastName', re: /last ?name|sur ?name|family ?name|\blname\b/, not: /referr|emergency|reference|manager|recruiter/ },
    { key: 'dateOfBirth', re: /date of birth|\bdob\b|birth ?date|birthday/ },
    { key: 'currentCompany', re: /current (company|employer|organi[sz]ation)|^(company|employer)( name)?$|present (company|employer)|company name|employer name/, not: /previous|past|why|reference|referr|desired/ },
    { key: 'currentTitle', re: /current (job )?(title|role|position|designation)|^(job )?title$|^designation$|present (title|role|position)|job title/, not: /appl|desired|interest|which (position|role)/ },
    { key: 'fullName', re: /full ?name|legal name|your name|^name$|candidate name|applicant name/, not: /company|school|university|referr|reference|emergency|manager|recruiter|employer|file|user ?name|business|pet|first|last|middle|preferred/ },
    { key: 'street2', re: /address ?(line)? ?2|\bapt\b|apartment|suite|\bunit\b/ },
    { key: 'postalCode', re: /\bzip\b|zip ?code|postal|post ?code|pin ?code|postcode/ },
    { key: 'city', re: /\bcity\b|\btown\b|locality/, not: /ethnic|citizen/ },
    { key: 'state', re: /\bstate\b|province|\bregion\b|\bcounty\b/, not: /statement|united state/ },
    { key: 'nationality', re: /citizenship|nationality|citizen of/ },
    { key: 'country', re: /\bcountry\b|country of residence/, not: /code|dial|citizen/ },
    { key: 'street', re: /street|address ?(line)? ?1|^address$|mailing address|home address|residential address|current address|postal address|\baddress\b/, not: /e ?mail|line 2|address 2|\bip\b|web|url|city|ethereum|wallet/ },
    { key: 'location', re: /^(current )?location$|where are you (currently )?(located|based)|current location|city of residence|where do you (currently )?live|based in/ },
    { key: 'workMode', re: /remote|hybrid|on ?site|work (arrangement|mode|location preference)/, not: /relocat/ },
    { key: 'school', re: /school|universit|college|institution|alma mater/ },
    { key: 'fieldOfStudy', re: /field of study|\bmajor\b|discipline|speciali[sz]ation|course of study|area of study/ },
    { key: 'degree', re: /degree|qualification|education level|highest (level of )?education/ },
    { key: 'graduationDate', re: /graduat|year of (completion|passing)|completion (year|date)|passing year/ },
    { key: 'gpa', re: /\bgpa\b|\bcgpa\b|grade point|percentage|\bmarks\b/ },
    { key: 'coverLetter', re: /cover ?letter/ },
    { key: 'summary', re: /summary|about (yourself|you)|tell us (about|a bit)|\bbio\b|introduce yourself|describe yourself|professional profile/ },
    { key: 'skills', re: /\bskills?\b|technologies|tech stack|key expertise/ },
    { key: 'languages', re: /languages? (spoken|known|you speak)|which languages|language proficiency|spoken languages/ },
    { key: 'howHeard', re: /how did you (hear|find|learn|come across)|where did you (hear|find|see)|referral source|^source$|how you heard/ },
    { key: 'portfolio', re: /portfolio|personal (web ?)?site|^website$|website|\bblog\b|\burl\b|other (link|profile)|\blinks?\b/, not: /company|linked ?in|git ?hub|twitter/ },
  ];

  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName',
    name: 'fullName', nickname: 'preferredName', email: 'email', tel: 'phone', 'tel-national': 'phone',
    'tel-country-code': 'phoneCountryCode', 'street-address': 'street', 'address-line1': 'street',
    'address-line2': 'street2', 'address-level2': 'city', 'address-level1': 'state',
    'postal-code': 'postalCode', country: 'country', 'country-name': 'country',
    organization: 'currentCompany', 'organization-title': 'currentTitle', url: 'portfolio',
    bday: 'dateOfBirth', sex: 'gender',
  };

  const KEY_LABELS = {
    linkedin: 'LinkedIn URL', github: 'GitHub URL', twitter: 'X / Twitter', email: 'email', phoneCountryCode: 'phone country code',
    phone: 'phone number', preferredName: 'preferred name', middleName: 'middle name', firstName: 'first name', lastName: 'last name',
    dateOfBirth: 'date of birth', currentCompany: 'current company', currentTitle: 'current job title', fullName: 'name',
    street2: 'address line 2', postalCode: 'postal code', city: 'city', state: 'state / province', nationality: 'citizenship',
    country: 'country', street: 'street address', location: 'city & country', yearsExperience: 'years of experience',
    currentSalary: 'current salary', expectedSalary: 'expected salary', availableStartDate: 'earliest start date',
    noticePeriod: 'notice period', requireSponsorship: 'sponsorship answer', authorizedToWork: 'work authorisation answer',
    willingToRelocate: 'relocation answer', over18: 'age (18+) answer', workMode: 'work-mode preference', pronouns: 'pronouns',
    hispanic: 'Hispanic/Latino answer', race: 'race / ethnicity answer', gender: 'gender answer', veteran: 'veteran status',
    disability: 'disability answer', school: 'school (Education)', fieldOfStudy: 'field of study', degree: 'degree',
    graduationDate: 'graduation date', gpa: 'GPA / grade', coverLetter: 'cover letter', summary: 'professional summary',
    skills: 'skills', languages: 'languages', howHeard: '“how did you hear about us” answer', portfolio: 'portfolio / website',
  };

  // Keys whose answer is a yes / no
  const YES_NO_KEYS = new Set(['authorizedToWork', 'requireSponsorship', 'willingToRelocate', 'over18']);
  // Long-form answers only belong in multi-line boxes
  const LONG_KEYS = new Set(['summary', 'coverLetter']);
  // Checkboxes that represent legal consent are never ticked for the user
  const CONSENT_RE = /\bagree|consent|terms|privacy|acknowledge|certify|attest|confirm that|i understand|accurate|true and complete|signature|subscribe|newsletter|marketing|text messages|sms/;

  // ---------------------------------------------------------------------------
  // Profile → flat value map
  // ---------------------------------------------------------------------------
  function flatten(p) {
    const v = { ...p };
    const exp = (p.experience || [])[0] || {};
    const edu = (p.education || [])[0] || {};
    v.currentTitle = p.currentTitle || exp.title || '';
    v.currentCompany = p.currentCompany || exp.company || '';
    v.school = edu.school || '';
    v.degree = edu.degree || '';
    v.fieldOfStudy = edu.fieldOfStudy || '';
    v.gpa = edu.gpa || '';
    v.graduationDate = edu.endDate || '';
    v.fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
    v.location = [p.city, p.state, p.country].filter(Boolean).join(', ');
    if (!v.coverLetter && v.summary) v.coverLetter = '';
    return v;
  }

  // ---------------------------------------------------------------------------
  // DOM collection
  // ---------------------------------------------------------------------------
  function collectControls(root = document, out = []) {
    const sel = 'input, select, textarea, [role="combobox"]:not(input), [aria-haspopup="listbox"]:not(input)';
    root.querySelectorAll(sel).forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot && !el.hasAttribute(UI_ATTR)) collectControls(el.shadowRoot, out);
    });
    return out;
  }

  const SKIP_TYPES = new Set(['hidden', 'password', 'submit', 'button', 'reset', 'image', 'search', 'range', 'color']);

  function isVisible(el) {
    if (!el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (!el.getClientRects().length) return false;
    // Guard against hidden "trap" fields that try to harvest autofill data
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.right + window.scrollX < 0 || r.bottom + window.scrollY < 0) return false;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
      if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
    }
    return true;
  }

  function isUsable(el) {
    if (el.closest(`[${UI_ATTR}]`)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (SKIP_TYPES.has(type)) return false;
      if (el.readOnly && !el.getAttribute('role')) return false;
      if (/captcha|recaptcha|honeypot|\bhp\b/i.test(el.name + ' ' + el.id + ' ' + el.className)) return false;
      if (type === 'radio' || type === 'checkbox' || type === 'file') {
        // custom-styled controls are often visually hidden; accept if their label shows
        return isVisible(el) || (el.labels && [...el.labels].some(isVisible)) || isVisible(el.parentElement || el);
      }
    }
    return isVisible(el);
  }

  // ---------------------------------------------------------------------------
  // Working out what a control is asking for
  // ---------------------------------------------------------------------------
  function textOf(node, skip) {
    if (!node) return '';
    let s = '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (skip && (n === skip || skip.contains?.(n))) return NodeFilter.FILTER_REJECT;
          if (/^(SCRIPT|STYLE|SELECT|OPTION|TEXTAREA|BUTTON|SVG|NOSCRIPT)$/i.test(n.tagName)) return NodeFilter.FILTER_REJECT;
          if (n.hasAttribute?.(UI_ATTR)) return NodeFilter.FILTER_REJECT;
          if (n.getAttribute?.('role') === 'listbox') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) s += ' ' + walker.currentNode.nodeValue;
    return s.replace(/\s+/g, ' ').trim();
  }

  const byIds = (ids, rootNode) =>
    (ids || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => (rootNode.getElementById ? rootNode.getElementById(id) : document.getElementById(id)))
      .filter(Boolean)
      .map((n) => textOf(n))
      .join(' ');

  function labelText(el) {
    const root = el.getRootNode();
    const parts = [];
    if (el.labels && el.labels.length) parts.push([...el.labels].map((l) => textOf(l, el)).join(' '));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) parts.push(byIds(lb, root));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    return parts.join(' ').trim();
  }

  // Nearby text for frameworks that don't link labels (Lever, Ashby, Workday, …)
  function contextText(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const controls = node.querySelectorAll('input:not([type=hidden]), select, textarea');
      const radiosOnly = [...controls].every((c) => c.type === 'radio' || c.type === 'checkbox');
      if (controls.length > 1 && !(radiosOnly && el.type !== 'text')) {
        // too broad – fall back to the closest preceding sibling text
        break;
      }
      const t = textOf(node, el);
      if (t && t.length > 1) return clip(t, 220);
    }
    // preceding sibling heading/label
    let prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
    for (let i = 0; prev && i < 3; i++, prev = prev.previousElementSibling) {
      const t = textOf(prev);
      if (t) return clip(t, 220);
    }
    return '';
  }

  function groupQuestion(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const legend = fs.querySelector('legend');
      if (legend) return textOf(legend);
    }
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const t = byIds(group.getAttribute('aria-labelledby'), el.getRootNode()) || group.getAttribute('aria-label');
      if (t) return t;
    }
    // walk up to a container holding the whole group, take its text minus option labels
    const name = el.name;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const same = name ? node.querySelectorAll(`input[name="${CSS.escape(name)}"]`) : [el];
      const all = node.querySelectorAll('input:not([type=hidden]), select, textarea');
      if (same.length === all.length && all.length >= 1) {
        const optionText = new Set([...same].map((r) => norm(optionLabel(r))));
        const sib = node.previousElementSibling;
        const own = textOf(node)
          .split(/\s{2,}|\n/)
          .join(' ');
        let q = own;
        optionText.forEach((o) => { if (o) q = norm(q).replace(o, ' '); });
        q = q.trim();
        if (q.length > 2) return q;
        if (sib) return textOf(sib);
      } else break;
    }
    return contextText(el);
  }

  function optionLabel(input) {
    if (input.labels && input.labels.length) return textOf(input.labels[0], input) || input.value;
    const al = input.getAttribute('aria-label');
    if (al) return al;
    const next = input.nextElementSibling || input.parentElement;
    return (next && textOf(next, input)) || input.value || '';
  }

  function describe(el) {
    const label = labelText(el);
    const attrs = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('data-automation-id'), el.getAttribute('title'), el.getAttribute('data-qa')]
      .filter(Boolean)
      .join(' ');
    const isGroup = el.type === 'radio' || (el.type === 'checkbox' && el.name && document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`).length > 1);
    const question = isGroup ? groupQuestion(el) : '';
    const context = label ? '' : contextText(el);
    return {
      label: norm(question || label),
      attrs: norm(attrs),
      context: norm(context),
      display: clip(question || label || context || el.getAttribute('placeholder') || el.name || el.id || 'Unlabelled field', 90),
      autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop(),
      required:
        el.required ||
        el.getAttribute('aria-required') === 'true' ||
        /\*\s*$|\*/.test(question || label || context),
    };
  }

  const SECTION_HEAD = 'h1,h2,h3,h4,h5,h6,legend,[role="heading"],[data-automation-id*="Header"],[data-automation-id*="header"]';
  const sectionCache = new WeakMap();
  function sectionOf(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      if (sectionCache.has(node)) return sectionCache.get(node);
      let head = '';
      const own = node.querySelector(':scope > ' + SECTION_HEAD.split(',').join(', :scope > ')) || (node.tagName === 'FIELDSET' && node.querySelector('legend'));
      if (own) head = norm(textOf(own));
      if (!head && node.getAttribute('aria-labelledby')) head = norm(byIds(node.getAttribute('aria-labelledby'), node.getRootNode()));
      if (!head && node.getAttribute('aria-label')) head = norm(node.getAttribute('aria-label'));
      let kind = null;
      if (head) {
        if (/work experience|experience|employment|work history|professional history|previous (job|position|role)s?|positions? held/.test(head)) kind = 'experience';
        else if (/education|academic|school|universit|qualification|degree/.test(head)) kind = 'education';
      }
      if (kind) { sectionCache.set(node, kind); return kind; }
      if (node === document.body) break;
    }
    return null;
  }

  function classify(el, d, section = null) {
    const type = (el.type || '').toLowerCase();
    if (d.autocomplete && AUTOCOMPLETE[d.autocomplete] && d.autocomplete !== 'off' && d.autocomplete !== 'on') {
      return { key: AUTOCOMPLETE[d.autocomplete], score: 10 };
    }
    if (type === 'email') return { key: 'email', score: 9 };
    if (type === 'tel' && !/code|extension/.test(d.label + d.attrs)) return { key: 'phone', score: 8 };

    let best = null;
    const sources = [
      [d.label, 3],
      [d.attrs, 2],
      [d.context, 1.5],
    ];
    RULES.forEach((rule, idx) => {
      if (rule.section && !(section && (rule.section === true || rule.section === section))) return;
      let score = 0;
      for (const [text, w] of sources) {
        if (!text) continue;
        if (rule.re.test(text) && !(rule.not && rule.not.test(text))) score = Math.max(score, w);
      }
      // a label that says something different outranks a hint in the name attribute
      if (score && score < 3 && d.label && !rule.re.test(d.label) && RULES.some((r) => r !== rule && r.re.test(d.label) && !(r.not && r.not.test(d.label)))) {
        score -= 1.2;
      }
      if (score > 0) {
        const s = score - idx * 0.001;
        if (!best || s > best.score) best = { key: rule.key, score: s };
      }
    });
    if (best && LONG_KEYS.has(best.key) && el.tagName !== 'TEXTAREA' && !el.isContentEditable) return null;
    return best;
  }

  // Never fill or remember these: government IDs, bank / card details, passwords
  const SENSITIVE_RE = /social security|\bssn\b|aadh?aar|\bpan (card|number|no)\b|passport (no|number|#)|national (id|insurance)|\bnin\b|bank account|account (number|no)|routing|\bifsc\b|\biban\b|\bswift\b|sort code|credit card|debit card|card number|\bcvv\b|\bcvc\b|expir(y|ation) date|tax (id|file|identification)|\btin\b|\bitin\b|licen[cs]e number|password|passcode|\botp\b|security (code|answer|question)|mother s maiden|(atm|card|security) pin/;
  const isSensitive = (text) => SENSITIVE_RE.test(norm(text));

  // Capitalised names inside a question ("Acme" in "Why do you want to work at Acme?")
  const properNouns = (q) =>
    String(q || '')
      .split(/[^A-Za-z0-9&'.-]+/)
      .slice(1)
      .filter((w) => /^[A-Z][a-zA-Z0-9&'.-]+$/.test(w) && !/^(I|I'm|LinkedIn|GitHub|US|USA|UK|EU|CV|GPA|CTC|Yes|No|Please|If|What|Why|How|When|Where|Which)$/.test(w))
      .map((w) => w.toLowerCase().replace(/[.']+$/, ''));

  function customAnswer(question, qa) {
    let best = null;
    const newNouns = properNouns(question);
    for (const item of qa || []) {
      if (!item || !item.question || !item.answer) continue;
      const savedNouns = properNouns(item.question);
      // A saved answer about one company must never be reused for another
      if (savedNouns.some((n) => !norm(question).includes(n))) continue;
      // Generic saved question ("…work here?") can match a company-specific one ("…work at Globex?")
      const strip = (q, nouns) => nouns.reduce((t, n) => t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' '), q);
      const a = strip(question, newNouns).replace(/\b(here|there|us|our company|this company|at|join)\b/gi, ' ');
      const b = strip(item.question, savedNouns).replace(/\b(here|there|us|our company|this company|at|join)\b/gi, ' ');
      const nq = norm(question);
      const nk = norm(item.question);
      let s = similarity(a, b);
      if (nq && nk && (nq === nk || (nk.length > 12 && nq.includes(nk)))) s = Math.max(s, 0.95);
      if (!best || s > best.score) best = { answer: item.answer, score: s, question: item.question };
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Choosing among options (selects, radios, custom dropdowns)
  // ---------------------------------------------------------------------------
  const COUNTRY_ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
    ['united kingdom', 'uk', 'u k', 'great britain', 'britain', 'england', 'gb'],
    ['india', 'in', 'ind', 'bharat'],
    ['united arab emirates', 'uae', 'emirates'],
    ['canada', 'ca', 'can'],
    ['germany', 'de', 'deutschland'],
    ['australia', 'au', 'aus'],
    ['netherlands', 'nl', 'holland', 'the netherlands'],
    ['south korea', 'korea', 'republic of korea', 'korea republic of'],
  ];
  const DECLINE = /decline|prefer not|do not wish|don t wish|dont wish|not wish|choose not|rather not|not to (say|answer|disclose|self identify)|not specified|i don t want/;
  const PLACEHOLDER = /^(select|choose|please select|please choose|pick|none selected|\-+|—|select one|select an option|\s*)$/;

  const yesish = (s) => !noish(s) && /^(yes|y|true|i am|i do|i will|i have|i can|i would)\b/.test(norm(s));
  const noish = (s) => /^(no|n|false|i am not|i do not|i don t|i will not|i won t|i have not|i cannot|i can t)\b/.test(norm(s));

  function aliasSet(v) {
    const n = norm(v);
    const group = COUNTRY_ALIASES.find((g) => g.includes(n));
    return group || [n];
  }

  function parseRange(text) {
    const t = String(text || '').toLowerCase().replace(/,/g, '');
    let m = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|and)\s*(\d+(?:\.\d+)?)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    m = t.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|or above|and above|and over|plus)|(?:more than|over|above|at least|greater than)\s*(\d+(?:\.\d+)?)/);
    if (m) return [parseFloat(m[1] || m[2]), Infinity];
    m = t.match(/(?:less than|under|below|up to|fewer than)\s*(\d+(?:\.\d+)?)/);
    if (m) return [0, parseFloat(m[1])];
    m = t.match(/^(\d+(?:\.\d+)?)\b/);
    if (m) return [parseFloat(m[1]), parseFloat(m[1])];
    return null;
  }

  // options: [{text, value, ref}] → best option or null
  function pickOption(options, desired, key) {
    const real = options.filter((o) => !PLACEHOLDER.test(norm(o.text)) || (o.value && !PLACEHOLDER.test(norm(o.value)) && norm(o.text)));
    if (!real.length || desired == null || desired === '') return null;
    const want = norm(desired);

    if (YES_NO_KEYS.has(key) || want === 'yes' || want === 'no') {
      const isYes = /^(yes|y|true)$/.test(want);
      const isNo = /^(no|n|false)$/.test(want);
      if (isYes || isNo) {
        const hit = real.find((o) => (isYes ? yesish(o.text) : noish(o.text)));
        if (hit) return hit;
      }
    }
    if (DECLINE.test(want)) {
      const hit = real.find((o) => DECLINE.test(norm(o.text)));
      if (hit) return hit;
    }
    const aliases = aliasSet(desired);
    let hit = real.find((o) => aliases.includes(norm(o.text)) || aliases.includes(norm(o.value)));
    if (hit) return hit;

    if (key === 'yearsExperience' || /^\d+(\.\d+)?$/.test(want)) {
      const n = parseFloat(want);
      if (!isNaN(n)) {
        hit = real.find((o) => {
          const r = parseRange(o.text);
          return r && n >= r[0] && n <= r[1];
        });
        if (hit) return hit;
      }
    }

    // starts-with / contains (avoid "male" ↔ "female", "no" ↔ "not")
    const wordRe = new RegExp(`(^|\\s)${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    hit = real.find((o) => norm(o.text).startsWith(want + ' ') || wordRe.test(norm(o.text)));
    if (hit && want.length >= 2) return hit;
    hit = real.find((o) => {
      const t = norm(o.text);
      return t.length >= 3 && new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(want);
    });
    if (hit) return hit;

    // token similarity as a last resort
    let best = null;
    real.forEach((o) => {
      const s = similarity(o.text, desired);
      if (s >= 0.6 && (!best || s > best.s)) best = { o, s };
    });
    return best ? best.o : null;
  }

  // ---------------------------------------------------------------------------
  // Setting values so React / Vue / Angular notice
  // ---------------------------------------------------------------------------
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }

  function fire(el, ...types) {
    for (const t of types) {
      const ev = t === 'input' ? new InputEvent('input', { bubbles: true, composed: true }) : new Event(t, { bubbles: true, composed: true });
      el.dispatchEvent(ev);
    }
  }

  function typeText(el, value) {
    el.focus({ preventScroll: true });
    fire(el, 'focus', 'focusin');
    setNativeValue(el, value);
    fire(el, 'input', 'change');
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    el.blur();
    fire(el, 'blur', 'focusout');
  }

  let DATE_PREF = 'auto';
  function formatDate(iso, el) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return iso;
    const [, y, mo, d = '01'] = m;
    const type = (el.type || '').toLowerCase();
    if (type === 'date') return `${y}-${mo}-${d}`;
    if (type === 'month') return `${y}-${mo}`;
    const ph = norm(el.getAttribute('placeholder') + ' ' + labelText(el));
    if (/dd mm yyyy|dd mm yy/.test(ph)) return `${d}/${mo}/${y}`;
    if (/mm yyyy|mm yy/.test(ph) && !/dd/.test(ph)) return `${mo}/${y}`;
    if (/yyyy mm dd/.test(ph)) return `${y}-${mo}-${d}`;
    if (/\byyyy\b/.test(ph) && !/mm/.test(ph)) return y;
    if (/^(year)$|\byear\b/.test(ph) && !/month|mm/.test(ph)) return y;
    if (/^(month)$|\bmonth\b/.test(ph) && !/year|yy/.test(ph)) return String(Number(mo));
    let pref = DATE_PREF;
    if (pref === 'auto') pref = /^en-us|^en-ph|^en-ca/i.test(navigator.language || '') ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
    return pref === 'MM/DD/YYYY' ? `${mo}/${d}/${y}` : `${d}/${mo}/${y}`;
  }

  function adaptValue(el, key, value) {
    if (value == null) return '';
    let v = String(value);
    if (/date|range/i.test(key) || key === 'dateOfBirth' || (el.type || '').match(/^(date|month)$/)) {
      if (/^\d{4}-\d{2}/.test(v)) v = formatDate(v, el);
    }
    if (key === 'graduationDate' && /\byear\b/.test(norm(labelText(el) + ' ' + el.name)) && /^\d{4}/.test(String(value))) {
      v = String(value).slice(0, 4);
    }
    if ((el.type || '') === 'number') {
      const n = String(v).match(/-?\d+(\.\d+)?/);
      v = n ? n[0] : '';
    }
    const max = el.maxLength;
    if (max && max > 0 && v.length > max) v = v.slice(0, max);
    return v;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 1500, step = 60) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return fn();
  }

  function visibleOptions(near) {
    const scope = near?.getAttribute?.('aria-controls') || near?.getAttribute?.('aria-owns');
    const owned = scope && document.getElementById(scope);
    const list = owned ? owned.querySelectorAll('[role="option"]') : document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]');
    return [...list].filter(isVisible).map((n) => ({ text: textOf(n) || n.getAttribute('aria-label') || '', value: '', ref: n }));
  }

  function clickLike(node) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    node.dispatchEvent(new PointerEvent('pointerdown', opts));
    node.dispatchEvent(new MouseEvent('mousedown', opts));
    node.dispatchEvent(new PointerEvent('pointerup', opts));
    node.dispatchEvent(new MouseEvent('mouseup', opts));
    node.click();
  }

  async function fillCombobox(el, value, key) {
    const isInput = el.tagName === 'INPUT';
    if (isInput) {
      el.focus();
      clickLike(el);
      setNativeValue(el, String(value).slice(0, 40));
      fire(el, 'input');
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    } else {
      clickLike(el);
    }
    let opts = await waitFor(() => {
      const o = visibleOptions(el);
      return o.length ? o : null;
    }, 1800);
    if (!opts || !opts.length) {
      if (isInput) {
        // free-text combobox (e.g. location autocompletes): leave the typed value
        fire(el, 'change');
        return 'typed';
      }
      return false;
    }
    let choice = pickOption(opts, value, key);
    if (!choice && isInput) {
      // retry with a shorter query (first word)
      setNativeValue(el, String(value).split(/[ ,]/)[0]);
      fire(el, 'input');
      await sleep(400);
      opts = visibleOptions(el);
      choice = pickOption(opts, value, key);
    }
    if (!choice) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      if (isInput) { setNativeValue(el, ''); fire(el, 'input'); }
      return false;
    }
    clickLike(choice.ref);
    await sleep(120);
    return choice.text;
  }

  async function attachResume(el, resume) {
    const res = await fetch(resume.dataUrl);
    const blob = await res.blob();
    const file = new File([blob], resume.name, { type: resume.type || blob.type, lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    fire(el, 'input', 'change');
    return resume.name;
  }

  // ---------------------------------------------------------------------------
  // Highlighting + on-page summary
  // ---------------------------------------------------------------------------
  function ensureStyle() {
    if (document.getElementById('lazyform-style')) return;
    const st = document.createElement('style');
    st.id = 'lazyform-style';
    st.textContent = `
      [${MARK_ATTR}="filled"]{outline:2px solid #22a35a !important;outline-offset:2px !important;border-radius:6px;transition:outline-color .3s}
      [${MARK_ATTR}="review"]{outline:2px dashed #e0a030 !important;outline-offset:2px !important;border-radius:6px}`;
    (document.head || document.documentElement).appendChild(st);
  }

  function clearMarks() {
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((n) => n.removeAttribute(MARK_ATTR));
  }

  function markTarget(el) {
    if (el.type === 'radio' || el.type === 'checkbox') {
      return el.closest('fieldset, [role="radiogroup"], [role="group"]') || el.parentElement || el;
    }
    if (el.type === 'file') return el.closest('label, div') || el;
    return el;
  }

  function showPanel(result) {
    document.getElementById('lazyform-panel-host')?.remove();
    if (window.top !== window && !result.filled.length) return;
    const host = document.createElement('div');
    host.id = 'lazyform-panel-host';
    host.setAttribute(UI_ATTR, '');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const root = host.attachShadow({ mode: 'closed' });
    const review = result.skipped.filter((s) => s.attention);
    root.innerHTML = `
      <style>
        :host{all:initial}
        .card{font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0a0a0a;background:#fff;border:1px solid #ebebeb;border-radius:20px;
          box-shadow:0 24px 48px -20px rgba(0,0,0,.28);width:310px;max-height:60vh;display:flex;flex-direction:column;overflow:hidden;letter-spacing:-.005em}
        header{display:flex;align-items:center;gap:10px;padding:14px 16px 10px}
        .dot{width:20px;height:20px;border-radius:50%;flex:none;background:radial-gradient(circle at 30% 28%,#ffd3a8 0 18%,transparent 46%),radial-gradient(circle at 72% 30%,#b9c6ff 0 20%,transparent 52%),radial-gradient(circle at 46% 78%,#ffb4d6 0 22%,transparent 56%),radial-gradient(circle,#9fe3ff,#c7b8ff 70%)}
        h2{font-size:14.5px;font-weight:600;letter-spacing:-.02em;margin:0;flex:1}
        button{font:inherit;cursor:pointer}
        .x{border:0;background:#f5f5f5;font-size:15px;line-height:1;color:#555;width:28px;height:28px;border-radius:50%}
        .x:hover,.x:focus-visible{background:#ebebeb;outline:none}
        .body{padding:4px 16px 14px;overflow:auto}
        p{margin:0 0 8px;color:#555}
        ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
        li button{width:100%;text-align:left;border:0;background:#f5f5f5;color:#0a0a0a;border-radius:12px;padding:8px 10px}
        li button:hover,li button:focus-visible{background:#ebebeb;outline:none}
        .req{color:#9a5b00;font-weight:600}
        .foot{font-size:12px;color:#6e6e6e;margin-top:12px}
        @media (prefers-color-scheme: dark){
          .card{background:#121212;color:#f7f7f7;border-color:#262626}
          p{color:#b5b5b5} .foot{color:#a0a0a0}
          li button{background:#1a1a1a;color:#f7f7f7} li button:hover{background:#262626}
          .x{background:#1a1a1a;color:#b5b5b5} .x:hover{background:#262626} .req{color:#f5b84a}
        }
      </style>
      <div class="card" role="status" aria-live="polite">
        <header><span class="dot" aria-hidden="true"></span>
          <h2>Filled ${result.filled.length} field${result.filled.length === 1 ? '' : 's'}</h2>
          <button class="x" aria-label="Close LazyForm summary">×</button></header>
        <div class="body">
          ${review.length ? `<p>${review.length} need${review.length === 1 ? 's' : ''} your attention:</p><ul></ul>` : '<p>Nothing obvious left — check the form before you submit.</p>'}
          <div class="foot">Green = filled · dashed amber = check yourself. Nothing was submitted.</div>
        </div>
      </div>`;
    const ul = root.querySelector('ul');
    review.slice(0, 30).forEach((s) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.innerHTML = `${s.required ? '<span class="req">Required · </span>' : ''}`;
      b.append(document.createTextNode(s.label));
      b.addEventListener('click', () => {
        const target = s.el;
        if (target && target.isConnected) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => target.focus?.({ preventScroll: true }), 300);
        }
      });
      li.append(b);
      ul.append(li);
    });
    const close = () => host.remove();
    root.querySelector('.x').addEventListener('click', close);
    root.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    (document.body || document.documentElement).appendChild(host);
  }

  // ---------------------------------------------------------------------------
  // Main: scan + fill
  // ---------------------------------------------------------------------------
  function buildFields() {
    const controls = collectControls().filter(isUsable);
    const fields = [];
    const seenGroups = new Set();
    for (const el of controls) {
      const type = (el.type || '').toLowerCase();
      if (el.tagName === 'INPUT' && (type === 'radio' || (type === 'checkbox' && el.name))) {
        const groupKey = el.form ? `${type}:${el.name}:${[...document.forms].indexOf(el.form)}` : `${type}:${el.name}`;
        const members = el.name
          ? [...(el.form || el.getRootNode()).querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`)]
          : [el];
        if (el.name && seenGroups.has(groupKey)) continue;
        seenGroups.add(groupKey);
        if (type === 'checkbox' && members.length === 1) {
          fields.push({ kind: 'checkbox', el, d: describe(el) });
        } else {
          fields.push({ kind: type === 'radio' ? 'radio' : 'checkgroup', el, members, d: describe(el) });
        }
        continue;
      }
      if (type === 'checkbox') {
        fields.push({ kind: 'checkbox', el, d: describe(el) });
        continue;
      }
      if (type === 'file') {
        fields.push({ kind: 'file', el, d: describe(el) });
        continue;
      }
      if (el.tagName === 'SELECT') {
        fields.push({ kind: 'select', el, d: describe(el) });
        continue;
      }
      const role = el.getAttribute('role');
      const isCombo =
        role === 'combobox' ||
        (el.getAttribute('aria-haspopup') === 'listbox' && el.tagName !== 'INPUT') ||
        (el.tagName === 'INPUT' && el.getAttribute('aria-autocomplete') === 'list');
      if (isCombo && el.tagName !== 'TEXTAREA') {
        // buttons that open a listbox but sit inside another combobox are handled by it
        if (el.tagName !== 'INPUT' && el.querySelector('input')) continue;
        fields.push({ kind: 'combo', el, d: describe(el) });
        continue;
      }
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') fields.push({ kind: 'text', el, d: describe(el) });
    }
    return fields;
  }

  function isFilled(f) {
    const el = f.el;
    if (f.kind === 'radio' || f.kind === 'checkgroup') return f.members.some((m) => m.checked);
    if (f.kind === 'checkbox') return el.checked;
    if (f.kind === 'file') return el.files && el.files.length > 0;
    if (f.kind === 'select') {
      const o = el.options[el.selectedIndex];
      return !!(o && el.selectedIndex > 0 && o.value !== '' && !PLACEHOLDER.test(norm(o.text)));
    }
    if (f.kind === 'combo' && el.tagName !== 'INPUT') {
      const t = norm(textOf(el));
      return !!t && !PLACEHOLDER.test(t) && !/^select/.test(t);
    }
    return !!String(el.value || '').trim();
  }

  async function loadData() {
    const { profile = {}, settings = {}, resume = null } = await chrome.storage.local.get(['profile', 'settings', 'resume']);
    return { profile, settings: { overwrite: false, highlight: true, showPanel: true, ...settings }, resume };
  }

  // Experience / education blocks: which entry field i belongs to
  const SECTION_MAP = {
    experience: { currentTitle: 'title', currentCompany: 'company', location: 'location', city: 'location', rangeStart: 'startDate', rangeEnd: 'endDate', availableStartDate: 'startDate', jobDescription: 'description', summary: 'description', currentlyHere: '__current' },
    education: { school: 'school', degree: 'degree', fieldOfStudy: 'fieldOfStudy', gpa: 'gpa', rangeStart: 'startDate', rangeEnd: 'endDate', graduationDate: 'endDate', availableStartDate: 'startDate' },
  };

  // Work out key + section + entry index for every field, in page order
  function plan(fields, profile) {
    const counters = {};
    for (const f of fields) {
      if (f.kind === 'file') continue;
      const section = sectionOf(f.el);
      const cls = classify(f.el, f.d, section);
      f.cls = cls;
      f.section = null;
      if (cls && section && SECTION_MAP[section][cls.key]) {
        const ck = section + ':' + cls.key;
        f.section = section;
        f.entryIndex = counters[ck] = ck in counters ? counters[ck] + 1 : 0;
        f.entryField = SECTION_MAP[section][cls.key];
      }
    }
    return fields;
  }

