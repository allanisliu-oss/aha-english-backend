const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { required } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ── 查词（ECDICT 本地数据库） ──
router.get('/:word', required, async (req, res) => {
  const word = req.params.word.toLowerCase().trim();
  if (!word || word.length > 60) {
    return res.status(400).json({ ok: false, error: 'invalid_word' });
  }

  try {
    let entry = await prisma.dictWord.findUnique({ where: { word } });

    // 找不到原词时尝试去掉末尾 s/ed/ing 等简单形态
    if (!entry) {
      const fallbacks = [
        word.replace(/ies$/, 'y'),
        word.replace(/ied$/, 'y'),
        word.replace(/ing$/, ''),
        word.replace(/ing$/, 'e'),
        word.replace(/ed$/, ''),
        word.replace(/ed$/, 'e'),
        word.replace(/s$/, ''),
      ];
      for (const fb of fallbacks) {
        if (fb !== word && fb.length > 1) {
          entry = await prisma.dictWord.findUnique({ where: { word: fb } });
          if (entry) break;
        }
      }
    }

    if (!entry) {
      return res.status(404).json({ ok: false, error: 'word_not_found' });
    }

    res.json({ ok: true, data: formatEntry(entry) });
  } catch (err) {
    console.error('[dict]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

function formatEntry(entry) {
  return {
    word: entry.word,
    phonetic: entry.phonetic || null,
    translation: entry.translation || null,
    definition: entry.definition || null,
    pos: entry.pos || null,
    exchange: entry.exchange || null,
    frq: entry.frq || null,
  };
}

module.exports = router;
