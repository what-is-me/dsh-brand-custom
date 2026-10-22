# dsh-brand-custom

把 DeepSeek Harness 画自家品牌的四处位置——侧栏图标与文字标、新建会话页的图标与
标题——换成你自己的，入口在 **设置 → 品牌自定义**（英文界面是 Settings → Brand）。

所有字段都可留空。留空的那一项继续用官方图标或文案，所以装上却不配置时，行为和
原版完全一致。

| 位置 | 默认 | 可以换成 |
| --- | --- | --- |
| 侧栏图标 | DeepSeek 那条鱼 | PNG / JPEG / WebP / SVG，最大 4 MB |
| 侧栏文字标 | `deepseek` + `HARNESS` 角标 | 两段独立文案 |
| 新建会话图标 | 首页那条动画鱼 | PNG / JPEG / WebP / SVG，最大 4 MB |
| 新建会话标题 | `探索未至之境`（跟随语言） | 标题与预览角标两段文案 |

## 安装

```sh
dsh plugin --profile <name> add https://github.com/what-is-me/dsh-brand-custom
```

`<name>` 是你实际运行的 profile，例如 `desktop`。参数要写**仓库地址**，不是本地
路径：插件管理器会把托管仓库地址识别成 git 规格，在调用 pnpm 之前先用匿名方式做
一次 GitHub 连通性检查，最后在 profile 清单里记成
`github:what-is-me/dsh-brand-custom`。

包内声明了 `dsh.bundle.patch`，所以同一条命令在装包的同时也会把
`dsh-brand-custom` 追加到 profile 的 bundle 列表，不需要手工改
`cordis.patch.yml`。重启应用（或在客户端重新构建后刷新页面），设置里就会出现这个
分区。

要锁定某个提交或标签，在末尾加 `#`：`…dsh-brand-custom#v0.1.0`。

卸载：`dsh plugin --profile <name> remove dsh-brand-custom`，如果
`dsh.profile.bundles` 里还有这一项，一并删掉。

如果你是在本地改这个插件，用
`dsh plugin --profile <name> add link:/绝对路径/dsh-brand-custom` 装工作副本，
改完不用重新安装。

## 四个位置是怎么接管的

宿主用三个 single slot 加一行写死的文案来画品牌：

- `sidebar.brand.mark` —— 折叠轨道和展开头部共用的那条鱼，props 是 `{ size: 24 }`。
- `sidebar.brand.name` —— 文字标，owner props 是空对象。
- `conversation.hero.brand.mark` —— 首页的鱼，props 是 `{ size: 34, className }`。
- 首页标题**没有 slot**：宿主用自己的 locale 字典渲染进 `Hqq-bq_titleGroup` 里的
  一个 span。

所以这个插件做两件不同的事：

1. **占槽。** `@deepseek-ai/dsh-client-ui-brand-official` 以默认优先级（0）占着前
   三个槽。本插件用 **priority -1** 注册，槽服务的规则是「最低的绘制」，于是只要
   这条注册存在就会盖住官方实现。而这条注册只在读者确实提供了对应值时存在：清空
   字段就 dispose，官方品牌立刻回来——不需要任何重绘逻辑。
2. **改写标题。** 那个 span 直接改 DOM，第一次写入前先把宿主原文记下来，清空时原样
   写回。`MutationObserver` 保证切语言、首页重挂之后仍然是你的文案，而一旦没有任何
   自定义它就彻底断开。定位走的是 mark slot 自己的出口
   `[data-slot="conversation.hero.brand.mark"]`，所以这里没有写死任何带哈希的类名。

## 存储

数据全归宿主侧（node 半边）管，浏览器半边只读回来。

```
$DSH_HOME/plugins/dsh-brand-custom/
  config.json          # { version: 1, text: { 四个可空槽位 } }
  sidebar-mark.<ext>   # png/jpg/webp/svg 里恰好一个，或者不存在
  hero-mark.<ext>
```

图片先写临时文件再 rename，然后删掉同一种类别的其他扩展名，所以任何时刻读状态都只
会看到一个文件。上传会按声明的 content-type 校验（PNG 和 WebP 查文件头魔数，SVG
按文本处理），上限 4 MB。

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/brand-custom-api/config` | `{ ok, text, images }` |
| `PUT` | `/brand-custom-api/config` | 合并 `{ text }`，返回新状态 |
| `GET`/`HEAD` | `/brand-custom-api/image/<kind>` | 读回图片字节 |
| `PUT` | `/brand-custom-api/image/<kind>` | 替换（格式由 content-type 指定） |
| `DELETE` | `/brand-custom-api/image/<kind>` | 删除 |

`kind` 是 `sidebar-mark` 或 `hero-mark`。所有路由都只允许回环客户端：`Host` 必须是
回环地址、`Sec-Fetch-Site` 必须是同源、有 `Origin` 时必须与 Host 同源。图片响应带
`nosniff` 和 `default-src 'none'` 的 CSP，因为 SVG 本身是能带脚本的文档。

## 失效隔离

插件不能把应用一起拖死，所以两个半边都不许自己的异常逃出去。

严格的是网页启动流程：客户端条目全部落定之后，它会遍历每个条目，只要有一个不是
`active` 就抛 `web boot: N entries did not activate …`——`apply` 抛异常的插件会让
整个页面停在加载页（前端 bundle 里的 `bZ`）。宿主侧宽松得多：只有全局必需列表里的
条目才会拒绝启动，普通 bundle 失败只是
`warning: N entries did not activate`，兄弟插件照常运行。

因此浏览器半边把每一步「失败也能接受」的动作都包在 `safely()` 里，出错时打印
`dsh-brand-custom: <步骤> unavailable — <原因>` 而不是抛出：locale 注册与绑定、标题
观察器、初始状态读取、设置分区、以及三次占槽。宿主如果去掉了 `settings.section`，
或者 locale 命名空间已被别的插件占用，代价只是少一个功能。

宿主半边同样收口：路由体统一过 `guard()`，抛错时返回
`500 {"ok":false,"error":"internal error"}`，而不是变成未捕获的 rejection；路由注册
被拒绝只记一条日志，不会从 `apply` 抛出来；`readBody` 除了 `end`/`error` 之外也在
`close` 上落定，客户端中途断开不会让处理器一直挂着。

## 测试

```sh
node test/smoke.mjs        # node 半边：全部路由、栅栏、魔数校验、落盘
node test/client-smoke.mjs # 浏览器半边：对照 stub 检查注册形状
node test/takeover.mjs     # 占槽：只在有值期间占用
node test/hero-text.mjs    # 标题改写与清空还原
node test/hardening.mjs    # 失效隔离：服务坏掉只损失一个功能
```

浏览器半边的测试不需要 DOM 也不需要 `react-dom`：把插件组件当普通函数调用，
`useSyncExternalStore` 换成读取实时快照，标题改写则是手工搭一棵元素树。

## 已知限制

- 标题改写依赖首页框架的结构（mark 出口在 hitbox 内、title group 在旁边）。如果
  将来版本改了这个框架，改写会静默失效——三个 slot 仍然照常工作。
- 侧栏文字标是照宿主自己的两段式布局手工重建的，所以在有自定义文案期间，宿主改
  样式不会传导过来。
