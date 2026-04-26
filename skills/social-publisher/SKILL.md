---
name: social-publisher
description: 
使用调试版 Chrome（CDP）自动化处理微博和小红书。适用于：微博发布、发微博、微博互动（点赞、转发、评论、转评）、微博账号切换、切号、打开微博浏览器、打开 9333/9334、打开登录页、登录微博等正式任务。
微博发布只分两类：
(1) 发布纯文微博：用户不提供文案，也不需要素材，改走 weibo-ent-hot-publisher；
(2) 执行发布任务：用户已提供文案和素材，只负责执行发布，包含单素材、多素材、图文、动图、视频、混合素材发布。
对执行发布任务，不再先区分图片、动图、视频，统一按“素材”处理，已验证 jpg/gif/mp4 混合可走同一入口。严禁自写临时脚本，必须走现有正式入口。
---

# 社交平台发布工具

统一规则：**浏览器只走调试版 Chrome；正式任务只走现有正式脚本。**

## 硬约束

- **严禁新写任何 `tmp-*` / `debug-*` / `test-*` / 临时脚本。**
- 只能使用和修复现有正式入口；流程不够时，**改正式脚本/Skill，不要旁路加脚本**。
- 微博发布只分两类：
  1. **发布纯文微博**：用户不提供文案、不需要素材 → 交给 `weibo-ent-hot-publisher`
  2. **执行发布任务**：用户已经提供文案和素材 → 只负责执行发布
- 对“执行发布任务”，再细分：
  - **单素材**
  - **多素材**
- 对“执行发布任务”，**不再先区分图片、动图、视频**；统一按“素材”处理。
- 对其他 agent / 机器人：**发布任务默认走 `-PayloadPath`（UTF-8 JSON 文件）协议，不要默认使用裸 `-Text` / `-ImagePath` 命令行传参。**
- `pending-attachments.json`、`attachment-collection.json`、payload 文件现在有正式入口：`scripts/state-manager.mjs`。后续读写这些状态文件时，优先复用它，不要再各自手写散落路径。
- 面向非技术用户的操作手册见：`references/weibo-operator-sop.md`。当需要给用户解释标准指令格式、能力边界、取消/重开/救急流程时，优先按这份 SOP 说明。
- 对 **飞书来源** 的发布任务：素材本地路径统一收敛到 `%USERPROFILE%\\.openclaw\\media\\inbound\\`，不要混用 `C:\tmp\openclaw\`、工作区临时目录或其他下载目录作为最终素材路径。

## 正式脚本

- `publish-weibo.ps1`：**微博统一素材发布主入口**
- `interact-weibo.ps1`：微博互动
- `login-weibo.ps1`：打开微博登录页
- `switch-weibo-account.ps1`：切换微博账号端口
- `open-weibo-browsers.ps1`：打开 9333 / 9334 两个微博浏览器
- `social-publisher.mjs`：`publish-weibo.ps1` 的底层执行脚本

## 命令分类

### 1) 发布纯文微博

触发条件：
- 用户说“发布纯文微博”
- 用户**没有提供文案**
- 用户**没有提供素材**

规则：
- **不要追问正文**
- 直接交给 `weibo-ent-hot-publisher`

### 2) 执行发布任务

触发条件：
- 用户已经提供文案
- 用户已经提供素材，或明确没有素材只发纯文
- 当前任务只需要执行发布，不需要自动选题

统一入口：`publish-weibo.ps1`

#### 飞书来源素材的固定处理规则

当发布任务来自飞书消息，且素材来自当前消息附件时，按以下顺序处理：

1. **优先使用飞书自动落盘结果**
   - 默认素材目录固定为：`%USERPROFILE%\\.openclaw\\media\\inbound\\`
   - 如果当前消息中的图片/文件已经自动解析并保存到该目录，直接使用该路径写入 payload

2. **判断是否需要主动补下载**
   - 只有在“消息里存在附件，但本地没有对应落盘路径”时，才考虑主动补下载
   - 常见触发特征：
     - 当前消息/上下文里有附件资源（`file_key` / `image_key`）
     - 但 `MediaPaths` 里缺少对应本地路径
     - 或日志/上下文出现 `Media exceeds 30MB limit`
   - 不要对已经成功落盘的素材重复下载

3. **主动补下载只尝试一次**
   - 每个缺失素材，最多主动调用 **一次** `feishu_im_bot_image`
   - 主动补下载时：
     - 图片 → `type="image"`
     - 文件/音频/视频 → `type="file"`
   - 如果这一次失败，就直接放弃该素材，不做第二次重试

4. **主动补下载成功后，统一收敛到 inbound 目录**
   - 如果工具返回的 `saved_path` 不在 `%USERPROFILE%\\.openclaw\\media\\inbound\\` 下，需要立刻复制/移动到该目录，再把 **inbound 中的新路径** 写入 payload
   - 不要把 `\tmp\openclaw\...` 之类的临时路径直接作为最终素材路径长期使用

5. **主动补下载仍失败时**
   - 该素材跳过，不要无限重试
   - 继续使用其余已成功落盘的素材执行发布
   - 如果最终一个素材都没有落下来，再按无素材或失败场景处理

#### 飞书多消息收集模式（素材顺序保障）

当用户在飞书中**分多条消息**发送声明 + 素材时，使用此模式。目的是解决素材并行下载导致顺序混乱的问题。

**用户操作流程：**
1. 先发声明消息：`发布微博，文案：XXX，共N个素材`（**不带附件**）
2. 等待 3 秒以上（确保声明消息的 debounce 先到）
3. 按期望的发布顺序逐条发送附件，每条消息一个附件：
   - 消息2：附件A.jpg
   - 消息3：附件B.gif
   - 消息4：附件C.mp4

**自动处理流程（AI 侧）：**

由于飞书插件的 debounce 机制，文本消息会进入 debouncer 等待（默认 ~3 秒），而附件消息直接 dispatch。因此**附件消息通常会先于声明消息到达 AI**。
```
用户发送：声明(T=0) → 附件A(T=3s) → 附件B(T=4s) → 附件C(T=5s)
AI 处理：附件A → 附件B → 附件C → 声明(debouncer 到期)
```

每条消息到达时，按以下逻辑处理：

**步骤 1 — 检查状态**
- 读取 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\pending-attachments.json`（附件暂存）
- 读取 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\attachment-collection.json`（收集状态）
- 两个文件可能都不存在（正常；目录由脚本自动创建）

**步骤 2 — 判断当前消息类型**
- **声明消息**：包含"发布微博"等发布意图 + "共N个素材/附件"（不带附件）
- **附件消息**：当前消息包含 MediaPaths（图片或文件附件）
- **触发词**：在收集状态下，文本为"发"/"开始"/"发布"
- **取消词**：在收集状态下，文本为"取消"/"算了"/"不要了"

**步骤 3 — 按类型执行**

**A) 声明消息到达：**
1. 解析"共N个"中的 N（expectedCount），提取文案（text）
2. 读取 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\pending-attachments.json`，获取之前暂存的所有附件路径，**按 createdAt 时间排序**，取前 N 个作为 collected
3. 创建 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\attachment-collection.json`：
   ```json
   {
     "active": true,
     "declaredAt": <当前时间戳毫秒>,
     "text": "提取的文案",
     "expectedCount": N,
     "collected": [{"path": "...", "type": "..."}, ...],
     "submit": true,
     "port": 9333
   }
   ```
4. 清空 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\pending-attachments.json`（或设为空数组）
5. 检查 collected.length >= expectedCount：
   - ≥ → 素材收齐，执行发布（步骤 5）
   - < → 回复：`收到声明，等你发素材（共 N 个）`，等待后续消息补充（后续附件也可能还没被暂存，等到达后通过 B 分支处理）
6. **补充检查**：如果 collected 不足 N 个，用飞书 API 查历史消息（`feishu_im_user_get_messages`）补充——以声明消息的上下文为准，查找同会话中后续到达的附件消息，按 message_id 排序补充到 collected，重新检查是否收齐。
   > 注意：如果 pending 中已经有附件，说明附件已经由 AI 处理并暂存过。飞书 API 仅作为补充兜底，不会重复添加已暂存的路径。

**B) 附件消息到达：**
1. 检查 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\attachment-collection.json` 是否有 active 收集任务：
   - **有** → 将附件路径加入 collected，更新文件，检查数量：
     - 收齐了 → 执行发布（步骤 5）
     - 没收齐 → 回复：`收到素材 X/N`（X = 当前 collected.length）
   - **没有** → 这是"附件先到"场景，将附件写入 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\pending-attachments.json`：
     ```json
     [
       { "path": ".../xxx.jpg", "type": "image/jpeg", "createdAt": <时间戳毫秒> },
       { "path": ".../yyy.gif", "type": "image/gif", "createdAt": <时间戳毫秒> }
     ]
     ```
     回复：`收到素材`（简洁回复，不暴露收集逻辑）

**C) 触发词到达（"发"/"开始"/"发布"）：**
- 有收集任务且 collected 不为空 → 执行发布（步骤 5）
- 无收集任务 → 当作普通文本处理（可能触发发布纯文微博流程）

**D) 取消词到达（"取消"/"算了"/"不要了"）：**
- 清理两个状态文件，回复：`已取消发布`
- 无收集任务 → 当作普通文本处理

**E) 普通文本消息（其他情况）：**
- 有收集任务 → 可能是修改文案（"文案改成：XXX"），更新 text 字段；否则忽略，不回复。
- 无收集任务 → 正常处理（可能是新的发布任务或其他对话）

**步骤 4 — 超时处理（5 分钟）**
- 每次收到消息时，检查 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\collections\\attachment-collection.json` 的 `declaredAt`：
  - `now - declaredAt > 5 * 60 * 1000`（300秒）→ 超时，用已收集的素材发布（即使 < expectedCount）
- 发布或清理后，删除两个状态文件。

**步骤 5 — 执行发布**
1. 按 collected 中**已有的顺序**（即用户实际发送顺序）构建 payload：
   ```json
   {
     "text": "提取的文案",
     "assets": ["path1", "path2", "path3"],
     "submit": true,
     "port": 9333
   }
   ```
2. 写入 `%USERPROFILE%\\.openclaw\\state\\social-publisher\\payloads\\weibo-payload-<随机>.json`（UTF-8 编码；目录由脚本自动创建）
3. 调用 `publish-weibo.ps1 -PayloadPath <路径>`
4. 发布成功后回复：`发布成功，文案为：XXX`
5. 发布失败后回复：`发布失败：<原因>。`
6. **无论成功失败，清理两个状态文件**
7. 如果发布失败但用户希望重试，需要重新走整个收集流程（包括重新声明）

**多发/少发处理：**
- 声明 N 个，来了 >N 个：按到达/暂存顺序取前 N 个发布，多出的忽略。
- 声明 N 个，来了 <N 个，触发词到达：用已收集的发布。
- 声明 N 个，来了 <N 个，超时：用已收集的发布。
- 声明 N 个，来了 0 个，超时：清理状态，回复提示：`超时，未收到素材。`
- 声明消息中也带了附件：按上述 B 分支处理，该附件计入 collected。

#### 正式协议：Payload 文件（推荐） / Base64 Payload（兼容）

### 推荐：PayloadPath（UTF-8 JSON 文件）

发布任务默认推荐使用 `-PayloadPath`，不要再把中文文案和多素材直接裸传命令行。

JSON 文件示例（必须为 UTF-8 编码）：

```json
{
  "text": "第一次尝试",
  "assets": [
    "C:\\path\\to\\1.jpg",
    "C:\\path\\to\\2.gif",
    "C:\\path\\to\\3.mp4"
  ],
  "submit": true,
  "port": 9333,
  "stripTopics": false
}
```

调用示例：

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-weibo.ps1 -PayloadPath "%USERPROFILE%\\.openclaw\\state\\social-publisher\\payloads\\weibo-payload.json"
```

任务完成后会**默认自动删除**该 JSON 文件。

如果排障时希望保留该文件：

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-weibo.ps1 -PayloadPath "%USERPROFILE%\\.openclaw\\state\\social-publisher\\payloads\\weibo-payload.json" -KeepPayloadFile
```

### 兼容：Base64 Payload

```powershell
$payload = '{"text":"第一次尝试","assets":["C:\\path\\to\\1.jpg","C:\\path\\to\\2.gif","C:\\path\\to\\3.mp4"],"submit":true}'
$payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/publish-weibo.ps1 -PayloadBase64 $payloadBase64
```

说明：
- 推荐优先级：`-PayloadPath` > `-PayloadBase64` > `-PayloadJson` > 旧的 `-Text` / `-ImagePath`
- payload 字段：
  - `text`: 文案
  - `assets`: 素材路径数组（统一素材，不区分图片/动图/视频）
  - `submit`: 是否直接发布，默认建议传 `true`
  - `port`: 可选，指定微博端口
  - `stripTopics`: 可选，是否去掉话题
- `publish-weibo.ps1` 会按 UTF-8 读取 `-PayloadPath` 指向的 JSON 文件
- 使用 `-PayloadPath` 时，任务完成后会默认自动删除 payload 文件
- `-KeepPayloadFile` 仅用于排障时显式保留 payload 文件
- `publish-weibo.ps1` 仍兼容旧的 `-Text` / `-ImagePath`，但那是兼容层，不是推荐主协议
- **飞书来源素材** 写入 payload 前，先做一次素材路径归一：
  - 优先保留 `%USERPROFILE%\\.openclaw\\media\\inbound\\...`
  - 若主动补下载得到的是 `\tmp\openclaw\...` 或其他临时路径，先复制/移动到 `%USERPROFILE%\\.openclaw\\media\\inbound\\`，再写入 `assets`
- **飞书来源的大文件 fallback**：
  - 若自动解析阶段报 `Media exceeds 30MB limit`，先主动调用一次下载工具补救
  - 补救成功则继续发布；补救失败则跳过该素材，不无限重试
- 已验证：
  - 多图可行
  - `mp4 + jpg` 可行
  - `gif + mp4 + jpg` 可行
  - 8 个混合素材（jpg/gif/mp4）可行

## 发布工作流

1. 运行 `publish-weibo.ps1`
2. 自动启动/复用调试版 Chrome，并连接 CDP
3. 先检查微博是否已登录；未登录则直接失败
4. 输入文案
5. 统一通过发布框素材入口上传素材
6. `social-publisher.mjs` 中：
   - `setInputFiles` 超时：**300 秒**
   - 发布轮询：**最长 300 秒**
   - 轮询间隔：**3 秒**
   - 只点**发布框附近、可点击、未 disabled 的 button**
   - 如果按钮还不可点，继续等待素材上传/页面处理完成
   - **不是点到一次就结束，而是持续轮询，直到确认成功或明确失败**
   - 成功判定优先看：成功提示 / 点击后发布框持续消失
   - 失败时不提前关页，保留现场
7. 成功后返回简短结果

## 其他命令

### 登录微博

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/login-weibo.ps1
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/login-weibo.ps1 -Port 9334
```

### 打开两个微博浏览器

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/open-weibo-browsers.ps1
```

### 切换微博账号

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/switch-weibo-account.ps1
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/switch-weibo-account.ps1 -Port 9333
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/switch-weibo-account.ps1 -Port 9334
```

### 微博互动

```powershell
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/interact-weibo.ps1 -Action like -Url "https://weibo.com/..."
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/interact-weibo.ps1 -Action repost -Url "https://weibo.com/..."
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/interact-weibo.ps1 -Action comment -Url "https://weibo.com/..." -Text "支持一下"
powershell -ExecutionPolicy Bypass -File ${SKILL_DIR}/scripts/interact-weibo.ps1 -Action repost-comment -Url "https://weibo.com/..." -Text "这条不错，转一下"
```

互动规则只保留核心：
- 评论/转评不要拆成两段式
- 评论文案必须由 agent 现生成，不要调用本地评论生成脚本
- 点赞后若触发验证弹窗，立即失败并返回：`任务失败，跳验证。`

## 标准最终回复

- 发布成功：`发布成功，文案为：XXX`
- 发布失败：`发布失败：<原因>。`
- 登录成功：`打开成功。当前端口：9334。`
- 登录失败：`打开失败：<原因>。`
- 切号成功：`切换成功。当前端口：9334。`
- 切号失败：`切换失败：<原因>。`
- 打开双浏览器成功：`打开成功。端口：9333、9334。`
- 打开双浏览器失败：`打开失败：<原因>。`
- 点赞成功：`点赞成功。`
- 点赞失败：`点赞失败：<原因>。`
- 转发成功：`转发成功。`
- 转发失败：`转发失败：<原因>。`
- 评论成功：`评论成功。`
- 评论失败：`评论失败：<原因>。`
- 转评成功：`转评成功。`
- 转评失败：`转评失败：<原因>。`

补充：
- 成功只报最终结果，不复述过程
- 失败只保留一个最关键原因

## 故障判断

- 如果 `setInputFiles` 超时：先判断是脚本超时不够，还是素材组合 / 文件大小问题
- 如果报 `Cannot transfer files larger than 50Mb to a browser not co-located with the server`：按大文件注入限制处理
- 不要把“文件已注入 input”说成“上传成功”
- 未登录就直接返回：`微博未登录，请先登录后再试`
