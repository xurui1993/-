import { Theme } from "./types";

export const MUTTERINGS = [
  "正在初始化核心组件...",
  "已加载配置参数，准备就绪。",
  "确保系统运行环境正常。",
  "开始解析数据源...",
  "分配计算资源中...",
  "正在连接数据库引擎...",
  "同步缓存数据...",
  "校验数据格式...",
  "等待响应结果...",
  "已完成环境预热。"
];

export const THEMES: Theme[] = [
  {
    name: "Aegis", runner: "▰", target: "▰",
    spin_frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    icon: "🧮", title: "AEGIS 工作流管控端", logo: "薪酬核算中心", sub: "",
    kite: "◈",
    term_head: "处理进度", log_init: "日志初始化成功，等待任务...\n",
    footer: "系统状态: 最佳 // 上行链路加密",
    lbl_city: "区域设置", lbl_type: "任务类型", lbl_config: "参数配置文件", lbl_source: "源数据目录", lbl_workspace: "工作空间",
    btn_config: "选择配置", btn_source: "选择目录", btn_workspace: "选择工作", btn_run: "提交执行", btn_run_ing: "正在处理中...",
    btn_success: "执行成功", btn_error: "执行失败",
    tab_task: "执行队列", tab_output: "输出结果",
    btn_add_root: "挂载新卷",
  }
];
