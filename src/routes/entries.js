const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { required, optional } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ── 列出词条（分页） ──
router.get('/', optional, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.register) where.register = req.query.register;
    if (req.query.frequencyTier) where.frequencyTier = req.query.frequencyTier;
    if (req.query.difficultyTier) where.difficultyTier = req.query.difficultyTier;
    if (req.query.search) {
      where.lemma = { contains: req.query.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma.vocabEntry.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { lemma: 'asc' },
        include: { _count: { select: { cards: true } } },
      }),
      prisma.vocabEntry.count({ where }),
    ]);

    res.json({
      ok: true,
      data: { items, total, page, limit },
    });
  } catch (err) {
    console.error('[entries/list]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 单个词条 ──
router.get('/:id', optional, async (req, res) => {
  try {
    const entry = await prisma.vocabEntry.findUnique({
      where: { id: req.params.id },
      include: { cards: true },
    });
    if (!entry) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    res.json({ ok: true, data: entry });
  } catch (err) {
    console.error('[entries/get]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 创建词条 ──
router.post('/', required, async (req, res) => {
  try {
    const entry = await prisma.vocabEntry.create({
      data: {
        userId: req.userId,
        lemma: req.body.lemma,
        wordForm: req.body.wordForm,
        pos: req.body.pos,
        chineseMeaning: req.body.chineseMeaning,
        register: req.body.register,
        mode: req.body.mode,
        frequencyTier: req.body.frequencyTier,
        difficultyTier: req.body.difficultyTier,
        exampleSentence: req.body.exampleSentence,
        audioUrl: req.body.audioUrl,
        tags: req.body.tags || [],
        notes: req.body.notes,
      },
    });
    res.status(201).json({ ok: true, data: entry });
  } catch (err) {
    console.error('[entries/create]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 更新词条 ──
router.patch('/:id', required, async (req, res) => {
  try {
    const entry = await prisma.vocabEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    // 只允许作者编辑
    if (entry.userId && entry.userId !== req.userId) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const allowed = [
      'lemma', 'wordForm', 'pos', 'chineseMeaning', 'register',
      'mode', 'frequencyTier', 'difficultyTier', 'exampleSentence',
      'audioUrl', 'tags', 'notes',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    const updated = await prisma.vocabEntry.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[entries/update]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
