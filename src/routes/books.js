const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { required } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ── 导入书籍（只发元数据，正文存设备本地）──
router.post('/import', required, async (req, res) => {
  try {
    const { title, author, sourceType, language, chapterTitles } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ ok: false, error: 'title_required' });
    }
    if (!Array.isArray(chapterTitles)) {
      return res.status(400).json({ ok: false, error: 'chapterTitles_must_be_array' });
    }

    const book = await prisma.bookImport.create({
      data: {
        userId: req.userId,
        title: title.slice(0, 200),
        author: author ? String(author).slice(0, 200) : null,
        sourceType: sourceType || 'txt',
        language: language || 'en',
        chapterTitles,
      },
    });

    res.status(201).json({ ok: true, data: book });
  } catch (err) {
    console.error('[books/import]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 书单 ──
router.get('/', required, async (req, res) => {
  try {
    const books = await prisma.bookImport.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: books });
  } catch (err) {
    console.error('[books/list]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 删除书籍 ──
router.delete('/:bookId', required, async (req, res) => {
  try {
    const book = await prisma.bookImport.findFirst({
      where: { id: req.params.bookId, userId: req.userId },
    });
    if (!book) return res.status(404).json({ ok: false, error: 'not_found' });

    await prisma.bookImport.delete({ where: { id: req.params.bookId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[books/delete]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 阅读进度：读取 ──
router.get('/:bookId/progress', required, async (req, res) => {
  try {
    const { bookId } = req.params;
    const progress = await prisma.readingProgress.findUnique({
      where: { userId_bookId: { userId: req.userId, bookId } },
    });
    res.json({
      ok: true,
      data: progress || { chapterIndex: 0, charOffset: 0 },
    });
  } catch (err) {
    console.error('[books/progress/get]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 阅读进度：更新 ──
router.patch('/:bookId/progress', required, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { chapterIndex, charOffset } = req.body;

    if (typeof chapterIndex !== 'number' || typeof charOffset !== 'number') {
      return res.status(400).json({ ok: false, error: 'chapterIndex_and_charOffset_required' });
    }

    const progress = await prisma.readingProgress.upsert({
      where: { userId_bookId: { userId: req.userId, bookId } },
      create: { userId: req.userId, bookId, chapterIndex, charOffset },
      update: { chapterIndex, charOffset },
    });
    res.json({ ok: true, data: progress });
  } catch (err) {
    console.error('[books/progress/patch]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 保存划词标注 ──
router.post('/:bookId/annotations', required, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { chapterRef, selectedText, contextText, meaningSnapshot } = req.body;

    if (!selectedText) {
      return res.status(400).json({ ok: false, error: 'selectedText_required' });
    }

    const book = await prisma.bookImport.findFirst({
      where: { id: bookId, userId: req.userId },
    });
    if (!book) return res.status(404).json({ ok: false, error: 'not_found' });

    const annotation = await prisma.readingAnnotation.create({
      data: {
        userId: req.userId,
        bookId,
        chapterRef: chapterRef || null,
        selectedText,
        normalizedText: selectedText.toLowerCase().trim(),
        contextText: contextText || null,
        meaningSnapshot: meaningSnapshot || null,
      },
    });

    res.status(201).json({ ok: true, data: annotation });
  } catch (err) {
    console.error('[books/annotation]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

module.exports = router;
