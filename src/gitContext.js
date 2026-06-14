const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseNameOnly(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncateText(text, maxCharacters) {
  if (!Number.isFinite(maxCharacters) || maxCharacters <= 0) {
    return text;
  }

  if (text.length <= maxCharacters) {
    return text;
  }

  const notice = '\n...[truncated]';
  if (maxCharacters <= notice.length) {
    return text.slice(0, maxCharacters);
  }

  return `${text.slice(0, maxCharacters - notice.length)}${notice}`;
}

function chooseDiffScope({ preferStagedChanges, stagedDiff, workingDiff, stagedFiles, workingFiles }) {
  const hasStaged = stagedDiff.trim().length > 0;
  const hasWorking = workingDiff.trim().length > 0;

  if (preferStagedChanges && hasStaged) {
    return { scope: 'staged', diff: stagedDiff, files: stagedFiles };
  }

  if (hasWorking) {
    return { scope: 'working', diff: workingDiff, files: workingFiles };
  }

  if (hasStaged) {
    return { scope: 'staged', diff: stagedDiff, files: stagedFiles };
  }

  return { scope: 'none', diff: '', files: [] };
}

async function runGit(rootPath, args, options = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: rootPath,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024
  });
  return stdout;
}

async function getGitContext(rootPath, options = {}) {
  const maxDiffCharacters = options.maxDiffCharacters || 60000;
  const [status, stagedDiff, workingDiff, stagedNames, workingNames] = await Promise.all([
    runGit(rootPath, ['status', '--short']),
    runGit(rootPath, ['diff', '--cached', '--no-ext-diff', '--minimal'], { maxBuffer: maxDiffCharacters * 4 }),
    runGit(rootPath, ['diff', '--no-ext-diff', '--minimal'], { maxBuffer: maxDiffCharacters * 4 }),
    runGit(rootPath, ['diff', '--cached', '--name-only']),
    runGit(rootPath, ['diff', '--name-only'])
  ]);

  const selected = chooseDiffScope({
    preferStagedChanges: options.preferStagedChanges !== false,
    stagedDiff,
    workingDiff,
    stagedFiles: parseNameOnly(stagedNames),
    workingFiles: parseNameOnly(workingNames)
  });

  return {
    ...selected,
    rootPath,
    status: status.trim(),
    diff: truncateText(selected.diff, maxDiffCharacters),
    isTruncated: selected.diff.length > maxDiffCharacters
  };
}

async function getGitObject(rootPath, objectPath) {
  try {
    return await runGit(rootPath, ['show', objectPath], { maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    return '';
  }
}

async function readWorkspaceFile(rootPath, relativePath) {
  try {
    return await fs.readFile(path.join(rootPath, relativePath), 'utf8');
  } catch (error) {
    return '';
  }
}

async function getReviewFileContent(rootPath, relativePath, scope, side) {
  if (side === 'base') {
    if (scope === 'staged') {
      return getGitObject(rootPath, `HEAD:${relativePath}`);
    }

    const indexContent = await getGitObject(rootPath, `:${relativePath}`);
    if (indexContent) {
      return indexContent;
    }
    return getGitObject(rootPath, `HEAD:${relativePath}`);
  }

  if (scope === 'staged') {
    return getGitObject(rootPath, `:${relativePath}`);
  }

  return readWorkspaceFile(rootPath, relativePath);
}

module.exports = {
  chooseDiffScope,
  getGitContext,
  getReviewFileContent,
  parseNameOnly,
  runGit,
  truncateText
};
