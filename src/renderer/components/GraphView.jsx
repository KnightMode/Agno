import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { X } from 'lucide-react';

export default function GraphView({ onClose, onOpen }) {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [hoverNode, setHoverNode] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 760, height: 480 });
  const containerRef = useRef(null);
  const fgRef = useRef(null);

  useEffect(() => {
    window.ngobs.graph.data().then(setData);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-120);
    }
  }, [data]);

  const neighborSet = useMemo(() => {
    if (!hoverNode) return new Set();
    const neighbors = new Set();
    neighbors.add(hoverNode.id);
    data.links.forEach((link) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === hoverNode.id) neighbors.add(targetId);
      if (targetId === hoverNode.id) neighbors.add(sourceId);
    });
    return neighbors;
  }, [hoverNode, data.links]);

  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isHighlighted = neighborSet.has(node.id);
    const isHovered = hoverNode && hoverNode.id === node.id;
    const radius = isHovered ? 6 : 4;

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI, false);
    ctx.fillStyle = isHighlighted
      ? 'rgba(10, 132, 255, 0.12)'
      : 'rgba(10, 132, 255, 0.04)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = isHighlighted ? '#409cff' : '#0a84ff';
    ctx.fill();

    const fontSize = Math.max(11 / globalScale, 3);
    ctx.font = `${fontSize}px -apple-system, SF Pro Text, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isHighlighted
      ? 'rgba(245, 245, 247, 0.9)'
      : 'rgba(235, 235, 245, 0.55)';
    ctx.fillText(node.label, node.x, node.y + radius + 4);
  }, [neighborSet, hoverNode]);

  const linkColor = useCallback((link) => {
    if (!hoverNode) return 'rgba(255, 255, 255, 0.08)';
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    if (sourceId === hoverNode.id || targetId === hoverNode.id) {
      return 'rgba(10, 132, 255, 0.35)';
    }
    return 'rgba(255, 255, 255, 0.04)';
  }, [hoverNode]);

  const linkWidth = useCallback((link) => {
    if (!hoverNode) return 0.5;
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    if (sourceId === hoverNode.id || targetId === hoverNode.id) return 1.5;
    return 0.3;
  }, [hoverNode]);

  const handleNodeClick = useCallback((node) => {
    onOpen(node.id);
    onClose();
  }, [onOpen, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="graph-overlay" onClick={onClose}>
      <div className="graph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="graph-header">
          <h3>Graph</h3>
          <button className="graph-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="graph-container" ref={containerRef}>
          {data.nodes.length > 0 && (
            <ForceGraph2D
              ref={fgRef}
              graphData={data}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={5}
              nodeCanvasObject={nodeCanvasObject}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={linkColor}
              linkWidth={linkWidth}
              onNodeClick={handleNodeClick}
              onNodeHover={setHoverNode}
              cooldownTicks={80}
              enableNodeDrag={true}
              enableZoomPanInteraction={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}
