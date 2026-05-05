import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Loader2 } from 'lucide-react';

export function CsvPreview({ content, url }: { content?: string, url?: string }) {
  const [csvContent, setCsvContent] = useState<string | null>(content || null);
  const [isLoading, setIsLoading] = useState(!!url && !content);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (content) {
      setCsvContent(content);
      setIsLoading(false);
      return;
    }
    
    if (url) {
      setIsLoading(true);
      setError(null);
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error("Failed to fetch file");
          return res.arrayBuffer();
        })
        .then(buffer => {
           if (url.toLowerCase().match(/\.(csv|txt)$/)) {
              const decoder = new TextDecoder('utf-8');
              setCsvContent(decoder.decode(buffer));
           } else {
              const workbook = XLSX.read(buffer, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const csv = XLSX.utils.sheet_to_csv(worksheet);
              setCsvContent(csv);
           }
           setIsLoading(false);
        })
        .catch(err => {
           console.error(err);
           setError(err.message);
           setIsLoading(false);
        });
    }
  }, [url, content]);

  if (isLoading) {
    return (
      <div className="flex w-full h-full items-center justify-center text-[#949BA4] bg-[#2B2D31]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }
  
  if (error) {
    return <div className="text-red-400 p-4 text-center bg-[#2B2D31] h-full flex items-center justify-center">{error}</div>;
  }

  if (!csvContent) {
    return <div className="text-[#949BA4] p-4 text-center bg-[#2B2D31] h-full flex items-center justify-center">No data</div>;
  }

  // Strip out dirty IDs 
  const cleanedContent = csvContent
    .replace(/dtmi:com:[a-zA-Z0-9_\-]+:/g, '')
    .replace(/;\d+(\b|,|")/g, '$1');

  let separator = cleanedContent.includes('\t') && !cleanedContent.split('\n')[0].includes(',') ? '\t' : ',';
  
  const parseCSVRow = (row: string) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        if (row[i] === '"') {
            inQuotes = !inQuotes;
        } else if (row[i] === separator && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += row[i];
        }
    }
    result.push(current);
    return result;
  };

  const rawRows = cleanedContent.split(/\r?\n/).map(parseCSVRow);
  
  // Split into multiple tables if there are blank rows dividing them
  const tables: string[][][] = [];
  let currentTable: string[][] = [];

  for (const row of rawRows) {
    const isEmpty = row.every(cell => cell.trim() === '');
    if (isEmpty) {
      if (currentTable.length > 0) {
        tables.push(currentTable);
        currentTable = [];
      }
    } else {
      currentTable.push(row);
    }
  }
  if (currentTable.length > 0) {
    tables.push(currentTable);
  }

  if (tables.length === 0) return <div className="text-[#949BA4] p-4 text-center">No data</div>;

  return (
    <div className="overflow-auto w-full h-full custom-scrollbar p-6 flex flex-col gap-8 bg-[#2B2D31]">
      {tables.map((rows, tableIdx) => {
        const maxCols = Math.max(...rows.map(r => r.length));
        return (
          <div key={tableIdx} className="overflow-x-auto w-full rounded-md border border-[#1E1F22] shadow-sm">
            <table className="w-full text-sm text-left border-collapse bg-[#2B2D31]">
              {rows.length > 0 && (
                <thead className="bg-[#1E1F22] text-[#DBDEE1]">
                  <tr>
                    {Array.from({ length: maxCols }).map((_, i) => (
                      <th key={i} className="px-4 py-2 border-b border-r border-[#1E1F22] last:border-r-0 font-semibold truncate max-w-[200px]">
                        {rows[0][i] || ''}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody className="text-[#949BA4]">
                {rows.slice(1).map((row, i) => (
                  <tr key={i} className="hover:bg-[#313338]/50 transition-colors border-b border-[#1E1F22] last:border-b-0">
                    {Array.from({ length: maxCols }).map((_, j) => (
                      <td key={j} className="px-4 py-2 border-r border-[#1E1F22] last:border-r-0 whitespace-nowrap max-w-[300px] truncate" title={row[j] || ''}>
                        {row[j] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 1 && (
                  <tr>
                    <td colSpan={maxCols} className="px-4 py-2 text-center italic text-[#72767D] bg-[#2B2D31]">
                      No data rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
