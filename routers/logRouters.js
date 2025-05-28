const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// return last N lines of the latest log (default 200)
router.get("/logs", (req, res) => {
  const lines = parseInt(req.query.lines || "200");
  const logDir = path.join(__dirname, "../logs");
  const latest = fs
    .readdirSync(logDir)
    .filter(f => f.startsWith("automation-"))
    .sort()        // YYYY-MM-DD order
    .pop();

  if (!latest) return res.json({ success:false, message:"No logs yet" });

  const filePath = path.join(logDir, latest);
  const data     = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const slice    = data.slice(-lines).map(JSON.parse);   // parse JSON lines

  res.json({ success: true, log: slice });
});

module.exports = router;
