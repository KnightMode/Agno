import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { X } from 'lucide-react';

const GRAPH_LAYOUT_KEY = 'ngobs.graph.layout.v3';

const DEFAULT_LAYOUT = {
  staticMode: false,
  positions: {},
  collapsed: {}
};

function loadLayout() {
  try {
    const raw = window.localStorage.getItem(GRAPH_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw);
    return {
      staticMode: Boolean(parsed?.staticMode),
      positions: parsed?.positions && typeof parsed.positions === 'object' ? parsed.positions : {},
      collapsed: parsed?.collapsed && typeof parsed.collapsed === 'object' ? parsed.collapsed : {}
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function hasCoords(pos) {
  return Number.isFinite(pos?.x) && Number.isFinite(pos?.y);
}

function getNodeId(ref) {
  return typeof ref === 'object' && ref !== null ? ref.id : ref;
}

export default function GraphView({ onClose, onOpen }) {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [layout, setLayout] = useState(() => loadLayout());
  const [hoverNode, setHoverNode] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 760, height: 480 });
  const containerRef = useRef(null);
  const fgRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    window.ngobs.graph.data().then((graph) => {
      const initialNodes = graph.nodes.map((node) => {
        const saved = layout.positions[node.id];
        const pinned = Boolean(saved?.pinned);
        const next = { ...node, pinned };
        if (hasCoords(saved)) {
          next.x = saved.x;
          next.y = saved.y;
          if (layout.staticMode || pinned) {
            next.fx = saved.x;
            next.fy = saved.y;
          }
        }
        return next;
      });
      setData({ nodes: initialNodes, links: graph.links });
    });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRAPH_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // ignore localStorage failures
    }
  }, [layout]);

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
    setData((current) => {
      if (!current.nodes.length) return current;

      let changed = false;
      const nextNodes = current.nodes.map((node) => {
        const saved = layout.positions[node.id];
        const pinned = Boolean(saved?.pinned);
        const shouldFix = layout.staticMode || pinned;
        const hasSavedCoords = hasCoords(saved);
        const next = { ...node };

        if (next.pinned !== pinned) {
          next.pinned = pinned;
          changed = true;
        }

        if (hasSavedCoords && shouldFix) {
          if (next.x !== saved.x || next.y !== saved.y) {
            next.x = saved.x;
            next.y = saved.y;
            changed = true;
          }
          if (next.fx !== saved.x || next.fy !== saved.y) {
            next.fx = saved.x;
            next.fy = saved.y;
            changed = true;
          }
        } else if (next.fx !== undefined || next.fy !== undefined) {
          next.fx = undefined;
          next.fy = undefined;
          changed = true;
        }

        return next;
      });

      return changed ? { ...current, nodes: nextNodes } : current;
    });
  }, [layout]);

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-120);
    }
  }, [data]);

  const { outgoingAdjacency, incomingAdjacency } = useMemo(() => {
    const outgoing = new Map();
    const incoming = new Map();
    data.links.forEach((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      if (!outgoing.has(sourceId)) outgoing.set(sourceId, []);
      if (!outgoing.has(targetId)) outgoing.set(targetId, []);
      if (!incoming.has(sourceId)) incoming.set(sourceId, []);
      if (!incoming.has(targetId)) incoming.set(targetId, []);
      outgoing.get(sourceId).push(targetId);
      incoming.get(targetId).push(sourceId);
    });
    return { outgoingAdjacency: outgoing, incomingAdjacency: incoming };
  }, [data.links]);

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set();
    const collapsedRoots = Object.keys(layout.collapsed || {}).filter((id) => layout.collapsed[id]);
    const rootSet = new Set(collapsedRoots);

    collapsedRoots.forEach((rootId) => {
      const directOutgoing = outgoingAdjacency.get(rootId) || [];
      const queue = [...directOutgoing];
      const visited = new Set();

      // If a node has no outgoing links, collapse immediate inbound neighbors as a fallback.
      if (queue.length === 0) {
        const directIncoming = incomingAdjacency.get(rootId) || [];
        directIncoming.forEach((neighborId) => {
          if (!rootSet.has(neighborId)) hidden.add(neighborId);
        });
      }

      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        if (rootSet.has(currentId)) continue;

        hidden.add(currentId);
        const nextChildren = outgoingAdjacency.get(currentId) || [];
        for (const childId of nextChildren) {
          if (!visited.has(childId)) {
            queue.push(childId);
          }
        }
      }
    });

    return hidden;
  }, [outgoingAdjacency, incomingAdjacency, layout.collapsed]);

  const visibleData = useMemo(() => {
    const nodes = data.nodes.filter((node) => !hiddenNodeIds.has(node.id));
    const visibleIds = new Set(nodes.map((node) => node.id));
    const links = data.links.filter((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });
    return { nodes, links };
  }, [data, hiddenNodeIds]);

  useEffect(() => {
    if (hoverNode && hiddenNodeIds.has(hoverNode.id)) {
      setHoverNode(null);
    }
  }, [hoverNode, hiddenNodeIds]);

  useEffect(() => {
    if (selectedNodeId && hiddenNodeIds.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, hiddenNodeIds]);

  const neighborSet = useMemo(() => {
    if (!hoverNode) return new Set();
    const neighbors = new Set();
    neighbors.add(hoverNode.id);
    visibleData.links.forEach((link) => {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      if (sourceId === hoverNode.id) neighbors.add(targetId);
      if (targetId === hoverNode.id) neighbors.add(sourceId);
    });
    return neighbors;
  }, [hoverNode, visibleData.links]);

  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isHighlighted = neighborSet.has(node.id);
    const isHovered = hoverNode && hoverNode.id === node.id;
    const isSelected = selectedNodeId === node.id;
    const isPinned = Boolean(layout.positions[node.id]?.pinned);
    const isCollapsed = Boolean(layout.collapsed[node.id]);
    const radius = isSelected ? 7 : (isHovered ? 6 : 4);

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + (isSelected ? 11 : 8), 0, 2 * Math.PI, false);
    ctx.fillStyle = isHighlighted
      ? 'rgba(10, 132, 255, 0.12)'
      : 'rgba(10, 132, 255, 0.04)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = isPinned ? '#30d158' : (isSelected ? '#ff9f0a' : (isHighlighted ? '#409cff' : '#0a84ff'));
    ctx.fill();

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
      ctx.strokeStyle = 'rgba(255, 159, 10, 0.9)';
      ctx.lineWidth = Math.max(2 / globalScale, 1);
      ctx.stroke();
    }

    if (isCollapsed) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI, false);
      ctx.strokeStyle = 'rgba(255, 159, 10, 0.8)';
      ctx.lineWidth = Math.max(1.5 / globalScale, 0.75);
      ctx.stroke();
    }

    const fontSize = Math.max(11 / globalScale, 3);
    ctx.font = `${fontSize}px -apple-system, SF Pro Text, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isHighlighted
      ? 'rgba(245, 245, 247, 0.9)'
      : 'rgba(235, 235, 245, 0.55)';
    ctx.fillText(node.label, node.x, node.y + radius + 4);
  }, [neighborSet, hoverNode, selectedNodeId, layout]);

  const linkColor = useCallback((link) => {
    if (!hoverNode) return 'rgba(255, 255, 255, 0.08)';
    const sourceId = getNodeId(link.source);
    const targetId = getNodeId(link.target);
    if (sourceId === hoverNode.id || targetId === hoverNode.id) {
      return 'rgba(10, 132, 255, 0.35)';
    }
    return 'rgba(255, 255, 255, 0.04)';
  }, [hoverNode]);

  const linkWidth = useCallback((link) => {
    if (!hoverNode) return 0.5;
    const sourceId = getNodeId(link.source);
    const targetId = getNodeId(link.target);
    if (sourceId === hoverNode.id || targetId === hoverNode.id) return 1.5;
    return 0.3;
  }, [hoverNode]);

  const saveNodePosition = useCallback((nodeId, x, y, pinnedOverride) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    setLayout((prev) => {
      const previous = prev.positions[nodeId] || {};
      const nextPinned = pinnedOverride === undefined ? Boolean(previous.pinned) : Boolean(pinnedOverride);
      return {
        ...prev,
        positions: {
          ...prev.positions,
          [nodeId]: { x, y, pinned: nextPinned }
        }
      };
    });
  }, []);

  const togglePin = useCallback((nodeId) => {
    if (!nodeId) return;

    const currentPinned = Boolean(layout.positions[nodeId]?.pinned);
    const nextPinned = !currentPinned;
    const liveNodes = fgRef.current?.graphData()?.nodes || [];
    const liveNode = liveNodes.find((node) => node.id === nodeId);

    setLayout((prev) => {
      const current = prev.positions[nodeId] || {};
      const nextPinned = !current.pinned;
      const x = Number.isFinite(liveNode?.x) ? liveNode.x : (Number.isFinite(current.x) ? current.x : 0);
      const y = Number.isFinite(liveNode?.y) ? liveNode.y : (Number.isFinite(current.y) ? current.y : 0);
      return {
        ...prev,
        positions: {
          ...prev.positions,
          [nodeId]: {
            x,
            y,
            pinned: nextPinned
          }
        }
      };
    });

    setData((current) => {
      const nodes = current.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const next = { ...node };
        if (Number.isFinite(next.x) && Number.isFinite(next.y)) {
          if (nextPinned || layout.staticMode) {
            next.fx = next.x;
            next.fy = next.y;
          } else {
            next.fx = undefined;
            next.fy = undefined;
          }
        }
        next.pinned = nextPinned;
        return next;
      });
      return { ...current, nodes };
    });
  }, [layout.positions, layout.staticMode]);

  const toggleCollapsed = useCallback((nodeId) => {
    if (!nodeId) return;
    setLayout((prev) => {
      const nextCollapsed = { ...prev.collapsed };
      if (nextCollapsed[nodeId]) {
        delete nextCollapsed[nodeId];
      } else {
        nextCollapsed[nodeId] = true;
      }
      return { ...prev, collapsed: nextCollapsed };
    });
  }, []);

  const freezeCurrentLayout = useCallback((pinAll = false) => {
    const graph = fgRef.current?.graphData();
    if (!graph?.nodes?.length) return;

    const nextPositions = {};
    graph.nodes.forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const previous = layout.positions[node.id] || {};
      const pinned = pinAll ? true : Boolean(previous.pinned);
      nextPositions[node.id] = { x: node.x, y: node.y, pinned };
      if (layout.staticMode || pinned) {
        node.fx = node.x;
        node.fy = node.y;
      }
    });

    setLayout((prev) => ({
      ...prev,
      positions: { ...prev.positions, ...nextPositions }
    }));
  }, [layout.positions, layout.staticMode]);

  const handleNodeClick = useCallback((node, event) => {
    setSelectedNodeId(node.id);
    if (event?.shiftKey) {
      toggleCollapsed(node.id);
      return;
    }

    if (event?.metaKey || event?.ctrlKey) {
      togglePin(node.id);
      return;
    }

    // Single-click selects; double-click opens the note.
    if (event?.detail >= 2) {
      onOpen(node.id);
      onClose();
    }
  }, [onOpen, onClose, toggleCollapsed, togglePin]);

  const handleNodeDragEnd = useCallback((node) => {
    const shouldPin = layout.staticMode ? true : Boolean(layout.positions[node.id]?.pinned);
    saveNodePosition(node.id, node.x, node.y, shouldPin);
    if (layout.staticMode || shouldPin) {
      node.fx = node.x;
      node.fy = node.y;
    } else {
      node.fx = undefined;
      node.fy = undefined;
    }
  }, [layout, saveNodePosition]);

  const handleNodeRightClick = useCallback((node, event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(node.id);
    if (event.shiftKey) {
      toggleCollapsed(node.id);
      return;
    }
    togglePin(node.id);
  }, [togglePin, toggleCollapsed]);

  const handleEngineStop = useCallback(() => {
    if (!layout.staticMode) return;
    freezeCurrentLayout();
  }, [layout.staticMode, freezeCurrentLayout]);

  const resetLayout = useCallback(() => {
    setLayout((prev) => ({ ...prev, positions: {}, collapsed: {} }));
    setData((current) => ({
      ...current,
      nodes: current.nodes.map((node) => ({ ...node, fx: undefined, fy: undefined, pinned: false }))
    }));
    if (fgRef.current) fgRef.current.d3ReheatSimulation();
  }, []);

  const toggleStaticMode = useCallback(() => {
    setLayout((prev) => ({ ...prev, staticMode: !prev.staticMode }));
    if (fgRef.current) fgRef.current.d3ReheatSimulation();
  }, []);

  const hiddenCount = hiddenNodeIds.size;
  const activeNodeId = selectedNodeId || hoverNode?.id;
  const activeIsPinned = Boolean(activeNodeId && layout.positions[activeNodeId]?.pinned);
  const activeIsCollapsed = Boolean(activeNodeId && layout.collapsed[activeNodeId]);
  const activeNodeLabel = activeNodeId
    ? (data.nodes.find((node) => node.id === activeNodeId)?.label || activeNodeId)
    : 'None';
  const selectableNodes = useMemo(() => {
    return visibleData.nodes
      .map((node) => ({ id: node.id, label: node.label || node.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleData.nodes]);

  return (
    <div className="graph-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="graph-modal">
        <div className="graph-header">
          <h3>Graph</h3>
          <button className="graph-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="graph-controls">
          <div className="graph-toolbar graph-toolbar-primary">
            <button className={`graph-btn ${layout.staticMode ? 'active' : ''}`} onClick={toggleStaticMode}>
              {layout.staticMode ? 'Static' : 'Dynamic'}
            </button>
            <button className="graph-btn" onClick={() => freezeCurrentLayout(layout.staticMode)}>
              Save Layout
            </button>
            <button className="graph-btn" onClick={() => setLayout((prev) => ({ ...prev, collapsed: {} }))}>
              Expand All
            </button>
            <button className="graph-btn" onClick={resetLayout}>
              Reset
            </button>
            <span className="graph-meta">
              Hidden: {hiddenCount}
            </span>
          </div>

          <div className="graph-toolbar graph-toolbar-secondary">
            <select
              className="graph-select"
              value={activeNodeId || ''}
              onChange={(e) => setSelectedNodeId(e.target.value || null)}
            >
              <option value="">Select node…</option>
              {selectableNodes.map((node) => (
                <option key={node.id} value={node.id}>{node.label}</option>
              ))}
            </select>

            <div className="graph-actions">
              <button className="graph-btn" disabled={!activeNodeId} onClick={() => togglePin(activeNodeId)}>
                {activeIsPinned ? 'Unpin' : 'Pin'}
              </button>
              <button className="graph-btn" disabled={!activeNodeId} onClick={() => toggleCollapsed(activeNodeId)}>
                {activeIsCollapsed ? 'Expand' : 'Collapse'}
              </button>
              <button
                className="graph-btn"
                disabled={!activeNodeId}
                onClick={() => {
                  if (!activeNodeId) return;
                  onOpen(activeNodeId);
                  onClose();
                }}
              >
                Open
              </button>
            </div>

            <span className="graph-selected" title={`Selected: ${activeNodeLabel}`}>
              Selected: {activeNodeLabel}
            </span>
          </div>

          <div className="graph-help-row">
            <span className="graph-help">
              Tip: Click to select. Double-click opens note. Cmd/Ctrl+click pins. Shift+click collapses.
            </span>
          </div>
        </div>

        <div className="graph-container" ref={containerRef} onContextMenu={(e) => e.preventDefault()}>
          {visibleData.nodes.length > 0 && (
            <ForceGraph2D
              ref={fgRef}
              graphData={visibleData}
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
              onNodeHover={(node) => {
                setHoverNode(node);
                if (node?.id) setSelectedNodeId(node.id);
              }}
              onNodeDragEnd={handleNodeDragEnd}
              onNodeRightClick={handleNodeRightClick}
              onEngineStop={handleEngineStop}
              cooldownTicks={layout.staticMode ? 20 : 80}
              enableNodeDrag={true}
              enableZoomPanInteraction={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}
