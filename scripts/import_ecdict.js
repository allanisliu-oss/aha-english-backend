/**
 * ECDICT 导入脚本
 *
 * 用法：
 *   node scripts/import_ecdict.js --csv /path/to/ecdict.csv
 *
 * ECDICT 下载地址：
 *   https://github.com/skywind3000/ECDICT/releases
 *   下载 ecdict-sqlite-28.zip，解压得到 stardict.db（SQLite 格式）
 *   或下载 ecdict-csv-28.zip，解压得到 ecdict.csv（CSV 格式）
 *
 * 推荐用 CSV 格式，本脚本默认读取 CSV。
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

async function main() {
  const args = process.argv.slice(2);
  const csvIndex = args.indexOf('--csv');
  if (csvIndex === -1 || !args[csvIndex + 1]) {
    console.error('用法: node scripts/import_ecdict.js --csv /path/to/ecdict.csv');
    process.exit(1);
  }
  const csvPath = path.resolve(args[csvIndex + 1]);

  if (!fs.existsSync(csvPath)) {
    console.error(`文件不存在: ${csvPath}`);
    process.exit(1);
  }

  console.log(`读取文件: ${csvPath}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let batch = [];
  let total = 0;
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
    if (!word || word.length > 60) { skipped++; continue; }

    // 过滤掉明显的乱码或非英文词条
    if (!/^[a-zA-Z]/.test(word)) { skipped++; continue; }

    batch.push({
      word,
      phonetic: row.phonetic || null,
      definition: row.definition || null,
      translation: row.translation || null,
      pos: row.pos || null,
      exchange: row.exchange || null,
      frq: row.frq ? parseInt(row.frq) || null : null,
    });

    if (batch.length >= BATCH_SIZE) {
      await flush(batch);
      total += batch.length;
      batch = [];
      if (total % 10000 === 0) console.log(`已导入 ${total} 条...`);
    }
  }

  if (batch.length > 0) {
    await flush(batch);
    total += batch.length;
  }

  console.log(`✅ 导入完成：共 ${total} 条，跳过 ${skipped} 条`);
  await prisma.$disconnect();
}

async function flush(batch) {
  await prisma.dictWord.createMany({
    data: batch,
    skipDuplicates: true,
  });
}

// 简单 CSV 解析（处理带引号的字段）
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
