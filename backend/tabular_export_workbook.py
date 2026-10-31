"""Streaming tabular exports using the existing artifact-authored workbook styles."""
from datetime import date,datetime
from decimal import Decimal
import math
import xml.etree.ElementTree as ET
from price_export_workbook import WorkbookStream,NS,text


def letter(index):
    result='';index+=1
    while index:index,value=divmod(index-1,26);result=chr(65+value)+result
    return result


def value_cell(column,row,value,style):
    ref=f'{letter(column)}{row}';attributes=f'r="{ref}" s="{style}"'
    if value is None:return f'<c {attributes}/>'
    if isinstance(value,datetime):value=value.isoformat(sep=' ')
    if isinstance(value,bool):return f'<c {attributes} t="b"><v>{int(value)}</v></c>'
    if isinstance(value,date):value=value.isoformat()
    if isinstance(value,(int,float,Decimal)):
        if not math.isfinite(value):raise ValueError('来源包含非有限数字')
        return f'<c {attributes}><v>{value}</v></c>'
    return f'<c {attributes} t="inlineStr"><is><t xml:space="preserve">{text(value)}</t></is></c>'


class TabularWorkbook(WorkbookStream):
    def __init__(self,path,headers,name,scope,widths=None,source_url='https://aero-rush.ele.me/team-invite/index.html',**kwargs):
        self.titles=list(headers);self.title=name;self.widths=widths;self.source_url=source_url;super().__init__(path,scope,**kwargs)
        if not self.titles or len(self.titles)>512:raise ValueError('导出字段数量无效')
    def __enter__(self):
        super().__enter__()
        for index,replacements in ((0,{'B1':self.source_url}),(3,dict(zip(('A4','B4','C4','D4','E4','F4','G4','H4','I4'),('商家编号','范围','站点','日期范围','分段','资料','数据行数','处理结果','说明'))))):
            row=ET.fromstring(self.audit_header[index])
            for target in row:
                if target.attrib.get('r') not in replacements:continue
                for child in list(target):target.remove(child)
                target.set('t','inlineStr');ET.SubElement(ET.SubElement(target,'{'+NS+'}is'),'{'+NS+'}t').text=replacements[target.attrib['r']]
            self.audit_header[index]=ET.tostring(row,encoding='unicode')
        return self
    def _open_main(self):
        prototype=ET.fromstring(self.header[0]);header_style=next(iter(prototype)).attrib.get('s','0')
        row='<row r="1" ht="36" customHeight="1">'+''.join(value_cell(i,1,title,header_style) for i,title in enumerate(self.titles))+'</row>'
        widths=self.widths or [38 if '站点' in h or '团队' in h else 26 if '证' in h or 'ID' in h or '时间' in h else 20 for h in self.titles]
        cols='<cols>'+''.join(f'<col min="{i+1}" max="{i+1}" width="{width}" customWidth="1"/>' for i,width in enumerate(widths))+'</cols>'
        self._open(self.title if not self.names else self.title+str(len(self.names)+1),[row],cols,1)
    def _close(self,columns=None,filter_start=1):
        columns=columns or len(self.titles)
        self.stream.write((f'</sheetData><autoFilter ref="A{filter_start}:{letter(columns-1)}{self.sheet_rows}"/></worksheet>').encode('utf-8'));self.stream.close();self.stream=None
    def append(self,values):
        if len(values)!=len(self.titles):raise ValueError('明细列数与表头不一致，未静默截断')
        if self.sheet_rows>=self.row_limit:self._close();self._open_main()
        self.sheet_rows+=1;self.count+=1
        height=min(160,max(36,18*max((str(value).count('\n')+1 for value in values if value is not None),default=1)))
        self.stream.write((f'<row r="{self.sheet_rows}" ht="{height}" customHeight="1">'+''.join(value_cell(i,self.sheet_rows,value,self.styles.get('A','0')) for i,value in enumerate(values))+'</row>').encode('utf-8'))
