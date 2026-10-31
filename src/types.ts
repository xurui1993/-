export interface Theme {
  name: string;
  runner: string;
  target: string;
  spin_frames: string[];
  icon: string;
  title: string;
  logo: string;
  sub: string;
  kite: string;
  term_head: string;
  log_init: string;
  footer: string;
  lbl_city: string;
  lbl_type: string;
  lbl_config: string;
  lbl_source: string;
  lbl_workspace: string;
  btn_config: string;
  btn_source: string;
  btn_workspace: string;
  btn_run: string;
  btn_run_ing: string;
  btn_success: string;
  btn_error: string;
  tab_task: string;
  tab_output: string;
  btn_add_root: string;
}

export interface AppConfig {
  city: string;
  basePath: string;
  sourcePath: string;
  cities: string[];
  enableInterceptor?: boolean;
  enableCrossStationMerge?: boolean;
  action?: string;
  payrollSourceMode?: 'manual' | 'fengshen' | 'xiaoxiang';
  billingPeriodPreset?: string;
  payrollPreparationId?: string;
  preparationOnly?: boolean;
  deductionConfigVersion?: string;
}

export interface LogEntry {
  text: string;
  level: "INFO" | "SYSTEM" | "WARN" | "ERROR" | "SUCCESS";
}

export interface TaskHistoryRecord {
  id: string;
  name: string;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED';
}

export interface UserProfile {
  name: string;
  department: string;
  avatar: string;
  status?: string;
}
