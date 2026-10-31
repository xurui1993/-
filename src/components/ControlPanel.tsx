import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud } from 'lucide-react';

interface ControlPanelProps {
  payrollSourceMode?: 'manual' | 'fengshen' | 'xiaoxiang';
  onUploadFiles?: (files: { file: File; relativePath: string }[]) => Promise<void>;
  onOpenTemplates?: () => void;
  isRunning?: boolean;
}

/**
 * 兼职核算上传区：仅负责拖拽 / 点选上传与模式说明。
 * 模式切换、辅助下载工具、认证入口由 CorePage 承担；执行态展示由 ExecutionCockpit 承担。
 */
export function ControlPanel({ payrollSourceMode = 'fengshen', onUploadFiles, onOpenTemplates, isRunning = false }: ControlPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!onUploadFiles || isRunning) return;

    const items = e.dataTransfer.items;
    const filesToUpload: { file: File; relativePath: string }[] = [];

    const traverseFileTree = async (item: any, path?: string) => {
      path = path || "";
      if (item.isFile) {
        const file = await new Promise<File>((resolve) => item.file(resolve));
        filesToUpload.push({ file, relativePath: path + file.name });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const readAllEntries = async () => {
          let allEntries: any[] = [];
          let entries: any[] = [];
          do {
            entries = await new Promise<any[]>((resolve) => {
              dirReader.readEntries((result: any[]) => resolve(result));
            });
            allEntries = allEntries.concat(entries);
          } while (entries.length > 0);
          return allEntries;
        };
        const entries = await readAllEntries();
        for (const entry of entries) {
          await traverseFileTree(entry, path + item.name + "/");
        }
      }
    };

    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i].webkitGetAsEntry();
        if (item) {
          await traverseFileTree(item);
        }
      }
    }

    if (filesToUpload.length > 0) {
      await onUploadFiles(filesToUpload);
    }
  };

  const handleClick = () => {
    if (isRunning) return;
    multiFileInputRef.current?.click();
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onUploadFiles || !e.target.files) return;
    const files = e.target.files;
    const filesToUpload: { file: File; relativePath: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      filesToUpload.push({
        file: files[i],
        relativePath: files[i].webkitRelativePath || files[i].name,
      });
    }
    e.target.value = '';
    if (filesToUpload.length > 0) {
      await onUploadFiles(filesToUpload);
    }
  };

  return <div className={`wb-upload ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={processDrop}>
    <input ref={fileInputRef} type="file" className="hidden" webkitdirectory="true" {...({ directory: 'true' } as any)} onChange={handleFileInput} aria-label="选择资料文件夹" />
    <input ref={multiFileInputRef} type="file" className="hidden" multiple accept=".xlsx,.xls,.csv,.txt" onChange={handleFileInput} aria-label="模板及补充资料" />
    <UploadCloud size={25} className="mx-auto text-sky-600" />
    <h3>{payrollSourceMode === 'xiaoxiang' ? '上传灯塔薪资申请表与日期配送单' : payrollSourceMode === 'manual' ? '上传薪资申请表与已有资料' : '上传薪资申请表（标准模板）'}</h3>
    <p className="wb-muted">{payrollSourceMode === 'fengshen' ? '根据「薪资申请表（标准模板）」自动识别城市与周期，随后准备所需资料。' : '「薪资申请表（标准模板）」与配送资料必需，其他资料可一并上传。'}</p>
    <div className="wb-row wb-action-bar wb-upload-actions">
      <button type="button" className="wb-primary" disabled={isRunning} onClick={handleClick}>选择文件</button>
      <button type="button" className="wb-button" disabled={isRunning} onClick={() => fileInputRef.current?.click()}>选择文件夹</button>
      {onOpenTemplates && <button type="button" className="wb-button" onClick={onOpenTemplates}>获取标准模板</button>}
    </div>
    <p className="wb-muted mt-3">支持直接拖入文件或包含标准模板的目录</p>
  </div>;
}
