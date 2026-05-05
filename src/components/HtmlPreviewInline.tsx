import React, { useState } from 'react';
import { Eye, Code } from 'lucide-react';

interface HtmlPreviewInlineProps {
  content: string;
}

export function HtmlPreviewInline({ content }: HtmlPreviewInlineProps) {
  const [view, setView] = useState<'preview' | 'code'>('preview');

  return (
    <div className="border border-[#1E1F22] rounded-lg overflow-hidden my-4 bg-[#2B2D31] shadow-sm">
      <div className="flex justify-between items-center bg-[#313338] border-b border-[#1E1F22] px-2 h-10">
        <div className="flex h-full">
          <button 
            onClick={() => setView('preview')}
            className={`flex items-center gap-1.5 px-4 h-full border-b-2 transition-colors text-sm font-medium ${view === 'preview' ? 'border-[#5865F2] text-white' : 'border-transparent text-[#949BA4] hover:bg-[#2B2D31] hover:text-[#DBDEE1]'}`}
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button 
            onClick={() => setView('code')}
            className={`flex items-center gap-1.5 px-4 h-full border-b-2 transition-colors text-sm font-medium ${view === 'code' ? 'border-[#5865F2] text-white' : 'border-transparent text-[#949BA4] hover:bg-[#2B2D31] hover:text-[#DBDEE1]'}`}
          >
            <Code className="w-4 h-4" />
            Code
          </button>
        </div>
      </div>
      <div className="relative w-full">
        {view === 'preview' ? (
           <iframe 
             srcDoc={content} 
             className="w-full bg-white h-[400px] border-none block" 
             sandbox="allow-scripts" 
           />
        ) : (
           <div className="overflow-auto bg-[#1E1F22] h-[400px]">
             <pre className="p-4 text-[13px] leading-relaxed font-mono text-[#DBDEE1]">
               {content}
             </pre>
           </div>
        )}
      </div>
    </div>
  );
}
