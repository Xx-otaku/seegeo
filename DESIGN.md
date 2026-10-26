---
name: "seegeo"
description: "中文本机三平台回答与来源监测工作界面"
colors:
  pine: "#143d36"
  green: "#226b53"
  green-hover: "#18563f"
  ink: "#202c28"
  muted: "#65736c"
  supporting-text: "#62715e"
  supporting-text-strong: "#5d6d59"
  line: "#e2e7df"
  paper: "#fff"
  canvas: "#f7f8f5"
  topbar: "#fcfdf9"
  danger: "#9b3c35"
  amber: "#8c5b1b"
  task-surface: "#edf3e7"
  task-border: "#dbe5d3"
  field-border: "#ced7ce"
  button-border: "#cfd8cd"
  button-hover: "#eef3e9"
  focus: "#498167"
  nav-hover: "#214c43"
  nav-active: "#2d5548"
  nav-text: "#cfddd3"
  nav-active-text: "#f5ffed"
  badge-neutral-bg: "#eef1eb"
  badge-neutral-text: "#60715d"
  badge-success-bg: "#edf5e9"
  badge-success-text: "#336f45"
  badge-failed-bg: "#faece9"
  badge-failed-text: "#9a3e38"
  badge-warning-bg: "#fff3df"
  badge-warning-text: "#90611e"
  badge-running-bg: "#e5f5ed"
  badge-running-text: "#1c6f5b"
  diff-added-bg: "#e5f3de"
  diff-added-text: "#356431"
  diff-removed-bg: "#fae8e1"
  diff-removed-text: "#94584d"
typography:
  headline:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "17px"
    fontWeight: 600
  subtitle:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
  reading:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.95
  question:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.65
  button:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
  label:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "11px"
    fontWeight: 500
  badge:
    fontFamily: "\"Avenir Next\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "10px"
rounded:
  badge: "4px"
  warning: "5px"
  control: "6px"
  toast: "7px"
  surface: "8px"
  switch: "12px"
  circle: "50%"
spacing:
  "4": "4px"
  "6": "6px"
  "7": "7px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "22": "22px"
  "23": "23px"
  "24": "24px"
  "25": "25px"
  "27": "27px"
  "28": "28px"
  "29": "29px"
  "30": "30px"
  "31": "31px"
  "32": "32px"
  "33": "33px"
  "34": "34px"
  "35": "35px"
  "36": "36px"
  "40": "40px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-text:
    textColor: "{colors.green}"
    typography: "{typography.button}"
  field:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-item:
    textColor: "{colors.nav-text}"
    rounded: "{rounded.control}"
    padding: "12px 15px"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-text}"
  badge:
    backgroundColor: "{colors.badge-neutral-bg}"
    textColor: "{colors.badge-neutral-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  badge-success:
    backgroundColor: "{colors.badge-success-bg}"
    textColor: "{colors.badge-success-text}"
  badge-failed:
    backgroundColor: "{colors.badge-failed-bg}"
    textColor: "{colors.badge-failed-text}"
  badge-warning:
    backgroundColor: "{colors.badge-warning-bg}"
    textColor: "{colors.badge-warning-text}"
  badge-running:
    backgroundColor: "{colors.badge-running-bg}"
    textColor: "{colors.badge-running-text}"
  reading-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "31px 36px"
  run-strip:
    backgroundColor: "{colors.task-surface}"
    rounded: "{rounded.surface}"
    padding: "21px 23px"
  diff-surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "28px 33px"
---

# Design System: seegeo

## Overview

**Creative North Star: "seegeo 工作界面"**

seegeo 是中文、Mac 桌面优先的本机操作面板。既有方向用深松绿导航、浅草绿任务区和近白阅读面组织工作，以细分隔线维持紧凑表格，以宽松行距承载长回答。

界面语言具体、克制。主操作使用单一绿色，登录、验证和待核对状态使用琥珀色，失败使用红色；文字状态与图标共同表达含义。本文仅记录 src/style.css 与 src/App.tsx 已实现的设计。

**Key Characteristics:**

- 深松绿固定导航与浅色工作面
- 紧凑问题表格、宽松长文阅读
- 绿色主操作与明确的文字状态
- 本机中文字体栈、细边框、轻圆角
- 桌面并排阅读，窄屏纵向与底部导航

## Colors

色彩以深松绿和低饱和浅绿建立工作空间，白色用于正文承载面。规范值见 frontmatter；下列名称解释实际用途。

### Primary

- **深松绿（pine）**：固定导航、确认提示的深色底。
- **操作绿（green）**：主要按钮、链接、复选框与输入光标；悬停使用 green-hover。
- **浅草绿任务面（task-surface）**：当前采集状态条，与白色阅读面区分。
- **导航深绿层（nav-hover / nav-active）**：分别表达指针悬停与当前所在页面。

### Neutral

- **工作区近白（canvas）**、**顶栏近白（topbar）**、**阅读白（paper）**：构成页面、顶栏与正文层级。
- **正文墨色（ink）**、**辅助灰绿（muted / supporting-text / supporting-text-strong）**：正文、说明与表格元数据。末尾样式覆盖后的 supporting-text 系列是实际辅助文字颜色。
- **浅绿分隔线（line）**：表格外框、阅读面、栏目和设置分节。
- **控件边线（field-border / button-border）**、**焦点绿（focus）**：区分可输入、可点击和键盘位置。

状态色保持既有实现：success 与 running 为两组绿色；failed 为浅红底深红字；partial、uncertain、waiting_verification、waiting_login 共用 warning 琥珀组；pending、cancelled 使用 neutral。danger 用于危险按钮，amber 用于提醒文字。差异正文使用独立 added / removed 色组，移除文字同时加删除线。未记录未实施的色阶。

## Typography

**Display / Body Font:** Avenir Next，中文由 PingFang SC 呈现，后备为 Microsoft YaHei、sans-serif。未加载外部字体。数据路径采用原生 code 元素的等宽字体，未指定独立字体家族。

同一字体栈贯穿标题、表格、表单和正文，依靠字号、字重、行距建立层次。

### Hierarchy

- **Headline**：页面标题；阅读页问题标题另用较轻字重（500）、桌面字号（24px）和行高（1.65）。
- **Title / Subtitle**：分节标题与局部标题；侧栏品牌为紧排字距（-0.04em）的字标（29px、600）。
- **Body / Reading**：全局基准（14px）；普通段落行高（1.7），回答行高（1.95）、最大行宽（78ch），保留换行并允许长内容断行。
- **Question**：表格问题文字，和小一号的编号、分组、版本元数据形成主次。
- **Button / Label / Badge**：控件与紧凑状态。表格正文（12px）、表头（11px、500）；问题元信息、表尾、结果时间、模式说明最终为（11px）。
- **数字**：问题编号、结果时间、导航计数与事件时间使用等宽数字（tabular-nums）。

## Layout

桌面采用固定侧栏（220px）与右侧弹性主区。顶栏高（68px），工作区最大宽（1720px）、居中，内边距（36px 40px 24px）。表格与白色阅读面在同一工作区内；设置内容最大宽（1050px）。表格默认单元格内边距（19px 16px），表头（14px 16px）；筛选行可换行。上述 spacing 是实际观测尺寸，不表示项目已有独立 CSS 间距变量体系。

三平台阅读使用等宽三列（repeat(3, minmax(0, 1fr))），列间以细线分隔；正文差异为单个白色阅读面，来源增减区为两列。导入与编辑采用两列结构，导入主次比例为（2:1）。

- **≥1600px**：工作区上边距（42px），问题行宽上限（850px），问题列占比（50%）。
- **≤1200px**：侧栏（190px），主区水平留白（25px），单元格水平留白（12px）；平台设置操作改为纵向。
- **≤900px**：侧栏压缩为图标栏（76px），工作区留白（26px 20px）；平台阅读转单列，回答恢复（14px）；问题表最小宽（760px），横向滚动由表格容器承载。导入结构转单列。
- **≤600px**：导航固定于底部，高（63px），图标与中文文字纵向排列；主区移除侧栏偏移并留出底栏空间。顶栏（49px），工作区留白（23px 16px）。筛选搜索占满一行，编辑、来源增减转单列，导入和阅读操作随宽度换行。采集记录表最小宽（690px），继续在容器内滚动。

手机阅读卡内边距（19px），差异面（18px）；单平台回答（13px、1.9），三平台纵向阅读仍沿用其（14px）覆盖。手机提示置于底栏之上（bottom: 80px）。

## Elevation & Depth

主体通过深浅色面、细边框和间距分层，表格、任务条、阅读面没有投影。分段选项的选中态使用小投影（0 1px 3px #293f1f10）；确认提示使用扩散投影（0 6px 24px #143d3620）。固定导航层级（10），手机底栏（20），确认提示（30）。

状态过渡保持短促：按钮背景和边线、导航背景、开关背景与滑块位移均为（0.15s），进度条宽度为（0.4s）。采集中图标线性旋转（1.5s）；prefers-reduced-motion: reduce 下关闭动画和过渡。

## Shapes

容器为轻圆角矩形：阅读面、任务条、桌面表格、内联面板使用 surface；按钮、输入、导航使用 control；紧凑徽章使用 badge。开关轨道（29×17px），滑块（13px）圆形，开启后平移（12px）。任务状态图标用圆底，普通状态点为小圆。表格以直线横向分隔，无格子背景或装饰裁切。

## Components

### Buttons

主要操作为实心绿，白字；次要操作为白底细边框，危险操作保留白底并使用 danger 文字。通用内边距、圆角与文字样式见 frontmatter。按钮悬停使用既有背景/边线变化，文本按钮悬停加下划线；全局 focus-visible 使用（2px）焦点轮廓与（3px）偏移。disabled 按钮透明度（0.5）且使用不可用光标。导出为有边框的图标与原生 select 组合。

### Chips / Status Badges

徽章包含中文状态与圆点，采集中改为旋转图标。完成、失败、来源待核对、需核对会话、登录、验证、排队、取消均保留不同文字。背景色辅助区分，不能取代文字。空平台显示“尚未采集”。

### Cards / Containers

阅读面、任务状态条、内联导入/编辑面板和表格外框共用轻圆角与细边框；阅读面为白色，任务条为浅草绿。任务条左侧放运行概况与计划，右侧放暂停/开始操作；按钮在窄屏依现有断点换行。普通容器没有悬浮投影。

### Inputs / Fields

输入、选择器与文本域为白底细绿灰边框，内边距（10px 12px）、最小高（39px）。文本域支持纵向调整并保留较宽行距（1.75）。搜索框包住图标、输入和清除按钮，宽度（220–420px），focus-within 显示整体轮廓；手机铺满一行。文件输入保留原生可聚焦区域，以透明覆盖方式铺满虚线文件入口。

### Navigation

桌面导航包含品牌、四个工作入口与平台验证状态；当前项使用独立深绿底与浅色文字。窄侧栏仅保留图标，手机改为底部图标加文字导航。导航切换清除详情、初始任务、编辑和导入状态；点击平台验证项进入运行设置。

### Question / Platform Rows

问题与每个平台的结果各为独立可点击入口。问题行支持勾选、启停、内联编辑与删除；勾选行使用浅绿底，悬停行使用顶栏近白。问题文本保留换行，元信息紧随其下。选中数量同步到“采集 N 个问题”。

### Reading / Comparison

阅读页固定使用“回答原文 / 三平台对照 / 历史对照”三种视图，平台分段控件与记录选择器保留在内容上方。来源按正文实际引用与平台检索参考分组，原生 details 支持展开；正文引用默认展开。历史差异以绿色新增行、带删除线的浅红移除行呈现；来源增减独立列出。记录不足时提供解释性空状态；问题版本不同显示琥珀提示。

### Feedback

全局错误为带关闭按钮的浅红消息，使用 role=alert；完成提示为深松绿浮层，使用 role=status，持续（5s）。服务连接、加载、采集中、未采集、来源失败和登录等待均有文字。页面数据每（5s）刷新；这是状态更新节奏，不是视觉动画。

## Do's and Don'ts

### Do:

- Do 保留 Avenir Next → PingFang SC → Microsoft YaHei → sans-serif 的本机字体栈。
- Do 使用白色阅读面和浅绿任务面区分内容与运行状态。
- Do 给状态保留中文标签，登录等待、来源待核对、失败和完成各自可识别。
- Do 在数据表容器内横向滚动，在长问题、回答和链接处允许换行。
- Do 保留键盘焦点轮廓、文件输入焦点和减弱动效规则。

### Don't:

- Don't 引入宣传页式超大展示字、装饰插图或新的视觉身份。
- Don't 把来源提取失败呈现为没有来源，或把未采集呈现为采集成功。
- Don't 将普通内容容器改成重阴影悬浮卡片；现有主体通过色面和边框分层。
- Don't 隐去桌面与手机布局中当前导航、问题和任务状态的含义。
