const path = require('node:path');
const vscode = require('vscode');
const { AiClient, normalizeApiFormat } = require('./aiClient');
const { resolveAiConfigurationValue } = require('./config');
const { getGitContext, getReviewFileContent } = require('./gitContext');
const { createLogger } = require('./logger');
const { buildCommitPrompt, buildReviewPrompt, cleanCommitMessage, readPromptInstructions, resolveOutputLanguage } = require('./prompts');
const { parseReviewComments } = require('./reviewParser');

const SECRET_API_KEY = 'aiCommit.apiKey';
const REVIEW_SCHEME = 'ai-commit-review';
const LOG_FILE_NAME = 'ai-commit.log';

function getSecretKey(apiFormat) {
  return `${SECRET_API_KEY}.${normalizeApiFormat(apiFormat)}`;
}

class ReviewDocumentProvider {
  constructor() {
    this.documents = new Map();
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
  }

  set(uri, content) {
    this.documents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  clear() {
    this.documents.clear();
  }

  provideTextDocumentContent(uri) {
    return this.documents.get(uri.toString()) || '';
  }
}

class ReviewState {
  constructor() {
    this.controller = vscode.comments.createCommentController('aiCommitReview', 'AI Commit Review');
    this.threads = [];
  }

  clear() {
    for (const thread of this.threads) {
      thread.dispose();
    }
    this.threads = [];
  }

  dispose() {
    this.clear();
    this.controller.dispose();
  }

  addComment(uri, comment) {
    const range = new vscode.Range(Math.max(comment.line - 1, 0), 0, Math.max(comment.line - 1, 0), 0);
    const body = new vscode.MarkdownString(comment.message);
    const thread = this.controller.createCommentThread(uri, range, [
      {
        author: { name: 'AI Commit' },
        body,
        mode: vscode.CommentMode.Preview
      }
    ]);
    thread.label = comment.severity;
    thread.canReply = false;
    this.threads.push(thread);
  }
}

function getConfiguration() {
  const config = vscode.workspace.getConfiguration('aiCommit');
  const legacyProvider = config.get('provider', '');
  const apiFormat = normalizeApiFormat(config.get('apiFormat', legacyProvider || 'openai-compatible'));
  const formatDefaults = apiFormat === 'anthropic-compatible'
    ? { apiBaseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest' }
    : { apiBaseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

  return {
    apiFormat,
    apiBaseUrl: resolveAiConfigurationValue(config, 'apiBaseUrl', formatDefaults.apiBaseUrl),
    apiKey: config.get('apiKey', ''),
    model: resolveAiConfigurationValue(config, 'model', formatDefaults.model),
    commitLanguage: config.get('commitLanguage', 'zh-CN'),
    customLanguage: config.get('customLanguage', ''),
    promptSource: config.get('promptSource', 'both'),
    inlinePrompt: config.get('inlinePrompt', ''),
    promptFile: config.get('promptFile', '.ai-commit.md'),
    preferStagedChanges: config.get('preferStagedChanges', true),
    maxDiffCharacters: config.get('maxDiffCharacters', 60000),
    temperature: config.get('temperature', 0.2),
    maxTokens: config.get('maxTokens', 4096),
    logLevel: config.get('logLevel', 'info'),
    maxReviewDiffEditors: config.get('maxReviewDiffEditors', 5)
  };
}

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    throw new Error('Open a Git workspace folder before using AI Commit.');
  }

  if (folders.length === 1 || !vscode.window.activeTextEditor) {
    return folders[0].uri.fsPath;
  }

  const activeUri = vscode.window.activeTextEditor.document.uri;
  const folder = vscode.workspace.getWorkspaceFolder(activeUri);
  return (folder || folders[0]).uri.fsPath;
}

async function getApiKey(context) {
  const config = getConfiguration();
  const existing = await context.secrets.get(getSecretKey(config.apiFormat));
  if (existing) {
    return existing;
  }

  if (config.apiKey) {
    return config.apiKey.trim();
  }

  const legacyExisting = config.apiFormat === 'openai-compatible'
    ? await context.secrets.get(SECRET_API_KEY)
    : '';
  if (legacyExisting) {
    return legacyExisting;
  }

  const entered = await vscode.window.showInputBox({
    title: 'AI Commit API Key',
    prompt: `Enter an API key for the ${config.apiFormat} endpoint. It will be stored in VS Code SecretStorage.`,
    password: true,
    ignoreFocusOut: true
  });

  if (!entered) {
    throw new Error('AI API key is required.');
  }

  await context.secrets.store(getSecretKey(config.apiFormat), entered.trim());
  return entered.trim();
}

async function getGitRepository(rootPath) {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    return undefined;
  }

  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);
  return api.repositories.find((repository) => repository.rootUri.fsPath === rootPath) || api.repositories[0];
}

async function setNativeCommitInput(rootPath, message) {
  const repository = await getGitRepository(rootPath);
  if (repository?.inputBox) {
    repository.inputBox.value = message;
    return true;
  }

  await vscode.env.clipboard.writeText(message);
  return false;
}

function buildAiOptions(context, messages, logger) {
  const config = getConfiguration();
  return getApiKey(context).then((apiKey) => ({
    apiFormat: config.apiFormat,
    apiKey,
    apiBaseUrl: config.apiBaseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    logger,
    timeoutMs: 60000,
    messages
  }));
}

function getLogFileUri(context) {
  return vscode.Uri.joinPath(context.logUri, LOG_FILE_NAME);
}

function getLogFilePath(context) {
  return getLogFileUri(context).fsPath;
}

function createExtensionLogger(context, output) {
  const config = getConfiguration();
  return createLogger({
    level: config.logLevel,
    output,
    logFilePath: getLogFilePath(context)
  });
}

async function loadAiContext(logger) {
  const config = getConfiguration();
  const rootPath = getWorkspaceRoot();
  logger?.info('Loading Git context', {
    rootPath,
    preferStagedChanges: config.preferStagedChanges,
    maxDiffCharacters: config.maxDiffCharacters
  });
  const gitContext = await getGitContext(rootPath, {
    preferStagedChanges: config.preferStagedChanges,
    maxDiffCharacters: config.maxDiffCharacters
  });

  if (gitContext.scope === 'none') {
    throw new Error('No staged or unstaged Git changes were found.');
  }

  const instructions = readPromptInstructions(rootPath, {
    promptSource: config.promptSource,
    inlinePrompt: config.inlinePrompt,
    promptFile: config.promptFile
  });

  logger?.debug('Prompt instructions loaded', {
    promptSource: config.promptSource,
    promptFile: config.promptFile,
    instructionCharacters: instructions.length
  });

  return { config, rootPath, gitContext, instructions };
}

function createReviewUri(relativePath, side, sessionId) {
  return vscode.Uri.from({
    scheme: REVIEW_SCHEME,
    path: `/${relativePath}`,
    query: new URLSearchParams({ side, session: sessionId }).toString()
  });
}

async function openReviewDiff(provider, rootPath, gitContext, relativePath, sessionId) {
  const baseUri = createReviewUri(relativePath, 'base', sessionId);
  const targetUri = createReviewUri(relativePath, 'target', sessionId);
  const [baseContent, targetContent] = await Promise.all([
    getReviewFileContent(rootPath, relativePath, gitContext.scope, 'base'),
    getReviewFileContent(rootPath, relativePath, gitContext.scope, 'target')
  ]);

  provider.set(baseUri, baseContent);
  provider.set(targetUri, targetContent);

  await vscode.commands.executeCommand(
    'vscode.diff',
    baseUri,
    targetUri,
    `${relativePath} (${gitContext.scope}: base -> target)`,
    { preview: false }
  );

  return targetUri;
}

function uniqueFilesForReview(gitContext, comments) {
  const commentedFiles = comments.map((comment) => comment.file);
  const source = commentedFiles.length > 0 ? commentedFiles : gitContext.files;
  return Array.from(new Set(source)).filter(Boolean);
}

async function generateCommitMessage(context, output) {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: 'Generating AI commit message...' },
    async () => {
      const config = getConfiguration();
      const logger = createExtensionLogger(context, output);
      logger.info('Generate commit message command started', {
        apiFormat: config.apiFormat,
        apiBaseUrl: config.apiBaseUrl,
        model: config.model,
        commitLanguage: config.commitLanguage,
        promptSource: config.promptSource,
        logFilePath: getLogFilePath(context)
      });

      const { rootPath, gitContext, instructions } = await loadAiContext(logger);
      const outputLanguage = resolveOutputLanguage(config.commitLanguage, config.customLanguage);
      const prompt = buildCommitPrompt({
        instructions,
        outputLanguage,
        scope: gitContext.scope,
        status: gitContext.status,
        diff: gitContext.diff,
        maxDiffCharacters: config.maxDiffCharacters
      });

      const ai = new AiClient();
      const content = await ai.complete(await buildAiOptions(context, [
        { role: 'system', content: 'You write precise Git commit messages.' },
        { role: 'user', content: prompt }
      ], logger));

      const message = cleanCommitMessage(content);
      if (!message) {
        throw new Error('AI returned an empty commit message.');
      }

      const wroteToScm = await setNativeCommitInput(rootPath, message);
      if (wroteToScm) {
        vscode.window.showInformationMessage(`AI commit message generated from ${gitContext.scope} changes.`);
      } else {
        vscode.window.showWarningMessage('AI commit message copied to clipboard because the built-in Git input box was unavailable.');
      }
    }
  );
}

async function reviewChanges(context, provider, reviewState, output) {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: 'Running AI review...' },
    async () => {
      const config = getConfiguration();
      const logger = createExtensionLogger(context, output);
      logger.info('Review changes command started', {
        apiFormat: config.apiFormat,
        apiBaseUrl: config.apiBaseUrl,
        model: config.model,
        commitLanguage: config.commitLanguage,
        promptSource: config.promptSource,
        logFilePath: getLogFilePath(context)
      });

      const { rootPath, gitContext, instructions } = await loadAiContext(logger);
      const outputLanguage = resolveOutputLanguage(config.commitLanguage, config.customLanguage);
      const prompt = buildReviewPrompt({
        instructions,
        outputLanguage,
        scope: gitContext.scope,
        status: gitContext.status,
        diff: gitContext.diff,
        maxDiffCharacters: config.maxDiffCharacters
      });

      const ai = new AiClient();
      const content = await ai.complete(await buildAiOptions(context, [
        { role: 'system', content: 'You are a concise code reviewer. Output strict JSON only.' },
        { role: 'user', content: prompt }
      ], logger));

      const comments = parseReviewComments(content);
      const files = uniqueFilesForReview(gitContext, comments);
      const sessionId = `${Date.now()}`;
      const openedTargetUris = new Map();

      provider.clear();
      reviewState.clear();

      for (const file of files.slice(0, config.maxReviewDiffEditors)) {
        const targetUri = await openReviewDiff(provider, rootPath, gitContext, file, sessionId);
        openedTargetUris.set(file, targetUri);
      }

      for (const comment of comments) {
        const targetUri = openedTargetUris.get(comment.file);
        if (targetUri) {
          reviewState.addComment(targetUri, comment);
        }
      }

      if (comments.length === 0) {
        vscode.window.showInformationMessage(`AI review found no actionable comments. Opened ${Math.min(files.length, config.maxReviewDiffEditors)} native diff view(s).`);
      } else {
        vscode.window.showInformationMessage(`AI review added ${comments.length} inline comment(s) in native diff view(s).`);
      }
    }
  );
}

async function setApiKey(context) {
  const config = getConfiguration();
  const entered = await vscode.window.showInputBox({
    title: 'AI Commit API Key',
    prompt: `Enter an API key for the ${config.apiFormat} endpoint. It will be stored in VS Code SecretStorage.`,
    password: true,
    ignoreFocusOut: true
  });

  if (!entered) {
    return;
  }

  await context.secrets.store(getSecretKey(config.apiFormat), entered.trim());
  vscode.window.showInformationMessage('AI Commit API key saved.');
}

async function openPromptFile() {
  const rootPath = getWorkspaceRoot();
  const config = getConfiguration();
  const promptPath = path.isAbsolute(config.promptFile)
    ? config.promptFile
    : path.join(rootPath, config.promptFile || '.ai-commit.md');
  const promptUri = vscode.Uri.file(promptPath);

  try {
    await vscode.workspace.fs.stat(promptUri);
  } catch (error) {
    const template = Buffer.from([
      '# AI Commit Instructions',
      '',
      'Write commit messages in Chinese.',
      'Use a concise subject line and include relevant body details when the diff is non-trivial.',
      '',
      'Example:',
      'feat: 支持从暂存区生成提交信息',
      '',
      '- 优先总结用户可见行为',
      '- 必要时说明验证方式',
      ''
    ].join('\n'));
    await vscode.workspace.fs.writeFile(promptUri, template);
  }

  const document = await vscode.workspace.openTextDocument(promptUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function openLogFile(context) {
  const logUri = getLogFileUri(context);
  try {
    await vscode.workspace.fs.stat(logUri);
  } catch (error) {
    await vscode.workspace.fs.createDirectory(context.logUri);
    await vscode.workspace.fs.writeFile(logUri, Buffer.from(''));
  }

  const document = await vscode.workspace.openTextDocument(logUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function handleCommandError(error, context, output) {
  const message = error instanceof Error ? error.message : String(error);
  const logger = createExtensionLogger(context, output);
  logger.error('Command failed', {
    message,
    stack: error instanceof Error ? error.stack : undefined
  });

  const action = await vscode.window.showErrorMessage(`AI Commit: ${message}`, 'Show Logs', 'Open Log File');
  if (action === 'Show Logs') {
    output.show();
  } else if (action === 'Open Log File') {
    await openLogFile(context);
  }
}

function activate(context) {
  const provider = new ReviewDocumentProvider();
  const reviewState = new ReviewState();
  const output = vscode.window.createOutputChannel('AI Commit');

  context.subscriptions.push(
    output,
    vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, provider),
    reviewState,
    vscode.commands.registerCommand('aiCommit.generateCommitMessage', () => generateCommitMessage(context, output).catch((error) => handleCommandError(error, context, output))),
    vscode.commands.registerCommand('aiCommit.reviewChanges', () => reviewChanges(context, provider, reviewState, output).catch((error) => handleCommandError(error, context, output))),
    vscode.commands.registerCommand('aiCommit.setApiKey', () => setApiKey(context).catch((error) => handleCommandError(error, context, output))),
    vscode.commands.registerCommand('aiCommit.showLogs', () => output.show()),
    vscode.commands.registerCommand('aiCommit.openLogFile', () => openLogFile(context).catch((error) => handleCommandError(error, context, output))),
    vscode.commands.registerCommand('aiCommit.openPromptFile', () => openPromptFile().catch((error) => handleCommandError(error, context, output)))
  );
}

function deactivate() {}

module.exports = { activate, deactivate, getSecretKey };
