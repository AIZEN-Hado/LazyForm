# LazyForm – Job Application Autofill

Save your details once, then fill job application forms in one click. Works on Greenhouse, Lever, Ashby, Workday-style pages, company career sites and most other web forms. It **never submits** anything — you always review and click Submit yourself.

## Install (2 minutes)

1. Unzip `lazyform-extension.zip` into a folder you'll keep (e.g. `Documents/LazyForm`).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
5. The setup page opens automatically. Pin the ⚡ LazyForm icon from the puzzle-piece menu so it's always visible.

## Set up your profile

Fill in the sections on the setup page — personal details, address, links, current role and salary, work experience, education, skills, cover letter, work-eligibility answers, optional diversity questions, and your resume file. Everything autosaves.

**Saved answers** is for any other question ("Why do you want to work here?", "Favourite project?"). LazyForm matches them to similar wording on new forms.

## Fill applications

**Auto-apply mode (recommended for career sites)**
Open the job's application page, click the ⚡ icon → **Start auto-apply** (or press Alt+Shift+Y if that shortcut is set). The first time, Chrome asks permission for LazyForm to work on the sites you open — that's what lets it keep going from page to page.

From then on, in that tab only, it fills by itself:
- every section and every step as you press Next,
- extra blocks that appear (e.g. after "Add another"),
- the next page of the application, and hand-offs to job platforms like Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS, Taleo, SuccessFactors and others.

If the application moves to a site it doesn't recognise, it pauses and asks **"Fill on this site?"** first. A small bar in the bottom-left shows it's on and how much it filled. Press **Stop** there or in the popup; closing the tab or 3 hours without activity also stops it. It never touches other tabs, never changes something you've edited, and never submits.

**Just this page**
Click the ⚡ icon → **Fill this page once**, or press **Alt+Shift+F**.

**What you'll see**
- **Green outline** – filled by LazyForm.
- **Dashed amber outline** – needs you: consent boxes, unrecognised required questions, dropdowns it couldn't match.
- Answer the leftovers yourself, then click **Save my new answers** in the popup — next time those questions fill automatically.

Several jobs or degrees? Add them in order (most recent first). When a form has multiple job or education blocks, the 1st block gets your 1st entry, the 2nd your 2nd, and so on.

## What it fills

Names, email, phone, address, city/state/country, LinkedIn/GitHub/portfolio, current title & company, years of experience (including range dropdowns like “5–10 years”), notice period, start date, current/expected salary, work authorisation, sponsorship, relocation, 18+, school/degree/major/GPA/graduation date, skills, summary, cover letter, “how did you hear about us”, EEO answers (only if you set them), your resume file, and any saved custom answers. It handles plain inputs, dropdowns, radio buttons, checkboxes, searchable comboboxes, Workday-style listboxes and forms embedded in iframes.

## What it deliberately doesn't do

- Submit forms or click “Next”.
- Tick consent / terms / “I certify” boxes — you should read those.
- Overwrite fields that already have something in them (switchable in Settings).
- Fill hidden or invisible fields (a known trick to harvest autofill data).
- Fill or remember sensitive numbers: government IDs (PAN, Aadhaar, SSN, passport), bank, card or tax details, passwords.
- Reuse a saved answer that names one company on another company's form.
- Solve CAPTCHAs or type passwords.

## Privacy

All data — profile, resume, saved answers — lives only in this browser's extension storage (`chrome.storage.local`). LazyForm has no server, makes no network requests, and has no analytics. It only touches a page when you click Fill / press the shortcut, or in the one tab where you switched auto-apply mode on. **Settings → Export backup** saves a JSON copy; **Delete all my data** wipes it.

### Permissions explained

| Permission | Why |
| --- | --- |
| `storage` | Keep your profile on this device |
| `activeTab` + `scripting` | Fill the current tab only when you click the icon or use the shortcut |
| Optional: access to sites you open | Only for auto-apply mode, so it can keep filling after the page changes. It still only runs in the tab where you switched it on. Settings → “Allow auto-apply mode” off removes the permission. |

## Known limits

- Very custom widgets (drag-and-drop date pickers, rich-text editors, some Workday dropdowns) may need a manual pick — they're flagged in amber.
- Location boxes that require choosing a suggestion: LazyForm types your city; select the suggestion if one appears.
- Chrome blocks all extensions on `chrome://` pages and the Chrome Web Store.
- Your resume must be 5 MB or smaller.
- Workday's split day/month/year date boxes may need a manual entry.
- Your data is stored unencrypted in Chrome's profile folder; on a shared computer, use your own Chrome profile.

## Files

```
manifest.json        MV3 manifest
background.js        shortcuts + auto-apply sessions
popup.html / popup/  toolbar popup
options.html / options/  profile setup page
content/filler.js    detection, matching and filling engine
content/session.js   auto-apply mode (on-page bar, follows steps)
lib/run.js           shared injection helpers
```
