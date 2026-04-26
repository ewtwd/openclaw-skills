---
name: weibo-ent-hot-publisher
description: 精确触发口令：发布纯文微博。当用户说“发布纯文微博”时，默认调用本技能，而不是先询问正文内容。它会自动完成“发布纯文微博 / 发纯文微博 / 根据热搜发微博”工作流：从微博文娱热搜页抓取前 15 热搜，优先挑选娱乐圈正向话题，随机选择 1 条，打开详情页提取关键信息，并根据详情页各个博主发布的微博内容生成 30-40 字、符合微博平台风格且不带 `#词条#` 的纯文正文，再调用 social-publisher 现有发布脚本发出。用在用户没有提供现成微博文案、只要求直接发布纯文微博，或希望根据微博文娱热搜自动选题发帖的场景。
---

# Weibo Ent Hot Publisher

## Overview

这是一个上层工作流技能：它不直接替代 `social-publisher`，而是负责“选题 + 理解 + 写稿”，最后复用 `social-publisher/scripts/publish-weibo.ps1` 完成真正发布。

当用户只说“发布纯文微博”而没有给正文时，默认不要先追问文案内容，直接走本技能的热搜选题流程。

## Workflow

### 1. 抓取文娱热搜前 15

运行：

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/run-discover-ent-hot-topic.ps1 -Top 15 -Json
```

它会：
- 先检查微博是否已登录；未登录则直接返回，不继续抓取
- 打开 `https://weibo.com/hot/entertainment`
- 抓取可见热搜项
- 取前 N 条（默认 15）
- 随机选一条
- 打开详情页并提取详情页中各个博主发布的微博内容
- 输出 JSON

### 2. 基于详情写微博正文

拿到脚本输出后：
- 阅读 `references/draft-guidelines.md`
- 根据 `picked` 与 `detail.posts/detail.snippet/detail.keyLines` 生成 1 条微博正文
- 正文里不要带 `#xxx#`这类话题词条，保持纯文字
- 写稿时优先依据 `detail.posts` 里的各个博主微博正文理解事件，不要只根据热搜标题空泛发挥
- 长度控制在 30-40 字
- 优先选择娱乐圈偏正向的热搜；如果抽中的话题明显偏负面、争议过大、信息不完整，或 `detail.posts` 太少不足以支撑写稿，可在前 15 里重选一次更稳妥的话题
- 写作态度可在“认同 / 疑惑 / 力挺”中择一，不要每次都同一种口吻
- 语言人设按 22-26 岁、一线冲浪、熟悉娱乐圈与追剧追星语境来写
- AI 语气默认固定为娱乐向口语化表达：温和理性、友善自然、可带轻微正向情绪；可少量自然使用“谁懂啊 / 浅浅说一句 / 救命”这类口语助词，但不要堆砌热词，不要写出模板化 AI 腔
- 风格在“吃瓜前线嘴替 / 温柔安利追星 / 毒舌吐槽搞笑 / 梗王段子轻松”中随机取一种
- 在用户给出正式 prompt 前，先按临时文案规范写

### 3. 调用现有发布脚本

用生成好的正文调用：

```powershell
powershell -ExecutionPolicy Bypass -File ${WORKSPACE}/skills/social-publisher/scripts/publish-weibo.ps1 -Text "<生成的微博正文>" -StripTopics -Submit
```

## Boundaries

- 这个技能负责：抓热搜、随机选题、提取详情、辅助写文案
- `social-publisher` 负责：打开微博首页、填入正文、点击发布
- 发布纯文微博时，调用发布脚本应带 `-StripTopics`，作为最终兜底，避免生成文案残留 `#词条#`
- 不要把发布逻辑重新实现一份到本技能里

## Output Contract

发现脚本返回 JSON 时，重点字段如下：

- `topics`: 抓到的热搜列表
- `picked`: 本次随机选中的热搜
- `detail.title`: 详情页标题
- `detail.url`: 实际打开到的地址
- `detail.requestedUrl`: 原始热点详情地址
- `detail.loginRequired`: 是否被微博拦到登录页
- `detail.snippet`: 压缩后的正文摘要
- `detail.keyLines`: 过滤后的关键文本行
- `detail.posts`: 从详情页提取出的博主微博正文列表（优先使用）
- `detail.postCount`: 成功提取到的微博正文数量
- `detail.sourceQuality`: 提取质量标记（`post-text-rich` / `post-text-limited` / `page-summary-only`）

## Notes

- 抓取脚本默认复用 `social-publisher/node_modules` 里的 Playwright 依赖，不需要在本技能单独再装一份。
- 运行前最好先确保微博已登录；如果详情页被重定向到登录页，结果中的 `detail.loginRequired` 会是 `true`。
- 如果抓不到足够的热搜项，优先返回实际抓到的结果，不要伪造。
- 如果详情页信息噪声很大，写微博时使用更保守、更概括的表达。
- 如果用户只是想手动发布一条已经写好的微博正文，那是 `social-publisher` 的场景；如果用户没有给正文、只说“发布纯文微博”，优先用本技能。
- 如果用户之后补充正式的发帖 prompt，把它放进 `references/` 并在本技能里优先引用。
