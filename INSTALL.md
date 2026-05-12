# 🚀 KeyMemory 安装指南

## 方式一：本地安装（推荐）

### 1. 克隆项目
```bash
git clone https://github.com/your-username/keymemory.git
cd keymemory
```

### 2. 安装依赖
```bash
pnpm install
```

### 3. 构建项目
```bash
pnpm build
```

### 4. 一键配置 Claude Desktop
```bash
pnpm setup
```

### 5. 完成！
重启 Claude Desktop，开始使用！

---

## 使用示例

### 保存记忆
对 Hermes 说：
```
帮我记住：我喜欢喝珍珠奶茶，三分糖，去冰
```

### 搜索记忆
```
我喜欢喝什么？
```

### 查看所有记忆
```
列出所有记忆
```

---

## 管理界面（可选）

如果你想通过 Web 界面管理记忆：
```bash
pnpm dev:web
```
然后访问 http://localhost:5173

---

## 重要提示

✅ **不需要手动启动服务** - Claude Desktop 会自动启动 KeyMemory  
✅ **不需要配置 API Key** - 完全本地运行  
✅ **不会上传任何数据** - 所有记忆存储在你电脑本地  
✅ **完全免费开源** - 无任何费用  

---

## 技术说明

KeyMemory 是一个 MCP (Model Context Protocol) 服务器，与 Claude Desktop 无缝集成。

- **数据存储**: SQLite（本地）
- **搜索**: 全文 + 语义混合搜索
- **嵌入**: ONNX（本地运行，不需要网络）

---

## 需要帮助？

访问 https://github.com/your-username/keymemory 查看更多文档。

