# Plus Meter

轻量本地额度看板。只使用 Node.js 自带模块，零 npm 依赖，无构建步骤。

## 启动

Windows 双击 `start.cmd`，或在本目录执行 `node server.mjs`，打开 http://127.0.0.1:18765 。需要 Node.js 20 或更高版本。

重复启动会打开已运行的 Plus Meter；如果默认端口被其他程序占用，会自动选用空闲端口，地址显示在启动窗口。

选择或拖入你自己的 `auth.json`，即可查询。默认每 60 秒刷新，可调整为 30 秒、2 分钟、5 分钟或手动。查询失败保留旧数据，并明确标记；网络故障指数退避，401/403 暂停自动查询。

Windows 普通网页和桌面小组件共用加密保存的账户与代理。勾选“加密保存账户，下次自动加载”导入后，关闭、重启服务或刷新页面均会自动加载，不必再次选择文件或输入代理。已保存的代理会直接用于查询。

如需要代理，导入前填写本机 HTTP 代理，例如 `http://127.0.0.1:7897`。支持 CONNECT，不支持 SOCKS。代理修改后重新导入。工具不自动使用系统代理。

自定义端口：PowerShell 执行 `$env:PLUS_METER_PORT='18766'`，再执行 `node server.mjs`。

## 支持的凭据与额度

支持 Codex 的 `tokens.access_token`、`tokens.account_id` 格式，也支持顶层 `access_token` / `account_id`。若 account_id 缺失，尝试从 JWT 声明获取，最终由 OpenAI 校验身份。仅有 `OPENAI_API_KEY` 的文件无法查询订阅额度。

显示 ChatGPT Plus 等订阅中的 **Codex 额度**：短周期、长周期、接口提供的额外额度与 Credits，以及重置时间。周期长度来自接口，不硬编码为 5 小时或每周。未返回的字段显示“未提供”，不推算剩余消息次数。

**不是 ChatGPT 聊天模型消息次数监控器。** 当前实现不支持聊天模型、图像生成、Deep Research 的剩余次数。这里的“实时”是定时轮询，不是服务器推送；上游数据可能存在延迟。

使用固定的 `GET https://chatgpt.com/backend-api/wham/usage`，这是 Codex 使用的内部接口，可能变更或拒绝第三方查询，不能保证长期可用。

## Windows 桌面小组件

解压到一个固定目录，双击 `install-widget.cmd` 创建桌面快捷方式“Plus Meter 额度小组件”，再双击桌面图标打开。也可运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-widget.ps1`。需要 Windows、Node.js 20 或更高版本及 Microsoft Edge，无需执行 npm install。收到源码包的使用者需要导入自己的 auth.json 并填写自己的代理地址，勾选加密保存后下次自动加载。

小组件使用已安装的 Microsoft Edge 应用窗口，不安装 Electron；默认 370 × 650 像素，放置在桌面右上角并置顶，可拖动和调整大小。重复打开会激活现有窗口。关闭组件会结束它自己启动的后台服务。

拖动或调整其他应用窗口大小时，小组件会暂时隐藏，结束后恢复；恢复不抢焦点、不改变其他窗口位置，避免右侧置顶窗口干扰拖动与贴边操作。

小组件使用独立的本地端口 18766，冲突时自动换用空闲端口。“账户设置”可展开导入选项；勾选“加密保存账户，下次自动加载”后，账户 JSON 和代理地址保存在 `%USERPROFILE%\.plus-meter\auth.dpapi`，使用 Windows 当前用户 DPAPI 加密。配置使用固定用户目录，避开 Windows 打包应用对 AppData 的重定向，保证 Codex 内启动和普通桌面快捷方式读取同一份配置。不会保存明文 auth.json。只有同一 Windows 用户可正常解密加载。点“清除账户”会同时删除保存的加密凭据。

小组件重新打开会自动加载已保存的账户与代理，默认每 60 秒刷新。没有设置开机自启动。令牌过期仍需重新导入有效 auth.json；本工具不刷新 OAuth 令牌。请保留程序目录，桌面快捷方式指向此目录。

## 凭据处理

浏览器读取所选文件并传给本机服务。不勾选保存时凭据仅在内存中。Windows 模式显式勾选保存后，将完整 JSON 和代理加密存储用于下次加载；网络查询只使用 access_token。不会将凭据写入 localStorage 或日志。不要把 auth.json 放到项目内或分享给他人。

服务仅监听 127.0.0.1；限制 Host 和 Origin，API 使用随机页面会话校验。静态资源无外部依赖。access_token 仅发送到上述固定 OpenAI 地址，HTTPS 验证证书，不跟随跳转。使用本机代理时，HTTPS 经过该代理。

本工具不执行 OAuth 刷新、不改写原始 auth.json。导入的是文件快照，Codex 后续更新原文件不会自动同步。令牌过期请重新登录 Codex 并重新导入最新文件；如果 Codex 将凭据存入系统钥匙串，则需要提供文件形式的凭据。

## 验证

`node --test` 运行凭据解析、接口数据转换、本地 API 和账户切换测试，使用虚拟凭据和模拟上游，不消耗账户额度。

官方认证说明：https://learn.chatgpt.com/docs/auth

实现参考：https://github.com/openai/codex/tree/main/codex-rs/backend-client
