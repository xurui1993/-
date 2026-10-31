import React from 'react';
import { taskGuidance, type TaskContext } from '../lib/taskGuidance';

export function TaskOutcome({ task, children }: { task: TaskContext; children?: React.ReactNode }) {
  const guidance = taskGuidance(task);
  return <section className={`wb-task-outcome is-${guidance.tone}`} aria-label="任务结果与下一步">
    <div><strong>{guidance.label}</strong><p>{guidance.hint}</p></div>
    {children && <div className="wb-task-outcome-actions">{children}</div>}
  </section>;
}
