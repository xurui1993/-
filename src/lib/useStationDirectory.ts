import {useEffect,useState} from 'react';
import {getWorkspaceId} from '../utils';
export type DirectoryPlatform='fengshen'|'xiaoxiang'|'lanorange';
export interface DirectoryCity {id:string;name:string;station_count:number|null;status:string}
export interface DirectoryStation {id:string;name:string;city:string;city_id:string;platform:string}
export interface StationDirectory {platform:string;session_version:string;status:string;message:string;fetched_at:string;cities:DirectoryCity[];stations:DirectoryStation[]}
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const defaultFetch:Fetcher=(url,init)=>{const headers=new Headers(init?.headers);headers.set('x-workspace-id',encodeURIComponent(getWorkspaceId()));return fetch(url,{...init,headers});};
export function useStationDirectory(platform:DirectoryPlatform,fetcher:Fetcher=defaultFetch,enabled=true){
  const [data,setData]=useState<StationDirectory|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    let disposed=false,timer:ReturnType<typeof setTimeout>;let generation=0;
    const controller=new AbortController();
    async function read(refresh=false){
      const request=++generation;
      try{
        const response=await fetcher(`/api/workbench/station-directory?platform=${platform}${refresh?'&refresh=1':''}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'目录暂不可用');
        if(!disposed&&request===generation){setData(value);setError('');}
      }catch(problem){if(!disposed&&request===generation)setError(problem instanceof Error?problem.message:'站点目录暂不可用');}
      if(!disposed&&request===generation)timer=setTimeout(()=>void read(),2000);
    }
    const changed=(event:Event)=>{const source=(event as CustomEvent).detail?.source;if(source&&source!==platform)return;clearTimeout(timer);setData(null);void read(true);};
    window.addEventListener('workbench:platform-session-changed',changed);setData(null);void read(reload>0);
    return()=>{disposed=true;controller.abort();clearTimeout(timer);window.removeEventListener('workbench:platform-session-changed',changed);};
  },[platform,reload,enabled]);
  return {data,error,refresh:()=>setReload(value=>value+1)};
}
export function stationCountText(directory:StationDirectory|null,city:string){
  const matching=directory?.cities.filter(value=>value.id===city||value.name===city)||[];
  if(matching.length!==1||matching[0].station_count===null)return '待同步';
  return `${matching[0].station_count}站`;
}
