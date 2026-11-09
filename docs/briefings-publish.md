# briefings 离线发布契约

状态：离线判定和 ready 旁车已在本仓。上传 CLI 在没有 `BRIEFINGS_PUBLISH_TOKEN` 时不发 HTTP。例行未改。token 未写入仓库或 Actions secret。真实链路尚未跑通。

真实链路 `export → GitHub → Actions → 公网` **未验证**。失败告警是否盖住 Pages，以及部署前核验到 `deploy-pages` 返回之间的 TOCTOU，也 **未验证**。

生产路径不是把本地 ready 或 raw 直推进 `content/`。box 上 `stageReady` 之后，`scripts/briefings-upload.mjs` 只把公开 envelope 写到 `_inbox/daily/YYYY-MM-DD.json` 或 `_inbox/weekly/YYYY-Www.json`。没有 `BRIEFINGS_PUBLISH_TOKEN`，或值不是一段不含空白的 token 字符，命令退出 50，不发 HTTP。token 只从该环境变量读入，不进参数、日志、结果行或 Actions secret。

现有 `.github/workflows/pages.yml` 在同一次 run 里处理队列、快进提交 `content/`、构建并部署，然后按已消费的 `content_hash` 和 blob sha 做 CAS 删除。`schedule` 为每天 22:17 上海（`17 14 * * *`）和周一 09:17（`17 1 * * 1`），只处理已经在仓里的白名单文件。`cancel-in-progress: false` 不是 FIFO。部署前要求 `origin/main` 仍等于处理后的 `content_sha`；核验之后仍有未证明为零的窗口。

处理 job 只有 `contents: write`。deploy 是 `contents: read`、`pages: write`、`id-token: write`。ack 只有 `contents: write`。没有 `actions: write`。step summary 和 `_site/publish-manifest.json` 并列写出 `trigger_sha`、`content_sha`、`payload_sha256`，不合成一个版本号。

`scripts/briefings-publish.mjs` 仍是本地 ready 校验。不带测试注入时它不读 token，也不发 HTTP。

公开页只渲染已在 git 里的 JSON。Markdown 不参与哈希。Page 仍是阅读权威。本文件不改页面。

## 1. 命令

本地 ready 校验：

```bash
node scripts/briefings-publish.mjs --ready <ready.json> --receipt-dir <dir>
```

这个命令不读 `BRIEFINGS_PUBLISH_TOKEN`，也不上传。

生产上传：

```bash
node scripts/briefings-upload.mjs --ready <ready.json> --receipt-dir <dir>
```

它只根据 ready 生成公开 envelope，并只 PUT 白名单路径。无可用 token 时退出 50。两个命令都拒绝目录扫描和裸 JSON。

命令只打开 `--ready` 指向的那一个文件。它不扫描目录，也不接受裸的 briefing JSON。补漏是 `pages.yml` 的 schedule，只看已经上传的白名单文件。

`briefings-publish.mjs` 在没有测试注入时仍退出 **50**（`adapter_disabled`），不发 HTTP。`briefings-upload.mjs` 只有在 `BRIEFINGS_PUBLISH_TOKEN` 可用时才向白名单路径发 Contents API；否则同样是 50。两种 50 都表示这次没有完成上传，不是「通道已经可用」。

测试代码可以调用 `asTestTransport` 或 `createInjectedGitDataTransport(fetchImpl)` 注入 `briefings-publish.mjs`。那条注入不读上传 token。上传命令的测试用假 token 和假 fetch，不把真实 token 写进夹具。未带测试标记的对象即使写了 `enabled: true` 也不能打开发布命令。

## 2. Ready 契约

`ready_schema` 固定为 `qianji.briefing.export-ready.v1`。字段只有：

| 字段 | 含义 |
|---|---|
| `schema` | `qianji.briefing.daily.v1` 或 `qianji.briefing.weekly.v1` |
| `period` | 日报 `YYYY-MM-DD`，周报 `YYYY-Www` |
| `updated_at` | 严格偏移时间戳，见下节 |
| `content_hash` | 规范化对象去掉顶层 `updated_at` 后，键名递归排序，再 `JSON.stringify` 的 SHA-256 |
| `raw_sha256` | 规范化之前原始字节的 SHA-256 |
| `snapshot_sha256` | 规范化快照字节的 SHA-256 |
| `snapshot` | 相对导出根的 `objects/norm/<snapshot_sha256>.json` |
| `raw` | 相对导出根的 `objects/raw/<raw_sha256>.json` |

导出根是 ready 文件所在 `ready/` 目录的上一级。`snapshot` 和 `raw` 必须是相对路径，不能是绝对路径，不能含 `..`。

快照字节是规范化对象按键名递归排序后的两空格 JSON，末尾一个换行。`content_hash` 不是这段 pretty JSON 的哈希；它不含 `updated_at`，也没有额外空白。

参考实现是 `stageReady(root, rawBytes)`。三条例行 **尚未** 调用它。

### 原子顺序

1. 规范化并校验。
2. 原始字节写入 `objects/raw/`（临时文件、fsync、rename）。已存在且字节相同则保持。
3. 规范化快照写入 `objects/norm/`，同样原子且不可变。
4. **最后** 把 ready 文件原子 rename 到 `ready/<daily|weekly>-<period>.json`。

ready rename 之前的崩溃不会留下可消费的 ready。命令不把「连续读两次相同」当作完成。完成边只是 ready 文件本身，并且它必须重新算出与旁车一致的哈希。

下列任一不一致都是 `ready_mismatch`，退出 **11**，不接触远程：快照字节、原始字节、`content_hash`、schema、期、`updated_at` 与重新规范化的结果不符；路径逃出导出根；符号链接。

## 3. 时间戳

只接受 `YYYY-MM-DDTHH:mm:ss±HH:mm`。拒绝 `Z`、小数秒、缺偏移、非法日历日、秒或分超过 59、偏移超出 -12:00 到 +14:00。

比较用绝对时刻，不用字符串。`2026-11-10T08:00:00+08:00` 与 `2026-11-10T00:00:00+00:00` 是同一版本。

## 4. 规范化与兼容

顺序：解析 JSON → 现有 `stripValue` → 结构校验 → 对快照再跑 `findForbidden`。剔除后仍有禁文则整份拒绝，不删条目，不补 GitHub 字段。

日报沿用入库所需的 schema、期、`Asia/Shanghai`、六项 metrics、`home_related` 的 `a/b`、`github.meta.archive`。`polfin` 可选；出现时 id 不得与 news 相撞，日报 `wave` 只能是 `晨间` 或 `午间`。扩展 metrics（含 `news_noon: 0`）保留。涨星 `age_h: null`、新锐 `gained: null`、空的 license/slogan 保持原样，不补 `url`。

周报不要求日报那组 metrics。保留 `window`、`gaps`、`news_digest`、`polfin`。news 需要 `background`、`facts`、`why`、`detail`，不要求 `wave`、`first_source_at`、`arch_impact`。涨星需要 `what`、`why`，以及非空的 `gained` 或 `gained_week_approx`。新锐只需要 `what`、`why`；缺 `age_h`、`slogan`、`license` 或 `gained: null` 不拒绝，也不补键。

`sample: true` 拒绝。Markdown 不读入哈希。

## 5. 幂等

`content_hash` 不含 `updated_at`。远程文件先做同一套规范化，再比较哈希和时刻。

| 远程 | 哈希 | 时刻 | 结果 |
|---|---|---|---|
| 无此路径 | 通过校验 | 可解析 | 发布 |
| 有 | 相同 | 相同 | 退出 0，`noop`，不提交 |
| 有 | 相同 | 来稿更新 | 发布。不吞掉新的时间戳 |
| 有 | 相同 | 来稿更旧 | 退出 0，`noop`，不回退远程 |
| 有 | 不同 | 相同 | 退出 20，`conflict`。不能因为见过这个时间戳就当成功 |
| 有 | 不同 | 来稿更新 | 发布 |
| 有 | 不同 | 来稿更旧 | 退出 21，`stale` |

同一时刻以绝对时刻为准，所以上表的「相同」包含不同偏移写法。

## 6. 退出码、机器字段与回执

stdout 与 stderr 各一行机器 JSON。每行都有 `result`、`reason`、`exit`、`attempts`。ready 已经通过校验时还有 `schema`、`period`、`updated_at`、`content_hash`。没有正文，没有路径，没有凭据，也没有 `enabled`。

`result` 是这一次的结局。`reason` 是更具体的原因；拒绝和传输失败时它与 `result` 相同，发布和空操作时它区分原因。

| exit | result | reason |
|---|---|---|
| 0 | `published` | `missing_remote`、`stamp_bump` 或 `replace` |
| 0 | `noop` | `identical` 或 `older_stamp_same_content` |
| 10 | `bad_args` | `bad_args`。规范化函数另有 `bad_json`、`bad_timestamp`、`invalid`、`forbidden`、`sample_refused`，它们发生在写入 ready 之前，不会成为发布命令的传输结果 |
| 11 | `ready_mismatch` | `ready_mismatch` |
| 20 | `conflict` | `conflict` |
| 21 | `stale` | `stale` |
| 30 | `lock_timeout` 或 `lock_lost` | 与 `result` 相同。超时表示锁仍被活进程持有；`lock_lost` 表示持锁辅助进程在临界区中途退出 |
| 40 | `transport_exhausted` | 可重试的网络失败、5xx、408、429、非 JSON 正文或响应丢失，用满 3 次 |
| 40 | `transport_forbidden` | 401 或 403。不重试 |
| 40 | `transport_rejected` | 其他不应盲重试的 4xx |
| 40 | `ref_missing`、`remote_unreadable`、`tree_truncated` | 与 `result` 相同。不重试 |
| 40 | `unknown` | 上传响应丢失或重试耗尽后未能读回同一路径。不是成功，本地 ready 保留 |
| 50 | `adapter_disabled` | 本地发布命令的固定结果；上传命令在没有可用 token 时也是这个结果 |

`success.json` 只在确认发布，或确认远程已有同一哈希且同一时刻时写入。退出 20、21、40 只写 `pending.json`。退出 30 和 50 不写回执。这些失败都不改已有的 success。同一时刻同一哈希的重复成功也不重写 success 字节。更新的时间戳一旦确认发布，会换成新的 success。pending 失败可以再用同一 ready 重试。

### 锁

receipt 目录里的 `publish.lock` 是同一台机器上的内核 `flock`，不是用目录存在与否当锁。持锁的是一个辅助进程：它把父进程死亡信号设为 SIGKILL，所以 Node 进程无论正常退出还是被 SIGKILL，锁都会由内核释放。下次获取不会因为上次崩溃留下的文件而永远退出 30。

等待超时只返回 30，不会把仍被活进程持有的锁抢走。不提供手动删除锁文件来恢复：删掉文件会换成新的 inode，可能绕过仍活着的持有者。崩溃后的恢复是自动的，不需要人去清锁。这只在本地文件系统的进程之间有效，不是跨主机锁。同一进程里的并发调用各自启动辅助进程，因此也会被同一把锁串行化。

## 7. 生产传输（未执行）

生产 CAS 只用文档中的 GitHub REST Git Data API，仓库固定为 `yurkingw/briefings`，ref 为 `heads/main`：

1. `GET /repos/yurkingw/briefings/git/ref/heads/main`
2. `GET /repos/yurkingw/briefings/git/commits/{sha}`
3. `GET /repos/yurkingw/briefings/git/trees/{tree_sha}?recursive=1`
4. 该路径有 blob 时 `GET /repos/yurkingw/briefings/git/blobs/{blob_sha}`
5. `POST /repos/yurkingw/briefings/git/blobs`，`encoding: utf-8`
6. `POST /repos/yurkingw/briefings/git/trees`，`base_tree` 必须是刚读到的 tree，`tree` 数组只有要替换的那一个 `content/daily|weekly/<period>.json`
7. `POST /repos/yurkingw/briefings/git/commits`，`parents` 只有刚读到的 commit
8. `PATCH /repos/yurkingw/briefings/git/refs/heads/main`，正文必须是 `{ "sha": "...", "force": false }`

`force: false` 表示非快进会被 GitHub 拒绝（文档：Update a reference）。这里不用 force，不用 force-with-lease，不用 git push。

base 变化后重新执行 1–4，只重读同一路径，按第 5 节重判，再用新的 base 重建 tree 和 commit。最多 3 次。树更新始终带当前 `base_tree` 且只列一个路径，因此不会用旧 base 覆盖其他文件。ref 不存在、tree `truncated: true`，或远程 JSON 无法规范化，都失败关闭，不创建 ref。

响应丢失、连接失败、408、429、5xx，以及 HTTP 正文不是 JSON，都归一化成可重试错误，不会变成未分类异常。下一次从第 1 步重读并重判。若远程已经是同一版本，退出 0，不再建第二个 commit。否则最多 3 次，然后退出 40，`result` 为 `transport_exhausted`。401 和 403 立刻退出 40，`transport_forbidden`，不盲重试。其他不应重试的 4xx 是 `transport_rejected`。

`lib/` 与 `scripts/` 没有 checkout、clone 或 git init。box 上禁止任何 checkout/clone，包括改名的 bare remote。`test/publish/bare-git-sim.mjs` 只被 CA 里的离线测试导入，用临时 bare 仓库和 `update-ref <new> <old>` 模拟非快进；它不是生产载体，不能放到 box 上跑。

`createGithubGitDataTransport()` 不接受 fetch，永远是关闭的。会发请求的 `createInjectedGitDataTransport(fetchImpl)` 只供测试代码调用，CLI 不引用它。请求头只有 `accept`、`content-type` 和 `x-github-api-version`，没有认证头。本变更不读取、不配置 token。注入传输的 `production` 固定为 false；它通过测试不等于生产发布已经可用。离线首版不承担认证后的生产 E2E，该链路仍然 blocked。

## 8. 认证边界

分类只使用下面三档。本变更不申请凭据，也不搜索钥匙。

| 对象 | 分类 | 依据 |
|---|---|---|
| box 上这次 `gh` CLI 进程 | 已验证：该进程没有可用认证 | 在 box 上执行 `gh api repos/yurkingw/briefings --jq '{full_name,permissions}'` 退出码 4，提示需要 `gh auth login` 或 `GH_TOKEN`。没有读、打印或枚举凭据 |
| box 上其他身份、App、部署密钥 | 未验证 | 不能从「这个 gh 进程没登录」推断它们不存在 |
| 本 CA 的 gh 集成查询分支保护与 Actions secrets | 不可受控查询 | 只读请求返回 403。这不是「保护不存在」或「secret 不存在」 |
| 本 CA 的 gh 集成 `permissions.push` | 该集成身份返回 false | 只描述这个 CA 登录，没有用它 push，也不是 box |
| 本变更中的生产写凭据 | 本变更未配置 | 是否另有受控凭据仍是未验证 |

候选范围仍只是建议，没有证明已经够用：仅 `yurkingw/briefings` 的 fine-grained PAT 或 GitHub App，Contents 读和写，加上自动附带的 Metadata 读。分支保护、规则集和组织策略未知。

## 9. Pages 是否会跟着 Contents 写走

事实：`.github/workflows/pages.yml` 在 `push` 到 `main` 以及 `workflow_dispatch` 时构建；`deploy` 依赖构建成功。workflow 权限是 `contents: read`、`pages: write`、`id-token: write`，它自己不回写 commit。最近一次已在 `main` 上的提交曾经部署成功。这只证明 **已经在 `main` 上的提交** 可以走这条 workflow。

条件，尚未用生产凭据验证：

- GitHub 文档规定，由 `GITHUB_TOKEN` 触发的事件里，除 `workflow_dispatch` 和 `repository_dispatch` 外，不会创建新的 workflow run。因此用 Actions 内置 `GITHUB_TOKEN` 做的 Contents 写，不能当作会触发本 Pages workflow 的 push。
- PAT 或 GitHub App installation token 与 `GITHUB_TOKEN` 不是同一类凭据。它们默认产生的 push 可以匹配 `on.push`，但本仓没有用任何真实凭据演练过。
- 分支保护和组织策略属于上一节的不可受控查询，不能假设不存在，也不能假设 Contents 写权限已经足够越过它们。
- 不声明这次或将来的 Actions 运行费用为零。

## 10. 补漏提案（未启用）

主路径不是常驻进程：将来例行只在 Page 定稿、自身校验成功、快照与 ready 都原子落盘之后，调用第 1 节的命令一次。现在例行没有这一行，所以生产上不会被调用。

实际常驻载体 **未确认**。可靠性边界：在载体被单独确认并启用之前，漏掉的那一次调用不会自动重跑。ready 和 pending 留在本地，只能由同一个人或将来的载体再次把 **同一个 ready 文件** 传给同一命令。冲突 20 和过期 21 即使将来有了调度，也不应自动改写成发布。

下面的 unit 是提案文本。本变更不探测 box 上有没有 systemd 或 cron，不执行安装，不指定一个已经存在的运行用户。

```ini
# 不安装。
[Service]
Type=oneshot
ExecStart=/usr/bin/node /PATH/briefings/scripts/briefings-publish.mjs --ready /PATH/ready/daily-YYYY-MM-DD.json --receipt-dir /PATH/receipts/daily-YYYY-MM-DD
```

```ini
# 不安装。每天 22:10 与周一 09:10（Asia/Shanghai）各一次 oneshot，不是 daemon。
[Timer]
OnCalendar=*-*-* 22:10:00 Asia/Shanghai
OnCalendar=Mon *-*-* 09:10:00 Asia/Shanghai
Persistent=true
```

```bash
# 不执行。
systemctl --user daemon-reload
systemctl --user enable --now briefings-publish.timer
```

生命周期是一次 oneshot。离线重放是 `npm run test:publish`，不访问 GitHub。告警出口是非 0 退出码、stdout 的机器 JSON 和 `pending.json`；不唤醒 Bot，不新增 secret。权限边界是只读 ready 根、可写 receipt 目录；不能给这个进程 checkout，也不能把凭据放进参数。当前命令在校验后退出 50，仍然没有 HTTP。

## 11. 离线测试

`npm run test:publish` 覆盖原子写崩溃、ready 绑定失败、并发同文与异文、旧版、重复、同版本冲突、锁超时、三次传输失败、响应丢失后的去重，以及 success 不被失败覆盖。GitHub 请求由进程内假服务器记录，断言 `force: false` 和单路径 `base_tree`。CA 里的 bare git 只存在于测试进程的临时目录。

`npm test` 先跑这些测试，再跑原有的站点构建检查。通过不等于公网发布已经验证。
