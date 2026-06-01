import { useRef, useEffect, useCallback, useState } from 'react';
import type { Layer } from '@keymemory/shared';
import { useI18n } from '../i18n';
import { redactSensitiveText } from '../lib/memoryFormat';

interface GraphData {
  nodes: Array<{ id: string; title: string; layer: string; tags?: string[]; project?: string }>;
  edges: Array<{ source: string; target: string; type: string; weight: number; label?: string }>;
}

interface NebulaGraphProps {
  data: GraphData | null;
  onNodeClick?: (nodeId: string) => void;
  loading?: boolean;
}

const LAYER_COLORS: Record<string, string> = {
  flash: '#FF9F0A',
  short: '#007AFF',
  long: '#34C759',
  project: '#AF52DE',
  entity: '#FF2D55',
};

const LAYER_GLOW: Record<string, string> = {
  flash: 'rgba(255,159,10,',
  short: 'rgba(0,122,255,',
  long: 'rgba(52,199,89,',
  project: 'rgba(175,82,222,',
  entity: 'rgba(255,45,85,',
};

const EDGE_COLORS: Record<string, string> = {
  shared_tag: 'rgba(0,122,255,0.25)',
  shared_project: 'rgba(175,82,222,0.25)',
  shared_entity: 'rgba(255,45,85,0.25)',
};

interface SimNode {
  id: string;
  title: string;
  layer: string;
  tags?: string[];
  project?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  connections: number;
  pulsePhase: number;
}

interface SimEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  label?: string;
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

export default function NebulaGraph({ data, onNodeClick, loading }: NebulaGraphProps) {
  const { language, t, layerLabel } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<{ nodes: SimNode[]; edges: SimEdge[] }>({ nodes: [], edges: [] });
  const animRef = useRef<number>(0);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ nodeId: string | null; offsetX: number; offsetY: number; isPanning: boolean; startX: number; startY: number }>({
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
  });
  const hoverRef = useRef<string | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const starsRef = useRef<Star[]>([]);
  const timeRef = useRef(0);
  const [hoveredNode, setHoveredNode] = useState<{ id: string; title: string; layer: string; tags?: string[]; x: number; y: number } | null>(null);

  const generateStars = useCallback((w: number, h: number) => {
    const count = Math.floor((w * h) / 3000);
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 0.3 + Math.random() * 1.2,
        alpha: 0.2 + Math.random() * 0.5,
        twinkleSpeed: 0.5 + Math.random() * 2,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
    starsRef.current = stars;
  }, []);

  const getConnectionCounts = useCallback((edges: SimEdge[]) => {
    const counts: Record<string, number> = {};
    for (const e of edges) {
      counts[e.source] = (counts[e.source] || 0) + 1;
      counts[e.target] = (counts[e.target] || 0) + 1;
    }
    return counts;
  }, []);

  const initSimulation = useCallback(
    (graphData: GraphData) => {
      const counts = getConnectionCounts(graphData.edges as SimEdge[]);
      const cx = sizeRef.current.width / 2;
      const cy = sizeRef.current.height / 2;

      const nodes: SimNode[] = graphData.nodes.map((n) => {
        const conn = counts[n.id] || 0;
        const angle = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 150;
        return {
          ...n,
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          radius: 8 + Math.min(conn * 2.5, 18),
          connections: conn,
          pulsePhase: Math.random() * Math.PI * 2,
        };
      });

      simRef.current = { nodes, edges: graphData.edges as SimEdge[] };
      transformRef.current = { x: 0, y: 0, scale: 1 };
    },
    [getConnectionCounts]
  );

  const applyForces = useCallback(() => {
    const { nodes, edges } = simRef.current;
    if (nodes.length === 0) return;

    const cx = sizeRef.current.width / 2;
    const cy = sizeRef.current.height / 2;
    const repulsion = 3500;
    const attraction = 0.004;
    const centerGravity = 0.008;
    const damping = 0.85;
    const alpha = 0.25;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force * alpha;
        const fy = (dy / dist) * force * alpha;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    const nodeMap = new Map<string, SimNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = 140;
      const force = (dist - idealDist) * attraction * edge.weight * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      src.vx += fx;
      src.vy += fy;
      tgt.vx -= fx;
      tgt.vy -= fy;
    }

    for (const node of nodes) {
      if (dragRef.current.nodeId === node.id) continue;
      node.vx += (cx - node.x) * centerGravity * alpha;
      node.vy += (cy - node.y) * centerGravity * alpha;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }, []);

  const truncateTitle = (title: string, maxLen: number) => {
    if (title.length <= maxLen) return title;
    return title.slice(0, maxLen - 1) + '…';
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = sizeRef.current;
    const { x: tx, y: ty, scale } = transformRef.current;
    const { nodes, edges } = simRef.current;
    const hoveredId = hoverRef.current;
    const t = timeRef.current;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
    bgGrad.addColorStop(0, '#1A1A2E');
    bgGrad.addColorStop(0.5, '#16162A');
    bgGrad.addColorStop(1, '#0D0D1A');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const stars = starsRef.current;
    for (const star of stars) {
      const twinkle = Math.sin(t * star.twinkleSpeed + star.twinklePhase) * 0.3 + 0.7;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,210,255,${star.alpha * twinkle})`;
      ctx.fill();
    }

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const connectedToHover = new Set<string>();
    if (hoveredId) {
      connectedToHover.add(hoveredId);
      for (const e of edges) {
        if (e.source === hoveredId) connectedToHover.add(e.target);
        if (e.target === hoveredId) connectedToHover.add(e.source);
      }
    }

    const nodeMap = new Map<string, SimNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const isHighlighted = hoveredId && (edge.source === hoveredId || edge.target === hoveredId);
      const isDimmed = hoveredId && !isHighlighted;

      const baseColor = EDGE_COLORS[edge.type] || 'rgba(255,255,255,0.1)';

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isDimmed) {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
      } else if (isHighlighted) {
        ctx.strokeStyle = baseColor.replace(/[\d.]+\)$/, '0.6)');
        ctx.lineWidth = Math.max(1.5, edge.weight * 2);
      } else {
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = Math.max(0.8, edge.weight * 1.2);
      }
      ctx.stroke();

      if (!isDimmed) {
        const pulsePos = ((t * 0.3) % 1);
        const mx = src.x + (tgt.x - src.x) * pulsePos;
        const my = src.y + (tgt.y - src.y) * pulsePos;
        const pulseAlpha = isHighlighted ? 0.6 : 0.2;
        ctx.beginPath();
        ctx.arc(mx, my, isHighlighted ? 2 : 1.2, 0, Math.PI * 2);
        ctx.fillStyle = baseColor.replace(/[\d.]+\)$/, `${pulseAlpha})`);
        ctx.fill();
      }

      if (edge.label && isHighlighted) {
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = 'rgba(200,210,255,0.7)';
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, mx, my - 6);
      }
    }

    for (const node of nodes) {
      const color = LAYER_COLORS[node.layer] || '#8E8E93';
      const glowBase = LAYER_GLOW[node.layer] || 'rgba(142,142,147,';
      const isHovered = hoveredId === node.id;
      const isConnected = connectedToHover.has(node.id);
      const isDimmed = hoveredId && !isConnected;

      const pulse = Math.sin(t * 1.5 + node.pulsePhase) * 0.15 + 0.85;

      if (isDimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100,100,120,0.1)';
        ctx.fill();

        ctx.font = `${Math.max(9, node.radius * 0.7)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = 'rgba(200,210,255,0.08)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncateTitle(node.title, 8), node.x, node.y + node.radius + 12);
        continue;
      }

      const outerGlowR = node.radius * (isHovered ? 4 : 2.8) * pulse;
      const outerGlow = ctx.createRadialGradient(node.x, node.y, node.radius * 0.3, node.x, node.y, outerGlowR);
      outerGlow.addColorStop(0, glowBase + (isHovered ? '0.35)' : '0.18)'));
      outerGlow.addColorStop(0.5, glowBase + (isHovered ? '0.12)' : '0.05)'));
      outerGlow.addColorStop(1, glowBase + '0)');
      ctx.beginPath();
      ctx.arc(node.x, node.y, outerGlowR, 0, Math.PI * 2);
      ctx.fillStyle = outerGlow;
      ctx.fill();

      const ringR = node.radius * 1.6 * pulse;
      ctx.beginPath();
      ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = glowBase + (isHovered ? '0.25)' : '0.1)');
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      const nodeGrad = ctx.createRadialGradient(
        node.x - node.radius * 0.3,
        node.y - node.radius * 0.3,
        0,
        node.x,
        node.y,
        node.radius
      );
      nodeGrad.addColorStop(0, color + 'FF');
      nodeGrad.addColorStop(0.7, color + 'DD');
      nodeGrad.addColorStop(1, color + 'AA');
      ctx.fillStyle = nodeGrad;
      ctx.fill();

      if (isHovered) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      const labelAlpha = isHovered ? 0.95 : 0.55;
      const labelSize = isHovered ? Math.max(11, node.radius * 0.8) : Math.max(9, node.radius * 0.65);
      ctx.font = `500 ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = `rgba(220,225,255,${labelAlpha})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateTitle(node.title, isHovered ? 12 : 8), node.x, node.y + node.radius + labelSize + 2);
    }

    ctx.restore();
    ctx.restore();
  }, []);

  const animate = useCallback(() => {
    timeRef.current += 0.016;
    applyForces();
    render();
    animRef.current = requestAnimationFrame(animate);
  }, [applyForces, render]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const { x: tx, y: ty, scale } = transformRef.current;
    return {
      x: (sx - tx) / scale,
      y: (sy - ty) / scale,
    };
  }, []);

  const findNodeAt = useCallback(
    (wx: number, wy: number) => {
      const { nodes } = simRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = wx - n.x;
        const dy = wy - n.y;
        if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
          return n;
        }
      }
      return null;
    },
    []
  );

  useEffect(() => {
    if (data && data.nodes.length > 0) {
      initSimulation(data);
    } else {
      simRef.current = { nodes: [], edges: [] };
    }
  }, [data, initSimulation]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const dpr = window.devicePixelRatio || 1;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      generateStars(rect.width, rect.height);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);

    ro.observe(container);

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      const node = findNodeAt(world.x, world.y);

      if (node) {
        dragRef.current = {
          nodeId: node.id,
          offsetX: world.x - node.x,
          offsetY: world.y - node.y,
          isPanning: false,
          startX: sx,
          startY: sy,
        };
      } else {
        dragRef.current = {
          nodeId: null,
          offsetX: 0,
          offsetY: 0,
          isPanning: true,
          startX: sx,
          startY: sy,
        };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);

      if (dragRef.current.nodeId) {
        const { nodes } = simRef.current;
        const nodeMap = new Map<string, SimNode>();
        for (const n of nodes) nodeMap.set(n.id, n);
        const node = nodeMap.get(dragRef.current.nodeId);
        if (node) {
          node.x = world.x - dragRef.current.offsetX;
          node.y = world.y - dragRef.current.offsetY;
          node.vx = 0;
          node.vy = 0;
        }
        return;
      }

      if (dragRef.current.isPanning) {
        const dx = sx - dragRef.current.startX;
        const dy = sy - dragRef.current.startY;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        dragRef.current.startX = sx;
        dragRef.current.startY = sy;
        return;
      }

      const node = findNodeAt(world.x, world.y);
      if (node) {
        hoverRef.current = node.id;
        canvas.style.cursor = 'pointer';
        setHoveredNode({
          id: node.id,
          title: node.title,
          layer: node.layer,
          tags: node.tags,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      } else {
        hoverRef.current = null;
        canvas.style.cursor = 'grab';
        setHoveredNode(null);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (dragRef.current.nodeId) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const dx = sx - dragRef.current.startX;
        const dy = sy - dragRef.current.startY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          onNodeClick?.(dragRef.current.nodeId);
        }
      }
      dragRef.current = { nodeId: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0 };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.2, Math.min(5, transformRef.current.scale * delta));
      const ratio = newScale / transformRef.current.scale;
      transformRef.current.x = sx - (sx - transformRef.current.x) * ratio;
      transformRef.current.y = sy - (sy - transformRef.current.y) * ratio;
      transformRef.current.scale = newScale;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    animRef.current = requestAnimationFrame(animate);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [animate, screenToWorld, findNodeAt, onNodeClick, generateStars]);

  const showEmpty = !loading && (!data || data.nodes.length === 0);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#0D0D1A',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: 'grab',
        }}
      />

      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            left: hoveredNode.x + 14,
            top: hoveredNode.y - 12,
            pointerEvents: 'none',
            background: 'rgba(20,20,40,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: '#E8ECFF',
            fontSize: 13,
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            padding: '8px 14px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.08)',
            maxWidth: 260,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{redactSensitiveText(hoveredNode.title)}</div>
          <div style={{ fontSize: 11, color: 'rgba(200,210,255,0.5)' }}>
            {LAYER_COLORS[hoveredNode.layer] ? (
              <span style={{ color: LAYER_COLORS[hoveredNode.layer] }}>
                {hoveredNode.layer === 'project' ? (language === 'zh' ? '项目' : 'Project') : layerLabel(hoveredNode.layer as Layer)}
              </span>
            ) : null}
            {hoveredNode.tags && hoveredNode.tags.length > 0 && (
              <span> · {hoveredNode.tags.slice(0, 3).join(', ')}</span>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(13,13,26,0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid rgba(0,122,255,0.2)',
              borderTopColor: '#007AFF',
              borderRadius: '50%',
              animation: 'nebula-spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes nebula-spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {showEmpty && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(200,210,255,0.18)', opacity: 0.9 }} />
          <div
            style={{
              color: 'rgba(200,210,255,0.3)',
              fontSize: 15,
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              letterSpacing: 1,
            }}
          >
            {t('graph.empty')}
          </div>
          <div
            style={{
              color: 'rgba(200,210,255,0.15)',
              fontSize: 12,
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            }}
          >
            {t('graph.emptyHint')}
          </div>
        </div>
      )}
    </div>
  );
}
