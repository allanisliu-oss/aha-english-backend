const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const { required } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '30d';

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: TOKEN_EXPIRY });
}

// ── Email 注册 ──
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email_and_password_required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'password_too_short' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email_already_registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, passwordHash },
    });

    // 同时创建学习配置
    await prisma.learningProfile.create({
      data: { userId: user.id },
    });

    const token = signToken(user.id);
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({
      ok: true,
      data: {
        userId: user.id,
        email: user.email,
        petName: user.petName,
        petStage: user.petStage,
        token,
      },
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── Email 登录 ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email_and_password_required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const token = signToken(user.id);
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // 返回学习配置
    const profile = await prisma.learningProfile.findUnique({ where: { userId: user.id } });

    res.json({
      ok: true,
      data: {
        userId: user.id,
        email: user.email,
        petName: user.petName,
        petStage: user.petStage,
        profile,
        token,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── Apple / Google 登录（占位） ──
router.post('/social', async (req, res) => {
  try {
    const { provider, providerUserId, email, displayName } = req.body;

    if (!provider || !providerUserId) {
      return res.status(400).json({ ok: false, error: 'provider_and_provider_user_id_required' });
    }
    if (!['apple', 'google'].includes(provider)) {
      return res.status(400).json({ ok: false, error: 'invalid_provider' });
    }

    const idField = provider === 'apple' ? 'appleUserId' : 'googleUserId';

    // 查找已有用户
    let user = await prisma.user.findFirst({
      where: { [idField]: providerUserId },
    });

    if (!user) {
      // 新建用户
      user = await prisma.user.create({
        data: {
          email,
          [idField]: providerUserId,
        },
      });
      await prisma.learningProfile.create({ data: { userId: user.id } });
    }

    const token = signToken(user.id);
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const profile = await prisma.learningProfile.findUnique({ where: { userId: user.id } });

    res.json({
      ok: true,
      data: {
        userId: user.id,
        email: user.email,
        petName: user.petName,
        petStage: user.petStage,
        profile,
        token,
      },
    });
  } catch (err) {
    console.error('[auth/social]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 获取当前用户 ──
router.get('/me', required, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { learningProfile: true },
    });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    const { passwordHash, ...safe } = user;
    res.json({ ok: true, data: safe });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 登出 ──
router.post('/logout', required, async (req, res) => {
  try {
    const header = req.headers.authorization;
    const token = header.slice(7);
    await prisma.session.updateMany({
      where: { token },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
