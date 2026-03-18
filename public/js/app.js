const FLAG = `<svg viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="20" fill="#1a1200"/><rect width="28" height="7" fill="#c8a000"/><rect y="13" width="28" height="7" fill="#8a6e00"/><circle cx="14" cy="10" r="4" fill="#f5c800" opacity="0.95"/><circle cx="14" cy="10" r="2" fill="#fff8cc"/></svg>`;

const PKG = {
  solo: { icon: '🗡️', name: 'Solo', max: 1, price: 5000 },
  duo:  { icon: '⚔️', name: 'Duo',  max: 2, price: 2000 },
  trio: { icon: '🔱', name: 'Trio', max: 3, price: 1500 }
};

const EQ = {
  none:    { name: 'Bez wypożyczenia', price: 0, deposit: 0, bonus: null },
  full:    { name: 'Pełny set', price: 500, deposit: 30000, bonus: 60, items: 'Buty + Tarcza + Naszyjnik' },
  partial: { name: 'Naszyjnik + Buty', price: 300, deposit: 10000, bonus: 40, items: 'Naszyjnik + Buty' }
};

const STATUS = {
  pending:  { label: 'Oczekuje',      cls: 'b-pending' },
  active:   { label: 'Potwierdzone',  cls: 'b-active' },
  done:     { label: 'Ukończone',     cls: 'b-done' },
  rejected: { label: 'Odrzucone',     cls: 'b-rejected' },
  cancelled:{ label: 'Anulowane',     cls: 'b-rejected' }
};

function badge(status) {
  const s = STATUS[status] || { label: status, cls: 'b-pending' };
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

const HCAPTCHA_SITE_KEY = '638a1d80-4b9c-44d2-9f2e-e78c063a2580';
