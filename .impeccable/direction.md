# seegeo 工作界面约定

## Direction contract

THESIS：中文本机监测工具，采用 Finder、邮件、系统设置的操作秩序。问题是主入口，任务控制在四页和回答详情中始终可见。

OWN-WORLD：浅灰侧栏、白色工作区、细灰分隔线、系统字体和蓝色主操作。正文深灰，辅助文字可读。取消保留档案，不使用复杂玻璃、营销卡片或假窗口按钮。

STORY：用户维护问题、开始监测、暂停或取消，再阅读原文与来源、对照历史、导出数据。控制状态如实呈现，未完成不代表历史内容被删除。

FIRST VIEWPORT：208px 侧栏，54px 路径栏，其下共享任务控制栏；标题/导入导出、筛选、问题×平台表格依次展开。暂停/继续和取消位于固定位置，结束后提供重跑；原任务保持暂停。

FORM：用户指定的 macOS 工作台方向，code-led Operate。seed: none (user-pinned)。1440px 三平台并排；390px 顶部四项导航，表格在自身容器横向滚动，正文和控件不造成整页溢出。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 基线分析扩展（v0.3.0）

沿用已确认的 macOS Operate 系统。第五个导航项“基线分析”依次提供目标品牌与竞品配置、平台/日期/分组/信源口径筛选、样本分母、品牌指标、网站信源份额、目标品牌人工情感、十类回答结构及逐条核对。实际比例来自完整回答；来源失败排除信源统计，未知排名和情感不能记作零。目标品牌、竞品、别名均可修改；不展示事实错误和投放内容指标。表格在窄屏自身滚动，问题列保留可读宽度；完整回答核对就地展开。数据与配置只保存在本机，无宣传指标或虚构样本。
