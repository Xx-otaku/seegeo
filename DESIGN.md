---
name: "seegeo"
description: "采用 macOS 工作秩序的中文本机回答与来源监测工具"
colors:
  blue: "#0066cc"
  blue-hover: "#005bb5"
  blue-soft: "#e7f0fc"
  nav-active: "#dce8f8"
  selected-row: "#edf4fe"
  ink: "#1d1d1f"
  muted: "#65656c"
  line: "#e5e5ea"
  paper: "#fff"
  surface: "#f5f5f7"
  sidebar: "#f0f0f2"
  toolbar: "#fafafc"
  field-border: "#c7c7cc"
  button-border: "#d2d2d7"
  button-hover: "#f0f0f3"
  focus: "#80b8f4"
  danger: "#b42318"
  amber: "#946200"
  status-neutral: "#62626a"
  status-success: "#287243"
  status-warning: "#916000"
  status-paused: "#6b54a5"
  status-cancelled: "#707078"
  warning-bg: "#fff8e8"
  warning-text: "#825609"
  diff-added-bg: "#e4f3e8"
  diff-added-text: "#275b37"
  diff-removed-bg: "#fbe9e8"
  diff-removed-text: "#8a352e"
  toast: "#25252b"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "17px"
    fontWeight: 600
  subtitle:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  reading:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.95
  question:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.65
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "11px"
  badge:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Helvetica Neue\", sans-serif"
    fontSize: "11px"
rounded:
  marker: "4px"
  compact: "5px"
  control: "6px"
  navigation: "7px"
  diff: "8px"
  table: "9px"
  surface: "10px"
  switch: "12px"
  circle: "50%"
spacing:
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "22": "22px"
  "24": "24px"
  "28": "28px"
  "30": "30px"
  "32": "32px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "34px"
  button-text:
    textColor: "{colors.blue}"
    typography: "{typography.button}"
    rounded: "{rounded.marker}"
    padding: "5px 0"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "34px"
  nav-item:
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.blue}"
  badge:
    textColor: "{colors.status-neutral}"
    typography: "{typography.badge}"
  badge-success:
    textColor: "{colors.status-success}"
    typography: "{typography.badge}"
  badge-warning:
    textColor: "{colors.status-warning}"
    typography: "{typography.badge}"
  badge-failed:
    textColor: "{colors.danger}"
    typography: "{typography.badge}"
  badge-running:
    textColor: "{colors.blue}"
    typography: "{typography.badge}"
  badge-paused:
    textColor: "{colors.status-paused}"
    typography: "{typography.badge}"
  badge-cancelled:
    textColor: "{colors.status-cancelled}"
    typography: "{typography.badge}"
  reading-surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "30px"
  task-toolbar:
    backgroundColor: "{colors.toolbar}"
    padding: "18px 32px 13px"
  segmented:
    rounded: "{rounded.navigation}"
    padding: "3px"
  switch:
    rounded: "{rounded.switch}"
    width: "30px"
    height: "18px"
---

# Design System: seegeo

## Overview

**Creative North Star: "macOS 本机工作台"**

seegeo 采用 Finder、邮件、系统设置的操作秩序：浅灰侧栏、白色工作区、细灰分隔线和系统字体。蓝色用于主操作、当前导航、链接与输入反馈；颜色退居内容之后，让问题、回答、来源与真实任务状态保持清楚。

这是供日常维护与长文核对的中文本机工具。紧凑表格承载问题与三平台结果，较宽行距承载回答；共享任务控制栏跨五个工作页及回答详情持续可见。界面不使用宣传页排版、装饰插图、复杂玻璃或假窗口按钮。

**Key Characteristics:**

- 浅灰侧栏、白色工作区、蓝色主操作
- 系统字体、细分隔线与轻圆角
- 问题表格紧凑，回答正文宽松
- 任务控制持续可见，状态与不可用原因具体可读
- 窄屏顶部五项导航，表格在自身容器内横向滚动

## Colors

以低饱和中性灰建立工作空间，以系统蓝标记可操作与已选择状态。规范值见 frontmatter；名称对应实际 CSS 变量和重复使用的局部色值。

### Primary

- **操作蓝（blue）**：主要按钮、链接、选中导航文字、复选框、开关、运行状态和进度条。悬停主按钮使用 blue-hover。
- **浅蓝运行底（blue-soft）**：运行中任务图标底色。nav-active 与 selected-row 分别承担当前导航与已选表格行的背景。

### Neutral

- **工作白（paper）**：主区、阅读面、设置分区与表单底色。
- **侧栏浅灰（sidebar）**、**辅助面灰（surface）**、**控制栏近白（toolbar）**：侧栏、数据路径及辅助图标、持续任务栏各自的静态层级。
- **正文墨色（ink）**与**辅助灰（muted）**：正文和说明；line 用于分区与容器边线。field-border 与 button-border 区分输入和按钮边界，focus 标记键盘位置。
- **提示炭灰（toast）**：完成提示底色，与白字配合。

状态色属于语义反馈：status-success 表示完成，status-warning 表示登录、验证、来源或会话待核对，status-paused 表示暂停，danger 表示失败和危险操作；排队与取消使用中性状态色。琥珀 warning-bg / warning-text 用于结果提醒，amber 用于提醒文字。差异新增和移除使用独立 diff 色组；移除正文同时带删除线。徽章使用文字和小圆点，通常没有彩色胶囊底。

**The Action Blue Rule.** 蓝色集中表达操作、选择与运行反馈；成功、等待、暂停和失败保留各自文字与状态色。

## Typography

**Display / Body Font:** 系统字体栈，依次为 -apple-system、BlinkMacSystemFont、SF Pro Text、PingFang SC、Helvetica Neue、sans-serif。未加载外部字体。数据路径保留原生 code 等宽字体。

同一字体贯穿标题、表格、正文和控件，依靠字号、字重与行距建立层次。没有宣传式 display 角色。

### Hierarchy

- **Headline**：工作页标题；窄屏标题缩至（24px）。回答详情问题标题使用（23px、1.6）、最大宽（46ch），窄屏为（20px）。
- **Title / Subtitle**：分区与局部标题；侧栏字标为（24px、650），窄屏为（20px）。
- **Body / Reading**：正文基准与回答正文见 frontmatter。回答保留换行，最大行宽（75ch）；三平台列内正文使用（13px、1.85）。
- **Question**：可点击的问题文字，与小号编号、分组、版本元信息形成主次。
- **Button / Label / Badge**：紧凑操作与状态；表格正文（12px），表头（11px、500），问题元信息和结果时间（10px）。任务标题（14px、600），计划与解释（11px）。
- **数字**：表格、导航计数、任务进度、事件时间使用 tabular-nums。

## Layout

桌面固定侧栏（208px），主区占其余宽度。路径栏最小高（54px）；共享任务栏位于其下，并在滚动时吸附视口顶部。主工作区留白（30px 32px 42px），没有旧版居中最大宽布局。阅读区域最大宽（1450px），单回答面最大宽（1020px），设置区域最大宽（960px）。

任务栏以“状态与当前问题 / 控制按钮”两列组织，批次进度与解释跨整行。暂停或继续、取消、结束后的重跑与开始操作保持同一区域。问题库按标题操作、筛选、问题×平台表格排列；表头内边距（12px 14px），单元格（15px 14px）。问题表最小宽（770px），超宽只在表格容器滚动。导入两列等宽，编辑为主列加（200px）分组列；来源变化两列。spacing 记录重复使用的实际尺寸，项目没有独立 CSS 间距变量体系。

- **≥1550px**：工作区、路径栏和任务栏水平留白扩至（48px），问题列占比（44%）。
- **≤1200px**：侧栏（184px），主区水平留白（24px）；任务栏改为单列，控制按钮位于状态下方并左缩进（48px）。三平台阅读改为纵向分区；平台设置操作纵向排列。
- **≤760px**：侧栏转为页面顶部区域，五项导航横排，保留图标与文字；隐藏品牌说明、平台健康区和导航计数。路径栏最小高（44px），工作区留白（25px 18px 35px）。任务栏继续吸顶，按钮采用三列网格并按数量换行。搜索占满一行；导入、编辑、历史记录选择器与来源变化改为单列。阅读面内边距（19px），设置面（19px），差异面（16px）；表格保持自身横向滚动。

基线分析沿用工作区间距和表格容器。网站信源与情感统计桌面为两列，间隔（28px），≤1200px 改为单列；配置行是品牌 / 别名 / 移除操作三列，≤760px 别名独占第二行。普通指标表最小宽（500px），窄屏（540px）；样本明细始终最小宽（1050px），问题入口宽（240–360px），只在自身容器横向滚动。人工核对面板就地展开并滚动到可见位置，顶部预留（190px），窄屏（205px）；完整回答区域最大高（330px），超出后内部滚动。窄屏五项导航的文字为（10px）、图标为（13px）。

## Elevation & Depth

主体通过浅灰侧栏、白色内容、近白控制栏、细边框与间距分层。常规表格、阅读面和设置分区没有投影。分段选中项使用小投影（0 1px 3px #0002），开关滑块使用（0 1px 2px #0002），完成提示使用（0 6px 20px #0002）。侧栏层级（5），任务栏（4），错误消息（7），完成与操作中提示（20）。

**The Quiet Surface Rule.** 普通内容以白色、浅灰和边线分层；投影仅服务分段选择、开关滑块与短暂提示。

控件背景与投影过渡为（0.12s ease-out），开关为（0.15s），进度宽度为（0.3s ease-out），运行图标为（1s linear）旋转。按钮按下轻移（1px）。prefers-reduced-motion: reduce 下关闭动画、过渡与平滑滚动。

## Shapes

轻圆角矩形延续 macOS 工具的克制感：控件使用 control，导航和分段底座使用 navigation，表格与任务图标使用 table，阅读面、设置分区与内联面板使用 surface。历史差异面使用 diff；来源序号与文本按钮使用 marker。开关为胶囊轨道（30×18px）与圆形滑块（14px），开启后平移（12px）。状态点为圆形；表格用横向分隔线，普通内容不采用装饰裁切。

## Components

### Buttons

主按钮蓝底白字，次按钮白底细灰边，危险按钮保留白底并用 danger 文字。通用尺寸见 frontmatter；实际高度为最小高，允许内容增长。任务栏按钮采用（7px 9px）内边距与（32px）最小高，窄屏更紧凑。悬停改变背景与边线，文本操作悬停加下划线；全局键盘焦点使用（3px）轮廓及（2px）偏移。不可用状态保留灰色背景和文字，任务控制通过 title 解释原因，详情恢复与重采同时提供可见原因。操作中锁定内容表单，并显示“正在执行操作…”提示。

### Chips / Status Badges

状态是小圆点加中文标签，采集中用旋转图标。完成、暂停、取消、失败、来源待核对、需核对会话、登录、验证与排队各保留具体文字。徽章本身透明，不添加旧版彩色胶囊。空平台显示“尚未采集”。

### Cards / Containers

阅读面、设置分区、问题表格共用细灰边框与白色背景；内联导入/编辑使用近白蓝灰底（#f8f9fc）。分段控件底座为浅灰（#ededf1），当前项为白色小投影。阅读留白与回答行距服务长文核对，普通容器维持平面结构。

### Inputs / Fields

白底、细灰边、轻圆角；基本内边距与尺寸见 frontmatter。文本域允许纵向调整，行高（1.7），基础最小高（110px），导入文本域（160px）。搜索由图标、输入和清除按钮组成，宽度（200–400px），focus-within 为完整边框轮廓，窄屏占满一行。导入文件使用真实原生 file input。开关采用原生可聚焦 checkbox，视觉轨道紧邻输入，禁用时半透明。

### Navigation

桌面浅灰侧栏包含字标、问题库、采集记录、历史对照、基线分析、运行设置五个工作入口与平台健康状态。当前项浅蓝底、蓝字蓝图标，悬停浅灰底；窄屏导航移至顶部横排。正文阅读视图使用底部蓝线标记当前标签，平台选择使用浅灰分段控件。导航文字与图标共同表达位置。

### Persistent Task Controls

任务控制栏跨问题库、采集记录、历史对照、基线分析、运行设置和回答详情。状态、轮次、完成数量、当前平台与问题在左，控制在右或其下；进度与解释留在栏内。取消保留已完成回答和来源，重跑创建新轮次；这些区别必须由控件和提示直接说明。工具栏不使用营销卡片外观。

### Question / Platform Rows

问题与平台结果均为独立入口。行内保留勾选、启停、编辑和移除；勾选行浅蓝，悬停行近白。问题可换行，元信息紧随其下。移除说明明确保留历史；勾选数量同步到开始监测按钮。

### Reading / Comparison

回答原文、三平台对照、历史变化三个视图保持一致的阅读入口。来源按正文引用与检索参考分组，用原生 details 展开；正文引用默认展开。历史新增以浅绿底深绿字呈现，移除以浅红底深红字和删除线呈现，来源增减独立列出。缺少可比记录时解释原因，问题版本不同时给琥珀提示。

### Baseline Analysis

基线分析是新增的工作入口，沿用白底表格、系统蓝、辅助灰和现有输入控件。顶部显示目标品牌与竞品摘要，配置以现有内联面板展开：首行为目标品牌，其余为可添加、移除的竞品，每行提供名称和逗号分隔别名。保存后重新统计，目标品牌变化不会沿用旧品牌情感标注。平台、起止日期、问题分组与信源口径筛选使用原生输入与选择器，刷新和 JSON 导出使用既有次按钮。

筛选下方用细分隔线和文字列出有效回答、匹配记录、排除记录、信源完整样本及更新时间。品牌表现、网站信源、人工情感和回答结构使用指标表与紧邻的分母说明。比例显示一位小数；网站、情感和结构份额并列数字与细蓝条（80×5px、圆角 3px），数字始终可读，未知显示“待核对”且不画进度条。TOP3 的未判定、不适用与情感的未核对分别说明，不计为零或中性。

样本表提供原回答入口和人工核对入口。核对面板保留问题、品牌提及次数与默认展开的完整回答，再提供目标品牌情感、排名判定、按顺序的前三品牌及备注。未提及目标品牌时禁用情感选择并说明原因；排名支持未知、已核对和不适用。保存复用蓝色主按钮，关闭按钮有可访问名称。没有完整回答或可统计信源时显示具体空状态，不填充示例指标。

### Feedback

错误为带关闭按钮的浅红消息，使用 role=alert；完成提示为炭灰浮层，使用 role=status，显示（5s）。操作中另有固定白底提示。服务连接、加载、采集中、未采集和人工处理均有文字。数据每（5s）刷新，这是状态更新节奏。

## Do's and Don'ts

### Do:

- Do 保留系统字体栈、浅灰侧栏、白色工作区与蓝色主操作。
- Do 在五页与回答详情中保留任务控制；暂停、继续、取消和重跑的含义必须可读。
- Do 用中文标签与图标说明状态，给不可用操作保留具体原因。
- Do 在表格自身容器内横向滚动，允许问题、回答、来源链接与数据路径断行。
- Do 保留键盘焦点、真实禁用状态、操作中反馈与减弱动效支持。

### Don't:

- Don't 把运行工具改成宣传页，或加入超大展示字、装饰插图、复杂玻璃和假窗口按钮。
- Don't 恢复深绿导航或绿色主操作；绿色仅用于已有成功、健康状态与差异新增内容。
- Don't 把普通阅读面和设置分区改成重阴影悬浮卡片。
- Don't 用颜色代替状态文字，或把来源失败、未采集与成功混为一谈。
- Don't 让手机正文与控件撑宽整页，或将现有顶部导航改为底部导航。
