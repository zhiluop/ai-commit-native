const fs = require('node:fs');
const path = require('node:path');

const LEVELS = {
  off: 0,
  error: 1,
  info: 2,
  debug: 3
};

function normalizeLogLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
}

function shouldLog(configuredLevel, messageLevel) {
  const configured = LEVELS[normalizeLogLevel(configuredLevel)];
  const requested = LEVELS[normalizeLogLevel(messageLevel)];
  return configured >= requested && requested > 0;
}

function redactSecret(value) {
  return String(value || '')
    .replace(/((?:Authorization|authorization)["']?\s*[:=]\s*["']?)Bearer\s+[^"'\s,;}]+/g, '$1Bearer [redacted]')
    .replace(/(Bearer\s+)[^"'\s,;}]+/gi, '$1[redacted]')
    .replace(/((?:x-api-key|api[_-]?key)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[redacted]');
}

function serializeDetails(details) {
  if (details === undefined) {
    return '';
  }

  if (typeof details === 'string') {
    return redactSecret(details);
  }

  return redactSecret(JSON.stringify(details));
}

function appendLogFile(logFilePath, line) {
  if (!logFilePath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, `${line}\n`, 'utf8');
  } catch (error) {
    // Logging must never block commit generation or review.
  }
}

function createLogger({ level = 'info', output, logFilePath }) {
  function write(messageLevel, message, details) {
    if (!shouldLog(level, messageLevel)) {
      return;
    }

    const suffix = details === undefined ? '' : ` ${serializeDetails(details)}`;
    const line = `[${new Date().toISOString()}] [${messageLevel}] ${message}${suffix}`;
    output?.appendLine(line);
    appendLogFile(logFilePath, line);
  }

  return {
    debug(message, details) {
      write('debug', message, details);
    },
    info(message, details) {
      write('info', message, details);
    },
    error(message, details) {
      write('error', message, details);
    }
  };
}

module.exports = {
  createLogger,
  normalizeLogLevel,
  redactSecret,
  shouldLog
};
