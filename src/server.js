'use strict';
const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`\n  AI-native CMS running on http://localhost:${config.port}`);
  console.log(`  Storage: ${config.usingMongo ? 'MongoDB' : 'filesystem (./data)'}`);
  console.log(`  AI chat: ${config.aiEnabled ? 'enabled' : 'disabled (add an API key)'}\n`);
});
