import React from 'react';
import { WorkbenchDrawer } from './WorkbenchDrawer';

export function TaskCreationSurface({enabled,step,onClose,catalog,review,footer,children}:{
  enabled:boolean; step:number; onClose:()=>void; catalog:React.ReactNode; review:React.ReactNode;
  footer:React.ReactNode; children:React.ReactNode;
}) {
  if(!enabled)return <>{children}</>;
  return <WorkbenchDrawer title="新建任务" wide onClose={onClose} bodyClassName="tc-create-body">
    <ol className="tc-create-steps" aria-label="新建任务步骤">
      {['选择业务场景','配置处理范围','确认并创建'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined}><span>{index+1}</span>{label}</li>)}
    </ol>
    <div hidden={step!==1}>{catalog}</div>
    <div hidden={step!==2}>{children}{footer}</div>
    {step===3&&review}
  </WorkbenchDrawer>;
}
