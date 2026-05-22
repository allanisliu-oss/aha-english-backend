// 启动前自动跑 Prisma migration
// Render 上部署时：自动同步数据库 schema
const { execSync } = require('child_process');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

try {
  console.log('[prestart] Syncing Prisma schema to database...');
  execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate --accept-data-loss`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  console.log('[prestart] Schema sync complete.');
} catch (err) {
  console.error('[prestart] Migration failed:', err.message);
  // 如果是生产环境，不要因为 migration 失败而阻止启动
  // （可能数据库还没准备好，或 schema 一致无需迁移）
  if (process.env.NODE_ENV === 'production') {
    console.warn('[prestart] Continuing despite migration error (production mode)');
  } else {
    process.exit(1);
  }
}
