// Fixture data shaped exactly like the Core responses. Deleted when the
// authed data path lands; the components never know the difference.
export const RANKS = [
  { order: 1, name: 'White',  color: '#D8DCE0' },
  { order: 2, name: 'Yellow', color: '#E6C229' },
  { order: 3, name: 'Orange', color: '#CC6B2C' },
  { order: 4, name: 'Green',  color: '#3E7D5C' },
  { order: 5, name: 'Blue',   color: '#2C6FA8' },
  { order: 6, name: 'Purple', color: '#6A5090' },
  { order: 7, name: 'Brown',  color: '#6B4A33' },
  { order: 8, name: 'Black',  color: '#1B242C' },
  { order: 9, name: 'Sensei', color: '#B8863B' },
];
export const FIXTURE_LEARNER = {
  firstName: 'Maria',
  rank: RANKS[0],
  nextStep: 'Two lessons stand between you and Orange.',
  resume: { course: 'NC Employment Law — Orange Belt', lesson: 'Module 4 · Final pay and deductions', href: '/preview' },
};
