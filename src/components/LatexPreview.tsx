import React, { useEffect, useRef } from "react";

interface LatexPreviewProps {
  content: string;
}

export const LatexPreview: React.FC<LatexPreviewProps> = ({ content }) => {
  // Use the latex.js web component in an iframe to avoid Vite bundler issues
  // encodng the content as base64 prevents any HTML parsing issues like '&', '<', '>'
  const hasDocumentClass = content.includes('\\documentclass');
  const finalContent = hasDocumentClass 
    ? content 
    : `\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n${content}\n\\end{document}`;
    
  const encodedContent = btoa(unescape(encodeURIComponent(finalContent)));

  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { 
            margin: 0; 
            padding: 2rem; 
            background: white; 
            font-family: serif; 
          }
          .error-view {
            color: #d32f2f;
            font-family: monospace;
            white-space: pre-wrap;
            padding: 1rem;
            background: #ffebee;
            border-radius: 4px;
            margin-bottom: 1rem;
          }
        </style>
      </head>
      <body>
        <div id="container"></div>
        <script type="module">
          import { parse, HtmlGenerator } from "https://cdn.jsdelivr.net/npm/latex.js/dist/latex.mjs";
          
          try {
             // We need to inject the CSS for KaTeX and LaTeX.js
             const link = document.createElement("link");
             link.rel = "stylesheet";
             link.href = "https://cdn.jsdelivr.net/npm/latex.js/dist/css/katex.css";
             document.head.appendChild(link);
             
             const latexLink = document.createElement("link");
             latexLink.rel = "stylesheet";
             latexLink.href = "https://cdn.jsdelivr.net/npm/latex.js/dist/css/article.css";
             document.head.appendChild(latexLink);

             const content = decodeURIComponent(escape(atob("${encodedContent}")));
             const generator = new HtmlGenerator({ hyphenate: false });
             const doc = parse(content, { generator: generator }).htmlDocument('https://cdn.jsdelivr.net/npm/latex.js/dist/');
             
             document.getElementById('container').appendChild(doc.documentElement);
          } catch(e) {
             const errEl = document.createElement('div');
             errEl.className = 'error-view';
             errEl.textContent = 'Error rendering LaTeX: ' + e.toString();
             document.getElementById('container').appendChild(errEl);
             
             const pre = document.createElement('pre');
             pre.textContent = decodeURIComponent(escape(atob("${encodedContent}")));
             document.getElementById('container').appendChild(pre);
          }
        </script>
      </body>
    </html>
  `;

  return (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center overflow-auto p-4 md:p-8">
      <div className="bg-white shadow-xl w-full max-w-4xl h-[1056px] relative">
        <iframe
          title="LaTeX Preview"
          srcDoc={srcDoc}
          className="w-full h-full border-0 shadow-sm"
        />
      </div>
    </div>
  );
};

