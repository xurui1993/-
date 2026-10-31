export function stationFilterChoices(stations:{id:string;name:string;city:string}[],city:string){
  const rows=stations.filter(s=>!city||s.city===city);
  return rows.map(s=>({...s,ambiguous:rows.filter(other=>other.name===s.name).length>1,
    label:`${s.name} · ${s.city} · 编号 ${s.id}`}));
}
