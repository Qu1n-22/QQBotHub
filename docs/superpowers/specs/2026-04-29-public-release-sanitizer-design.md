# Public Release Sanitizer Design

## Goal

为插件仓库增加一个“公开发布准备”脚本：扫描少量白名单文件，发现敏感信息后在 `publish/` 目录生成脱敏副本，并将原始未跟踪敏感文件追加到 `.gitignore`，避免误提交。

## Scope

本次设计只覆盖以下内容：

- 扫描 `config/` 目录
- 扫描仓库根目录的 `README.md`
- 扫描配置文件中声明的少量额外文件
- 生成 `publish/` 目录下的公开版副本
- 对命中的敏感内容按类型替换为占位符
- 更新 `.gitignore` 来忽略未跟踪的原始敏感文件
- 输出处理报告

本次不覆盖以下内容：

- 自动重写或删除原始敏感文件
- 全仓库递归扫描
- 自动改写已被 Git 跟踪的原文件
- 复杂交互式确认流程

## User Decisions

- 发布目录固定为 `publish/`
- 默认只扫描白名单路径，不做全仓库扫描
- 敏感词替换采用按类型替换，而不是统一占位符
- 已被 Git 跟踪的文件只生成副本并告警，不自动修改原文件
- 脚本支持可选自动暂存，但默认不暂存

## Architecture

脚本入口放在 `scripts/prepare-public-release.js`，配置放在仓库根目录 `public-release.config.json`。脚本读取配置后，收集需要扫描的文件列表，逐个读取内容并匹配内置敏感规则与用户自定义规则。命中文件会复制到 `publish/` 下对应相对路径，并将命中的敏感内容替换为按类型定义的占位符。

脚本在生成副本后，会检查原文件是否被 Git 跟踪。未跟踪的原始敏感文件会被追加到 `.gitignore`；已跟踪文件不会尝试通过 `.gitignore` 隐藏，而是在结果报告中单独列出，提醒用户手动处理。脚本还会输出清晰的执行摘要，说明哪些文件被扫描、哪些文件命中、生成了哪些副本，以及哪些路径被加入忽略列表。

## File Responsibilities

- `scripts/prepare-public-release.js`
  - 命令行入口
  - 读取配置
  - 收集文件
  - 执行脱敏与复制
  - 更新 `.gitignore`
  - 输出报告
- `public-release.config.json`
  - 声明额外扫描文件
  - 声明用户自定义敏感规则
  - 控制默认行为
- `test/prepare-public-release.test.js`
  - 覆盖核心行为的自动化测试

## Configuration Shape

配置文件使用 JSON，最小结构如下：

```json
{
  "extraFiles": [],
  "customRules": []
}
```

说明：

- `extraFiles` 是相对仓库根目录的文件路径数组
- `customRules` 是可选规则数组，允许用户补充项目特有的替换规则

## Built-In Sensitive Types

脚本内置一组默认敏感规则，并按类型替换为更自然的公开占位符，例如：

- OpenAI 风格 API Key -> `sk-xxxxx`
- 通用 token / api key / secret -> `your_token_here`
- Authorization 头 -> `Bearer your_token_here`
- Cookie -> `your_cookie_here`
- QQ 号 -> `示例QQ号`
- 群号 -> `示例群号`

规则实现上优先匹配更具体的模式，避免通用规则覆盖更精准的替换结果。

## Publish Directory Behavior

输出目录固定为 `publish/`。副本保留原始相对路径，例如：

- `config/message.yaml` -> `publish/config/message.yaml`
- `README.md` -> `publish/README.md`

这样用户可以清晰区分“原始工作文件”和“可公开提交文件”，也便于后续只选择 `publish/` 下的安全副本进行提交。

## GitIgnore Behavior

脚本只会将“未跟踪且命中过敏感规则的原文件”追加到 `.gitignore`。这样可以减少误提交风险，同时避免无意义地向忽略列表添加普通文件。

对于已被 Git 跟踪的文件，脚本不会试图依赖 `.gitignore` 隐藏，因为 Git 仍会继续跟踪它们。此类文件会出现在报告的“已跟踪需手动处理”列表中。

## CLI Behavior

脚本支持两个参数：

- `--dry-run`
  - 只扫描和报告，不写入 `publish/` 和 `.gitignore`
- `--stage`
  - 在正常执行完成后，自动暂存 `publish/`、`.gitignore` 和 `public-release.config.json`

默认行为是不暂存，只生成结果并输出报告。

## Reporting

脚本执行完成后需要输出以下信息：

- 扫描了多少文件
- 命中了多少文件
- 生成了哪些 `publish/` 副本
- 哪些原文件被追加到 `.gitignore`
- 哪些命中文件已被 Git 跟踪，需要手动处理

如果没有任何文件命中，也要输出明确提示，避免用户误以为脚本没有工作。

## Error Handling

- `config/` 不存在时按空目录处理，不报错退出
- `extraFiles` 中不存在的路径应给出告警，但不导致整个流程失败
- 配置文件 JSON 格式错误时直接报错退出
- `git` 命令失败时不影响副本生成，但要在报告中提示无法判断跟踪状态或无法自动暂存

## Testing Strategy

采用 TDD，实现前先写测试。核心测试至少覆盖：

1. 命中敏感文件时会在 `publish/` 生成对应副本
2. 副本中的敏感内容会按类型替换
3. 未跟踪命中文件会被追加到 `.gitignore`
4. 已跟踪命中文件不会被追加到 `.gitignore`，但会出现在报告中
5. `--dry-run` 不会写文件
6. `--stage` 会尝试暂存目标路径

## Success Criteria

满足以下条件视为完成：

- 用户可以运行一次脚本，得到 `publish/` 下的可公开副本
- 原始敏感文件不会被脚本覆盖
- 未跟踪敏感源文件能被自动加入 `.gitignore`
- 已跟踪敏感源文件会被明确提示
- 用户可以只提交 `publish/` 下的副本而不是原文件
