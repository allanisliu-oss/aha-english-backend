const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Required auth — 拒绝未登录请求
 */
function required(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'token_invalid_or_expired' });
  }
}

/**
 * Optional auth — 有 token 就解析，没有也放行
 */
function optional(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret);
      req.userId = payload.sub;
    } catch {
      // ignore bad token in optional mode
    }
  }
  next();
}

module.exports = { required, optional };
