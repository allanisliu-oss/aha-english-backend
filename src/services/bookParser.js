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

  // Split on lines that look like chapter headings (CHAPTER, Chapter, all-caps short line)
  const chapterRegex = /^(chapter\s+\w+|第.+[章节]|\*{3,}|={3,}|-{3,})$/im;
  const lines = text.split('\n');

  const chapters = [];
  let current = { title: null, lines: [] };

  for (const line of lines) {
    if (chapterRegex.test(line.trim()) && current.lines.join('').trim().length > 0) {
      chapters.push({ title: current.title, content: current.lines.join('\n').trim() });
      current = { title: line.trim(), lines: [] };
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
        const text = stripHtml(html);
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

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { parseTxt, parseEpub };
