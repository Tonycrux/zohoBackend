const app = require('../app'); // this brings in your express app

module.exports = (req, res) => {
  app(req, res);
};
