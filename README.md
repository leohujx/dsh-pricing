# dsh-pricing

DeepSeek 定价插件（DSH Desktop）：会话头部标题行、**Session log 按钮左侧**显示当前模型的定价徽章；点击弹出完整定价表（缓存命中/未命中输入/输出 × 峰谷时段，当前时段高亮）。数据来自官方定价页（Host 抓取，1 小时 TTL 缓存），切换模型实时刷新，可手动刷新。

## 目录结构

```
dsh-pricing/
├── package.json      # 插件清单（dsh.client 声明、exports["./client"]）
└── lib/
    ├── index.js      # Host 端：抓取定价页 → 解析 HTML → 1h 缓存 → /pricing.json 路由
    └── client.js     # 客户端：徽章 + 定价表弹窗（__ModuleLoader__ bundle，免构建）
```

插件免构建、零运行时依赖（Host 用 Node 内置 fetch；客户端 react 由 DSH 运行时提供）。

## 安装（任选一种）

> 前提：目标电脑已启动过一次 DSH Desktop（生成 `~/.dsh` 目录）。

### 方式 A：软链接（推荐，更新最方便）

```bash
# 1. 克隆到稳定位置
mkdir -p ~/dsh-plugins
git clone <仓库地址> ~/dsh-plugins/dsh-pricing

# 2. 软链接到 profile 的 node_modules（等价于 pnpm 的链接）
mkdir -p ~/.dsh/profiles/desktop/node_modules
ln -s ~/dsh-plugins/dsh-pricing ~/.dsh/profiles/desktop/node_modules/dsh-pricing

# 3. 在 cordis.patch.yml 末尾注册条目
cat >> ~/.dsh/profiles/desktop/cordis.patch.yml <<'EOF'
- insert:
    - id: dsh-pricing
      name: dsh-pricing
EOF

# 4. 重启 DSH Desktop（Cmd+Q 再打开）
```

更新：`cd ~/dsh-plugins/dsh-pricing && git pull` → 客户端改动刷新页面（`Cmd+R`）即可，Host 改动需重启。

### 方式 B：拷贝到 profile plugins（与首次安装一致）

```bash
mkdir -p ~/.dsh/profiles/desktop/plugins
cp -R dsh-pricing ~/.dsh/profiles/desktop/plugins/

# 在 ~/.dsh/profiles/desktop/package.json 的 dependencies 加：
#   "dsh-pricing": "file:./plugins/dsh-pricing"
cd ~/.dsh/profiles/desktop && pnpm install

# cordis.patch.yml 末尾追加（同方式 A 第 3 步）
# 重启 DSH Desktop
```

## 验证

```bash
# Host 路由（端口以实际为准；lsof -nP -iTCP -sTCP:LISTEN | grep DSH 查看）
curl http://127.0.0.1:<端口>/pricing.json

# 冒烟测试（仓库根目录，需已装 DSH Desktop）
node test.mjs   # 若仓库没有 test.mjs，可从发布包获取
```

## 开发

- 改 `lib/client.js` → 刷新页面生效（`cache-control: no-cache`）
- 改 `lib/index.js` → 重启 DSH Desktop 生效
- DSH 客户端 API 参考：`/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/`（slots 引擎、`conversation.*` 槽位声明、`sessions` 服务等，任何装有 DSH Desktop 的机器路径相同）
- 版本兼容：槽位/服务名随 DSH 版本可能变化，装到新版本先跑验证再看徽章是否出现

## 数据源与规则

- 官方定价页：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
- 高峰时段：北京时间 9:00-12:00、14:00-18:00（从页面自动解析，其余为空闲，空闲价为高峰一半）
- 计费单位：元/百万 tokens
