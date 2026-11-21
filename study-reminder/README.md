# 加油学

面向手机的中文学习提醒 PWA：记录资料与计划，按学习时段提醒鼓励，并基于本地资料答疑。

## 本地运行

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:3000

## 可选密钥

- `OPENAI_API_KEY`：启用 `/api/ask` 模型增强答疑（未配置时仅本地检索）
- `OPENAI_MODEL`：可选，默认 `gpt-4o-mini`

## 添加到主屏幕

- **iOS**：Safari 打开 → 分享 →「添加到主屏幕」
- **Android**：Chrome 菜单 →「安装应用」或「添加到主屏幕」

资料与进度保存在浏览器 localStorage / IndexedDB，可离线查看与勾选任务；通知需授权且应用在可触发通知的环境中。
