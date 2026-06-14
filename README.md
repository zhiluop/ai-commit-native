# AI Commit Native

![AI Commit Native hero](https://raw.githubusercontent.com/zhiluop/ai-commit-native/main/media/marketplace/hero.png)

**AI Commit Native** 把 AI commit message 和 AI code review 放回 VS Code 原生 Git 工作流里：在 Source Control 标题栏点一下图标，扩展读取当前 diff，调用你配置的 OpenAI-compatible 或 Anthropic-compatible endpoint，然后把结果写回 VS Code 自带的 commit 输入框或原生 diff editor 评论线程。

它不接管 Git 面板，也不生成额外 review 文档。你的暂存区、diff、commit 输入框、日志和排错入口都还在熟悉的位置。

## 安装后你会看到

| 位置 | 入口 | 结果 |
| --- | --- | --- |
| Source Control 标题栏 | AI commit 图标 | 根据当前 diff 生成 commit message，并填入原生输入框 |
| Source Control 标题栏 | AI review 图标 | 打开原生 diff editor，把 AI 评论贴到右侧变更行 |
| 命令面板 | `AI Commit: Set API Key` | 把 API Key 保存到 VS Code SecretStorage |
| 命令面板 | `AI Commit: Show Logs` / `Open Log File` | 查看请求 URL、模型、HTTP 状态和脱敏后的错误信息 |

## 适合谁

| 你想要 | AI Commit Native 做什么 |
| --- | --- |
| 保持 VS Code 原生 Source Control 工作流 | 在 SCM 标题栏提供生成 commit message 和 review 的图标按钮 |
| 优先根据暂存区生成提交信息 | 默认读取 staged diff，暂存区为空时回退到未暂存改动 |
| 让 AI review 贴在代码旁边 | 打开 VS Code 原生 diff editor，并把 AI 评论挂到右侧变更行 |
| 使用自己的模型网关或 relay | 支持 OpenAI-compatible `/chat/completions` 和 Anthropic-compatible `/v1/messages` 协议格式 |
| 让团队提交风格稳定 | 支持 settings 内联提示词和 Markdown 提示词文件 |
| 遇到接口问题能排查 | 提供输出通道、日志文件、debug 等级和脱敏请求信息 |

## 工作流

![Native AI workflow](https://raw.githubusercontent.com/zhiluop/ai-commit-native/main/media/marketplace/workflow.png)

1. 在 Source Control 中暂存你准备提交的改动。
2. 点击 SCM 标题栏里的 AI commit 图标生成 commit message。
3. 如果需要 review，点击 AI review 图标。
4. 扩展会读取 diff、合并自定义提示词、调用你配置的 endpoint。
5. commit message 会写入 VS Code 原生 Git commit 输入框；review 评论会显示在原生 diff editor 的右侧变更行。

![AI review in native diff editor](https://raw.githubusercontent.com/zhiluop/ai-commit-native/main/media/marketplace/review.png)

## 功能亮点

- **原生入口**：命令和图标出现在 VS Code Source Control 标题栏和命令面板中。
- **暂存区优先**：`aiCommit.preferStagedChanges` 默认为 `true`，更贴近“这次到底要提交什么”的实际语义。
- **双协议兼容**：`openai-compatible` 会请求 `<baseUrl>/chat/completions`；`anthropic-compatible` 会请求 `<baseUrl>/v1/messages`。
- **SecretStorage 优先**：可通过 `AI Commit: Set API Key` 保存 key，优先于 settings JSON 中的明文 key。
- **提示词可组合**：`none`、`inline`、`file`、`both` 四种来源，Markdown 文件支持绝对路径或相对工作区路径。
- **多语言输出**：commit message 和 review 评论共享输出语言设置，内置中文、英文、俄语、日语等，也支持自定义语言偏好。
- **原生 review 展示**：AI review 要求模型返回 JSON，扩展解析后创建 VS Code comment thread，而不是输出一份孤立的报告。
- **可诊断**：`off`、`error`、`info`、`debug` 日志等级，日志会写入 `AI Commit` 输出通道和扩展日志文件。

## 安装

当前版本先通过 GitHub Release 分发 VSIX：

1. 打开 [AI Commit Native v0.1.5](https://github.com/zhiluop/ai-commit-native/releases/tag/v0.1.5)。
2. 下载 `ai-commit-native-0.1.5.vsix`。
3. 在 VS Code 扩展面板右上角点击 `...`。
4. 选择 `Install from VSIX...`。
5. 选择刚下载的 VSIX 文件完成安装。

也可以用命令行安装：

```bash
code --install-extension ai-commit-native-0.1.5.vsix
```

安装后在 VS Code 设置页搜索 `AI Commit`，配置 endpoint、模型和 API Key 即可使用。正式发布到 VS Code Marketplace 后，可以直接在扩展商店搜索安装。

## 快速开始

1. 在 VS Code 设置页搜索 `AI Commit`。
2. 选择 `aiCommit.apiFormat`：`openai-compatible` 或 `anthropic-compatible`。这是 API 请求/响应协议格式，不代表必须使用官方 OpenAI 或 Anthropic。
3. 配置 `aiCommit.model`，填写你的官方 API、中转、网关或 relay 实际要求的模型 ID。
4. 配置 API Key：推荐运行命令 `AI Commit: Set API Key` 保存到 VS Code SecretStorage；也可以临时填写 `aiCommit.apiKey`。
5. 按需配置 `aiCommit.apiBaseUrl`。
6. 配置输出语言和提示词来源。
7. 在 Source Control 页面点击 AI commit 图标生成 commit message，或点击 AI review 图标查看 diff 评论。

## 配置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `aiCommit.apiFormat` | `openai-compatible` | 请求/响应格式：OpenAI-compatible 或 Anthropic-compatible |
| `aiCommit.apiBaseUrl` | `https://api.openai.com/v1` | 官方 API、中转、网关或 relay 的 base URL |
| `aiCommit.model` | `gpt-4o-mini` | commit/review 使用的模型 ID |
| `aiCommit.apiKey` | 空 | 可选明文 API Key；SecretStorage 中的 key 优先 |
| `aiCommit.temperature` | `0.2` | 模型采样温度 |
| `aiCommit.maxTokens` | `4096` | 请求模型输出的最大 token 数 |
| `aiCommit.commitLanguage` | `zh-CN` | commit message 和 review 评论输出语言；支持预设代码或自定义语言偏好 |
| `aiCommit.promptSource` | `both` | 自定义提示词来源：none、inline、file、both |
| `aiCommit.inlinePrompt` | 空 | settings 中的内联提示词 |
| `aiCommit.promptFile` | `.ai-commit.md` | Markdown 提示词文件，支持绝对路径或相对工作区路径 |
| `aiCommit.preferStagedChanges` | `true` | 优先使用暂存区 diff |
| `aiCommit.maxDiffCharacters` | `60000` | 发送给模型的 diff 最大字符数 |
| `aiCommit.maxReviewDiffEditors` | `5` | review 后最多打开的 diff 编辑器数量 |
| `aiCommit.logLevel` | `info` | 日志等级：off、error、info、debug |

## 配置示例

OpenAI-compatible 格式：

```json
{
  "aiCommit.apiFormat": "openai-compatible",
  "aiCommit.apiBaseUrl": "https://your-relay.example.com/v1",
  "aiCommit.model": "your-openai-format-model-id",
  "aiCommit.apiKey": "your-relay-key"
}
```

Anthropic-compatible 格式：

```json
{
  "aiCommit.apiFormat": "anthropic-compatible",
  "aiCommit.apiBaseUrl": "https://your-relay.example.com",
  "aiCommit.model": "your-anthropic-format-model-id",
  "aiCommit.apiKey": "your-relay-key"
}
```

如果你用命令面板里的 `AI Commit: Set API Key`，就不需要在 settings JSON 中保存 `aiCommit.apiKey`。

语言示例配置：

```json
{
  "aiCommit.commitLanguage": "en"
}
```

自定义语言偏好示例配置：

```json
{
  "aiCommit.commitLanguage": "中文，技术名词保留英文"
}
```

提示词文件示例配置：

```json
{
  "aiCommit.promptSource": "file",
  "aiCommit.promptFile": "docs/commit-message-rules.md"
}
```

直接输入提示词示例配置：

```json
{
  "aiCommit.promptSource": "inline",
  "aiCommit.inlinePrompt": "请使用中文 Conventional Commits 格式，只输出最终 commit message。"
}
```

## AI review 输出格式

AI review 会要求模型只返回 JSON 数组。扩展会解析 `file`、`line`、`severity`、`message` 和可选 `suggestion`，然后把评论挂到 VS Code diff editor 的右侧目标文件行上。

模型返回示例：

```json
[
  {
    "file": "src/example.js",
    "line": 42,
    "severity": "warning",
    "message": "这里没有处理空响应，可能导致后续解析报错。",
    "suggestion": "在读取 body 前先检查 HTTP 状态和响应内容。"
  }
]
```

如果没有值得指出的问题，模型可以返回 `[]`。

## 日志和排错

如果遇到类似下面的错误：

```text
AI Commit: AI endpoint request failed (502): error code: 502
```

先把 `aiCommit.logLevel` 改成 `debug`，重新触发一次生成，然后运行命令 `AI Commit: Show Logs` 或 `AI Commit: Open Log File`。日志会显示：

- 当前 `apiFormat`
- 请求 URL
- 模型 ID
- prompt 来源
- HTTP 状态码
- 响应体片段
- 请求还没收到响应时的网络/超时错误

API Key 会被自动脱敏。502 通常是中转/网关返回的错误，重点检查 `apiBaseUrl` 是否和 `apiFormat` 匹配：OpenAI-compatible 会请求 `<baseUrl>/chat/completions`，Anthropic-compatible 会请求 `<baseUrl>/v1/messages`。

日志位置由 VS Code 分配给扩展。最稳的打开方式是命令面板执行 `AI Commit: Open Log File`；日志文件名是 `ai-commit.log`。如果弹出生成失败错误，新版本的错误提示里也会带 `Show Logs` 和 `Open Log File` 两个按钮。

## 提示词文件示例

```markdown
# Commit Message Rules

请用中文生成 commit message。

格式：

<type>: <简短中文摘要>

- <必要时说明主要改动>
- <必要时说明验证方式>

要求：
- 优先总结用户可见行为
- 不要输出 Markdown 代码块
- 如果改动较复杂，保留正文 bullet
```
