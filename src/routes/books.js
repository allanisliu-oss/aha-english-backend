const express = require('express');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { required } = require('../middleware/auth');
const { parseEpub, parseTxt } = require('../services/bookParser');

const router = express.Router();
const prisma = new PrismaClient();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_, file, cb) => {
    const ok = file.mimetype === 'text/plain' ||
      file.originalname.endsWith('.txt') ||
      file.originalname.endsWith('.epub');
    cb(ok ? null : new Error('unsupported_format'), ok);
  },
});

// ── 上传书籍 ──
router.post('/upload', required, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'file_required' });
    }

    const isEpub = req.file.originalname.toLowerCase().endsWith('.epub');
    const parsed = isEpub
      ? await parseEpub(req.file.buffer)
      : parseTxt(req.file.buffer, req.file.originalname);

    const book = await prisma.bookImport.create({
      data: {
        userId: req.userId,
        title: parsed.title,
        author: parsed.author || null,
        sourceType: isEpub ? 'epub' : 'txt',
        language: 'en',
        chapters: {
          create: parsed.chapters.map((ch, i) => ({
            chapterIndex: i,
            title: ch.title || null,
            content: ch.content,
          })),
        },
      },
      include: { chapters: { select: { id: true, chapterIndex: true, title: true } } },
    });

    res.status(201).json({ ok: true, data: book });
  } catch (err) {
    if (err.message === 'unsupported_format') {
      return res.status(400).json({ ok: false, error: 'unsupported_format' });
    }
    console.error('[books/upload]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 书单 ──
router.get('/', required, async (req, res) => {
  try {
    const books = await prisma.bookImport.findMany({
      where: { userId: req.userId },
      include: {
        chapters: { select: { id: true, chapterIndex: true, title: true }, orderBy: { chapterIndex: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: books });
  } catch (err) {
    console.error('[books/list]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ── 获取单章内容 ──
router.get('/:bookId/chapters/:chapterIndex', required, async (req, res) => {
  try {
    const { bookId, chapterIndex } = req.params;

    const book = await prisma.bookImport.findFirst({
      where: { id: bookId, userId: req.userId },
    });
    if (!book) return res.status(404).json({ ok: false, error: 'not_found' });

    const chapter = await prisma.bookChapter.findFirst({
      where: { bookId, chapterIndex: parseInt(chapterIndex) },
    });
    if (!chapter) return res.status(404).json({ ok: false, error: 'chapter_not_found' });

    res.json({ ok: true, data: chapter });
  } catch (err) {
    console.error('[books/chapter]', err);
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
