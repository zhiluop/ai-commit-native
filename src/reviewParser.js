const ALLOWED_SEVERITIES = new Set(['error', 'warning', 'info']);

function stripMarkdownFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractJson(text) {
  const stripped = stripMarkdownFence(text);
  if (stripped.startsWith('[') || stripped.startsWith('{')) {
    return stripped;
  }

  const arrayStart = stripped.indexOf('[');
  const arrayEnd = stripped.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1);
  }

  throw new Error('AI review response did not contain JSON.');
}

function normalizeFile(file) {
  return String(file || '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '');
}

function normalizeReviewComment(raw) {
  const file = normalizeFile(raw.file || raw.path || raw.filename);
  const message = String(raw.message || raw.body || raw.comment || '').trim();
  if (!file || !message) {
    return undefined;
  }

  const parsedLine = Number.parseInt(raw.line || raw.newLine || raw.position || '1', 10);
  const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 1) : 1;
  const severity = ALLOWED_SEVERITIES.has(raw.severity) ? raw.severity : 'info';
  const suggestion = String(raw.suggestion || raw.fix || '').trim();

  return {
    file,
    line,
    severity,
    message: suggestion ? `${message}\n\nSuggestion: ${suggestion}` : message
  };
}

function parseReviewComments(responseText) {
  let parsed;
  try {
    parsed = JSON.parse(extractJson(responseText));
  } catch (error) {
    throw new Error(`Could not parse AI review JSON: ${error.message}`);
  }

  const items = Array.isArray(parsed) ? parsed : parsed.comments;
  if (!Array.isArray(items)) {
    throw new Error('AI review JSON must be an array or an object with a comments array.');
  }

  if (items.length === 0) {
    return [];
  }

  const comments = items.map(normalizeReviewComment).filter(Boolean);
  if (comments.length === 0) {
    throw new Error('No usable review comments were found in the AI response.');
  }

  return comments;
}

module.exports = {
  normalizeReviewComment,
  parseReviewComments
};
