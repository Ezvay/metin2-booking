// Shared nav logic
async function initNav(activePage) {
  const data = await fetch('/api/session').then(r => r.json());
  if (data.loggedIn) {
    const login = document.getElementById('navLogin');
    const register = document.getElementById('navRegister');
    const user = document.getElementById('navUser');
    const logout = document.getElementById('logoutForm');
    const dashboard = document.getElementById('navDashboard');
    const admin = document.getElementById('navAdmin');
    if (login) login.style.display = 'none';
    if (register) register.style.display = 'none';
    if (user) { user.style.display = ''; user.textContent = '👤 ' + data.username; }
    if (logout) logout.style.display = '';
    if (dashboard) dashboard.style.display = '';
    if (admin && data.role === 'admin') admin.style.display = '';
  }
  return data;
}

const FLAG_SVG = '<svg viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="20" fill="#1a1200"/><rect width="28" height="7" fill="#c8a000"/><rect y="13" width="28" height="7" fill="#8a6e00"/><circle cx="14" cy="10" r="4" fill="#f5c800" opacity="0.95"/><circle cx="14" cy="10" r="2" fill="#fff8cc"/></svg>';

const STATUS_LABELS = { pending: 'Oczekuje', active: 'W toku', done: 'Ukonczone', rejected: 'Odrzucone' };
const STATUS_BADGES = { pending: 'badge-pending', active: 'badge-active', done: 'badge-done', rejected: 'badge-rejected' };
const PARTY_ICONS = { 1: '🗡️', 2: '⚔️', 3: '🔱' };
const PARTY_NAMES = { 1: 'Solo', 2: 'Duo', 3: 'Trio' };
