// src/api/middleware/auth.js
const jwt        = require('jsonwebtoken');
const { mysqlPool } = require('../../../config/database');

/**
 * Middleware JWT — verifica token Bearer e anexa req.user.
 */
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    const [rows] = await mysqlPool.query(
      'SELECT id, client_id, role, active FROM users WHERE id = ?',
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restringe acesso a roles específicas.
 * Uso: router.get('/rota', auth, requireRole('superadmin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
  };
}

/**
 * Garante que um usuário admin só acesse recursos do seu próprio cliente.
 * superadmin acessa tudo.
 */
function scopeToClient(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  req.clientScope = req.user.client_id;
  next();
}

module.exports = { authMiddleware, requireRole, scopeToClient };
