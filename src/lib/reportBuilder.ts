export interface ReportDefinition {
  id:string; label:string; scope:'city_month'|'city_range'|'all';
  description:string; sources:string[]; systems?:string[]; station_rule?:'separation'|'none';
}

function validDate(value:string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function reportRange(report:ReportDefinition|undefined,start:string,end:string,today?:string):{start:string;end:string;months:number}|null {
  if (!report || !['all','city_month','city_range'].includes(report.scope)) return null;
  if (report.scope==='all') return {start:'',end:'',months:0};
  if (!validDate(start)||!validDate(end)||start>end) return null;
  if (report.scope==='city_range') return today&&end>today ? null : {start,end,months:0};
  const first=start.slice(0,7),last=end.slice(0,7);
  if (today && last>today.slice(0,7)) return null;
  const [year,month]=last.split('-').map(Number);
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  const [firstYear,firstMonth]=first.split('-').map(Number);
  const months=(year-firstYear)*12+month-firstMonth+1;
  if (months>1200) return null;
  const lastDate=last+'-'+String(lastDay).padStart(2,'0');
  return {start:first+'-01',end:today&&lastDate>today?today:lastDate,months};
}
export function monthBounds(month:string):{start:string;end:string}|null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year,m]=month.split('-').map(Number);
  return {start:month+'-01',end:month+'-'+new Date(Date.UTC(year,m,0)).getUTCDate()};
}
