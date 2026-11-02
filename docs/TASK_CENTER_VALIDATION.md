# 任务中心改造验证说明

验证日期：2026年11月3日；基线：`7ee0826`。需求与验收项见 [TASK_CENTER_REQUIREMENTS.md](TASK_CENTER_REQUIREMENTS.md)。

## 实施结果

- 任务中心成为默认首页，资料采集及专项报表统一进入三步新建抽屉。七个业务场景预设与四个平台自定义入口并存，范围仍由现有后端校验。
- 业务场景编号、来源平台及冻结名称进入原有任务存储、幂等判断及重试链；旧任务不强制迁移。历史编号可定位其原业务任务。
- 任务列表与成果下载共用记录，待处理任务优先；成果过滤在计数、分页前执行。内部薪资来源任务仍归属原核算流程。
- 批量领取将经过原接口校验的文件流式写入各任务目录，限制20个资料或报表任务；遇到异常路径或同名文件终止并清理临时包。
- 薪资、价格、验证、停止、移出及恢复继续使用原业务接口。未改计薪公式、薪资自动执行策略及两份Excel交付约定。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 后端相关回归 | 242项通过 |
| 前端全量测试 | 175项通过 |
| TypeScript检查 | `npm run lint`通过 |
| 生产构建 | `npm run build`通过；保留现有主包超过500KB的提示 |
| 隔离浏览器 | Edge无头浏览器通过；前端运行异常0 |

后端覆盖任务目录、场景合法组合、跨平台拒绝、冻结名称、重启读取、重试归集、幂等、计数分页、历史定位、打包内容与清理，以及薪资队列、自动核算和验证回归。打包测试实际读取ZIP内容并检查CRC。

浏览器使用真实生产构建，拦截全部`/api/`请求，覆盖三步创建、确认前不提交、关闭保留范围、匹配已有任务不重复创建、蓝橙全量、专项报表、成果过滤、自动验证码提示、收起等待、从原任务重新打开及模块切换。1440、1024、390像素宽度均可操作，无页面横向溢出。模拟创建2个任务，真实业务写入0。

复现命令（在项目根目录，已安装项目依赖和Python Playwright）：

```powershell
$env:PYTHONPATH='backend;backend/tests'
.venv\Scripts\python.exe -m unittest test_task_hub test_task_center test_task_catalog test_download_records test_download_jobs test_download_service test_download_workflows test_payroll_queue test_payroll_inputs test_payroll_automatic test_payroll_control test_payroll_review test_payroll_review_flow test_fengshen_http_auth -q
npm test
npm run lint
npm run build
node scripts/check_task_hub_ui.mjs
```

浏览器脚本默认使用临时目录保存截图与JSON报告，也可设置`TASK_HUB_QA_DIR`。Windows默认使用Edge，可用`TASK_HUB_BROWSER_CHANNEL`指定已安装的Playwright浏览器通道。所有模拟验证均不使用用户的浏览器登录会话。

## 数据与运行边界

维护前后核对1744份受保护文件的大小及修改时间，以及31份配置、认证资料和模板的SHA-256，未发现变化。保留资料、输出、上传、会话和历史结果；源码交付包不含这些运行资料。

本次未重启现有业务服务，未执行真实平台短信、导出、审批或工资核算。自动化与模拟浏览器结果不代表真实平台联调或工资金额验收。加载新版界面需要在现有任务结束后正常重启项目服务；不应强制结束下载或核算任务。
