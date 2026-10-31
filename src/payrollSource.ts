import type { AppConfig } from './types';

export function restorePayrollSourceMode(saved: Partial<AppConfig>): 'manual' | 'fengshen' | 'xiaoxiang' {
  return saved.payrollSourceMode === 'xiaoxiang' ? 'xiaoxiang' : saved.payrollSourceMode === 'manual' ? 'manual' : 'fengshen';
}
