# 生产 E2E 清单

状态：token 未到位，本清单 **未执行**。不要把离线测试或本文件当成公网发布已经完成。

目标文件：box 上的 `/workspace/briefings/daily/2026-11-09.json`。若当日已有更新的日报，改用该日最新的 `daily/YYYY-MM-DD.json`。只上传公开 envelope，不上传本地 ready 或 raw。

## 步骤

1. 在 box 上对目标 JSON 跑 `stageReady`，再跑 `toPublicEnvelope`。记下 `content_hash`、`payload_sha256`、`period`。确认 envelope 不含 `objects/raw`、`raw_sha256` 或本地路径。
2. 在环境中放入 `BRIEFINGS_PUBLISH_TOKEN`，不要打印它，不要写入仓库或 Actions secret。运行：

   ```bash
   node scripts/briefings-upload.mjs --ready <ready.json> --receipt-dir <dir>
   ```

   退出 0 且 `result` 为 `uploaded` 才算上传确认。退出 50 且 `attempts` 为 0 表示这次进程在 HTTP 之前没有可用的 `BRIEFINGS_PUBLISH_TOKEN`（机器行带 `config_phase=pre_http`）。GitHub 401/403 是退出 40、`transport_forbidden`。响应丢失后必须靠 GET 同一路径确认同一 `content_hash` 与 `updated_at`。读不回则是 `unknown`，保留本地 ready，不当成成功。本清单不提供另一种凭据来源。
3. 把这次 Contents API 产生的 `main` commit 记为 `trigger_sha`（SHA_A）。它只应改动 `_inbox/daily/<period>.json` 或 `_inbox/weekly/<period>.json`。
4. 打开该 push 触发的 Deploy GitHub Pages run。处理 job 的 step summary 里，`trigger_sha` 与 `content_sha`（SHA_B）必须分开。SHA_B 是处理 job 快进提交 `content/<type>/<period>.json` 之后的 `main`。
5. deploy job 只有在再次读到的 `origin/main` 仍等于 SHA_B 时才部署。失败则不 ack。
6. 部署成功后，公网 `https://yurkingw.github.io/briefings/publish-manifest.json` 必须同时有 `trigger_sha`、`content_sha`。每个 item 的 `deployed_payload_sha256` 必须等于 SHA_B 上 `content/<type>/<period>.json` 的文件 SHA-256。`submitted_payload_sha256` 只表示这次 inbox envelope，不能把它当成已部署正文。没有合并的 `version` 字段。
7. 对照 SHA_B 上的 `content/<type>/<period>.json` 与第 1 步的 `content_hash`。再打开 `https://yurkingw.github.io/briefings/daily/<period>/`（周报则是 `/weekly/<period>/`），核对页面中的结论与更新时间。deployment 记录上的 SHA 可以仍是 SHA_A，这不单独判失败。
8. ack 之后，只有 blob sha 与 envelope 的 `submitted_content_hash` 仍等于本次消费值时，白名单文件才应消失。若期间被新稿替换，新文件必须还在。

## 仍未验证

- 上面 1–8 还没有用真实 token 跑过。
- `ci-failed` 监听 `yurkingw/briefings`、`ciBranch: main` 是否覆盖本 Pages workflow 的失败，包括 schedule，尚未实测。不能当成通知闭环。
- 部署前 ref 核验与 `deploy-pages` 返回之间的窗口不为零。`cancel-in-progress: false` 不是 FIFO，不能证明旧 run 绝不会在窗口里盖住新稿。
