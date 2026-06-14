class AiClient {
  constructor(fetcher = globalThis.fetch) {
    if (!fetcher) {
      throw new Error('This VS Code runtime does not provide fetch. Please use a recent VS Code version.');
    }
    this.fetcher = fetcher;
  }

  async complete(options) {
    const apiFormat = normalizeApiFormat(options.apiFormat || options.provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
    const logger = options.logger;

    try {
      const request = apiFormat === 'anthropic-compatible'
        ? buildAnthropicRequest(options)
        : buildOpenAiCompatibleRequest(options);

      logger?.info('Sending AI request', {
        apiFormat,
        url: request.url,
        model: options.model,
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens || undefined,
        messageCount: Array.isArray(options.messages) ? options.messages.length : 0
      });
      logger?.debug('AI request body', request.body);

      let response;
      try {
        response = await this.fetcher(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
      } catch (error) {
        const timeoutMs = options.timeoutMs || 60000;
        const message = error instanceof Error ? error.message : String(error);
        if (error?.name === 'AbortError') {
          logger?.error('AI endpoint request timed out', {
            apiFormat,
            url: request.url,
            model: options.model,
            timeoutMs
          });
          throw new Error(`AI endpoint request timed out after ${timeoutMs}ms.`);
        }

        logger?.error('AI endpoint request failed before receiving a response', {
          apiFormat,
          url: request.url,
          model: options.model,
          message
        });
        throw new Error(`AI endpoint request failed before receiving a response: ${message}`);
      }

      const text = await response.text();
      logger?.debug('AI response received', {
        status: response.status,
        ok: response.ok,
        bodyPreview: text.slice(0, 2000)
      });

      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (error) {
        logger?.error('AI endpoint returned non-JSON response', {
          status: response.status,
          bodyPreview: text.slice(0, 2000)
        });
        throw new Error(`AI endpoint returned non-JSON response (${response.status}): ${text.slice(0, 300)}`);
      }

      if (!response.ok) {
        const message = payload.error?.message || payload.message || response.statusText;
        logger?.error('AI endpoint request failed', {
          status: response.status,
          message,
          apiFormat,
          url: request.url,
          model: options.model,
          bodyPreview: text.slice(0, 2000)
        });
        throw new Error(`AI endpoint request failed (${response.status}): ${message}`);
      }

      const content = extractContent(apiFormat, payload);
      if (!content) {
        logger?.error('AI endpoint response did not include message content', {
          status: response.status,
          apiFormat,
          url: request.url,
          bodyPreview: text.slice(0, 2000)
        });
        throw new Error('AI endpoint response did not include message content.');
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeApiFormat(apiFormat) {
  return apiFormat === 'anthropic' || apiFormat === 'anthropic-compatible'
    ? 'anthropic-compatible'
    : 'openai-compatible';
}

function normalizeProvider(provider) {
  return normalizeApiFormat(provider);
}

function normalizeBaseUrl(apiBaseUrl, apiFormat) {
  const fallback = apiFormat === 'anthropic-compatible' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  return (apiBaseUrl || fallback).replace(/\/$/, '');
}

function buildOpenAiCompatibleRequest(options) {
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl, 'openai-compatible');
  const body = {
    model: options.model,
    temperature: options.temperature ?? 0.2,
    messages: options.messages
  };

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      ...(options.extraHeaders || {})
    },
    body
  };
}

function buildAnthropicRequest(options) {
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl, 'anthropic-compatible');
  const messages = [];
  const systemMessages = [];

  for (const message of options.messages || []) {
    if (message.role === 'system') {
      systemMessages.push(message.content);
    } else {
      messages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      });
    }
  }

  return {
    url: `${baseUrl}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': options.anthropicVersion || '2023-06-01',
      ...(options.extraHeaders || {})
    },
    body: {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      ...(systemMessages.length > 0 ? { system: systemMessages.join('\n\n') } : {}),
      messages
    }
  };
}

function extractContent(apiFormat, payload) {
  if (apiFormat === 'anthropic-compatible') {
    return (payload.content || [])
      .filter((part) => part && part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }

  return payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text;
}

module.exports = {
  AiClient,
  normalizeApiFormat,
  normalizeProvider,
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  extractContent
};
