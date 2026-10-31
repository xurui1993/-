import type { DeductionRow } from './workbench';

export type StationPlatform = 'fengshen' | 'xiaoxiang';
export interface DeductionStation {
  id: string;
  name: string;
  city: string;
  city_id: string;
  platform: StationPlatform;
}
export interface StationCatalog {
  platform: StationPlatform;
  cities: {id:string;name:string}[];
  stations: DeductionStation[];
  fetched_at: string | number | null;
  cached: boolean;
  scope_note: string;
  warnings: string[];
}
export type StationFetch = (url:string, init?:RequestInit)=>Promise<Response>;
export interface StationCityOption {value:string;name:string;label:string}

const text = (value:unknown): value is string => typeof value === 'string';
export function stationIdentity(station:DeductionStation) {
  return JSON.stringify([station.platform,station.city_id||station.city,station.id]);
}

/** The API accepts a city ID or a legacy city name. Never collapse same-name IDs. */
export function stationCityOptions(cities:{id:string;name:string}[]):StationCityOption[]{
  const nameCounts=new Map<string,number>();
  for(const city of cities)nameCounts.set(city.name,(nameCounts.get(city.name)||0)+1);
  return cities.map(city=>({value:city.id||city.name,name:city.name,
    label:(nameCounts.get(city.name)||0)>1?`${city.name} · 编号 ${city.id||'未提供'}`:city.name}));
}

export function stationCitySelection(value:string,cities:{id:string;name:string}[]):string{
  if(!value||cities.some(city=>city.id&&city.id===value))return value;
  const matching=cities.filter(city=>city.name===value);
  if(matching.length>1)return '';
  return matching.length===1?(matching[0].id||matching[0].name):'';
}

/** Platform IDs stay strings. Do not reconstruct already-rounded numeric IDs. */
export function validateStationCatalog(value:unknown, platform:StationPlatform): StationCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('站点目录返回格式无效，请重新获取。');
  const data=value as Record<string,unknown>;
  if(data.platform!==platform||!Array.isArray(data.cities)||!Array.isArray(data.stations)) throw Error('站点目录与当前平台不一致，请重新获取。');
  const cities:{id:string;name:string}[]=data.cities.map((raw:unknown)=>{
    const city=raw as Record<string,unknown>;
    if(!city||!text(city.id)||!text(city.name)||!city.name.trim())throw Error('后台城市目录不完整，请重新获取。');
    return {id:city.id,name:city.name};
  });
  const cityIds=new Map<string,string>();
  for(const city of cities){
    if(city.id&&cityIds.has(city.id)&&cityIds.get(city.id)!==city.name)throw Error('同一城市编号返回了不同名称，请重新获取目录。');
    if(city.id)cityIds.set(city.id,city.name);
  }
  const seen=new Map<string,DeductionStation>();
  for(const raw of data.stations){
    const item=raw as Record<string,unknown>;
    if(!item||item.platform!==platform||!text(item.id)||!item.id.trim()||!text(item.name)||!item.name.trim()||!text(item.city)||!text(item.city_id))throw Error('后台站点编号或归属不完整，未自动填入配置。');
    const station:DeductionStation={id:item.id,name:item.name,city:item.city,city_id:item.city_id,platform};
    const key=stationIdentity(station), previous=seen.get(key);
    if(previous&&(previous.name!==station.name||previous.city!==station.city))throw Error('同一站点编号返回了不同名称或城市，请核对平台资料。');
    seen.set(key,station);
  }
  const uniqueCities=[...new Map(cities.map(city=>[JSON.stringify([city.id,city.name]),city])).values()];
  return {platform,cities:uniqueCities,stations:[...seen.values()],
    fetched_at:text(data.fetched_at)||typeof data.fetched_at==='number'?data.fetched_at:null,
    cached:data.cached===true,scope_note:text(data.scope_note)?data.scope_note:'以当前账号可查询范围为准。',
    warnings:Array.isArray(data.warnings)?data.warnings.filter(text):[]};
}

export function stationCatalogUrl(platform:StationPlatform, city:string, refresh=false){
  const params=new URLSearchParams({platform,city:city.trim()});
  if(refresh)params.set('refresh','1');
  return '/api/workbench/deduction-stations?'+params.toString();
}

export async function requestStationCatalog(fetcher:StationFetch, platform:StationPlatform, city:string, refresh=false, signal?:AbortSignal){
  const response=await fetcher(stationCatalogUrl(platform,city,refresh),{signal});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const detail=data?.detail;
    throw Error(typeof detail==='string'?detail:typeof detail?.message==='string'?detail.message:'站点获取失败，请检查平台登录和查询范围。');
  }
  return validateStationCatalog(data,platform);
}

export function filterStations(stations:DeductionStation[], search:string){
  const needle=search.trim().toLocaleLowerCase();
  return stations.filter(station=>`${station.name} ${station.id} ${station.city}`.toLocaleLowerCase().includes(needle));
}

/** Update only the existing station metadata; financial values remain untouched. */
export function selectDeductionStation(rows:DeductionRow[], target:number|null, station:DeductionStation, defaults:DeductionRow={}): DeductionRow[]{
  if(!station.city.trim()||!station.name.trim()||!station.id.trim())throw Error('该站点缺少城市或编号，暂不能自动填入，请手动维护。');
  if(target!==null&&(!Number.isInteger(target)||target<0||target>=rows.length))throw Error('配置行已变化，请重新选择站点。');
  const duplicateName=rows.findIndex((row,index)=>index!==target&&String(row['团队名称']??'').trim()===station.name.trim());
  if(duplicateName>=0)throw Error('已有同名站点配置，当前扣款按名称匹配，请维护原记录或核实名称。');
  // Match the current payroll lookup without rewriting the saved platform name.
  const payrollName=(name:string)=>name.trim().replace(/_?新专送/g,'');
  const equivalentName=rows.findIndex((row,index)=>index!==target&&payrollName(String(row['团队名称']??''))===payrollName(station.name));
  if(equivalentName>=0)throw Error('已有核算等价站点名称：当前扣款匹配会移除“新专送”字样，请维护原记录或核实名称。');
  const duplicateId=rows.findIndex((row,index)=>index!==target&&String(row['城市']??'').trim()===station.city.trim()&&String(row['团队ID']??'').trim()===station.id.trim());
  if(duplicateId>=0)throw Error('该城市已有相同站点编号的配置，请维护原记录，避免重复规则。');
  const base=target===null?defaults:rows[target];
  const selected={...base,城市:station.city,团队名称:station.name,团队ID:station.id};
  return target===null?[...rows,selected]:rows.map((row,index)=>index===target?selected:row);
}
