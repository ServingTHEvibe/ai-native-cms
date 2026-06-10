'use strict';
try { require('dotenv').config(); } catch (_) { /* dotenv optional in prod */ }

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  ownerMasterKey: process.env.OWNER_MASTER_KEY || 'change-me-owner-key',
  serverSecret: process.env.SERVER_SECRET || 'insecure-dev-secret-change-me',

  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'ai_cms',

  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',

  vercelToken: process.env.VERCEL_TOKEN || '',
  vercelTeamId: process.env.VERCEL_TEAM_ID || '',
};

config.aiEnabled = Boolean(config.anthropicKey || config.openrouterKey);
config.usingMongo = Boolean(config.mongoUri);

module.exports = config;
