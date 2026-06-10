// Vercel serverless entry point. An Express app is a (req, res) handler,
// so exporting it directly works as a Vercel Node function.
const app = require('../src/app');
module.exports = app;
