const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`[aha-english] server running on port ${config.port} (${config.nodeEnv})`);
});
