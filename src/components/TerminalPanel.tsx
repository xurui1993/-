import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

export const TerminalPanel = React.memo(function TerminalPanel({
  logs,
  progress = 0,
  progressText = '',
  isRunning = false,
  showFooterProgress = true,
}: {
  logs: LogEntry[];
  progress?: number;
  progressText?: string;
  appTheme?: 'light' | 'dark';
  isRunning?: boolean;
  showFooterProgress?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getColor = (level: string) => {
    switch (level) {
      case 'INFO':
        return 'text-slate-700';
      case 'SYSTEM':
        return 'text-sky-700 font-semibold';
      case 'WARN':
        return 'text-amber-700 font-semibold';
      case 'ERROR':
        return 'text-rose-700 font-bold';
      case 'SUCCESS':
        return 'text-emerald-700 font-bold';
      default:
        return 'text-slate-600';
    }
  };

  const getPrefix = (level: string) => {
    if (level === 'SYSTEM') return '[系统] ';
    if (level === 'INFO') return '[信息] ';
    if (level === 'WARN') return '[警告] ';
    if (level === 'ERROR') return '[错误] ';
    if (level === 'SUCCESS') return '[成功] ';
    return '';
  };

  return (
    <div className="h-full w-full flex flex-col relative overflow-hidden bg-slate-50 border border-slate-200 rounded-xl">
      <div
        ref={scrollRef}
        className="flex-1 px-6 py-5 font-mono text-[13px] sm:text-[14px] overflow-y-auto overflow-x-hidden relative"
      >
        <div className="relative z-10 flex flex-col gap-1.5 min-h-full pb-4">
          {logs.length === 0 && (
            <div className="text-slate-400 select-none lowercase tracking-wider">
              [sys] waiting for handshake protocol...
            </div>
          )}
          {logs.map((log, i) => (
            <div key={i} className={`whitespace-pre-wrap leading-relaxed ${getColor(log.level)}`}>
              <span className="opacity-60 mr-2 select-none tracking-tighter">{getPrefix(log.level)}</span>
              {log.text.replace(/^>>>\s*/, '')}
            </div>
          ))}
        </div>
      </div>

      {showFooterProgress && isRunning && progress >= 0 && (
        <div className="w-full shrink-0 relative z-10 bg-white border-t border-slate-200 px-6 py-3">
          <div className="flex justify-between items-center mb-1.5 font-mono text-[11px] sm:text-[12px]">
            <div className="text-sky-700 flex items-center gap-2">
              <span>▶</span>
              <span className="capitalize">{progressText}</span>
            </div>
            <div className="text-sky-700 bg-sky-50 font-bold px-2 py-0.5 rounded tabular-nums">
              {progress}%
            </div>
          </div>
          <div className="h-1.5 w-full bg-slate-100 border border-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-700 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
});
