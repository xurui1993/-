import type {DeductionDraft,DeductionEntry,StationAssociation} from '../components/DeductionAmounts';

export function associationRows(data:DeductionDraft):StationAssociation[]{
  return data.association_rows||[...(data.unresolved||[]),...(data.linked_stations||[]).map(link=>({name:link.name,key:link.key,reason:'本次已确认',status:'resolved',candidates:(data.station_choices||[]).map(e=>e.key)}))];
}
export function recommendedKey(row:StationAssociation){
  const [first,second]=row.recommendations||[];
  return first&&(!second||first.score-second.score>=.12)?first.key:'';
}
export function commonChoices(rows:StationAssociation[],choices:DeductionEntry[]){
  return rows.length?choices.filter(choice=>rows.every(row=>row.candidates?.includes(choice.key))):[];
}
export function keepAssociationDraft(rows:StationAssociation[],previous:Record<string,string>){
  return Object.fromEntries(rows.map(row=>[row.name,row.status==='resolved'?row.key||'':row.candidates?.includes(previous[row.name])?previous[row.name]:recommendedKey(row)]));
}
