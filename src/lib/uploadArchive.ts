/** STORE ZIP assembled from file-backed Blob parts, not a full in-memory buffer.
 * CRC reads at most 1 MiB at a time. ZIP64 covers offsets/sizes above 4 GiB.
 */
export interface UploadFile {file: File; relativePath: string}
const MAX32 = 0xffffffff;
const CHUNK = 1024 * 1024;
const table = Uint32Array.from({length: 256}, (_, value) => {
  for (let n = 0; n < 8; n++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function bytes(length: number) { const value = new Uint8Array(length); return {value, view: new DataView(value.buffer)}; }
function extra64(values: number[]) {
  if (!values.length) return new Uint8Array();
  const {value, view} = bytes(4 + 8 * values.length); view.setUint16(0, 1, true); view.setUint16(2, values.length * 8, true);
  values.forEach((v, i) => view.setBigUint64(4 + i * 8, BigInt(v), true)); return value;
}
export async function createUploadArchive(files: UploadFile[], progress: (percent: number) => void = () => {}): Promise<Blob> {
  if (!files.length || files.length > 2000) throw new Error('每批请选择 1–2000 个文件');
  const total = files.reduce((sum, item) => sum + item.file.size, 0);
  if (total > 10 * 1024 ** 3) throw new Error('单批资料大小超过 10GiB 限制');
  const names = new Set<string>();
  for (const {file, relativePath} of files) {
    const name = relativePath.replace(/\\/g, '/');
    const segments = name.split('/');
    if (segments.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f<>:"|?*]/.test(part) || /[ .]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part))) throw new Error('文件路径无效：' + relativePath);
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('存在重复文件路径：' + relativePath);
    names.add(key);
    if (file.size > 4 * 1024 ** 3) throw new Error(`文件大小超限：${relativePath}（单文件最多4GiB）`);
  }
  const parts: BlobPart[] = [], central: BlobPart[] = [];
  let offset = 0, processed = 0, directorySize = 0;
  let lastProgress = -1;
  const report = (value: number) => { if (value !== lastProgress) { lastProgress = value; progress(value); } };
  for (const {file, relativePath} of files) {
    const name = new TextEncoder().encode(relativePath.replace(/\\/g, '/'));
    if (!name.length || name.length > 65535) throw new Error('文件路径长度不支持：' + relativePath);
    const modified = new Date(Math.max(new Date(1980, 0, 1).getTime(), Math.min(file.lastModified || Date.now(), new Date(2107, 11, 31).getTime())));
    const dosTime = (modified.getHours() << 11) | (modified.getMinutes() << 5) | Math.floor(modified.getSeconds() / 2);
    const dosDate = ((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();
    let crc = MAX32;
    for (let start = 0; start < file.size; start += CHUNK) {
      const chunk = new Uint8Array(await file.slice(start, start + CHUNK).arrayBuffer());
      for (let index = 0; index < chunk.length; index++) crc = table[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
      processed += chunk.length; report(Math.round(processed / Math.max(1, total) * 100));
    }
    crc = (crc ^ MAX32) >>> 0;
    const largeSize = file.size >= MAX32, largeOffset = offset >= MAX32;
    const localExtra = extra64(largeSize ? [file.size, file.size] : []);
    const local = bytes(30); local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, largeSize ? 45 : 20, true); local.view.setUint16(6, 0x800, true);
    local.view.setUint16(10, dosTime, true); local.view.setUint16(12, dosDate, true);
    local.view.setUint32(14, crc, true); local.view.setUint32(18, largeSize ? MAX32 : file.size, true); local.view.setUint32(22, largeSize ? MAX32 : file.size, true);
    local.view.setUint16(26, name.length, true); local.view.setUint16(28, localExtra.length, true);
    parts.push(local.value, name, localExtra, file);
    const centralExtra = extra64([...(largeSize ? [file.size, file.size] : []), ...(largeOffset ? [offset] : [])]);
    const record = bytes(46); record.view.setUint32(0, 0x02014b50, true);
    record.view.setUint16(4, 45, true); record.view.setUint16(6, largeSize || largeOffset ? 45 : 20, true); record.view.setUint16(8, 0x800, true);
    record.view.setUint16(12, dosTime, true); record.view.setUint16(14, dosDate, true);
    record.view.setUint32(16, crc, true); record.view.setUint32(20, largeSize ? MAX32 : file.size, true); record.view.setUint32(24, largeSize ? MAX32 : file.size, true);
    record.view.setUint16(28, name.length, true); record.view.setUint16(30, centralExtra.length, true); record.view.setUint32(42, largeOffset ? MAX32 : offset, true);
    central.push(record.value, name, centralExtra); directorySize += 46 + name.length + centralExtra.length;
    offset += 30 + name.length + localExtra.length + file.size;
  }
  parts.push(...central);
  const zip64 = offset >= MAX32 || directorySize >= MAX32;
  if (zip64) {
    const end64 = bytes(56); end64.view.setUint32(0, 0x06064b50, true); end64.view.setBigUint64(4, 44n, true); end64.view.setUint16(12, 45, true); end64.view.setUint16(14, 45, true);
    end64.view.setBigUint64(24, BigInt(files.length), true); end64.view.setBigUint64(32, BigInt(files.length), true); end64.view.setBigUint64(40, BigInt(directorySize), true); end64.view.setBigUint64(48, BigInt(offset), true);
    const locator = bytes(20); locator.view.setUint32(0, 0x07064b50, true); locator.view.setBigUint64(8, BigInt(offset + directorySize), true); locator.view.setUint32(16, 1, true);
    parts.push(end64.value, locator.value);
  }
  const end = bytes(22); end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, zip64 ? MAX32 : directorySize, true); end.view.setUint32(16, zip64 ? MAX32 : offset, true); parts.push(end.value);
  report(100); return new Blob(parts, {type: 'application/zip'});
}
