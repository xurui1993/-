import React from 'react';
import { FLOW_STEPS, flowStep } from '../lib/taskFlow';
export function TaskFlowSteps({status}: {status: string}) {
 const step=flowStep(status);
 return <ol className="wb-flow-steps" aria-label="任务操作步骤">{FLOW_STEPS.map((label,index)=><li key={label} aria-current={index===step?'step':undefined} className={index===step?'is-current':index<step?'is-complete':''}><span>{index+1}</span>{label}</li>)}</ol>;
}
