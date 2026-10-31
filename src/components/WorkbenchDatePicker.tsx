import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import {
  buildCalendarMonthGrid,
  buildCalendarYearMonths,
  computeDateRangeSpanDays,
  formatDateTriggerMeta,
} from '../lib/workbench';

export interface WorkbenchDatePickerProps {
  value: string;
  onChange: (nextValue: string) => void;
  mode?: 'date' | 'month';
  min?: string;
  max?: string;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  rangeRole?: 'start' | 'end';
  rangeStart?: string;
  rangeEnd?: string;
  today?: string;
  allowClear?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonthUTC(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

function getShanghaiTodayStr(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const pick = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function WorkbenchDatePicker({
  value,
  onChange,
  mode = 'date',
  min,
  max,
  disabled = false,
  ariaLabel,
  placeholder,
  rangeRole,
  rangeStart,
  rangeEnd,
  today: todayProp,
  allowClear = false,
  align = 'left',
  className = '',
}: WorkbenchDatePickerProps) {
  const todayDate = useMemo(() => todayProp || getShanghaiTodayStr(), [todayProp]);
  const todayMonth = todayDate.slice(0, 7);

  const [open, setOpen] = useState(false);
  const [pickingMonthView, setPickingMonthView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const parseInitialYearMonth = () => {
    const source = (value || rangeStart || max || todayDate || '2026-01-01').trim();
    const match = /^(\d{4})-(\d{2})/.exec(source);
    if (match) {
      return { year: Number(match[1]), month: Number(match[2]) };
    }
    return { year: 2026, month: 1 };
  };

  const [viewYear, setViewYear] = useState(() => parseInitialYearMonth().year);
  const [viewMonth, setViewMonth] = useState(() => parseInitialYearMonth().month);

  useEffect(() => {
    if (open) {
      const parsed = parseInitialYearMonth();
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
      setPickingMonthView(false);
    }
  }, [open, value]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const shiftMonth = (deltaMonths: number) => {
    const d = new Date(Date.UTC(viewYear, viewMonth - 1 + deltaMonths, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth() + 1);
  };

  const shiftYear = (deltaYears: number) => {
    setViewYear(prev => prev + deltaYears);
  };

  const dayCells = useMemo(
    () =>
      buildCalendarMonthGrid(viewYear, viewMonth, {
        selectedDate: value,
        todayDate,
        rangeStart,
        rangeEnd,
        minDate: min,
        maxDate: max,
      }),
    [viewYear, viewMonth, value, todayDate, rangeStart, rangeEnd, min, max],
  );

  const monthCells = useMemo(
    () =>
      buildCalendarYearMonths(viewYear, {
        selectedMonth: mode === 'month' ? value.slice(0, 7) : `${viewYear}-${pad2(viewMonth)}`,
        todayMonth,
        rangeStartMonth: rangeStart ? rangeStart.slice(0, 7) : undefined,
        rangeEndMonth: rangeEnd ? rangeEnd.slice(0, 7) : undefined,
        minMonth: min ? min.slice(0, 7) : undefined,
        maxMonth: max ? max.slice(0, 7) : undefined,
      }),
    [viewYear, viewMonth, mode, value, todayMonth, rangeStart, rangeEnd, min, max],
  );

  const triggerMeta = useMemo(
    () => formatDateTriggerMeta(value, mode, placeholder),
    [value, mode, placeholder],
  );

  const spanDays = useMemo(
    () => (mode === 'date' ? computeDateRangeSpanDays(rangeStart, rangeEnd) : null),
    [mode, rangeStart, rangeEnd],
  );

  const clampDate = (candidate: string): string => {
    let res = candidate;
    if (min && res < min) res = min;
    if (max && res > max) res = max;
    return res;
  };

  const handleSelectDay = (cell: { dateStr: string; isDisabled: boolean }) => {
    if (cell.isDisabled || disabled) return;
    onChange(cell.dateStr);
    setOpen(false);
  };

  const handleSelectMonth = (cell: { monthStr: string; month: number; isDisabled: boolean }) => {
    if (cell.isDisabled || disabled) return;
    if (mode === 'month') {
      onChange(cell.monthStr);
      setOpen(false);
    } else {
      setViewMonth(cell.month);
      setPickingMonthView(false);
    }
  };

  const handleQuickToday = () => {
    if (disabled) return;
    if (mode === 'month') {
      const target = max && todayMonth > max.slice(0, 7) ? max.slice(0, 7) : todayMonth;
      onChange(target);
      setOpen(false);
      return;
    }
    const target = clampDate(todayDate);
    onChange(target);
    setOpen(false);
  };

  const handleQuickMonthEdge = (edge: 'first' | 'last') => {
    if (disabled) return;
    const totalDays = daysInMonthUTC(viewYear, viewMonth);
    const raw =
      edge === 'first'
        ? `${viewYear}-${pad2(viewMonth)}-01`
        : `${viewYear}-${pad2(viewMonth)}-${pad2(totalDays)}`;
    const clamped = clampDate(raw);
    if ((min && clamped < min) || (max && clamped > max)) return;
    onChange(clamped);
    setOpen(false);
  };

  const quickTodayLabel =
    mode === 'month'
      ? '本月'
      : max && max < todayDate
        ? '最新可选'
        : '今天';

  const showMonthGrid = mode === 'month' || pickingMonthView;

  return (
    <div
      ref={rootRef}
      className={`wb-datepicker ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={`wb-datepicker-trigger ${open ? 'is-open' : ''} ${triggerMeta.isEmpty ? 'is-empty' : ''}`}
      >
        <span className="wb-dp-trigger-icon" aria-hidden="true">
          <CalendarIcon size={14} />
        </span>
        <span className="wb-dp-trigger-value">{triggerMeta.primaryText}</span>
        {triggerMeta.badgeText && (
          <span className="wb-dp-trigger-badge">{triggerMeta.badgeText}</span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`wb-dp-trigger-chevron ${open ? 'is-rotated' : ''}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${ariaLabel || '日期'}选择面板`}
          className={`wb-datepicker-popover ${align === 'right' ? 'is-align-right' : ''}`}
        >
          {/* Header Bar */}
          <div className="wb-dp-header">
            <div className="wb-dp-nav-group">
              <button
                type="button"
                aria-label="上一年"
                onClick={() => shiftYear(-1)}
                className="wb-dp-nav-btn"
              >
                <ChevronsLeft size={14} />
              </button>
              {!showMonthGrid && (
                <button
                  type="button"
                  aria-label="上一月"
                  onClick={() => shiftMonth(-1)}
                  className="wb-dp-nav-btn"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (mode === 'date') setPickingMonthView(prev => !prev);
              }}
              className={`wb-dp-header-title ${mode === 'date' ? 'is-interactive' : ''}`}
              title={mode === 'date' ? (pickingMonthView ? '返回日期视图' : '点击快速切换月份') : undefined}
            >
              <span>
                {viewYear}年 {!showMonthGrid && `${pad2(viewMonth)}月`}
              </span>
              {mode === 'date' && (
                <ChevronDown
                  size={13}
                  className={`wb-dp-title-chevron ${pickingMonthView ? 'is-rotated' : ''}`}
                />
              )}
            </button>

            <div className="wb-dp-nav-group">
              {!showMonthGrid && (
                <button
                  type="button"
                  aria-label="下一月"
                  onClick={() => shiftMonth(1)}
                  className="wb-dp-nav-btn"
                >
                  <ChevronRight size={14} />
                </button>
              )}
              <button
                type="button"
                aria-label="下一年"
                onClick={() => shiftYear(1)}
                className="wb-dp-nav-btn"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          </div>

          {/* Range Context Banner when part of a start/end pair */}
          {mode === 'date' && (rangeStart || rangeEnd) && (
            <div className="wb-dp-range-banner">
              <div className="wb-dp-range-info">
                <span className={`wb-dp-role-pill ${rangeRole === 'end' ? 'is-end' : 'is-start'}`}>
                  {rangeRole === 'end' ? '结束' : '开始'}
                </span>
                <span className="wb-dp-range-text">
                  {rangeStart || '—'} <span className="wb-dp-range-arrow">→</span> {rangeEnd || '—'}
                </span>
              </div>
              {spanDays !== null && (
                <span className="wb-dp-span-badge">共 {spanDays} 天</span>
              )}
            </div>
          )}

          {showMonthGrid ? (
            <div className="wb-dp-month-grid" role="grid" aria-label="月份选择网格">
              {monthCells.map(cell => (
                <button
                  key={cell.monthStr}
                  type="button"
                  disabled={cell.isDisabled}
                  aria-selected={cell.isSelected}
                  onClick={() => handleSelectMonth(cell)}
                  className={[
                    'wb-dp-month-cell',
                    cell.isSelected ? 'is-selected' : '',
                    !cell.isSelected && (cell.isRangeStart || cell.isRangeEnd) ? 'is-range-edge' : '',
                    cell.isInRange && !cell.isSelected ? 'is-in-range' : '',
                    cell.isCurrentMonth ? 'is-today' : '',
                    cell.isDisabled ? 'is-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>{cell.label}</span>
                  {cell.isCurrentMonth && <i className="wb-dp-today-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Weekday Header */}
              <div className="wb-dp-weekdays" aria-hidden="true">
                {WEEKDAYS.map((dayLabel, idx) => (
                  <span
                    key={dayLabel}
                    className={`wb-dp-weekday ${idx >= 5 ? 'is-weekend' : ''}`}
                  >
                    {dayLabel}
                  </span>
                ))}
              </div>

              {/* 42-Cell Day Grid */}
              <div className="wb-dp-grid" role="grid" aria-label="日期选择网格">
                {dayCells.map(cell => (
                  <button
                    key={cell.dateStr}
                    type="button"
                    disabled={cell.isDisabled}
                    aria-label={`${cell.year}年${cell.month}月${cell.day}日`}
                    aria-selected={cell.isSelected}
                    onClick={() => handleSelectDay(cell)}
                    className={[
                      'wb-dp-day',
                      cell.inCurrentMonth ? 'is-current-month' : 'is-outside-month',
                      cell.isWeekend && cell.inCurrentMonth ? 'is-weekend' : '',
                      cell.isToday ? 'is-today' : '',
                      cell.isSelected ? 'is-selected' : '',
                      !cell.isSelected && (cell.isRangeStart || cell.isRangeEnd) ? 'is-range-edge' : '',
                      cell.isInRange && !cell.isSelected ? 'is-in-range' : '',
                      cell.isDisabled ? 'is-disabled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="wb-dp-day-num">{cell.day}</span>
                    {cell.isToday && <i className="wb-dp-today-dot" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Footer Quick Actions */}
          <div className="wb-dp-footer">
            <div className="wb-dp-quick-actions">
              <button
                type="button"
                onClick={handleQuickToday}
                className="wb-dp-quick-btn is-accent"
              >
                {quickTodayLabel}
              </button>
              {mode === 'date' && !pickingMonthView && (
                <>
                  <button
                    type="button"
                    onClick={() => handleQuickMonthEdge('first')}
                    className="wb-dp-quick-btn"
                  >
                    月初
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickMonthEdge('last')}
                    className="wb-dp-quick-btn"
                  >
                    月末
                  </button>
                </>
              )}
              {allowClear && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="wb-dp-quick-btn is-muted"
                >
                  清除
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="wb-dp-confirm-btn"
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
