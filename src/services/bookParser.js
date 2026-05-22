const EPub = require('epub2');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Parse a TXT buffer into chapters split by blank lines or simple heuristics.
 */
function parseTxt(buffer, filename) {
  const text = buffer.toString('utf-8');
  const title = path.basename(filename, path.extname(filename));

  // Split on lines that look like chapter headings
  // - Markdown style: # Title, ## Title
  // - English: Chapter X, CHAPTER X
  // - Chinese: 第X章/节
  // - Separators: ***, ===, ---
  const chapterRegex = /^(#{1,3}\s+.+|chapter\s+\w+|第.+[章节]|\*{3,}|={3,}|-{3,})$/im;
  const lines = text.split('\n');

  const chapters = [];
  let current = { title: null, lines: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (chapterRegex.test(trimmed)) {
      // Flush previous chapter if it has content
      if (current.lines.join('').trim().length > 0) {
        chapters.push({ title: current.title, content: current.lines.join('\n').trim() });
      }
      current = { title: cleanChapterTitle(trimmed), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim().length > 0) {
    chapters.push({ title: current.title, content: current.lines.join('\n').trim() });
  }

  // If no chapters were detected, treat the whole file as one chapter
  if (chapters.length === 0) {
    chapters.push({ title: null, content: text.trim() });
  }

  return { title, author: null, chapters };
}

/**
 * Parse an EPUB buffer into chapters.
 * Writes to a temp file because epub2 reads from disk.
 */
async function parseEpub(buffer) {
  const tmpFile = path.join(os.tmpdir(), `aha-upload-${Date.now()}.epub`);
  try {
    fs.writeFileSync(tmpFile, buffer);
    const epub = await EPub.createAsync(tmpFile);

    const title = epub.metadata.title || 'Untitled';
    const author = epub.metadata.creator || null;

    const chapters = [];
    for (let i = 0; i < epub.flow.length; i++) {
      const item = epub.flow[i];
      try {
        const html = await new Promise((resolve, reject) => {
          epub.getChapter(item.id, (err, text) => (err ? reject(err) : resolve(text)));
        });
        const text = htmlToMarkdown(html);
        if (text.trim().length < 50) continue; // skip near-empty sections
        chapters.push({ title: item.title || null, content: text.trim() });
      } catch (_) {
        // skip unparseable sections
      }
    }

    if (chapters.length === 0) {
      throw new Error('no_readable_content');
    }

    return { title, author, chapters };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

/**
 * Strip markdown / decorative prefixes from a chapter heading line:
 *   "# Chapter One" → "Chapter One"
 *   "*** End ***"  → "End"
 *   "---"          → null (pure separator, no title)
 */
function cleanChapterTitle(line) {
  let s = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[*=\-]{3,}\s*/, '')
    .replace(/\s*[*=\-]{3,}$/, '')
    .trim();
  return s.length > 0 ? s : null;
}

/**
 * Convert HTML to a simplified markdown-ish format:
 *   - <h1>..<h6> → "# heading"
 *   - <b>/<strong> → **bold**
 *   - <i>/<em> → *italic*
 *   - <p>, <br>, <div> → paragraph breaks
 *   - everything else stripped
 *
 * Keeps formatting intact for the Flutter renderer without going full HTML.
 */
function htmlToMarkdown(html) {
  let s = html;

  // Headings
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) =>
    `\n\n${'#'.repeat(parseInt(lvl, 10))} ${stripTagsInline(inner)}\n\n`);

  // Bold / italic — strong/em are also bold/italic
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `**${stripTagsInline(inner)}**`);
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `*${stripTagsInline(inner)}*`);

  // Paragraphs / divs become paragraph breaks
  s = s.replace(/<\/(p|div)>/gi, '\n\n');
  s = s.replace(/<(p|div)[^>]*>/gi, '');

  // Line breaks
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Strip any remaining tags
  s = s.replace(/<[^>]+>/g, '');

  // HTML entities
  s = decodeEntities(s);

  // Normalize whitespace (preserve paragraph breaks)
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function stripTagsInline(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”');
}

module.exports = { parseTxt, parseEpub };
