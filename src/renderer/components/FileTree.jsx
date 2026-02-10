import React, { useEffect, useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';

function Node({ node, activePath, onOpen, onContextMenu, collapseSignal = 0, forceExpand = false, depth = 0 }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(false);
  }, [collapseSignal]);

  useEffect(() => {
    if (forceExpand) setOpen(true);
  }, [forceExpand]);

  if (node.type === 'directory') {
    return (
      <div className="tree-node">
        <button
          className="tree-row"
          onClick={() => setOpen((v) => !v)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu?.(e, node);
          }}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <ChevronRight className={open ? 'rotate' : ''} size={10} />
          <Folder size={13} />
          <span>{node.name}</span>
        </button>
        {open && (
          <div className="tree-children">
            {node.children?.map((child) => (
              <Node
                key={child.path}
                node={child}
                activePath={activePath}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
                collapseSignal={collapseSignal}
                forceExpand={forceExpand}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`tree-row ${activePath === node.path ? 'active' : ''}`}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, node);
      }}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <span className="tree-label">{node.name.replace(/\.md$/, '')}</span>
    </button>
  );
}

export default function FileTree({ tree, onOpen, onContextMenu, activePath, collapseSignal = 0, forceExpand = false }) {
  return (
    <div className="file-tree">
      {tree.map((node) => (
        <Node
          key={node.path}
          node={node}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          activePath={activePath}
          collapseSignal={collapseSignal}
          forceExpand={forceExpand}
        />
      ))}
    </div>
  );
}
