// Every piece of profile data the setup page collects.
const YES_NO = ['', 'Yes', 'No'];

export const SECTIONS = [
  {
    id: 'personal',
    title: 'Personal',
    blurb: 'The basics nearly every application asks for.',
    fields: [
      { key: 'firstName', label: 'First name', required: true, autocomplete: 'given-name' },
      { key: 'lastName', label: 'Last name', required: true, autocomplete: 'family-name' },
      { key: 'middleName', label: 'Middle name' },
      { key: 'preferredName', label: 'Preferred name', hint: 'Used for “What should we call you?”' },
      { key: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
      { key: 'phone', label: 'Phone number', type: 'tel', required: true, autocomplete: 'tel', placeholder: '+91 98765 43210' },
      { key: 'phoneCountryCode', label: 'Phone country code', placeholder: '+91' },
      { key: 'pronouns', label: 'Pronouns', type: 'select', options: ['', 'She/her', 'He/him', 'They/them', 'Prefer not to say'] },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', hint: 'Only used when a form explicitly asks.' },
    ],
  },
  {
    id: 'address',
    title: 'Address',
    blurb: 'Location fields and “Where are you based?” questions.',
    fields: [
      { key: 'street', label: 'Street address', wide: true, autocomplete: 'address-line1' },
      { key: 'street2', label: 'Apartment, suite, etc.', wide: true, autocomplete: 'address-line2' },
      { key: 'city', label: 'City', autocomplete: 'address-level2' },
      { key: 'state', label: 'State / province', autocomplete: 'address-level1' },
      { key: 'postalCode', label: 'Postal / ZIP code', autocomplete: 'postal-code' },
      { key: 'country', label: 'Country', autocomplete: 'country-name' },
      { key: 'nationality', label: 'Citizenship / nationality' },
    ],
  },
  {
    id: 'links',
    title: 'Links',
    blurb: 'Profiles recruiters like to see.',
    fields: [
      { key: 'linkedin', label: 'LinkedIn', type: 'url', placeholder: 'https://linkedin.com/in/…', wide: true },
      { key: 'github', label: 'GitHub', type: 'url', placeholder: 'https://github.com/…', wide: true },
      { key: 'portfolio', label: 'Portfolio / website', type: 'url', placeholder: 'https://…', wide: true },
      { key: 'twitter', label: 'X / Twitter', type: 'url', wide: true },
    ],
  },
  {
    id: 'work',
    title: 'Current role & expectations',
    blurb: 'Leave job title and company empty to use your most recent experience entry.',
    fields: [
      { key: 'currentTitle', label: 'Current job title' },
      { key: 'currentCompany', label: 'Current company' },
      { key: 'yearsExperience', label: 'Years of experience', type: 'number', placeholder: '3' },
      { key: 'noticePeriod', label: 'Notice period', placeholder: '30 days' },
      { key: 'availableStartDate', label: 'Earliest start date', type: 'date' },
      { key: 'workMode', label: 'Work-mode preference', type: 'select', options: ['', 'Remote', 'Hybrid', 'On-site', 'Flexible'] },
      { key: 'currentSalary', label: 'Current salary', placeholder: '12,00,000 INR' },
      { key: 'expectedSalary', label: 'Expected salary', placeholder: '18,00,000 INR' },
    ],
  },
  { id: 'experience', title: 'Work experience', blurb: 'Most recent first. The first entry fills “current company / title”.', repeat: 'experience' },
  { id: 'education', title: 'Education', blurb: 'Highest or most recent first. The first entry fills school, degree and major.', repeat: 'education' },
  {
    id: 'writing',
    title: 'Skills & writing',
    blurb: 'Reusable text for the longer questions.',
    fields: [
      { key: 'skills', label: 'Skills', type: 'textarea', rows: 2, wide: true, placeholder: 'Python, React, SQL, Product analytics…' },
      { key: 'languages', label: 'Languages you speak', wide: true, placeholder: 'English, Hindi' },
      { key: 'summary', label: 'Professional summary / “About you”', type: 'textarea', rows: 4, wide: true },
      { key: 'coverLetter', label: 'Default cover letter', type: 'textarea', rows: 7, wide: true, hint: 'Pasted into “Cover letter” text boxes. Tailor it before you submit.' },
      { key: 'howHeard', label: '“How did you hear about us?”', placeholder: 'LinkedIn' },
    ],
  },
  {
    id: 'eligibility',
    title: 'Work eligibility',
    blurb: 'Yes/no questions most applications include.',
    fields: [
      { key: 'authorizedToWork', label: 'Legally authorised to work where you’re applying?', type: 'select', options: YES_NO },
      { key: 'requireSponsorship', label: 'Will you need visa sponsorship?', type: 'select', options: YES_NO },
      { key: 'willingToRelocate', label: 'Willing to relocate?', type: 'select', options: YES_NO },
      { key: 'over18', label: 'Are you 18 or older?', type: 'select', options: YES_NO },
    ],
  },
  {
    id: 'eeo',
    title: 'Voluntary disclosures',
    blurb: 'Optional equal-opportunity questions (common on US forms). Leave blank and LazyForm won’t touch them.',
    fields: [
      { key: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Non-binary', 'Decline to self-identify'] },
      { key: 'hispanic', label: 'Hispanic or Latino?', type: 'select', options: ['', 'Yes', 'No', 'Decline to self-identify'] },
      {
        key: 'race', label: 'Race / ethnicity', type: 'select',
        options: ['', 'Asian', 'Black or African American', 'Hispanic or Latino', 'White', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Two or More Races', 'Decline to self-identify'],
      },
      { key: 'veteran', label: 'Veteran status', type: 'select', options: ['', 'I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'Decline to self-identify'] },
      { key: 'disability', label: 'Disability', type: 'select', options: ['', 'No, I do not have a disability', 'Yes, I have a disability (or previously had a disability)', 'Decline to self-identify'] },
    ],
  },
  { id: 'resume', title: 'Resume', blurb: 'Attached automatically to resume / CV upload fields.', special: 'resume' },
  { id: 'answers', title: 'Saved answers', blurb: 'Your answers to any other question. LazyForm matches them to similar wording on new forms.', special: 'qa' },
  { id: 'settings', title: 'Settings & data', blurb: '', special: 'settings' },
];

export const REPEATS = {
  experience: {
    noun: 'position',
    fields: [
      { key: 'title', label: 'Job title' },
      { key: 'company', label: 'Company' },
      { key: 'location', label: 'Location' },
      { key: 'startDate', label: 'Start', type: 'month' },
      { key: 'endDate', label: 'End', type: 'month', hint: 'Leave empty if current' },
      { key: 'description', label: 'What you did', type: 'textarea', rows: 3, wide: true },
    ],
  },
  education: {
    noun: 'school',
    fields: [
      { key: 'school', label: 'School / university', wide: true },
      { key: 'degree', label: 'Degree', placeholder: 'Bachelor of Technology' },
      { key: 'fieldOfStudy', label: 'Field of study', placeholder: 'Computer Science' },
      { key: 'startDate', label: 'Start', type: 'month' },
      { key: 'endDate', label: 'Graduation', type: 'month' },
      { key: 'gpa', label: 'GPA / grade', placeholder: '8.6 / 10' },
    ],
  },
};

export const DEFAULT_SETTINGS = { overwrite: false, highlight: true, showPanel: true, dateFormat: 'auto' };
