import { datasetGroup } from './downloadCenterLogic';
import { inferTaskKind } from './taskCatalog';

export const DOWNLOAD_PLATFORMS = [
  { id: 'fengshen', label: '风神', navLabel: '风神数据', iconKey: 'compass' },
  { id: 'lanorange', label: '蓝橙', navLabel: '蓝橙数据', iconKey: 'layers' },
  { id: 'baize', label: '商翼', navLabel: '白泽商翼', iconKey: 'users-round' },
  { id: 'xiaoxiang', label: '灯塔', navLabel: '小象灯塔', iconKey: 'radar' },
] as const;
export type DownloadPlatform = typeof DOWNLOAD_PLATFORMS[number]['id'];
export type DownloadPlatformIconKey = typeof DOWNLOAD_PLATFORMS[number]['iconKey'];
export type RecordModule = DownloadPlatform | 'generate';
export function moduleAcceptsDataset(id:string, platform:DownloadPlatform) {
  return inferTaskKind([id])==='download' && datasetGroup(id)===platform;
}
export function matchesRecordModule(record:{kind?:string;datasets:string[]},module?:RecordModule) {
  if(!module)return true;
  const kind=record.kind || inferTaskKind(record.datasets);
  if(module==='generate')return kind==='generate';
  // Historic mixed-platform downloads remain visible in each relevant module.
  return kind==='download' && record.datasets.some(id=>moduleAcceptsDataset(id,module));
}
