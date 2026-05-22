const express = require('express');
const { required } = require('../middleware/auth');

const router = express.Router();

// 简单内存缓存，避免对同一个词重复请求 Wiktionary
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// ── 查词 ──
router.get('/:word', required, async (req, res) => {
  const word = req.params.word.toLowerCase().trim();
  if (!word || word.length > 60) {
    return res.status(400).json({ ok: false, error: 'invalid_word' });
  }

  const cached = cache.get(word);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json({ ok: true, data: cached.data, cached: true });
  }

  try {
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
    const { default: fetch } = await import('node-fetch');
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'AhaEnglish/1.0 (language learning app)' },
      signal: AbortSignal.timeout(8000),
    });

    if (resp.status === 404) {
      return res.status(404).json({ ok: false, error: 'word_not_found' });
    }
    if (!resp.ok) {
      throw new Error(`wiktionary_${resp.status}`);
    }

    const raw = await resp.json();
    const data = formatDefinition(word, raw);

    cache.set(word, { ts: Date.now(), data });
    res.json({ ok: true, data });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ ok: false, error: 'dict_timeout' });
    }
    console.error('[dict]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * Flatten Wiktionary response into a simpler structure.
 * Raw: { en: [ { partOfSpeech, definitions: [ { definition, examples } ] } ] }
 */
function formatDefinition(word, raw) {
  const entries = raw['en'] || Object.values(raw)[0] || [];
  const senses = entries.slice(0, 4).map((entry) => ({
    pos: entry.partOfSpeech,
    definitions: (entry.definitions || []).slice(0, 3).map((d) => ({
      text: stripHtml(d.definition),
      example: d.parsedExamples?.[0]?.example
        ? stripHtml(d.parsedExamples[0].example)
        : null,
    })),
  }));

  return { word, senses };
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = router;
