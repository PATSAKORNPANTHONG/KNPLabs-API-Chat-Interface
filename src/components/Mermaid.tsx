import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, parseError] = useState<string | null>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark', // or match your theme (like 'base', 'forest', 'dark', 'neutral')
      securityLevel: 'loose',
      fontFamily: 'Inter, sans-serif'
    });

    let isMounted = true;

    const renderChart = async () => {
      try {
        parseError(null);
        // Avoid duplicate ID collision and avoid dashes
        const id = `mermaid_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        // Clean the chart slightly
        let cleanedChart = chart.trim();
        // Since ReactMarkdown might encode entities depending on parser setup, decode basic ones.
        cleanedChart = cleanedChart.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        const { svg } = await mermaid.render(id, cleanedChart);
        
        if (isMounted) setSvgContent(svg);
      } catch (err: any) {
        console.error('Mermaid rendering error:', err);
        // Sometimes Mermaid also attaches an error to the DOM if we don't catch it quickly enough. 
        if (isMounted) parseError(err?.message || 'Failed to render flowchart.');
      }
    };

    if (chart) {
      renderChart();
    }
    
    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="bg-[#1E1F22] border border-red-500/30 text-[#DBDEE1] p-4 rounded-md overflow-auto font-mono text-xs my-2">
        <div className="text-red-400 mb-2 font-bold select-none">Error parsing diagram</div>
        <pre className="select-text whitespace-pre-wrap">{error}</pre>
        <pre className="select-text whitespace-pre text-[#949BA4] mt-2 border-t border-[#35363C] pt-2">{chart}</pre>
      </div>
    );
  }

  if (!svgContent) {
    return (
      <div className="bg-[#2B2D31] text-[#DBDEE1] p-4 flex items-center justify-center rounded-md min-h-[100px] my-2">
        <span className="animate-pulse">Loading diagram...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container flex justify-center p-4 bg-[#2B2D31] rounded-lg border border-[#1E1F22] overflow-x-auto select-none my-2"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
