import type {DeductionEntry} from '../components/DeductionAmounts';
export function fillUnconfigured(entries:DeductionEntry[],source:DeductionEntry,columns:string[],keys?:Set<string>):DeductionEntry[]{
  return entries.map(entry=>{
    if(entry.key===source.key||entry.station.city_id!==source.station.city_id||entry.station.platform!==source.station.platform||entry.configured||entry.edited||(keys&&!keys.has(entry.key)))return entry;
    return {...entry,edited:true,zero_confirmed:source.zero_confirmed,row:{...entry.row,...Object.fromEntries(columns.map(c=>[c,source.row[c]]))}};
  });
}
