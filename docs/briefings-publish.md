# briefings 离线发布契约

状态：离线判定、ready 旁车和 Git Data adapter 接口已在本仓。生产 HTTP **默认关闭且本变更不执行**。例行未改。没有配置凭据，没有调度安装，没有部署。

真实链路 `export → GitHub → Actions → 公网` **未验证**。

公开页只渲染已在 git 里的 JSON。Markdown 不参与哈希。Page 仍是阅读权威。本文件不改页面。

## 1. 命令

```bash
node scripts/briefings-publish.mjs --ready <ready.json> --receipt-dir <dir>
```

只接受这两个参数。没有传输开关，没有 token 参数，不读环境变量。进程内测试可以注入 transport；shell 不能。

命令只打开 `--ready` 指向的那一个文件。它不扫描目录，也不接受裸的 briefing JSON。补漏将来也只能把同一个命令指到一个已经写好的 ready 文件。

当前默认行为：ready 绑定校验通过后退出 **50**（`adapter_disabled`），不发 HTTP，不写 success/pending。

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

## 6. 退出码与回执

stdout 与 stderr 各一行机器 JSON，字段只可能是 `result`、`exit`、`schema`、`period`、`updated_at`、`content_hash`、`attempts`。没有正文，没有路径，没有凭据。

| exit | result | 含义 |
|---|---|---|
| 0 | `published` 或 `noop` | 已确认写入，或远程已是同一版本 |
| 10 | `bad_args`、`bad_json`、`bad_timestamp`、`invalid`、`forbidden`、`sample_refused` | 输入或结构拒绝 |
| 11 | `ready_mismatch` | ready 与快照绑定失败 |
| 20 | `conflict` | 同一版本、不同正文 |
| 21 | `stale` | 更旧且正文不同 |
| 30 | `lock_timeout` | 没拿到 receipt 目录锁 |
| 40 | `transport_exhausted`、`ref_missing`、`remote_unreadable`、`tree_truncated` | 传输或远程读取失败 |
| 50 | `adapter_disabled` | 生产 adapter 关闭 |

`success.json` 只在确认发布，或确认远程已有同一哈希且同一时刻时写入。退出 20、21、40 只写 `pending.json`。退出 30 和 50 不写回执。这三类都不改已有的 success。同一时刻同一哈希的重复成功也不重写 success 字节。更新的时间戳一旦确认发布，会换成新的 success。pending 失败可以再用同一 ready 重试。

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

响应丢失时，下一次从第 1 步重读。远程若已是同一版本，退出 0，不再建第二个 commit。

`lib/` 与 `scripts/` 没有 checkout、clone 或 git init。box 上禁止任何 checkout/clone，包括改名的 bare remote。`test/publish/bare-git-sim.mjs` 只被 CA 里的离线测试导入，用临时 bare 仓库和 `update-ref <new> <old>` 模拟非快进；它不是生产载体，不能放到 box 上跑。

CLI 构造 adapter 时不传入 fetch，因此生产 HTTP 不会发出。本变更不读取、不配置 token。

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
