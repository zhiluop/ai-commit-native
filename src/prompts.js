const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROMPT_FILES = [
  '.ai-commit.md',
  '.commit-message.md',
  'commit-message.md',
  'docs/commit-message.md',
  '.github/commit-message.md'
];

const DEFAULT_INSTRUCTIONS = 'Write a concise, high-signal commit message. Prefer the project language and avoid vague summaries.';

const LANGUAGE_LABELS = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese'
};

function normalizePromptSource(promptSource) {
  return ['none', 'inline', 'file', 'both'].includes(promptSource) ? promptSource : 'both';
}

function resolveOutputLanguage(language, customLanguage) {
  if (language === 'custom') {
    const custom = String(customLanguage || '').trim();
    return custom || LANGUAGE_LABELS['zh-CN'];
  }

  return LANGUAGE_LABELS[language] || LANGUAGE_LABELS['zh-CN'];
}

function resolvePromptFilePath(rootPath, promptFile) {
  if (!promptFile) {
    return '';
  }

  return path.isAbsolute(promptFile) ? promptFile : path.join(rootPath, promptFile);
}

function discoverPromptFiles(rootPath, configuredPromptFile) {
  const candidates = configuredPromptFile
    ? [configuredPromptFile, ...DEFAULT_PROMPT_FILES]
    : DEFAULT_PROMPT_FILES;

  const seen = new Set();
  return candidates
    .map((candidate) => resolvePromptFilePath(rootPath, candidate))
    .filter((candidate) => {
      if (seen.has(candidate)) {
        return false;
      }
      seen.add(candidate);
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    });
}

function readPromptInstructions(rootPath, options = {}) {
  const promptSource = normalizePromptSource(options.promptSource || 'both');
  const parts = [];
  const inlinePrompt = (options.inlinePrompt || '').trim();

  if (promptSource === 'none') {
    return DEFAULT_INSTRUCTIONS;
  }

  if ((promptSource === 'inline' || promptSource === 'both') && inlinePrompt) {
    parts.push(`# Inline instructions\n${inlinePrompt}`);
  }

  const promptFiles = promptSource === 'file' || promptSource === 'both'
    ? discoverPromptFiles(rootPath, options.promptFile || '')
    : [];
  if (promptFiles.length > 0) {
    const promptPath = promptFiles[0];
    const promptContent = fs.readFileSync(promptPath, 'utf8').trim();
    if (promptContent) {
      const displayPath = path.isAbsolute(options.promptFile || '') ? promptPath : path.relative(rootPath, promptPath);
      parts.push(`# Markdown instructions from ${displayPath}\n${promptContent}`);
    }
  }

  if (parts.length === 0) {
    return DEFAULT_INSTRUCTIONS;
  }

  return parts.join('\n\n');
}

function buildCommitPrompt({ instructions, outputLanguage, scope, status, diff, maxDiffCharacters }) {
  const language = outputLanguage || LANGUAGE_LABELS['zh-CN'];
  return [
    'You are generating a Git commit message for a VS Code user.',
    'Return only the final commit message. Do not wrap it in markdown. Do not explain your reasoning.',
    `Output language: ${language}.`,
    'Respect the user instructions exactly when they specify a format, language, trailers, or examples.',
    '',
    '## User commit-message instructions',
    instructions,
    '',
    '## Repository state',
    `Change scope: ${scope}`,
    status || '(git status was empty)',
    '',
    `## Diff (maximum ${maxDiffCharacters} characters)`,
    diff || '(no diff)'
  ].join('\n');
}

function buildReviewPrompt({ instructions, outputLanguage, scope, status, diff, maxDiffCharacters }) {
  const language = outputLanguage || LANGUAGE_LABELS['zh-CN'];
  return [
    'You are reviewing a Git diff inside VS Code.',
    'Return only a JSON array. Do not wrap it in markdown unless the API forces you to.',
    'Each array item must use this shape: {"file":"relative/path","line":12,"severity":"error|warning|info","message":"short actionable review comment","suggestion":"optional fix"}.',
    `Write every review comment and suggestion in ${language}. Keep JSON property names unchanged.`,
    'Use the changed-file line number after the change, because comments will be attached to the right side of VS Code native diff editors.',
    'Prefer a small number of concrete, actionable comments. Return [] when there are no useful review comments.',
    '',
    '## User review/commit instructions',
    instructions,
    '',
    '## Repository state',
    `Change scope: ${scope}`,
    status || '(git status was empty)',
    '',
    `## Diff (maximum ${maxDiffCharacters} characters)`,
    diff || '(no diff)'
  ].join('\n');
}

function cleanCommitMessage(message) {
  return message
    .trim()
    .replace(/^```(?:gitcommit|text|markdown)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^commit message:\s*/i, '')
    .trim();
}

module.exports = {
  buildCommitPrompt,
  buildReviewPrompt,
  cleanCommitMessage,
  discoverPromptFiles,
  normalizePromptSource,
  readPromptInstructions,
  resolveOutputLanguage,
  resolvePromptFilePath
};
