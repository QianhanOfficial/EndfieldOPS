# 视觉素材与第三方许可

EOPS 终末地工业行动中枢采用受《明日方舟：终末地》启发的工业视觉风格。布局、配色、交互用于个人项目管理；本项目不是鹰角或 GRYPHLINE 的官方产品，也未声称获得其认可或授权。

## EOPS 项目标识

下列 SVG 由本项目使用基础几何图形独立绘制，没有使用官网工业 Logo 的路径，随本项目原创代码适用仓库根目录的 [LICENSE.md](../LICENSE.md)。

| 文件 | 用途 |
| --- | --- |
| `public/assets/eops-logo-black.svg`、`eops-logo-white.svg` | E/O/P/S 四格几何字标，浅色与深色主题 |
| `public/favicon.svg` | 黄色底的 EOPS 几何字标 |

之前本机原型使用的官网工业 Logo 已从公开发行内容中移除。原始文件仅保留在被 Git 忽略的 `work/private-original-assets/` 中。[ENDFIELD-REFERENCE.md](./ENDFIELD-REFERENCE.md) 保留视觉研究和来源记录；记录链接不构成素材再分发授权。

## 官方导航图标

本项目按维护者选择保留原有的七个导航图标，以维持现有界面。来源为 [《明日方舟：终末地》官方网站](https://endfield.hypergryph.com/) 2026-10-22 公开 HTML 中的 `Header_icon` 内联 SVG：

- `public/assets/endfield-nav-{home,operator,lore,information,calendar,aic-gameplay,notice}.svg`。
- `src/components/OfficialNavIcon.tsx` 中用于界面显示的相同 SVG 路径。

图标不是本项目原创，版权归 HYPERGRYPH 及相应权利人所有；本项目代码许可不授予其任何再授权，也不声明这些图标不存在使用或再分发限制。

## 祀的官方表情包

本项目按维护者选择保留 `public/assets/endfield-stickers-10.jpg`，用于原有进度条中的祀展示。文件保持下载原样，仅由 CSS 选择显示区域并施加浮动效果。

- [官方发布页：《明日方舟：终末地》表情包 #10](https://www.taptap.cn/moment/857006468283501226)。
- [图片来源](https://img2-tc.tapimg.com/moment/etag/FmImIpu-FA1cI1lckQXE56ET1HEz_20261007211107.jpg/_tap_ugc.jpg)。

角色与图片版权归 HYPERGRYPH 及相应权利人所有。官方发布页介绍微信、QQ平台下载使用，并未提供本项目可转授的素材许可；保留该图片不代表本项目获得了单独授权。该图片不适用本项目代码许可，不得据此推定可以不受限制地使用、修改或再分发。

## HarmonyOS Sans SC 字体

本软件使用 HarmonyOS Sans SC，版权归 **Huawei Device Co., Ltd.（华为终端有限公司）** 所有。三份 TTF 均直接来自 [华为官方字体包](https://developer.huawei.com/images/download/general/HarmonyOS-Sans.zip)，获取日期为 2026-10-22；未转换、未裁切、未修改。原始下载页面为 [华为开发者联盟设计资源](https://developer.huawei.com/consumer/cn/design/resource/)。

完整字体许可随字体保存在 [LICENSE_Fonts](../public/assets/fonts/LICENSE_Fonts)，独立于本项目代码许可。其允许未修改字体随软件捆绑分发，要求保留版权和协议、显著说明使用该字体，禁止修改字体及单独分发或出售字体。页面保留系统字体回退。

| 本地文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `public/assets/fonts/harmonyos-sans-sc-regular.ttf` | 8,261,128 | `297b088424be212207df2ce8b98e335468b782aa6b96832af0b8b773d711e2b1` |
| `public/assets/fonts/harmonyos-sans-sc-medium.ttf` | 8,227,312 | `6ed1553edccddc48eb27ff25d134a4a715cf54211238d4840b3038576cba1944` |
| `public/assets/fonts/harmonyos-sans-sc-bold.ttf` | 8,158,996 | `43a424b85e47fb53a17b3b32026a71801f86f8e022ca6798d186b47d39fa5f01` |

字体包中许可原文位于 `HarmonyOS Sans/HarmonyOS_Sans_SC/LICENSE.txt`；本仓库完整保留其文字，仅移除文件末尾的空字节填充。字体二进制文件逐字节保持原样。此前官网提供的 WOFF2 文件只保留在本机被 Git 忽略的研究目录中，不随仓库分发。

## README 截图

`docs/screenshots/` 中的 PNG 是 EOPS 运行示例项目时的界面截图，用于 README 展示。画面中包含上文所列的官方导航图标、祀的表情包和 HarmonyOS Sans SC 字形，这些内容仍归各自权利人所有，适用上文对应的说明，不因出现在截图中而适用本项目代码许可。

## 终末地 IP 边界

《明日方舟：终末地》名称、角色、世界观及相关标识的权利属于原权利人。本仓库的代码许可不授予这些第三方 IP 的使用、改编或商业授权。

参考 [GRYPHLINE 国际站二次创作与直播指引](https://endfield.gryphline.com/en-us/news/4497)（2026-02-03）：普通同人活动以其定义的非营利范围为前提，并有成本回收及视频、直播例外；指引禁止冒充官方、可能被误认成官方项目、缺少明确原创性的官方素材直接复制等情形。本项目选择免费、非商业定位；该国际站指引并不等于本项目已获授权，也不应理解为所有地区、所有同人活动一律禁止商业使用的法律结论。
