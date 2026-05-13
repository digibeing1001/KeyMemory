# Hermes 一键集成指南（小白版）

> 只需 3 步，让 Hermes 拥有记忆！

---

## 📦 第一步：安装准备

1. 确认你已安装 [Node.js 20+](https://nodejs.org/)
2. 打开终端（CMD/PowerShell），进入 KeyMemory 目录

```bash
# 安装依赖
pnpm install

# 构建项目
pnpm build
```

---

## 🚀 第二步：一键启动

### Windows 用户：
**双击** `start-hermes.bat` 文件即可！

### Mac/Linux 用户：
```bash
node start-hermes.js
```

---

## ⚙️ 第三步：配置 Claude Desktop

### 1. 打开配置文件
按下 `Win+R`，输入：
```
%APPDATA%\Claude\claude_desktop_config.json
```

### 2. 添加以下配置：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": [
        "packages/server/dist/mcp-server.js"
      ],
    }
  }
}
```

> ⚠️ 记得把 `你的用户名` 换成你实际的用户名！

---

## ✨ 开始使用

重启 Claude Desktop，然后对 Hermes 说：

```
帮我记住：今天学习了 TypeScript 基础
```

过一会儿再问：
```
我今天学了什么？
```

---

## 📖 常用命令

| 对 Hermes 说 | 效果 |
|--------------|------|
| "帮我记住：xxx" | 保存记忆 |
| "搜索关于 xxx 的记忆" | 搜索记忆 |
| "列出所有记忆" | 查看所有记忆 |

---

## 🔧 管理界面

打开浏览器访问：`http://localhost:5173`

你可以在这里：
- 查看所有记忆
- 编辑记忆
- 删除不需要的记忆
- 管理不同 Agent 的空间

---

## 🎯 快速测试

第一次使用，试试这些指令：

1. **存一个记忆**
   > "记住，我喜欢喝奶茶"

2. **搜索一下**  
   > "我喜欢喝什么？"

3. **确认存在**
   > "列出所有记忆"

---

## 💡 常见问题

### Q: 怎么停止服务？
A: 在终端按 `Ctrl+C`

### Q: 记忆存在哪里？
A: 在你的电脑本地，放心！不会上传到任何服务器

### Q: 可以给多个 Agent 用吗？
A: 可以！每个 Agent 有独立空间，互不干扰

### Q: 配置后不生效？
A: 重启 Claude Desktop 试试

---

## 📞 需要帮助？

1. 查看 Web 界面：`http://localhost:5173`
2. 查看详细文档：`AGENT_INTEGRATION.md`

---

**恭喜！你已经成功让 Hermes 拥有了记忆！🎉**

