const { createLogger, format, transports } = require("winston");
require("winston-daily-rotate-file");                  // rotation transport

const logFmt = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.json()
);

// daily file  (keeps 14 days, 5 MB each)
const fileRotate = new transports.DailyRotateFile({
  dirname     : "logs",
  filename    : "automation-%DATE%.log",
  datePattern : "YYYY-MM-DD",
  maxSize     : "5m",
  maxFiles    : "14d",
  level       : "info"
});

// pretty console for dev
const consoleDev = new transports.Console({
  level : "debug",
  format: format.combine(
    format.colorize(),
    format.printf(
      ({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`
    )
  )
});

const logger = createLogger({
  level    : "info",
  format   : logFmt,
  transports: [fileRotate, consoleDev]
});

module.exports = logger;
