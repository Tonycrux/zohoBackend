// api/index.js

const serverless = require('serverless-http');
const app = require('../app'); // assuming app.js exports your Express app

module.exports = serverless(app);
