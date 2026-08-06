import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import * as d3 from 'd3';
import { Search, Close, Link, Inbox, ArrowLeft } from './Icons';
import { useI18n } from '../i18n';
import { redactSensitiveText } from '../lib/memoryFormat';
import { userFacingLayer, userFacingRelation } from '../lib/userFacing';
import type { MemoryGraphData, GraphEdge } from '../lib/api';

/* ── Constants ─────────────────────────────────────────────────────── */

const LAYER_ACCENTS: Record<string, string> = {
  flash: '#b77635', short: '#2f8297', long: '#4f8a67',
  project: '#8065a3', entity: '#a45f72',
};

const LAYER_ORDER = ['entity', 'long', 'short', 'flash', 'project'] as const;
const layerRank = (l: string): number => { const i = LAYER_ORDER.indexOf(l as typeof LAYER_ORDER[number]); return i >= 0 ? i : 3; };

/* ── Types ─────────────────────────────────────────────────────────── */

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  summary?: string;
  layer: string;
  tags?: string[];
  project?: string;
  valley?: string;
  updatedAt?: string;
  relations?: string[];
  isClusterHead?: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number;
  strength?: number;
}

interface Valley {
  name: string;
  nodes: SimNode[];
  latestAt: number;
  layers: Set<string>;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function compactDate(value: string | undefined, locale: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function edgeLabel(edge: GraphEdge, language: 'zh' | 'en'): string {
  return userFacingRelation(edge.type || edge.label || 'relates_to', language);
}

function nodeRadius(node: SimNode, degree: number): number {
  if (node.isClusterHead) return 8 + Math.min(degree, 8) * 0.5;
  const base = node.layer === 'entity' ? 5 : node.layer === 'long' ? 4.5 : node.layer === 'project' ? 5 : 3.5;
  return base + Math.min(degree, 8) * 0.4;
}

function layerY(layer: string, height: number): number {
  const weights: Record<string, number> = { entity: 0.2, long: 0.35, short: 0.5, project: 0.6, flash: 0.7 };
  return height * (weights[layer] ?? 0.5);
}

/* ── Component ─────────────────────────────────────────────────────── */

interface Props {
  data: MemoryGraphData | null;
  onNodeClick?: (nodeId: string) => void;
  loading?: boolean;
}

export default function MemoryValley({ data, onNodeClick, loading }: Props) {
  const { language } = useI18n();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const hoveredRef = useRef<string | null>(null);

  const [query, setQuery] = useState('');
  const [selectedValley, setSelectedValley] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  hoveredRef.current = hoveredNode;
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef<number>(zoomLevel);
  zoomLevelRef.current = zoomLevel;
  const [rotation, setRotation] = useState(0);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const [timeRangeDays, setTimeRangeDays] = useState<number>(0);
  const [sliderValue, setSliderValue] = useState<number>(100);
  const [contourThresholds, setContourThresholds] = useState<number>(30);
  const contourThresholdsRef = useRef<number>(contourThresholds);
  contourThresholdsRef.current = contourThresholds;
  const [dimensions, setDimensions] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  /* ── ResizeObserver ─────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDimensions({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  /* ── Valleys ───────────────────────────────────────────── */
  const valleys = useMemo<Valley[]>(() => {
    if (!data?.nodes) return [];
    const grouped = new Map<string, SimNode[]>();
    for (const node of data.nodes) {
      const sn = node as SimNode;
      const name = sn.valley?.trim() || sn.project?.trim()
        || sn.tags?.[0] || (language === 'zh' ? '独立记忆' : 'Standalone memories');
      const n = grouped.get(name) ?? [];
      n.push(sn);
      grouped.set(name, n);
    }
    return [...grouped.entries()].map(([name, nodes]) => ({
      name,
      nodes: nodes.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
      latestAt: Math.max(...nodes.map(n => n.updatedAt ? new Date(n.updatedAt).getTime() : 0)),
      layers: new Set(nodes.map(n => n.layer)),
    })).sort((a, b) => b.latestAt - a.latestAt || b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
  }, [data, language]);

  const visibleValleys = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return valleys;
    return valleys.filter(v => v.name.toLocaleLowerCase().includes(needle)
      || v.nodes.some(n => `${n.title} ${n.summary ?? ''} ${(n.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(needle)));
  }, [query, valleys]);

  useEffect(() => {
    if (selectedValley && visibleValleys.some(v => v.name === selectedValley)) return;
    setSelectedValley(visibleValleys[0]?.name ?? null);
  }, [selectedValley, visibleValleys]);

  const selected = useMemo(() => visibleValleys.find(v => v.name === selectedValley) ?? null, [visibleValleys, selectedValley]);
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map(n => [n.id, n as SimNode])), [data]);

  /* ── Nearby (cross-valley edges) ──────────────────────── */
  const nearby = useMemo(() => {
    if (!selected || !data) return [];
    const ids = new Set(selected.nodes.map(n => n.id));
    return (data.edges ?? [])
      .filter(e => ids.has(e.source) !== ids.has(e.target))
      .map(e => ({ edge: e, node: nodeById.get(ids.has(e.source) ? e.target : e.source) }))
      .filter((x): x is { edge: GraphEdge; node: SimNode } => Boolean(x.node))
      .sort((a, b) => b.edge.weight - a.edge.weight)
      .filter((item, i, all) => all.findIndex(o => o.node.id === item.node.id) === i)
      .slice(0, 8);
  }, [data, nodeById, selected]);

  /* ── Time range ────────────────────────────────────────── */
  const timeExtent = useMemo<[number, number]>(() => {
    if (!data?.nodes.length) return [Date.now(), Date.now()];
    const times = data.nodes.map(n => (n as SimNode).updatedAt ? new Date((n as SimNode).updatedAt!).getTime() : Date.now());
    return [Math.min(...times), Math.max(...times)];
  }, [data]);

  const handleSliderChange = useCallback((v: number) => {
    setSliderValue(v);
    if (!data?.nodes.length) return;
    const [minT, maxT] = timeExtent;
    if (v >= 100) { setTimeRange(null); return; }
    const cutoff = minT + (maxT - minT) * (v / 100);
    setTimeRange([minT, cutoff]);
  }, [data, timeExtent]);

  const handleTimeRangeDaysChange = useCallback((days: number) => {
    setTimeRangeDays(days);
    if (days === 0) { setTimeRange(null); return; }
    const now = Date.now();
    setTimeRange([now - days * 24 * 60 * 60 * 1000, now]);
  }, []);

  /* ── Filtered data ─────────────────────────────────────── */
  const filteredData = useMemo(() => {
    if (!data) return null;
    let nodes = data.nodes as SimNode[];
    if (timeRange) {
      nodes = nodes.filter(n => {
        const t = n.updatedAt ? new Date(n.updatedAt).getTime() : Date.now();
        return t >= timeRange[0] && t <= timeRange[1];
      });
    }
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = data.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes, edges };
  }, [data, timeRange]);

  /* ── Force Simulation + Rendering ──────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!container || !canvas || !svg || !filteredData?.nodes.length) return;

    const W = dimensions.w;
    const H = dimensions.h;
    const simNodes: SimNode[] = filteredData.nodes.map(n => ({ ...n }));
    const simLinks: SimLink[] = filteredData.edges.map(e => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      strength: e.strength,
    }));

    const degreeMap = new Map<string, number>();
    for (const l of simLinks) {
      const sId = typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
      const tId = typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
      degreeMap.set(sId, (degreeMap.get(sId) ?? 0) + 1);
      degreeMap.set(tId, (degreeMap.get(tId) ?? 0) + 1);
    }

    // Mark cluster heads (highest degree per valley)
    const valleyGroups = new Map<string, SimNode[]>();
    for (const n of simNodes) {
      const v = n.valley ?? n.project ?? 'default';
      const arr = valleyGroups.get(v) ?? [];
      arr.push(n);
      valleyGroups.set(v, arr);
    }
    for (const [, group] of valleyGroups) {
      const best = group.reduce<SimNode | null>((top, n) => {
        if (!top || (degreeMap.get(n.id) ?? 0) > (degreeMap.get(top.id) ?? 0)) return n;
        return top;
      }, null);
      if (best) best.isClusterHead = true;
    }

    /* Simulation */
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance((d) => 80 - ((d as SimLink).strength ?? 0.5) * 30)
        .strength(0.3))
      .force('charge', d3.forceManyBody<SimNode>().strength(d => d.isClusterHead ? -400 : -60))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => nodeRadius(d, degreeMap.get(d.id) ?? 0) + 4))
      .force('x', d3.forceX<SimNode>(W / 2).strength(0.04))
      .force('y', d3.forceY<SimNode>().y(d => layerY(d.layer, H)).strength(0.3))
      .alphaDecay(0.02);

    // Add slight random perturbation for natural contour shapes
    for (const n of simNodes) {
      if (n.x !== undefined) n.x += (Math.random() - 0.5) * 3;
      if (n.y !== undefined) n.y += (Math.random() - 0.5) * 3;
    }
    simulationRef.current = simulation;

    /* Canvas contours */
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    let contourTimer: ReturnType<typeof setTimeout> | null = null;
    function drawContours() {
      if (contourTimer) clearTimeout(contourTimer);
      contourTimer = setTimeout(() => {
        const ctx = canvas!.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        // Background terrain grid
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < H; y += 40) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        for (let x = 0; x < W; x += 40) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }

        const pts = simNodes.filter(n => n.x != null && n.y != null);
        if (pts.length < 3) return;
        try {
          const density = d3.contourDensity<SimNode>()
            .x(d => d.x ?? 0).y(d => d.y ?? 0)
            .size([W, H]).bandwidth(15).thresholds(contourThresholdsRef.current)(pts);
          const geo = d3.geoPath().context(ctx);

          // Draw contour layers with gradient fill
          for (let i = 0; i < density.length; i++) {
            ctx.beginPath();
            const progress = i / density.length;
            const alpha = 0.03 + progress * 0.12;
            if (isDark) {
              ctx.fillStyle = `rgba(79, 138, 103, ${alpha})`;
              ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 + progress * 0.08})`;
            } else {
              ctx.fillStyle = `rgba(79, 138, 103, ${alpha * 0.5})`;
              ctx.strokeStyle = `rgba(0, 0, 0, ${0.03 + progress * 0.06})`;
            }
            ctx.lineWidth = progress > 0.7 ? 1.2 : 0.6;
            geo(density[i] as unknown as d3.GeoPermissibleObjects);
            ctx.fill();
            ctx.stroke();
          }

          // Valley shadows (lowest density areas)
          const valleyPaths = density.filter((_, i) => i < density.length * 0.15);
          for (const contour of valleyPaths) {
            ctx.beginPath();
            geo(contour as unknown as d3.GeoPermissibleObjects);
            ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.04)';
            ctx.fill();
          }

          // Peak highlight (top 25% contours)
          const peakPaths = density.filter((_, i) => i >= density.length * 0.75);
          for (const contour of peakPaths) {
            ctx.beginPath();
            geo(contour as unknown as d3.GeoPermissibleObjects);
            ctx.fillStyle = isDark ? 'rgba(255, 255, 200, 0.04)' : 'rgba(255, 255, 255, 0.15)';
            ctx.fill();
          }
        } catch { /* contour can fail on degenerate data */ }
      }, 60);
    }

    /* SVG setup */
    const svgSel = d3.select(svg).attr('width', W).attr('height', H);
    svgSel.selectAll('*').remove();

    /* Defs */
    const defs = svgSel.append('defs');
    const glowFilter = defs.append('filter')
      .attr('id', 'valley-glow').attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 3).attr('result', 'blur');
    glowFilter.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', (d: string) => d);

    const headGlow = defs.append('filter')
      .attr('id', 'valley-head-glow').attr('x', '-80%').attr('y', '-80%')
      .attr('width', '260%').attr('height', '260%');
    headGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 6).attr('result', 'blur');
    headGlow.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', (d: string) => d);

    // Peak radial gradient
    const peakGrad = defs.append('radialGradient')
      .attr('id', 'peak-glow').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    peakGrad.append('stop').attr('offset', '0%').attr('stop-color', '#FFD700').attr('stop-opacity', 0.6);
    peakGrad.append('stop').attr('offset', '60%').attr('stop-color', '#FFD700').attr('stop-opacity', 0.2);
    peakGrad.append('stop').attr('offset', '100%').attr('stop-color', '#FFD700').attr('stop-opacity', 0);

    for (const [layer, color] of Object.entries(LAYER_ACCENTS)) {
      const grad = defs.append('radialGradient')
        .attr('id', `grad-${layer}`).attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 1);
      grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.3);
    }

    const gRoot = svgSel.append('g').attr('class', 'valley-root');
    const gEdges = gRoot.append('g').attr('class', 'valley-edges');
    const gNodes = gRoot.append('g').attr('class', 'valley-nodes');
    const gPeaks = gRoot.append('g').attr('class', 'valley-peaks');
    const gLabels = gRoot.append('g').attr('class', 'valley-labels');

    /* Zoom */
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const tfStr = event.transform.toString();
        gRoot.attr('transform', tfStr);
        // 同步 canvas 等高线层 transform，避免与 SVG 节点分离
        if (canvas) {
          canvas.style.transformOrigin = '0 0';
          canvas.style.transform = tfStr;
        }
        transformRef.current = event.transform;
        setZoomLevel(event.transform.k);
        // Toggle non-cluster labels based on zoom level
        const k = event.transform.k;
        gLabels.selectAll<SVGGElement, SimNode>('g')
          .attr('display', (d: SimNode) => (k < 1.5 && !d.isClusterHead) ? 'none' : null);
      });
    svgSel.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    /* Edges — bezier curves */
    const edgeSel = gEdges.selectAll<SVGPathElement, SimLink>('path')
      .data(simLinks).join('path')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.18)')
      .attr('stroke-width', (d: SimLink) => Math.max(0.5, (d.weight ?? 1) * 2))
      .attr('stroke-opacity', (d: SimLink) => 0.2 + (d.strength ?? 0.5) * 0.3);

    /* Nodes */
    const nodeSel = gNodes.selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes, (d: SimNode) => d.id).join('circle')
      .attr('r', (d: SimNode) => nodeRadius(d, degreeMap.get(d.id) ?? 0))
      .attr('fill', (d: SimNode) => d.isClusterHead ? '#FFD700' : `url(#grad-${d.layer})`)
      .attr('stroke', (d: SimNode) => d.isClusterHead ? 'rgba(255,215,0,0.6)' : 'rgba(255,255,255,0.3)')
      .attr('stroke-width', (d: SimNode) => d.isClusterHead ? 2 : 1)
      .attr('filter', (d: SimNode) => d.isClusterHead ? 'url(#valley-head-glow)' : 'url(#valley-glow)')
      .attr('cursor', 'pointer')
      .attr('role', 'button')
      .attr('aria-label', (d: SimNode) => `${d.title} (${userFacingLayer(d.layer, language)})`)
      .on('mouseenter', function(_event: unknown, d: SimNode) {
        setHoveredNode(d.id);
        d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2.5);
      })
      .on('mouseleave', function(_event: unknown, d: SimNode) {
        setHoveredNode(null);
        d3.select(this)
          .attr('stroke', d.isClusterHead ? 'rgba(255,215,0,0.6)' : 'rgba(255,255,255,0.3)')
          .attr('stroke-width', d.isClusterHead ? 2 : 1);
      })
      .on('click', (event: MouseEvent, d: SimNode) => { event.stopPropagation(); setSelectedNode(d); });

    /* Peak markers for cluster heads */
    const peakNodes = simNodes.filter(n => n.isClusterHead);
    const peakSel = gPeaks.selectAll<SVGGElement, SimNode>('g')
      .data(peakNodes, (d: SimNode) => d.id).join('g')
      .attr('pointer-events', 'none');

    // Outer glow halo
    peakSel.append('circle')
      .attr('r', 18).attr('fill', 'url(#peak-glow)').attr('opacity', 0.4)
      .each(function() {
        const el = d3.select(this);
        el.append('animate').attr('attributeName', 'r').attr('values', '16;20;16').attr('dur', '4s').attr('repeatCount', 'indefinite');
        el.append('animate').attr('attributeName', 'opacity').attr('values', '0.3;0.5;0.3').attr('dur', '4s').attr('repeatCount', 'indefinite');
      });

    // Mid ring
    peakSel.append('circle')
      .attr('r', 10).attr('fill', 'none').attr('stroke', 'rgba(255,215,0,0.4)').attr('stroke-width', 1)
      .each(function() {
        d3.select(this).append('animate').attr('attributeName', 'r').attr('values', '9;12;9').attr('dur', '3s').attr('repeatCount', 'indefinite');
      });

    // Core glow point
    peakSel.append('circle')
      .attr('r', 6).attr('fill', '#FFD700').attr('filter', 'url(#valley-head-glow)');

    // Mountain triangle marker
    peakSel.append('polygon')
      .attr('points', '0,-8 3,-2 -3,-2').attr('fill', '#FFD700').attr('opacity', 0.8);

    /* Drag */
    const dragBehavior = d3.drag<SVGCircleElement, SimNode>()
      .on('start', (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    nodeSel.call(dragBehavior);

    /* Labels — zoom-dependent visibility */
    const labelNodes = simNodes.filter(n => {
      const isClusterHead = n.isClusterHead;
      if (zoomLevelRef.current < 1.5 && !isClusterHead) return false;
      return isClusterHead || (degreeMap.get(n.id) ?? 0) >= 2 || layerRank(n.layer) < 2;
    });
    const labelSel = gLabels.selectAll<SVGGElement, SimNode>('g')
      .data(labelNodes, (d: SimNode) => d.id).join('g')
      .attr('pointer-events', 'none');

    labelSel.append('rect').attr('rx', 3).attr('ry', 3).attr('fill', 'rgba(0,0,0,0.55)').attr('stroke', 'none');
    labelSel.append('text')
      .attr('font-size', (d: SimNode) => d.isClusterHead ? 12 : 10)
      .attr('font-weight', (d: SimNode) => d.isClusterHead ? 'bold' : 'normal')
      .attr('fill', 'rgba(255,255,255,0.88)')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'system-ui, sans-serif')
      .text((d: SimNode) => redactSensitiveText(d.title).slice(0, 20));

    labelSel.each(function() {
      const g = d3.select(this);
      const text = g.select('text');
      const bbox = (text.node() as SVGTextElement)?.getBBox();
      if (bbox) {
        g.select('rect')
          .attr('x', bbox.x - 3).attr('y', bbox.y - 1)
          .attr('width', bbox.width + 6).attr('height', bbox.height + 2);
      }
    });

    /* Tick */
    simulation.on('tick', () => {
      drawContours();
      edgeSel.attr('d', (d: SimLink) => {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
        const my = ((s.y ?? 0) + (t.y ?? 0)) / 2 - 15;
        return `M${s.x ?? 0},${s.y ?? 0} Q${mx},${my} ${t.x ?? 0},${t.y ?? 0}`;
      });
      nodeSel.attr('cx', (d: SimNode) => d.x ?? 0).attr('cy', (d: SimNode) => d.y ?? 0);
      peakSel.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      labelSel.attr('transform', (d: SimNode) => {
        const r = nodeRadius(d, degreeMap.get(d.id) ?? 0);
        return `translate(${d.x ?? 0},${(d.y ?? 0) - r - 8})`;
      });
    });

    /* Highlight hovered node edges */
    let prevHovered: string | null = null;
    const hoverInterval = setInterval(() => {
      const current = hoveredRef.current;
      if (current === prevHovered) return;
      prevHovered = current;
      if (current) {
        edgeSel
          .attr('stroke', (d: SimLink) => {
            const s = (d.source as SimNode).id;
            const t = (d.target as SimNode).id;
            return s === current || t === current ? '#fff' : 'rgba(255,255,255,0.18)';
          })
          .attr('stroke-opacity', (d: SimLink) => {
            const s = (d.source as SimNode).id;
            const t = (d.target as SimNode).id;
            return s === current || t === current ? 0.8 : 0.2 + (d.strength ?? 0.5) * 0.3;
          })
          .attr('stroke-width', (d: SimLink) => {
            const s = (d.source as SimNode).id;
            const t = (d.target as SimNode).id;
            return s === current || t === current ? 2.5 : Math.max(0.5, (d.weight ?? 1) * 2);
          });
      } else {
        edgeSel
          .attr('stroke', 'rgba(255,255,255,0.18)')
          .attr('stroke-opacity', (d: SimLink) => 0.2 + (d.strength ?? 0.5) * 0.3)
          .attr('stroke-width', (d: SimLink) => Math.max(0.5, (d.weight ?? 1) * 2));
      }
    }, 80);

    svgSel.on('click', () => setSelectedNode(null));

    return () => {
      simulation.stop();
      clearInterval(hoverInterval);
      if (contourTimer) clearTimeout(contourTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, dimensions]);

  /* ── Zoom controls ─────────────────────────────────────── */
  const handleZoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.4);
  }, []);
  const handleZoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
  }, []);
  const handleZoomReset = useCallback(() => {
    if (svgRef.current && zoomRef.current) d3.select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);
  const handleRotate = useCallback((delta: number) => {
    setRotation(r => r + delta);
    if (svgRef.current) {
      const W = svgRef.current.clientWidth;
      const H = svgRef.current.clientHeight;
      const g = d3.select(svgRef.current).select<SVGGElement>('.valley-root');
      const current = g.attr('transform') || '';
      const base = current.replace(/rotate\([^)]*\)/g, '').trim();
      g.attr('transform', `${base} rotate(${rotation + delta}, ${W / 2}, ${H / 2})`);
    }
  }, [rotation]);
  const handleRotateReset = useCallback(() => {
    setRotation(0);
    if (!svgRef.current) return;
    const g = d3.select(svgRef.current).select<SVGGElement>('.valley-root');
    const current = g.attr('transform') || '';
    g.attr('transform', current.replace(/rotate\([^)]*\)/g, '').trim());
  }, []);

  /* ── Layer panel data ──────────────────────────────────── */
  const layerNodes = useMemo(() => {
    if (!activeLayer || !filteredData) return [];
    return filteredData.nodes.filter(n => n.layer === activeLayer).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [filteredData, activeLayer]);

  /* ── Empty / loading states ────────────────────────────── */
  if (loading) {
    return <div className="valley-loading">{language === 'zh' ? '正在加载记忆山谷…' : 'Loading memory valley…'}</div>;
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="valley-empty">
        <Inbox size={30} />
        <strong>{language === 'zh' ? '还没有形成记忆山谷' : 'No memory valleys yet'}</strong>
        <span>{language === 'zh' ? '当记忆被邮件、项目、标签或关系串联后，会在这里自然聚成主题。' : 'Memories will gather here as mail, projects, tags, and relationships connect them.'}</span>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────────────── */
  const hasTimeSlider = timeExtent[1] > timeExtent[0];
  return (
    <div className="valley-page" ref={containerRef}>
      <canvas ref={canvasRef} className="valley-canvas" />
      <svg ref={svgRef} className="valley-svg" />

      {/* Header overlay */}
      <header className="valley-header">
        <div>
          <span>{language === 'zh' ? '记忆关系图谱' : 'MEMORY RELATIONSHIP GRAPH'}</span>
          <h2>{language === 'zh' ? '记忆山谷' : 'Memory Valley'}</h2>
          <p>{language === 'zh'
            ? `共 ${data.nodes.length} 条记忆，${data.edges.length} 条关系。拖拽、缩放探索记忆地形。`
            : `${data.nodes.length} memories, ${data.edges.length} connections. Drag, zoom, and explore.`}</p>
        </div>
        <dl>
          <div><dt>{language === 'zh' ? '主题' : 'Valleys'}</dt><dd>{valleys.length}</dd></div>
          <div><dt>{language === 'zh' ? '记忆' : 'Memories'}</dt><dd>{filteredData?.nodes.length ?? data.nodes.length}</dd></div>
          <div><dt>{language === 'zh' ? '关系' : 'Links'}</dt><dd>{filteredData?.edges.length ?? data.edges.length}</dd></div>
        </dl>
      </header>

      {/* Search bar */}
      <div className="valley-search-bar">
        <Search size={14} />
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder={language === 'zh' ? '搜索主题或记忆…' : 'Search valleys or memories…'} />
        <span>{visibleValleys.length}</span>
      </div>

      {/* Valley list sidebar */}
      <aside className="valley-sidebar">
        <div className="valley-sidebar-title">{language === 'zh' ? '主题山谷' : 'Theme Valleys'}</div>
        <div className="valley-sidebar-list">
          {visibleValleys.map((v, i) => {
            const accent = LAYER_ACCENTS[v.nodes[0]?.layer ?? 'short'] ?? LAYER_ACCENTS.short;
            const isSel = selected?.name === v.name;
            return (
              <button key={v.name} className={`valley-sidebar-item${isSel ? ' is-active' : ''}`}
                onClick={() => setSelectedValley(v.name)}
                style={{ '--v-accent': accent, '--v-idx': i } as CSSProperties}>
                <strong>{redactSensitiveText(v.name)}</strong>
                <small>{v.nodes.length} {language === 'zh' ? '条记忆' : 'memories'} · {compactDate(v.nodes[0]?.updatedAt, locale)}</small>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Selected valley detail */}
      {selected && (
        <div className="valley-detail">
          <header>
            <span>{language === 'zh' ? '当前山谷' : 'CURRENT VALLEY'}</span>
            <h3>{redactSensitiveText(selected.name)}</h3>
            <p>{language === 'zh' ? `${selected.nodes.length} 条记忆按最近更新排列。` : `${selected.nodes.length} memories, newest first.`}</p>
          </header>
          <div className="valley-detail-list">
            {selected.nodes.map(n => (
              <button key={n.id} onClick={() => onNodeClick?.(n.id)}>
                <span style={{ background: LAYER_ACCENTS[n.layer] ?? LAYER_ACCENTS.short }} />
                <div>
                  <strong>{redactSensitiveText(n.title)}</strong>
                  {n.summary && <p>{redactSensitiveText(n.summary)}</p>}
                  <small>{compactDate(n.updatedAt, locale)}{n.tags?.length ? ` · ${n.tags.slice(0, 2).join('、')}` : ''}</small>
                </div>
              </button>
            ))}
          </div>
          {nearby.length > 0 && (
            <section className="valley-nearby">
              <h4><Link size={14} />{language === 'zh' ? '通往其他山谷' : 'Paths to other valleys'}</h4>
              {nearby.map(({ edge, node }) => (
                <button key={`${edge.source}-${edge.target}-${edge.type}`} onClick={() => onNodeClick?.(node.id)}>
                  <span>{edgeLabel(edge, language)}</span>
                  <strong>{redactSensitiveText(node.title)}</strong>
                </button>
              ))}
            </section>
          )}
        </div>
      )}

      {/* Controls panel */}
      <div className="valley-controls">
        <div className="valley-controls-group">
          <span className="valley-controls-label">{language === 'zh' ? '缩放' : 'Zoom'}</span>
          <span className="valley-controls-value">{Math.round(zoomLevel * 100)}%</span>
          <button onClick={handleZoomIn} title={language === 'zh' ? '放大' : 'Zoom in'}>+</button>
          <button onClick={handleZoomOut} title={language === 'zh' ? '缩小' : 'Zoom out'}>−</button>
          <button onClick={handleZoomReset} title={language === 'zh' ? '重置' : 'Reset'}>⟲</button>
        </div>
        <div className="valley-controls-group">
          <span className="valley-controls-label">{language === 'zh' ? '旋转' : 'Rotate'}</span>
          <span className="valley-controls-value">{rotation}°</span>
          <button onClick={() => handleRotate(-15)} title={language === 'zh' ? '向左旋转' : 'Rotate left'}>↺</button>
          <button onClick={() => handleRotate(15)} title={language === 'zh' ? '向右旋转' : 'Rotate right'}>↻</button>
          <button onClick={handleRotateReset} title={language === 'zh' ? '重置旋转' : 'Reset rotation'}>N</button>
        </div>
        {/* 等高线密度滑块 */}
        <div className="valley-control-group">
          <label>{language === 'zh' ? '等高线' : 'Contours'}</label>
          <input type="range" min={6} max={60} value={contourThresholds}
            onChange={e => setContourThresholds(Number(e.target.value))}
            className="valley-control-slider" />
          <span>{contourThresholds}</span>
        </div>
        {/* 指南针 - 重置旋转 */}
        <button className="valley-control-btn" onClick={handleRotateReset} title={language === 'zh' ? '重置方向' : 'Reset rotation'}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="10" r="8"/>
            <polygon points="10,3 12,9 10,8 8,9" fill="currentColor" stroke="none"/>
            <polygon points="10,17 8,11 10,12 12,11" fill="none" stroke="currentColor"/>
            <text x="10" y="2" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none">N</text>
          </svg>
        </button>
        <div className="valley-controls-group">
          <button onClick={() => setShowLayerPanel(!showLayerPanel)} title={language === 'zh' ? '层级面板' : 'Layer panel'}>
            {language === 'zh' ? '层级' : 'Layers'}
          </button>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="valley-toolbar">
        <div className="valley-toolbar-center">
          <span className="valley-toolbar-label">{language === 'zh' ? '记录足迹' : 'Timeline'}</span>
          <select className="valley-toolbar-select" value={timeRangeDays} onChange={e => handleTimeRangeDaysChange(Number(e.target.value))}>
            <option value={0}>{language === 'zh' ? '全部时间' : 'All time'}</option>
            <option value={7}>{language === 'zh' ? '近 7 天' : 'Last 7 days'}</option>
            <option value={30}>{language === 'zh' ? '近 30 天' : 'Last 30 days'}</option>
            <option value={90}>{language === 'zh' ? '近 90 天' : 'Last 90 days'}</option>
            <option value={365}>{language === 'zh' ? '近一年' : 'Last year'}</option>
          </select>
          {hasTimeSlider && (
            <input type="range" className="valley-toolbar-slider" min={0} max={100} value={sliderValue} onChange={e => handleSliderChange(Number(e.target.value))} />
          )}
        </div>
        <div className="valley-toolbar-right">
          <span className="valley-toolbar-disclaimer">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5.5" fill="none" stroke="currentColor"/><text x="6" y="9" textAnchor="middle" fontSize="8" fill="currentColor">i</text></svg>
            {language === 'zh' ? '当前内容由 AI 生成，仅供参考' : 'AI-generated content, for reference only'}
          </span>
        </div>
      </div>

      {/* Layer panel overlay */}
      {showLayerPanel && (
        <div className="valley-layer-panel">
          <header>
            <h3>{language === 'zh' ? '记忆层级' : 'Memory Layers'}</h3>
            <button onClick={() => { setShowLayerPanel(false); setActiveLayer(null); }}><Close size={16} /></button>
          </header>
          <div className="valley-layer-tabs">
            {LAYER_ORDER.map(layer => {
              const count = filteredData?.nodes.filter(n => n.layer === layer).length ?? 0;
              return (
                <button key={layer} className={activeLayer === layer ? 'is-active' : ''}
                  onClick={() => setActiveLayer(activeLayer === layer ? null : layer)}
                  style={{ borderColor: LAYER_ACCENTS[layer] }}>
                  <span style={{ color: LAYER_ACCENTS[layer] }}>●</span> {userFacingLayer(layer, language)} ({count})
                </button>
              );
            })}
          </div>
          {activeLayer && layerNodes.length > 0 && (
            <div className="valley-layer-nodes">
              {layerNodes.map(n => (
                <button key={n.id} onClick={() => { setSelectedNode(n); setShowLayerPanel(false); }}>
                  <span style={{ background: LAYER_ACCENTS[n.layer] }} />
                  <div>
                    <strong>{redactSensitiveText(n.title)}</strong>
                    <small>{compactDate(n.updatedAt, locale)}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Node detail drawer */}
      {selectedNode && (
        <div className="valley-node-drawer">
          <header>
            <button onClick={() => setSelectedNode(null)}><ArrowLeft size={16} /></button>
            <div>
              <span style={{ color: LAYER_ACCENTS[selectedNode.layer] }}>● {userFacingLayer(selectedNode.layer, language)}</span>
              <h3>{redactSensitiveText(selectedNode.title)}</h3>
            </div>
          </header>
          {selectedNode.summary && (
            <div className="valley-node-drawer-content">
              <p className="valley-node-drawer-body">{redactSensitiveText(selectedNode.summary)}</p>
            </div>
          )}
          {selectedNode.tags && selectedNode.tags.length > 0 && (
            <div className="valley-node-drawer-tags">{selectedNode.tags.map(t => <span key={t}>{t}</span>)}</div>
          )}
          {selectedNode.project && <div className="valley-node-drawer-meta"><small>{language === 'zh' ? '项目' : 'Project'}: {selectedNode.project}</small></div>}
          {selectedNode.updatedAt && <div className="valley-node-drawer-meta"><small>{language === 'zh' ? '更新' : 'Updated'}: {compactDate(selectedNode.updatedAt, locale)}</small></div>}
          {selectedNode.valley && <div className="valley-node-drawer-meta"><small>{language === 'zh' ? '山谷' : 'Valley'}: {selectedNode.valley}</small></div>}
          {/* Related memories */}
          {selectedNode.relations && selectedNode.relations.length > 0 && (
            <div className="valley-node-drawer-relations">
              <h4>{language === 'zh' ? '关联记忆' : 'Related memories'} ({selectedNode.relations.length})</h4>
              {selectedNode.relations.map((rId: string) => {
                const rNode = nodeById.get(rId);
                if (!rNode) return null;
                return (
                  <button key={rId} onClick={() => {
                    const simNode = filteredData?.nodes.find(n => n.id === rId);
                    if (simNode) setSelectedNode(simNode);
                    else onNodeClick?.(rId);
                  }}>
                    <span style={{ background: LAYER_ACCENTS[rNode.layer] }} />
                    <div>
                      <strong>{redactSensitiveText(rNode.title)}</strong>
                      <small>{userFacingLayer(rNode.layer, language)} · {compactDate(rNode.updatedAt, locale)}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <button className="valley-node-drawer-open" onClick={() => onNodeClick?.(selectedNode.id)}>
            {language === 'zh' ? '在记忆库中打开' : 'Open in memory library'}
          </button>
        </div>
      )}
    </div>
  );
}
