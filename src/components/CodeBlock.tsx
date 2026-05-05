import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  filename?: string;
  value: string;
  onPreview?: () => void;
}

export function CodeBlock({ language, filename, value, onPreview }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    // If they asked for a PDF or docx, we just download the text content with the right extension
    // Although we can't easily generate a real PDF client-side without massive libraries, 
    // we can save it as an HTML/Markdown file or standard text file.
    let finalExtension = filename ? filename.split('.').pop()?.toLowerCase() || 'txt' : (language.toLowerCase() || 'txt');
    if (finalExtension === 'excel') finalExtension = 'csv';
    let finalFileName = filename || `download.${finalExtension}`;
    let mimeType = 'text/plain';
    let fileContent = value;

    if (finalExtension === 'html') mimeType = 'text/html';
    else if (finalExtension === 'json') mimeType = 'application/json';
    else if (finalExtension === 'md' || finalExtension === 'markdown') mimeType = 'text/markdown';
    else if (finalExtension === 'csv' || finalExtension === 'xlsx' || finalExtension === 'xls') {
      if (finalExtension === 'xlsx' || finalExtension === 'xls') {
        finalFileName = finalFileName.replace(/\.xlsx?$/i, '.csv');
        // If the original name didn't have an extension, force it to .csv
        if (!finalFileName.endsWith('.csv')) {
          finalFileName += '.csv';
        }
      }
      mimeType = 'text/csv;charset=utf-8';
      
      // If the content looks like TSV (has tabs but first line lacks commas), format as proper CSV
      if (fileContent.includes('\t') && !fileContent.split('\n')[0].includes(',')) {
        const lines = fileContent.split('\n');
        fileContent = lines.map(line => {
          return line.split('\t').map(cell => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
              return '"' + cell.replace(/"/g, '""') + '"';
            }
            return cell;
          }).join(',');
        }).join('\n');
      }
      
      // Add UTF-8 BOM so Excel opens it with proper encoding
      fileContent = '\uFEFF' + fileContent;
    } else if (finalExtension === 'pdf' || finalExtension === 'docx' || finalExtension === 'doc') {
      finalFileName = finalFileName.replace(/\.(pdf|docx?)$/i, '.txt');
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const displayTitle = filename || language || 'text';

  return (
    <div className="rounded-lg overflow-hidden border border-[#26282E] my-4 shadow-xl bg-[#1E1F22]">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#2B2D31] via-[#2f3136] to-[#2B2D31] border-b border-[#111214]">
        <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[#8b929d]">
          <span>{displayTitle}</span>
        </div>
        <div className="flex items-center gap-3">
          {onPreview && (
            <button
              onClick={onPreview}
              className="flex items-center gap-1.5 text-xs text-[#949BA4] hover:text-[#DBDEE1] transition-colors"
              title="Preview File"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>Preview</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-[#949BA4] hover:text-[#DBDEE1] transition-colors"
            title="Copy Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-xs text-[#949BA4] hover:text-[#DBDEE1] transition-colors"
            title={`Download as ${displayTitle}`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>
      <div className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-[#DBDEE1]">
        <pre className="!m-0 !p-0 !bg-transparent whitespace-pre">
          {value}
        </pre>
      </div>
    </div>
  );
}
