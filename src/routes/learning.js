const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { required } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ── 获取学习配置 ──
router.get('/profile', required, async (req, res) => {
  try {
    const profile = await prisma.learningProfile.findUnique({
      where: { userId: req.userId },
    });
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    res.json({ ok: true, data: profile });
  } catch (err) {
    console.error('[learning/profile]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 更新学习配置 ──
router.patch('/profile', required, async (req, res) => {
  try {
    const allowed = [
      'listeningScore', 'speakingScore', 'readingScore', 'writingScore',
      'dailyMinutes', 'primaryGoal', 'goalWeights',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    }

    const profile = await prisma.learningProfile.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, ...data },
      update: data,
    });
    res.json({ ok: true, data: profile });
  } catch (err) {
    console.error('[learning/update-profile]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 提交复习结果 ──
router.post('/review', required, async (req, res) => {
  try {
    const { cardId, entryId, feedback, userAnswer, isCorrect, reviewMode } = req.body;

    if (!cardId || !entryId || !feedback) {
      return res.status(400).json({ ok: false, error: 'cardId_entryId_feedback_required' });
    }

    // 根据反馈计算下次复习时间
    const intervals = {
      again: 1,    // 1 分钟
      hard: 10,    // 10 分钟
      good: 1440,  // 1 天
      easy: 5760,  // 4 天
    };
    const minutes = intervals[feedback] || 1440;
    const nextReviewAt = new Date(Date.now() + minutes * 60 * 1000);

    const record = await prisma.reviewRecord.create({
      data: {
        userId: req.userId,
        cardId,
        entryId,
        feedback,
        userAnswer: userAnswer || null,
        isCorrect: isCorrect !== undefined ? isCorrect : null,
        reviewMode: reviewMode || null,
        nextReviewAt,
      },
    });

    res.status(201).json({ ok: true, data: { record, nextReviewAt } });
  } catch (err) {
    console.error('[learning/review]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 获取待复习卡片 ──
router.get('/due-cards', required, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    // 查找所有用户已创建或系统预置的卡片
    // 优先返回到期且需要复习的
    const due = await prisma.reviewRecord.findMany({
      where: {
        userId: req.userId,
        nextReviewAt: { lte: new Date() },
      },
      include: { card: true, entry: true },
      orderBy: { nextReviewAt: 'asc' },
      take: limit,
    });

    // 如果没有到期卡片，返回新卡片（从未复习过的）
    if (due.length < limit) {
      const reviewedCardIds = (
        await prisma.reviewRecord.findMany({
          where: { userId: req.userId },
          select: { cardId: true },
          distinct: ['cardId'],
        })
      ).map((r) => r.cardId);

      const newCards = await prisma.card.findMany({
        where: { id: { notIn: reviewedCardIds } },
        include: { entry: true },
        take: limit - due.length,
      });

      return res.json({
        ok: true,
        data: {
          due: due.map((r) => ({ ...r.card, entry: r.entry, lastFeedback: r.feedback })),
          new: newCards,
        },
      });
    }

    res.json({
      ok: true,
      data: {
        due: due.map((r) => ({ ...r.card, entry: r.entry, lastFeedback: r.feedback })),
        new: [],
      },
    });
  } catch (err) {
    console.error('[learning/due-cards]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 今日学习统计 ──
router.get('/stats', required, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [reviewCount, correctCount, totalEntries] = await Promise.all([
      prisma.reviewRecord.count({
        where: { userId: req.userId, reviewedAt: { gte: today } },
      }),
      prisma.reviewRecord.count({
        where: { userId: req.userId, isCorrect: true, reviewedAt: { gte: today } },
      }),
      prisma.vocabEntry.count({ where: { userId: req.userId } }),
    ]);

    res.json({
      ok: true,
      data: {
        todayReviewCount: reviewCount,
        todayCorrectCount: correctCount,
        todayAccuracy: reviewCount > 0 ? Math.round((correctCount / reviewCount) * 100) : 0,
        totalVocabEntries: totalEntries,
      },
    });
  } catch (err) {
    console.error('[learning/stats]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
