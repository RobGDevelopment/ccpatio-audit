'use client';
import React, { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#0f172a',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#38bdf8',
    lineColor: '#475569',
    secondaryColor: '#1e293b',
    tertiaryColor: '#334155'
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
  },
  securityLevel: 'loose'
});

const Controls = () => {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 bg-slate-900/80 border border-slate-700 p-1.5 rounded-lg backdrop-blur-sm shadow-xl">
      <button onClick={() => zoomIn()} className="p-2 hover:bg-slate-800 rounded text-slate-300 hover:text-sky-400 transition-colors" title="Zoom In">
        <ZoomIn size={18} />
      </button>
      <button onClick={() => zoomOut()} className="p-2 hover:bg-slate-800 rounded text-slate-300 hover:text-sky-400 transition-colors" title="Zoom Out">
        <ZoomOut size={18} />
      </button>
      <div className="h-px bg-slate-700/50 w-full my-0.5"></div>
      <button onClick={() => resetTransform()} className="p-2 hover:bg-slate-800 rounded text-slate-300 hover:text-sky-400 transition-colors" title="Reset Zoom">
        <RotateCcw size={18} />
      </button>
    </div>
  );
};

export default function MermaidDiagram({ chart }: { chart: string }) {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const chartId = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    const renderChart = async () => {
      try {
        const { svg } = await mermaid.render(chartId.current, chart);
        setSvgContent(svg);
      } catch (err) {
        console.error("Mermaid rendering failed", err);
      }
    };
    renderChart();
  }, [chart]);

  if (!svgContent) return <div className="text-sky-400 font-mono text-sm animate-pulse flex h-[72vh] items-center justify-center">Rendering Architecture...</div>;

  return (
    <div className="h-[72vh] w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 relative cursor-grab shadow-2xl">
      <div className="absolute bottom-4 left-4 z-10 bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded text-[10px] font-mono text-sky-400 pointer-events-none backdrop-blur-sm shadow-lg">SCROLL: ZOOM | DRAG: PAN</div>
      <TransformWrapper centerOnInit={true} initialScale={0.7} maxScale={5} minScale={0.15}>
        <Controls />
        <TransformComponent contentClass="w-full h-full flex items-center justify-center p-12" wrapperClass="w-full h-full">
          <div 
            className="w-full h-full [&>svg]:max-w-none [&>svg]:min-w-300" 
            dangerouslySetInnerHTML={{ __html: svgContent }} 
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
