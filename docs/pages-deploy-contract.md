# Pages 部署契约核查

这次只核公开契约一次。没有证明客户端把创建请求、制品包或 OIDC 调用写错，所以生产部署行为不改。新增的只有一行白名单诊断。`deployment_failed` 不是平台事故结论。源码路径和 7.474 秒间隔不是亲见的响应。

成功控制是 run `45604679565`（#80，SHA `e12b11e21fdea75f9a73bdc042ab81977c8e4bb6`，制品 `15015789905`）。失败变量是 run `45612559797`（#81，SHA `57e3472ccaf7f08b246a5fc9eb650582fba0c60c`，制品 `15020581433`）。原始状态正文在 `docs/evidence/pages-status-2026-11-25.json`。

## 官方引用

- [Create a GitHub Pages deployment](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-deployment)：`POST /repos/{owner}/{repo}/pages/deployments`。正文有 `artifact_id` 或 `artifact_url`、`pages_build_version`、`oidc_token`，可选 `environment`（默认 `github-pages`）。200 响应有 `id`、`status_url`、`page_url`，可选 `preview_url`。HTTP 还有 400、404、422。
- [Get the status of a GitHub Pages deployment](https://docs.github.com/en/rest/pages/pages#get-the-status-of-a-github-pages-deployment)：`GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}`。id 可以是部署 id 或该部署的 commit SHA。200 响应只有 `status` 枚举，没有 `error` 或 `message`。文档写的是当前状态。
- `actions/deploy-pages@d6db901` 的 `src/internal/api-client.js`：创建正文就是 `artifact_id`、`pages_build_version`、`oidc_token`；预览才加 `preview`。`src/index.js` 调用 `core.getIDToken()`，不传 audience。`src/internal/deployment.js` 把 `deployment_attempt_error` 当暂时状态，把 `deployment_failed`、`deployment_perms_error`、`deployment_content_failed`、`deployment_cancelled`、`deployment_lost` 当永久状态。
- `actions/upload-pages-artifact` 的 Linux 归档是 `tar --dereference --hard-dereference --directory "$INPUT_PATH" -cvf "$RUNNER_TEMP/artifact.tar" --exclude=.git --exclude=.github --exclude=".[^/]*" .`。本仓 `pages.yml` 使用同一组参数。
- `actions/upload-artifact@ea165f8`（v4.6.2）写明 `overwrite: true` 会删除同名制品再新建一份，新制品有新的 id。

## 矩阵

| 项 | 公开契约 | 本仓 | #80 | #81 | 结论 |
|---|---|---|---|---|---|
| 创建正文 | 三个必填字段；`environment` 可省略 | `deploymentBody` 只送这三项 | 同此形状且成功 | `lib/pages-deploy.js` 相对 #80 无差异 | 排除请求形状错误 |
| OIDC | `getIDToken()` 无 audience | 同样调用 | 成功 | 同一调用 | 排除这次新引入的 OIDC 参数错误 |
| 制品包 | 官方 tar 参数；上传名 `github-pages` | 同一 tar 参数，`upload-artifact@ea165f8` | 681789 字节，id `15015789905` | 681534 字节，id `15020581433` | 排除打包命令差异。体积差来自 manifest 的 SHA 与空 items，正文哈希相同 |
| 制品 id | 用上传返回的 id | 绑定 `steps.pages-artifact.outputs.artifact-id` | 上传日志 id `15015789905` | 上传日志、`ARTIFACT_ID`、`pages_artifact_id` 都是 `15020581433` | 排除旧 id。两份制品在读取时都未过期 |
| 永久状态集 | 与 `deploy-pages@d6db901` 的 final/temporary 相同 | `deployment_attempt_error` 继续轮询 | 状态后来仍是 `succeed` | 会话内一次 stdout 是 `deployment_failed` | 不是未识别状态。不改状态分类 |
| 并发 | `concurrency.group: pages`，`cancel-in-progress: false` | 未改 | 11:28:48Z 结束 | 12:18:55Z 开始 | 两次 run 没有重叠 |
| 环境记录 | Actions environment `github-pages`，不是 Pages 状态对象 | `environment.name: github-pages` | 状态 `success`，描述为空 | 状态 `failure`，描述为空，时间 12:19:39Z | 描述为空，不能当作 Pages 原因 |
| 收件箱 | push 且空队列是 `rebuild`，`ack: []` | `planInbox` 如此；输出 `ack` 在列表为空时为 `false` | 有一条 unchanged item，随后 ack | process stdout `items: []` | ack 本来就是 false。ack job 另因 deploy 失败而跳过 |
| 当前状态可读性 | 需要 Pages 读权限；未认证 404 不代表不存在 | 有权限的 `gh api` | 两次都是 200，`{"status":"succeed"}`，20 字节 | 会话 stdout 200，`{"status":"deployment_failed"}`，30 字节；12:32:47Z 再读 200，`{"status":""}`，13 字节 | 当前状态不是持久原因档案 |

全零 SHA 在同一次再读也是 13 字节 `{"status":""}`。这只说明该探针的正文与 #81 再读相同，不能据此推广到其它 SHA。

## 排除

#81 日志没有创建或轮询的响应 JSON。固定码 `deployment_failed` 只出现在 `core.setFailed` 和检查注解里。7.474 秒是 `pages_artifact_id=`（12:19:28.0829406Z）到 `##[error]deployment_failed`（12:19:35.5564973Z）的间隔，只能说明它与默认 5 秒睡眠相容，不能当成亲见的第一次轮询。

未认证 `GET` 这些 Pages 路径返回 404。有权限的按 SHA 读取返回 200。404 不是“没有部署”。

没有 `error` / `message` 字段的公开状态对象，给不出服务端原因。到这里停止，不再追不可见的服务端。

## 诊断保证

`pages_deploy` 一行只可能包含：

- `phase=create` 或 `phase=poll`
- `http=` 加 100 到 599 的整数
- `id=` 加 1–20 位十进制，或等于本次 `pages_build_version` 的 40 位 SHA
- `pages_status=` 加上面枚举中的整串
- `code=` 加既有固定码整串

原始响应、响应头、异常消息和 token 不会拼进这一行。诊断回调自己抛错时，部署结果仍是原来的固定码。`pagesActionsRequest` 在 HTTP 错误时只回传状态整数；其它异常换成 `transport_failed`，不保留原消息。workflow 仍只把 `error.code` 交给 `core.setFailed`，没有 `error.code` 时用 `deploy_failed`。

测试在 `test/publish/pages-diagnostic.test.mjs`。哨兵放在 token、响应正文、状态串、id、异常消息和回调抛错里，断言它不出现在诊断行、固定 `error.message` 或控制台输出里。

## 未证

- #81 的 `deployment_failed` 出现在创建响应还是某一次轮询。
- Pages 为什么给出这个状态。公开契约没有原因字段，再读同一个 SHA 已经变成空 status。
- 空 status 与全零 SHA 的正文相同，不能解释失败，也不能证明记录被删除。
- 一行诊断或下一次自然 run 成功，都不等于防复发完成。若下一次自然 run 仍以同一个没有响应细节的方式失败，停止加字段，把缺口留在这里。
