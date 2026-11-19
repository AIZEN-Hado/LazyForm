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
