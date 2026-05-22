/**
 * 把 ecdict.csv 转成精简版 SQLite，给 Flutter 打包。
 *
 * 用法：node scripts/build_ecdict_sqlite.js --csv /tmp/ecdict.csv --out /tmp/ecdict.db
 *
 * 输出表结构：
 *   dict_words(word PK, phonetic, definition, translation, pos, exchange, frq INT)
 *
 * 只保留 Flutter 端要展示的字段；collins/oxford/tag/bnc/detail/audio 全部丢掉，
 * 体积大约从 63MB CSV 压到 40-50MB DB（带 PK 索引）。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const csv = argv[argv.indexOf('--csv') + 1];
const out = argv[argv.indexOf('--out') + 1];
if (!csv || !out) {
  console.error('Usage: node build_ecdict_sqlite.js --csv ecdict.csv --out ecdict.db');
  process.exit(1);
}
if (!fs.existsSync(csv)) {
  console.error(`csv not found: ${csv}`);
  process.exit(1);
}
try { fs.unlinkSync(out); } catch (_) {}

const tmpInsert = path.join(path.dirname(out), `.ecdict_${Date.now()}.sql`);

async function main() {
  console.log(`Reading ${csv} ...`);

  // 先用 sqlite3 CLI 建表
  spawnSync('sqlite3', [out, `
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    CREATE TABLE dict_words (
      word TEXT PRIMARY KEY,
      phonetic TEXT,
      definition TEXT,
      translation TEXT,
      pos TEXT,
      exchange TEXT,
      frq INTEGER
    );
  `], { stdio: 'inherit' });

  // 流式读 CSV 并写 INSERT 文件
  const writer = fs.createWriteStream(tmpInsert);
  writer.write('BEGIN;\n');

  const rl = readline.createInterface({
    input: fs.createReadStream(csv, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let count = 0;
  let skipped = 0;

  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;

    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });

    const word = (row.word || '').trim().toLowerCase();
    if (!word || word.length > 60 || !/^[a-z]/i.test(word)) {
      skipped++;
      continue;
    }

    const frq = row.frq ? parseInt(row.frq, 10) || null : null;
    const values = [
      sqlString(word),
      sqlString(row.phonetic || null),
      sqlString(row.definition || null),
      sqlString(row.translation || null),
      sqlString(row.pos || null),
      sqlString(row.exchange || null),
      frq === null ? 'NULL' : String(frq),
    ];
    writer.write(`INSERT OR IGNORE INTO dict_words VALUES(${values.join(',')});\n`);
    count++;
    if (count % 50000 === 0) console.log(`  wrote ${count} INSERTs...`);
  }
  writer.write('COMMIT;\n');
  writer.end();
  await new Promise(r => writer.on('finish', r));
  console.log(`Done writing INSERTs: ${count} kept, ${skipped} skipped`);

  console.log('Applying to SQLite ...');
  const res = spawnSync('sqlite3', [out, `.read ${tmpInsert}`], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('sqlite3 apply failed');
    process.exit(1);
  }
  fs.unlinkSync(tmpInsert);

  // 优化空间 + 查询速度
  spawnSync('sqlite3', [out, `
    CREATE INDEX IF NOT EXISTS idx_word ON dict_words(word);
    VACUUM;
  `], { stdio: 'inherit' });

  const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Built ${out} (${sizeMb} MB, ${count} rows)`);
}

function sqlString(s) {
  if (s === null || s === undefined || s === '') return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
