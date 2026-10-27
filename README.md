# 同词相遇

两个人在线玩联想词语小游戏：各自想一个词，同时揭晓；没想到一起，就从两个词继续联想，直到撞上同一个词。

在线体验：[samewordgame.hikawa00.top](https://samewordgame.hikawa00.top)

## 怎么玩

1. 一位玩家创建房间，选择每轮思考时间：30 秒、60 秒，或自定义 10–3600 秒。
2. 把邀请链接或 6 位房间码发给另一位玩家。对方加入后游戏开始。
3. 两人各自输入一个词并锁定答案。对方看不到你的词；双方都提交后会立即揭晓，计时结束也会揭晓。
4. 如果词语不同，从这两个词继续联想并进入下一轮。双方都准备好后，下一轮开始。
5. 完全相同的词会自动成功；如果表达不同但你们认为意思相同，双方都点击「我认为意思相同」也算成功。
6. 成功后可以预览并保存本局记录照片。

刷新或短暂断网后，可以用原来的邀请链接回到房间。恢复依赖原设备、原浏览器保存的房间凭证；清除浏览器数据或换设备后，凭证不会自动转移。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

本地开发服务器由 Vinext 启动。多人房间状态保存在 Cloudflare D1 中；本地运行需要有名为 `DB` 的 D1 绑定。账户专属的 Cloudflare 部署配置保存在项目所有者的本地文件中，不上传到这个仓库。

## 代码结构

游戏本身的核心代码主要集中在 `app/`、`db/` 和 `drizzle/`；仓库里其他目录还包含框架工具、通用组件和示例。

```text
app/
  page.tsx                 首页入口，渲染游戏界面
  game.tsx                 前端页面、房间交互、恢复连接和记录照片导出
  layout.tsx               全局 HTML 布局、页面标题和图标
  globals.css              全局样式和响应式视觉样式
  api/game/route.ts        创建/加入房间、提交答案、回合推进和状态查询 API
db/
  schema.ts                D1 数据表结构（房间与每轮答案）
  index.ts                 Drizzle ORM 与 D1 绑定
drizzle/                   数据库迁移 SQL
worker/index.ts            Worker 运行时入口
public/                    静态资源，例如网站图标
components/ui/             通用 UI 组件库；当前游戏主界面主要使用 app/globals.css 中的自定义样式
hooks/                     通用 React hooks
lib/                       UI、连接器等辅助函数
scripts/                   安装、构建和运行框架的项目脚本
examples/d1/               D1 使用示例，不属于游戏主流程
vendor/                    第三方样式资源；globals.css 会导入其中的样式
```

房间与回合业务主要在 `app/api/game/route.ts`，界面和玩家操作主要在 `app/game.tsx`。页面约每 1.2 秒向 API 拉取一次房间状态，用于同步另一位玩家的操作。

如果只想改游戏玩法或首页界面，通常先看 `app/game.tsx` 和 `app/api/game/route.ts`；要调整数据库字段时，再看 `db/schema.ts` 与 `drizzle/`。

## 技术栈

- React、TypeScript、Vinext
- Cloudflare Workers、D1
- Drizzle ORM
- Tailwind CSS
