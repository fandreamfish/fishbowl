# @fishbowl/app

两个宿主（DSH 插件、QQ 桥）共用的应用服务，不含任何宿主 API：

- `config` / `cfgkeys` / `fishcfg`：配置归一化、校验、按鱼覆盖
- `appraiser`：评价器（关键词版 / DeepSeek 版）
- `llm`：模型调用端口（HTTP 实现在这里，替换成假实现即可测试）
- `injector`：注入消息形状与状态摘要渲染
- `identity` / `grant` / `rename`：身份识别、许可、住处改名

宿主适配器只做"把事件转成这里的函数调用"。
