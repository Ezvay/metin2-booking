function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).send('Brak dostępu.');
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
