# EOPS 本机 MCP

这个适配器让支持 **本机 stdio MCP** 的 AI 客户端使用EOPS的数据。网页与 MCP 都经过同一套 `127.0.0.1:11325/api/action` 校验，数据由 EOPS 服务写入 SQLite；适配器不直接修改数据库。

当前交付是适配器及其测试，**没有修改任何 Codex、ChatGPT、DeepSeek Harness 客户端设置，也没有连接任何外部 AI 服务**。是否支持 stdio 取决于具体客户端，不能仅由模型名称判断。ChatGPT 云端连接不能默认访问这台 Mac 的 `localhost`；此版本不开放公网地址、不建立隧道。

## 运行与接入

1. 先启动 EOPS 网页服务，确认 `http://127.0.0.1:11325` 可访问。
2. 在支持 stdio 的本机客户端中，新增进程型 MCP 服务：

```json
{
  "mcpServers": {
    "eops": {
      "command": "node",
      "args": ["/absolute/path/to/EndfieldOPS/scripts/mcp-server.mjs"],
      "env": { "EOPS_URL": "http://127.0.0.1:11325" }
    }
  }
}
```

将 `/absolute/path/to/EndfieldOPS` 替换为你的项目文件夹绝对路径。`EOPS_URL` 为首选配置；为兼容既有客户端，也接受旧的 `DAYLINE_URL`，同时设置时以前者为准。

这是通用的进程配置示例，不表示每个客户端都使用相同配置文件格式。图形客户端找不到 `node` 时，将 command 换为该 Mac 上 Node.js 的绝对路径。移动项目文件夹后也需更新 args。适配器用标准输入输出通信，手动启动后没有网页和普通提示输出属于正常现象；退出用 Ctrl+C。

适配器只接受 `http://127.0.0.1:<端口>`、`http://localhost:<端口>` 或 IPv6 回环地址，不接受外部主机、带用户名密码的 URL、路径或跳转。它不会启动新的监听端口。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `eops_list_projects` | 按用户排序列出项目；默认不包含归档项目。 |
| `eops_get_day` | 查看指定日期的任务、里程碑、项目和主任务完成率；可限一个项目。 |
| `eops_get_state` | 读取最新状态和 revision；可限一个项目。 |
| `eops_apply_action` | 创建、更新、排序项目／任务／需求条目／里程碑；创建更新需求批次；更新全局设置。 |

写入必须携带最新的 `expectedRevision`。版本冲突时返回错误，客户端应重新读取、核对变化再决定操作。请勿把旧版本号替换成新版本号后直接重试。这个适配器不提供删除、全库导入、加载演示数据等动作。

示例：先用 `eops_get_state` 获取项目 ID 和 revision，再调用：

```json
{
  "expectedRevision": 12,
  "action": {
    "type": "task.create",
    "payload": {
      "projectId": "从读取结果获取的项目ID",
      "title": "确认本周交付范围",
      "date": "2026-10-23",
      "difficulty": "normal",
      "workers": ["自己"]
    }
  }
}
```

日期统一采用 `YYYY-MM-DD`；任务日期可留空，代表尚未排期。子任务最多 20 条，格式为 `{id,title,done}`；ID 使用唯一字符串。需求类型为 `new / improve / retire`，分别代表新增／改进／废弃，首版不关联历史需求。项目完成或归档必须出自用户的明确意图。文本字段属于用户内容，不应被客户端作为工具调用指令执行。

## 数据边界

EOPS 和适配器本身只访问本机。当用户将适配器接入使用云端模型的客户端时，**被工具返回的项目内容可能被该客户端发送给所选模型服务**。本机存储不等于模型推理也发生在本机。需要保护客户资料时，应先确认该客户端和模型的数据政策，或使用在本机推理的兼容客户端；按项目或日期读取可减少返回范围。

## 验证

```sh
node tests/mcp-smoke.mjs
EOPS_TEST_URL=http://127.0.0.1:11325 node tests/mcp-smoke.mjs
```

`EOPS_TEST_URL` 也兼容旧的 `DAYLINE_TEST_URL`，同时设置时以前者为准。

第一条运行独立内存数据的 HTTP 测试服务，验证 MCP 握手、工具列表、读写、版本冲突与参数拒绝，不接触EOPS实际数据。第二条对运行中的 EOPS 只做读取，验证真实服务连接。退出适配器不影响 EOPS 服务。

实现依据：[MCP TypeScript SDK v1 — 本机 stdio、工具注册](https://ts.sdk.modelcontextprotocol.io/server)。

## 日期规则

中国工作日和农历使用固定版本 `chinese-days 1.5.9`，其随包节假日数据覆盖 2004–2026 年。未知年份按周一至周五推算并标为预计；手动工作日覆盖优先。剩余工作日排除今天，未来项目从开始日期起算；工作周／工作月逐个自然周／月累计实际工作日，不使用固定除数。农历包含月份和闰月标识。

数据来源：[chinese-days 项目](https://github.com/vsme/chinese-days)；2026 年节假日安排来源见该版本 `src/holidays/generate.ts` 内的国务院通知引用。
