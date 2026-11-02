import {test} from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {createUploadArchive} from '../src/lib/uploadArchive.ts';

test('upload archive preserves UTF8 paths, binary contents and CRC with bounded reads', async () => {
  class BoundedFile extends File {
    slices=0;
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('The whole file must never be read'); }
    override slice(start=0,end=this.size,type?:string) { assert(end-start<=1024*1024);this.slices++;return super.slice(start,end,type); }
  }
  const data=Uint8Array.from({length:2*1024*1024+31},(_,i)=>i%251);
  const file=new BoundedFile([data],'配送费.csv');const progress:number[]=[];
  const blob=await createUploadArchive([{file,relativePath:'深圳/配送费.csv'},{file:new File(['template'],'template.xlsx'),relativePath:'深圳/template.xlsx'}],p=>progress.push(p));
  const archive=new AdmZip(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(archive.getEntries().map(e=>e.entryName),['深圳/配送费.csv','深圳/template.xlsx']);
  assert.deepEqual(archive.readFile('深圳/配送费.csv'),Buffer.from(data));assert.equal(archive.readAsText('深圳/template.xlsx'),'template');
  assert.equal(file.slices,3);assert.equal(progress.at(-1),100);assert(progress.every((v,i)=>i===0||v>=progress[i-1]));
});

test('empty files create readable ZIP entries and oversized batches fail before reading', async()=>{
  const empty=await createUploadArchive([{file:new File([],'empty.csv'),relativePath:'empty.csv'}]);
  assert.equal(new AdmZip(Buffer.from(await empty.arrayBuffer())).readFile('empty.csv')?.length,0);
  class HugeFile extends File {override get size(){return 4*1024**3+1;}}
  await assert.rejects(createUploadArchive([{file:new HugeFile([],'huge.csv'),relativePath:'huge.csv'}]),/单文件最多4GiB/);
  await assert.rejects(createUploadArchive([{file:new File([],'a.csv'),relativePath:'A.csv'},{file:new File([],'b.csv'),relativePath:'a.csv'}]),/重复文件路径/);
  await assert.rejects(createUploadArchive([{file:new File([],'a.csv'),relativePath:'../escape.csv'}]),/文件路径无效/);
});
