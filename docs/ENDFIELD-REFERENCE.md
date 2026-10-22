# 终末地官网视觉参考与素材出处

> 本文件是原型阶段的历史视觉调研记录。公开发行版保留配色与布局参考，Logo 使用原创 EOPS 素材；原始官网 Logo 及 WOFF2 字体不随仓库或 Release 分发。导航图标继续采用有出处的官网图形。祀角色进度装饰与当前字体来源另见素材清单。当前素材清单以 [ASSETS.md](ASSETS.md) 为准。

核查日期：2026-10-22。入口：[《明日方舟：终末地》中文官方网站](https://endfield.hypergryph.com/)。本记录来自当日公开 HTML、其直接引用的 CSS，以及语言布局脚本。下列数值是**网站当前实现值**，并不代表获得了官方品牌规范；深色项目管理界面如何组合这些颜色，仍属于 EOPS 的界面设计。

## 颜色：以页面中的具体用途为依据

主要证据：[官网 Header 与通用组件 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/46158da72caa0121.css)。为方便定位，表内保留原始类名的稳定语义部分；完整类名包含构建哈希。

| 页面用途 | 实际数值 | 规则定位 |
| --- | --- | --- |
| 强调黄／侧栏主要按钮悬停背景 | `#FFFA00` | `Header_buttonPreserveBg … Header_bg` 的 background-color |
| 黑色 Logo、侧栏主文字 | `#191919` | `Header_pcHeaderContainer` 的 color；`Header_logo` 的 color |
| 侧栏背景 | `#FFFFFF` | `Header_pcHeaderContainer` 的 background-color |
| 当前选中侧栏底 | `#E6E6E6` | `Header_overlay` 的 background-color |
| 侧栏悬停底 | `#E5E5E5` | `Header_navItem:before` 的 background-color |
| 普通导航图标 | `#D9D9D9` | `Header_navItem … Header_icon` 的 color |
| 悬停导航图标 | `#858585` | `Header_navItem:hover … Header_icon` 的 color |
| 侧栏下部按钮组背景 | `#F2F2F2` | `Header_buttonFrameBg` 的 background-color |
| 下部按钮图标 | `#7C7C7C` | `Header_buttonFrameContainer … Header_icon` 的 color |
| 下部按钮图标悬停 | `#424242` | 同一图标的 hover color |

其他页面的配色证据：

- [干员页 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/7f4007f6fbea68d1.css) 的 `Operator_decoLine` 使用三段渐变：`#FF00F0`、`#FFFA00`、`#00FFA2`。因此官网确实存在高饱和品红和偏绿的青色装饰，并非柔和粉色／灰青色。
- [世界观等区块 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/c1b6a925ef3d04ee.css) 的 `Lore_colorLine` 使用 `#FF1AAC`、`#00FFA2`、`#FFFA00`；`Lore_navigator` 背景为 `#131315`、边框为 `#35373C`。这些来自特定深色区块，不能称为官网统一深色主题规范。
- [影像资料 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/89618c72836110eb.css) 的播放按钮与装饰线还使用 `#FDFD1F`；世界观分页用到 `#FFF000`。官网并非所有黄色都完全相同。EOPS 主强调色选 `#FFFA00` 最贴近侧栏与通用按钮。
- [公告列表 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/cf29e99f050a5f93.css) 的空状态面板为 `#FAFAFA`，文字为 `#888888`。

官网侧栏由白、灰、近黑主导，黄色是小面积的强提示。不能把整片背景都改成黄色后声称复现了官网。

## 原型阶段提取的官方 Logo 与侧栏图标（历史记录）

这些 SVG 直接来自官网公开 HTML 中的 `Header_logo` / `Header_icon`，不是重新描摹或 AI 生成。原型时曾保存在 `public/assets/`，没有外部资源引用、脚本或事件处理属性。公开版本已用 EOPS 原创字标替换并移除原始 Logo；导航图标保留，具体发行清单见 [ASSETS.md](ASSETS.md)。下表中的 Logo 文件名为历史记录，不表示当前仓库仍包含这些文件。

| 文件 | 原始 viewBox | 处理方式 |
| --- | --- | --- |
| `endfield-logo-original.svg` | `0 0 214 233` | 官网内联 SVG 原样，仅补末尾换行；路径为 currentColor |
| `endfield-logo-black.svg` | `0 0 214 233` | 同一原始路径，根节点加 `color:#191919`，使独立 img 保持官网黑色 |
| `endfield-logo-white.svg` | `0 0 214 233` | 同一原始路径，根节点加 `color:#FFFFFF`；这是本项目的白色显示变体，并非另寻到的官方白色文件 |
| `endfield-nav-home.svg` | `0 0 40 40` | 官网「首页」原始图标 |
| `endfield-nav-operator.svg` | `0 0 44 49` | 官网「干员情报」原始图标 |
| `endfield-nav-lore.svg` | `0 0 42 42` | 官网「世界观资料」原始图标 |
| `endfield-nav-information.svg` | `0 0 43 46` | 官网「影像资料」原始图标 |
| `endfield-nav-calendar.svg` | `0 0 42 40` | 官网「版本日历」原始图标 |
| `endfield-nav-aic-gameplay.svg` | `0 0 41 50` | 官网「玩法介绍与集成工业知识」原始图标 |
| `endfield-nav-notice.svg` | `0 0 44 49` | 官网「公告」原始图标 |

Logo 为矢量纵向组合标，214:233 是原始视框比例，不能拉宽当作横向 Logo。黑白版本仅改变根节点展示色，路径、视框均保留原样。官方图标原本使用 currentColor；以独立 img 引用时不会继承父页面颜色，需要按现有界面的引用方式处理。

来源页面：[官网首页](https://endfield.hypergryph.com/)。官网自身把 `Header_logo` 设为 `#191919`。素材署名：© HYPERGRYPH；EOPS 是用户本机的独立项目管理应用。

## 字体：中文和拉丁字母分别核查

中文不是只用系统字体。[官网语言布局脚本](https://web.hycdn.cn/endfield/official-v4/_next/static/chunks/app/%5Blang%5D/(main)/layout-5e0d6ffb320689c2.js) 中的 `lang:"zh-cn"` 指向字体映射 `I`，通过浏览器 `FontFace` 动态载入：

| 官网 CSS 别名 | 实际字体 | 官方 WOFF2 文件 |
| --- | --- | --- |
| `SansRegular` | HarmonyOS Sans SC Regular | [Regular](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Regular.56a376.woff2) |
| `SansMedium` | HarmonyOS Sans SC Medium | [Medium](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Medium.8b3fa8.woff2) |
| `SansBold` | HarmonyOS Sans SC Bold | [Bold](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Bold.804ac9.woff2) |
| `SansBlack` | HarmonyOS Sans SC Black | [Black](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Black.f538c8.woff2) |

侧栏中文文字使用 `SansMedium`；干员介绍正文用 `SansRegular`，干员中文名用 `SansBold`。需要区分 CSS 别名和真实字体文件名。

[全局字体 CSS](https://web.hycdn.cn/endfield/official-v4/_next/static/css/d27b439a0cf24257.css) 另声明了以下拉丁字体：`ProtestStrike-Regular`、`Roboto-Regular`、`Roboto-Black`、`Gilroy-Light`、`Gilroy-Medium`、`Gilroy-ExtraBold`、`Novecentosanswide-Bold`、`Novecentosanswide-DemiBold`、`Novecentosanswide-Medium`、`SpaceGrotesk`。

其中 `Novecentosanswide-DemiBold` 用于大写英文装饰标题，`Gilroy-Medium` 用于英文辅助信息，`SpaceGrotesk` 用于部分数字／2D 控件。不能把全站概括为单独一种字体。

原型阶段曾把上述官网中文字体的 Regular、Medium、Bold 三个 WOFF2 文件保存到本机页面素材目录，也未安装为 macOS 系统字体。公开版本不再分发这些 WOFF2 文件，而改为华为官方下载包内未修改的原始 TTF，并附完整字体许可。下表只记录旧文件的来源和指纹，不是当前发行清单。其余字重与拉丁字体未引入。

| 本地文件 | 官方原文件 | 文件大小 | SHA-256 |
| --- | --- | ---: | --- |
| `public/assets/fonts/harmonyos-sans-sc-regular.woff2` | [HarmonyOS_Sans_SC_Regular.56a376.woff2](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Regular.56a376.woff2) | 210,644 字节 | `0e7f0a8ad8a3d3fd2285ad64041389d6ec08816bc62ea67fa07cdfa200785705` |
| `public/assets/fonts/harmonyos-sans-sc-medium.woff2` | [HarmonyOS_Sans_SC_Medium.8b3fa8.woff2](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Medium.8b3fa8.woff2) | 212,040 字节 | `e01c81017b01647bd4645a1b3c5e3290483b338a992c7d349f0c9caf6441d7f8` |
| `public/assets/fonts/harmonyos-sans-sc-bold.woff2` | [HarmonyOS_Sans_SC_Bold.804ac9.woff2](https://web.hycdn.cn/endfield/official-v4/_next/static/media/font/HarmonyOS_Sans_SC_Bold.804ac9.woff2) | 212,552 字节 | `0f362366db87b717f1f3fc5ea52394fc23f36127cf7f231122297901b57de05c` |

三份文件均通过 WOFF2 `wOF2` 标识、头部声明长度与实际长度一致、15 个字体表的结构检查。合计 635,236 字节。记录证明文件下载与基本格式检查成功，不把它等同于页面已经启用字体或所有汉字都有字形；缺字时仍应保留系统字体回退。

## 动画与比例证据

Header CSS 中，收起侧栏宽度为 `7.5rem`，展开导航项宽度为 `22.5rem`；展开背景增加 `15rem`。主要位移／宽度过渡为 `.3s`，透明度和颜色多为 `.2s`。导航中文从水平偏移 `-1rem`、透明度 0 过渡到正常位置、透明度 1。

官网根字号会根据窗口尺寸动态缩放，因此这些 rem 不能直接换算成固定 16px 后当作官网实际像素。EOPS 应按工作台信息密度采用自己的可读尺寸，保留这些空间关系和过渡特征。

## 原型核查方式与本地暂存（历史记录）

只下载了入口 HTML、直接引用的九份样式、四个用于定位字体的脚本到 `work/endfield-reference/`，不提交整站。该目录有 CSS URL 清单与 SVG 素材 SHA-256 清单，方便复核。当时的原型产出为十个 SVG、三份官网 WOFF2 和出处记录，没有系统字体安装。之后公开发行时对 Logo 和字体进行了上述替换，当前文件与许可均以 [ASSETS.md](ASSETS.md) 为准。
