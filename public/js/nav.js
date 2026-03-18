async function initNav() {
  const data = await fetch('/api/session').then(r => r.json());
  if (data.loggedIn) {
    const els = {
      navLogin: document.getElementById('navLogin'),
      navRegister: document.getElementById('navRegister'),
      navUser: document.getElementById('navUser'),
      logoutForm: document.getElementById('logoutForm'),
      navDashboard: document.getElementById('navDashboard'),
      navAdmin: document.getElementById('navAdmin')
    };
    if (els.navLogin) els.navLogin.style.display = 'none';
    if (els.navRegister) els.navRegister.style.display = 'none';
    if (els.navUser) { els.navUser.style.display = ''; els.navUser.textContent = '👤 ' + data.username; }
    if (els.logoutForm) els.logoutForm.style.display = '';
    if (els.navDashboard) els.navDashboard.style.display = '';
    if (els.navAdmin && data.role === 'admin') els.navAdmin.style.display = '';
  }
  return data;
}

const FLAG = '<svg viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="20" fill="#1a1200"/><rect width="28" height="7" fill="#c8a000"/><rect y="13" width="28" height="7" fill="#8a6e00"/><circle cx="14" cy="10" r="4" fill="#f5c800" opacity="0.95"/><circle cx="14" cy="10" r="2" fill="#fff8cc"/></svg>';
const STATUS_LABELS = { pending:'Oczekuje', active:'Potwierdzone', done:'Ukonczone', rejected:'Odrzucone', cancelled:'Anulowane' };
const STATUS_BADGES = { pending:'badge-pending', active:'badge-active', done:'badge-done', rejected:'badge-rejected', cancelled:'badge-rejected' };
const PKG_ICONS = { solo:'🗡️', duo:'⚔️', trio:'🔱' };
