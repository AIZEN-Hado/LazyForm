import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

// Controlled inputs: React ignores values set without proper events.
function Combo({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const id = label.replace(/\W+/g, '-').toLowerCase();
  const shown = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="field">
      <label id={id + '-l'} htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id + '-lb'}
        value={open ? q : value} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && (
        <ul id={id + '-lb'} role="listbox" aria-labelledby={id + '-l'} style={{ border: '1px solid #ccc', padding: 4, margin: 0 }}>
          {shown.map((o) => (
            <li key={o} role="option" aria-selected={o === value} style={{ listStyle: 'none', padding: 4, cursor: 'pointer' }}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setQ(''); setOpen(false); }}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Workday({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <label id="wd-l">{label}</label>
      <button type="button" aria-haspopup="listbox" aria-labelledby="wd-l wd-b" id="wd-b" onClick={() => setOpen(!open)}>{value || 'Select One'}</button>
      {open && (
        <div role="listbox">
          {options.map((o) => <div key={o} role="option" data-automation-id="promptOption" onClick={() => { onChange(o); setOpen(false); }}>{o}</div>)}
        </div>
      )}
    </div>
  );
}

function App() {
  const [s, set] = useState({ firstName: '', lastName: '', email: '', phone: '', exp: '', auth: '', country: '', degree: '', start: '', city: '' });
  const up = (k) => (e) => set((p) => ({ ...p, [k]: e.target ? e.target.value : e }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); window.__submitted = (window.__submitted || 0) + 1; }}>
      <div className="field"><label htmlFor="fn">Legal first name</label><input id="fn" value={s.firstName} onChange={up('firstName')} /></div>
      <div className="field"><label htmlFor="ln">Legal last name</label><input id="ln" value={s.lastName} onChange={up('lastName')} /></div>
      <div className="field"><label htmlFor="em">Email address</label><input id="em" type="email" value={s.email} onChange={up('email')} /></div>
      <div className="field"><label htmlFor="ph">Mobile number</label><input id="ph" type="tel" value={s.phone} onChange={up('phone')} /></div>
      <div className="field"><label htmlFor="sd">Earliest start date</label><input id="sd" type="date" value={s.start} onChange={up('start')} /></div>
      <div className="field"><label htmlFor="ex">How many years of experience do you have?</label>
        <select id="ex" value={s.exp} onChange={up('exp')}><option value="">Select</option><option value="a">Less than 2</option><option value="b">2 to 4</option><option value="c">5 or more</option></select></div>
      <fieldset><legend>Are you legally authorized to work in India?</legend>
        <label><input type="radio" name="auth" value="Yes" checked={s.auth === 'Yes'} onChange={up('auth')} /> Yes</label>
        <label><input type="radio" name="auth" value="No" checked={s.auth === 'No'} onChange={up('auth')} /> No</label>
      </fieldset>
      <Combo label="Country" options={['Canada', 'India', 'United Kingdom', 'United States']} value={s.country} onChange={up('country')} />
      <Combo label="City" options={[]} value={s.city} onChange={up('city')} />
      <Workday label="Highest degree" options={["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate']} value={s.degree} onChange={up('degree')} />
      <pre id="state">{JSON.stringify(s)}</pre>
      <button type="submit">Submit</button>
    </form>
  );
}

createRoot(document.getElementById('root')).render(<App />);
