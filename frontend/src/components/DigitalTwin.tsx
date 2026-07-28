import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { LatencySample, RouteHop, RouteSnapshot } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  domain: string;
  routes: RouteSnapshot[];
  latencySamples: LatencySample[];
}

/**
 * A traceroute rendered so the geometry itself carries meaning, rather than
 * being decorative. Each axis encodes one real dimension of the measurement:
 *
 *   X — position in the path (hop 1 … destination)
 *   Y — round-trip latency at that hop, so the silhouette IS the latency curve
 *   Z — which network operates the hop, so every AS gets its own lane and a
 *       handoff between providers appears as a sideways step
 *
 * The previous version placed hops on a `sin`/`cos` flourish, which looked like
 * a network diagram without telling you anything: identical output regardless of
 * the numbers behind it.
 */

const PALETTE = [0x5eead4, 0x60a5fa, 0xf472b6, 0xa78bfa, 0xfbbf24, 0x34d399, 0xfb923c, 0x22d3ee];
const COLOR_PRIVATE = 0x64748b;
const COLOR_UNKNOWN = 0x475569;
const COLOR_TIMEOUT = 0xfbbf24;
const COLOR_HIGHLIGHT = 0xffffff;

const SPAN_X = 12;
const SPAN_Y = 3.4;
const LANE_Z = 1.5;
const FLOOR_Y = -2;

/** Cymru AS names are long: "GOOGLE - Google LLC, US" → "Google LLC". */
function shortAsName(name: string | undefined): string {
  if (!name) return "";
  let out = name;
  const dash = out.indexOf(" - ");
  if (dash >= 0) out = out.slice(dash + 3);
  const comma = out.lastIndexOf(",");
  if (comma > 0 && out.length - comma <= 5) out = out.slice(0, comma);
  return out.trim();
}

/** Stable identity for "which network is this", used to group and colour hops. */
function networkKey(hop: RouteHop): string {
  if (hop.private) return "private";
  if (hop.asn) return `as${hop.asn}`;
  return "unknown";
}

interface Segment {
  key: string;
  label: string;
  asn?: string;
  country?: string;
  color: number;
  hopNumbers: number[];
}

/** A segment we could actually attribute to an operator. */
function isIdentified(segment: Segment): boolean {
  return segment.key.startsWith("as");
}

/**
 * A router that declines to answer, or whose prefix Cymru doesn't have, sitting
 * between two hops of the same network is still inside that network. Left
 * un-merged it would read as traffic leaving and immediately re-entering the
 * provider — two handoffs and an extra "network crossed" that never happened.
 */
function absorbInteriorGaps(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (let index = 0; index < segments.length; index++) {
    const current = segments[index];
    const previous = out[out.length - 1];
    const next = segments[index + 1];
    if (
      !isIdentified(current) &&
      previous &&
      next &&
      previous.key === next.key &&
      isIdentified(previous)
    ) {
      previous.hopNumbers.push(...current.hopNumbers, ...next.hopNumbers);
      index++; // `next` has been folded in; don't emit it again
      continue;
    }
    out.push({ ...current, hopNumbers: [...current.hopNumbers] });
  }
  return out;
}

/** Consecutive hops on the same network collapse into one segment. */
function buildSegments(hops: RouteHop[]): Segment[] {
  const segments: Segment[] = [];
  let colorIndex = 0;
  const colorFor = new Map<string, number>();

  for (const hop of hops) {
    const key = networkKey(hop);
    let color: number;
    if (key === "private") color = COLOR_PRIVATE;
    else if (key === "unknown") color = COLOR_UNKNOWN;
    else if (colorFor.has(key)) color = colorFor.get(key)!;
    else {
      color = PALETTE[colorIndex % PALETTE.length];
      colorFor.set(key, color);
      colorIndex++;
    }

    const last = segments[segments.length - 1];
    if (last && last.key === key) {
      last.hopNumbers.push(hop.hop);
      continue;
    }
    segments.push({
      key,
      label: hop.private
        ? "Private network"
        : shortAsName(hop.as_name) || (hop.asn ? `AS${hop.asn}` : "Unidentified network"),
      asn: hop.asn,
      country: hop.country,
      color,
      hopNumbers: [hop.hop],
    });
  }
  return absorbInteriorGaps(segments);
}

interface PathAnalysis {
  segments: Segment[];
  /** Distinct operators actually identified along the path. */
  networks: number;
  /** Hops with no attributable owner, so the reader knows what's missing. */
  unattributed: number;
  responding: number;
  /** Hops that answered nothing at all. */
  silent: number;
  probesSent: number;
  probesLost: number;
  /** Largest latency increase between consecutive responding hops. */
  biggestJump: { fromHop: number; toHop: number; deltaMs: number; label: string } | null;
  /** Hops where traffic crosses from one identified network into another. */
  handoffs: { atHop: number; from: string; to: string }[];
  jitteriest: { hop: number; spreadMs: number } | null;
}

function analysePath(hops: RouteHop[], segments: Segment[]): PathAnalysis {
  const responding = hops.filter((hop) => !hop.timed_out);
  // Loss is measured only across hops that replied at least once. A router that
  // answered nothing is almost always declining to answer by policy, and
  // folding those probes in makes a perfectly healthy path look 20%+ lossy.
  let probesSent = 0;
  let probesLost = 0;
  for (const hop of responding) {
    probesSent += hop.probes_sent;
    probesLost += hop.probes_lost;
  }

  // Biggest latency increase. This is the closest thing a traceroute offers to
  // "where is the time actually going", which is the question a reader has.
  let biggestJump: PathAnalysis["biggestJump"] = null;
  for (let i = 1; i < responding.length; i++) {
    const delta = responding[i].latency_ms - responding[i - 1].latency_ms;
    if (delta > (biggestJump?.deltaMs ?? 0)) {
      biggestJump = {
        fromHop: responding[i - 1].hop,
        toHop: responding[i].hop,
        deltaMs: delta,
        label: shortAsName(responding[i].as_name) || responding[i].address || `hop ${responding[i].hop}`,
      };
    }
  }

  // Only count a handoff between two networks we could actually name. Crossing
  // into a block of unattributed hops isn't evidence of changing provider — we
  // simply don't know who owns it.
  const identified = segments.filter(isIdentified);
  const handoffs: PathAnalysis["handoffs"] = [];
  for (let i = 1; i < identified.length; i++) {
    if (identified[i].key === identified[i - 1].key) continue;
    handoffs.push({
      atHop: identified[i].hopNumbers[0],
      from: identified[i - 1].label,
      to: identified[i].label,
    });
  }

  let jitteriest: PathAnalysis["jitteriest"] = null;
  for (const hop of responding) {
    const spread = hop.max_latency_ms - hop.min_latency_ms;
    if (spread > (jitteriest?.spreadMs ?? 0)) jitteriest = { hop: hop.hop, spreadMs: spread };
  }

  return {
    segments,
    networks: new Set(identified.map((segment) => segment.key)).size,
    unattributed: hops.filter((hop) => !hop.asn && !hop.private).length,
    responding: responding.length,
    silent: hops.length - responding.length,
    probesSent,
    probesLost,
    biggestJump,
    handoffs,
    jitteriest,
  };
}

interface TwinNode {
  id: string;
  hopNumber: number | null;
  label: string;
  sublabel: string;
  kind: "source" | "hop" | "destination";
  latencyMs: number | null;
  timedOut: boolean;
  color: number;
  position: THREE.Vector3;
  hop: RouteHop | null;
}

function buildNodes(domain: string, hops: RouteHop[], segments: Segment[]): TwinNode[] {
  const laneOf = new Map<number, number>();
  segments.forEach((segment, index) => {
    for (const hopNumber of segment.hopNumbers) laneOf.set(hopNumber, index);
  });
  const colorOf = new Map<number, number>();
  segments.forEach((segment) => {
    for (const hopNumber of segment.hopNumbers) colorOf.set(hopNumber, segment.color);
  });

  const laneCount = Math.max(segments.length, 1);
  const zFor = (lane: number) => (lane - (laneCount - 1) / 2) * LANE_Z;

  const maxLatency = Math.max(...hops.map((hop) => hop.latency_ms), 1);
  const total = hops.length + 2; // source + hops + destination
  const xFor = (index: number) => -SPAN_X / 2 + (index / Math.max(total - 1, 1)) * SPAN_X;
  const yFor = (latency: number) => (latency / maxLatency) * SPAN_Y;

  const nodes: TwinNode[] = [
    {
      id: "source",
      hopNumber: null,
      label: "This machine",
      sublabel: "collector",
      kind: "source",
      latencyMs: 0,
      timedOut: false,
      color: COLOR_HIGHLIGHT,
      position: new THREE.Vector3(xFor(0), 0, zFor(0)),
      hop: null,
    },
  ];

  hops.forEach((hop, index) => {
    const lane = laneOf.get(hop.hop) ?? 0;
    // A silent hop has no measured latency. Interpolating between its
    // neighbours keeps the curve continuous without inventing a value: the node
    // is drawn as a hollow marker so it reads as "unknown", not "0 ms".
    let y: number;
    if (!hop.timed_out) {
      y = yFor(hop.latency_ms);
    } else {
      const before = hops.slice(0, index).reverse().find((other) => !other.timed_out);
      const after = hops.slice(index + 1).find((other) => !other.timed_out);
      const a = before ? yFor(before.latency_ms) : 0;
      const b = after ? yFor(after.latency_ms) : a;
      y = (a + b) / 2;
    }
    nodes.push({
      id: `hop-${hop.hop}`,
      hopNumber: hop.hop,
      label: hop.address || "no reply",
      sublabel: hop.private ? "Private network" : shortAsName(hop.as_name) || "Unidentified",
      kind: "hop",
      latencyMs: hop.timed_out ? null : hop.latency_ms,
      timedOut: hop.timed_out,
      color: hop.timed_out ? COLOR_TIMEOUT : colorOf.get(hop.hop) ?? COLOR_UNKNOWN,
      position: new THREE.Vector3(xFor(index + 1), y, zFor(lane)),
      hop,
    });
  });

  const lastResponding = [...hops].reverse().find((hop) => !hop.timed_out);
  nodes.push({
    id: "destination",
    hopNumber: null,
    label: domain,
    sublabel: "destination",
    kind: "destination",
    latencyMs: lastResponding?.latency_ms ?? null,
    timedOut: false,
    color: segments[segments.length - 1]?.color ?? COLOR_HIGHLIGHT,
    position: new THREE.Vector3(xFor(total - 1), lastResponding ? yFor(lastResponding.latency_ms) : 0, zFor(laneCount - 1)),
    hop: null,
  });

  return nodes;
}

function hexToCss(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** Canvas-texture sprite label. Keeps text in the scene without extra deps. */
function makeLabel(text: string, cssColor: string): { sprite: THREE.Sprite; texture: THREE.Texture } {
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = 256 * scale;
  canvas.height = 48 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.font = "500 20px ui-monospace, monospace";
  ctx.fillStyle = cssColor;
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 26), 4, 24);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.2, 0.6, 1);
  return { sprite, texture };
}

export default function DigitalTwin({ domain, routes, latencySamples }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const autoRotateRef = useRef(true);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());

  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const successful = useMemo(() => routes.filter((route) => route.success), [routes]);
  const latest = successful[successful.length - 1];
  const prior = successful[successful.length - 2];
  // Keyed on id so the scene isn't torn down and rebuilt (resetting the camera)
  // every time a background refresh returns an equivalent object.
  const latestId = latest?.id ?? null;

  const hops = useMemo(() => latest?.hops ?? [], [latestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const segments = useMemo(() => buildSegments(hops), [hops]);
  const analysis = useMemo(() => analysePath(hops, segments), [hops, segments]);
  const nodes = useMemo(() => buildNodes(domain, hops, segments), [domain, hops, segments]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const changedHops = useMemo(() => {
    if (!prior) return new Set<number>();
    const before = new Map(prior.hops.map((hop) => [hop.hop, hop.address]));
    const changed = new Set<number>();
    for (const hop of hops) {
      if (before.has(hop.hop) && before.get(hop.hop) !== hop.address) changed.add(hop.hop);
    }
    return changed;
  }, [prior, hops]);

  useEffect(() => {
    autoRotateRef.current = autoRotate && !reduced;
  }, [autoRotate, reduced]);

  useEffect(() => {
    if (!host.current || nodes.length === 0) return;

    const container = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f0e);
    // Fog starts beyond the default camera distance, so it adds depth to the far
    // lanes without greying out the whole path on first render.
    scene.fog = new THREE.Fog(0x0b0f0e, 20, 46);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0.5, 5.5, 13);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 22;
    controls.autoRotateSpeed = 0.55;
    controls.target.set(0, 0.6, 0);
    controls.update();
    // saveState after positioning, or reset() would snap back to the target at
    // construction time (the origin) rather than the framing we actually set up.
    controls.saveState();
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(-5, 8, 6);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(26, 26, 0x1c3835, 0x121d1c);
    grid.position.y = FLOOR_Y;
    scene.add(grid);

    const disposables: { dispose(): void }[] = [];
    const meshes = new Map<string, THREE.Mesh>();
    const clickable: THREE.Mesh[] = [];
    const meshToId = new Map<THREE.Mesh, string>();

    // Links, coloured by the latency they add. A red-hot link is where the time
    // goes — visible before reading a single number.
    const maxDelta = Math.max(
      ...nodes.slice(1).map((node, i) => Math.max(0, (node.latencyMs ?? 0) - (nodes[i].latencyMs ?? 0))),
      1
    );
    const traffic: { mesh: THREE.Mesh; start: THREE.Vector3; end: THREE.Vector3; offset: number; speed: number }[] = [];

    nodes.forEach((node, index) => {
      if (index > 0) {
        const previous = nodes[index - 1];
        const delta = Math.max(0, (node.latencyMs ?? previous.latencyMs ?? 0) - (previous.latencyMs ?? 0));
        const heat = Math.min(1, delta / maxDelta);
        const linkColor = new THREE.Color().setHSL(0.45 - heat * 0.42, 0.75, 0.35 + heat * 0.15);

        const geometry = new THREE.BufferGeometry().setFromPoints([previous.position, node.position]);
        const material = new THREE.LineBasicMaterial({
          color: linkColor,
          transparent: true,
          opacity: node.timedOut || previous.timedOut ? 0.3 : 0.85,
        });
        scene.add(new THREE.Line(geometry, material));
        disposables.push(geometry, material);

        if (!reduced) {
          const pulseGeometry = new THREE.SphereGeometry(0.075, 10, 8);
          const pulseMaterial = new THREE.MeshBasicMaterial({ color: linkColor });
          const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
          scene.add(pulse);
          disposables.push(pulseGeometry, pulseMaterial);
          // Slower pulse where latency is higher, so motion reflects the data.
          traffic.push({
            mesh: pulse,
            start: previous.position,
            end: node.position,
            offset: index * 0.28,
            speed: 0.55 / (1 + heat * 2.2),
          });
        }
      }

      // Drop line to the floor makes each node's height (its latency) readable.
      const dropGeometry = new THREE.BufferGeometry().setFromPoints([
        node.position,
        new THREE.Vector3(node.position.x, FLOOR_Y, node.position.z),
      ]);
      const dropMaterial = new THREE.LineBasicMaterial({ color: node.color, transparent: true, opacity: 0.18 });
      scene.add(new THREE.Line(dropGeometry, dropMaterial));
      disposables.push(dropGeometry, dropMaterial);

      const radius = node.kind === "hop" ? 0.26 : 0.36;
      const geometry = new THREE.SphereGeometry(radius, 24, 16);
      // Silent hops are wireframe: they didn't answer, so they shouldn't look
      // as solid and certain as the hops that did.
      const material = node.timedOut
        ? new THREE.MeshBasicMaterial({ color: node.color, wireframe: true })
        : new THREE.MeshStandardMaterial({
            color: node.color,
            emissive: node.color,
            emissiveIntensity: 0.35,
            roughness: 0.35,
          });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(node.position);
      mesh.userData.baseColor = node.color;
      scene.add(mesh);
      disposables.push(geometry, material);
      meshes.set(node.id, mesh);
      meshToId.set(mesh, node.id);
      clickable.push(mesh);
    });

    // One label per network, above the first hop it owns: this is what turns the
    // picture into a sentence — "leaves Airtel here, enters Google here".
    segments.forEach((segment) => {
      // Skip unattributed runs: "Unidentified network" floating in the scene is
      // clutter, and the absent label already reads as "we don't know".
      if (!isIdentified(segment)) return;
      const firstNode = nodes.find((node) => node.hopNumber === segment.hopNumbers[0]);
      if (!firstNode) return;
      const { sprite, texture } = makeLabel(segment.label, hexToCss(segment.color));
      sprite.position.set(firstNode.position.x + 1.1, firstNode.position.y + 0.62, firstNode.position.z);
      scene.add(sprite);
      disposables.push(texture, sprite.material);
    });

    meshesRef.current = meshes;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (clientX: number, clientY: number): string | null => {
      const box = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - box.left) / box.width) * 2 - 1;
      pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickable)[0]?.object as THREE.Mesh | undefined;
      return hit ? meshToId.get(hit) ?? null : null;
    };

    const onMove = (event: PointerEvent) => {
      const id = pick(event.clientX, event.clientY);
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      setHoveredId(id);
    };
    const onDown = (event: PointerEvent) => {
      const id = pick(event.clientX, event.clientY);
      if (id) setSelectedId(id);
    };
    const onLeave = () => setHoveredId(null);

    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frame = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      controls.autoRotate = autoRotateRef.current;
      for (const pulse of traffic) {
        const progress = ((now * 0.001 * pulse.speed + pulse.offset) % 1 + 1) % 1;
        pulse.mesh.position.lerpVectors(pulse.start, pulse.end, progress);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      controlsRef.current = null;
      for (const item of disposables) item.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      meshesRef.current = new Map();
    };
  }, [nodes, segments, reduced]);

  // Highlight lives in its own effect so selecting a hop doesn't rebuild the
  // scene and throw away the camera position.
  useEffect(() => {
    for (const [id, mesh] of meshesRef.current) {
      const isActive = id === selectedId || id === hoveredId;
      const material = mesh.material as THREE.MeshStandardMaterial & { wireframe?: boolean };
      if ("emissive" in material && material.emissive) {
        material.emissive.setHex(isActive ? COLOR_HIGHLIGHT : mesh.userData.baseColor);
        material.emissiveIntensity = isActive ? 0.9 : 0.35;
      } else {
        material.color.setHex(isActive ? COLOR_HIGHLIGHT : mesh.userData.baseColor);
      }
      const scale = id === selectedId ? 1.45 : 1;
      mesh.scale.setScalar(scale);
    }
  }, [selectedId, hoveredId, nodes]);

  if (!latest) {
    return (
      <EmptyState
        title="No successful traceroute yet."
        hint="The route collector needs one completed trace before the topology can be built. On some networks ICMP is filtered entirely, in which case this view stays empty by design."
      />
    );
  }

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const recent = latencySamples.filter((sample) => sample.success).slice(-20);
  const endToEnd = recent.length ? recent.reduce((total, sample) => total + sample.latency_ms, 0) / recent.length : null;
  const lossPct = analysis.probesSent > 0 ? (analysis.probesLost / analysis.probesSent) * 100 : 0;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-sm text-ink">Path topology</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Height is latency, depth is the operating network, left to right is the path. Drag to orbit, scroll to
            zoom, click a node to inspect it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRotate((value) => !value)}
            className="grid h-7 w-7 place-items-center rounded border border-line text-muted transition-colors hover:border-signal hover:text-signal"
            title={autoRotate ? "Pause rotation" : "Resume rotation"}
            aria-label={autoRotate ? "Pause rotation" : "Resume rotation"}
          >
            {autoRotate ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            onClick={() => controlsRef.current?.reset()}
            className="grid h-7 w-7 place-items-center rounded border border-line text-muted transition-colors hover:border-signal hover:text-signal"
            title="Reset camera"
            aria-label="Reset camera"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </header>

      {/* The headline reading: what this path actually tells you. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Stat
          label="Networks crossed"
          value={String(analysis.networks)}
          detail={
            analysis.unattributed > 0
              ? `${analysis.unattributed} hop${analysis.unattributed === 1 ? "" : "s"} unattributed`
              : `${analysis.handoffs.length} handoff${analysis.handoffs.length === 1 ? "" : "s"}`
          }
        />
        <Stat
          label="Hops responding"
          value={`${analysis.responding}/${hops.length}`}
          detail={analysis.silent ? `${analysis.silent} silent` : "all replied"}
        />
        <Stat
          label="Loss en route"
          value={`${lossPct.toFixed(0)}%`}
          detail={`${analysis.probesLost}/${analysis.probesSent} on replying hops`}
          tone={lossPct > 20 ? "warn" : undefined}
        />
        <Stat
          label="End to end"
          value={endToEnd === null ? "—" : `${Math.round(endToEnd)} ms`}
          detail="recent TCP samples"
        />
      </dl>

      <div
        ref={host}
        className="h-[280px] w-full overflow-hidden rounded-lg border border-line bg-void sm:h-[360px] lg:h-[440px]"
        role="img"
        aria-label={`Path to ${domain}: ${hops.length} hops across ${analysis.segments.length} networks. A text table of the same data follows.`}
      />

      {/* Network legend — the key to the colours and lanes in the scene. */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {analysis.segments.map((segment, index) => (
          <div key={`${segment.key}-${index}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: hexToCss(segment.color) }}
            />
            <span className="font-mono text-[11px] text-ink/80">{segment.label}</span>
            <span className="font-mono text-[10px] text-muted">
              {segment.asn ? `AS${segment.asn}` : ""} {segment.hopNumbers.length} hop
              {segment.hopNumbers.length === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* Accessible source of truth. The 3D view is an enhancement on top of
            this table, not a replacement for it — a canvas can't be tabbed
            through or read by a screen reader. */}
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="-mx-px overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  <th scope="col" className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted">Hop</th>
                  <th scope="col" className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted">Address</th>
                  <th scope="col" className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted">Network</th>
                  <th scope="col" className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted">Latency</th>
                  <th scope="col" className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted">Jitter</th>
                </tr>
              </thead>
              <tbody>
                {hops.map((hop) => {
                  const id = `hop-${hop.hop}`;
                  const isSelected = id === selectedId;
                  const spread = hop.max_latency_ms - hop.min_latency_ms;
                  const isJump = analysis.biggestJump?.toHop === hop.hop;
                  return (
                    <tr
                      key={hop.hop}
                      onClick={() => setSelectedId(id)}
                      onMouseEnter={() => setHoveredId(id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(id)}
                      onBlur={() => setHoveredId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(id);
                        }
                      }}
                      tabIndex={0}
                      aria-current={isSelected ? "true" : undefined}
                      className={`cursor-pointer border-b border-line/50 transition-colors last:border-0 focus:outline-none focus-visible:bg-surface2 ${
                        isSelected ? "bg-signal/10" : "hover:bg-surface2/50"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-[11px] text-muted">
                        {hop.hop}
                        {changedHops.has(hop.hop) && (
                          <span className="ml-1 text-warn" title="Address changed since the previous capture">
                            •
                          </span>
                        )}
                      </td>
                      <td className="max-w-[150px] truncate px-3 py-2 font-mono text-[11px] text-ink" title={hop.address}>
                        {hop.address || <span className="text-muted">no reply</span>}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-[11px]" title={hop.as_name}>
                        {hop.private ? (
                          <span className="text-muted">Private</span>
                        ) : hop.as_name ? (
                          <span className="text-ink/70">{shortAsName(hop.as_name)}</span>
                        ) : (
                          <span className="text-muted/60">—</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-[11px] ${isJump ? "text-warn" : "text-ink"}`}>
                        {hop.timed_out ? <span className="text-muted">—</span> : `${Math.round(hop.latency_ms)} ms`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-muted">
                        {hop.timed_out ? "—" : `±${Math.round(spread / 2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-4">
          {selected ? (
            <div className="rounded-lg border border-line bg-surface/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {selected.kind === "hop" ? `Hop ${selected.hopNumber}` : selected.sublabel}
                </p>
                <button
                  onClick={() => setSelectedId(null)}
                  className="font-mono text-[10px] uppercase text-muted transition-colors hover:text-ink"
                >
                  clear
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-xs text-ink">{selected.label}</p>

              {selected.hop ? (
                <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                  <Field label="Operator" value={selected.hop.private ? "Private network" : shortAsName(selected.hop.as_name) || "Unidentified"} />
                  {selected.hop.asn && <Field label="ASN" value={`AS${selected.hop.asn}${selected.hop.country ? ` · ${selected.hop.country}` : ""}`} />}
                  <Field
                    label="Latency"
                    value={selected.hop.timed_out ? "No reply" : `${Math.round(selected.hop.latency_ms)} ms`}
                    detail={
                      selected.hop.timed_out
                        ? "Every probe was dropped — often a router configured not to answer, not a fault."
                        : `range ${Math.round(selected.hop.min_latency_ms)}–${Math.round(selected.hop.max_latency_ms)} ms`
                    }
                  />
                  <Field
                    label="Probes"
                    value={`${selected.hop.probes_sent - selected.hop.probes_lost}/${selected.hop.probes_sent} answered`}
                    detail={selected.hop.probes_lost > 0 && !selected.hop.timed_out ? "Partial loss at this hop" : undefined}
                  />
                </div>
              ) : (
                <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
                  {selected.kind === "source"
                    ? "Where the trace begins — the machine running the collector."
                    : "The destination host. Its latency is taken from the final responding hop."}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-surface/40 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Reading this path</p>
              <div className="mt-3 space-y-3">
                {analysis.biggestJump ? (
                  <Field
                    label="Biggest latency jump"
                    value={`+${Math.round(analysis.biggestJump.deltaMs)} ms`}
                    detail={`Between hop ${analysis.biggestJump.fromHop} and ${analysis.biggestJump.toHop} (${analysis.biggestJump.label}) — usually the long-haul link.`}
                  />
                ) : (
                  <Field label="Biggest latency jump" value="—" detail="Not enough responding hops to compare." />
                )}
                {analysis.handoffs.length > 0 ? (
                  <Field
                    label="Leaves your provider"
                    value={`hop ${analysis.handoffs[0].atHop}`}
                    detail={`${analysis.handoffs[0].from} → ${analysis.handoffs[0].to}${
                      analysis.handoffs.length > 1 ? `, then ${analysis.handoffs.length - 1} more handoff${analysis.handoffs.length > 2 ? "s" : ""}` : ""
                    }`}
                  />
                ) : (
                  <Field
                    label="Network handoffs"
                    value="none identified"
                    detail="Every attributable hop belongs to the same network, or too few hops could be attributed to tell."
                  />
                )}
                {analysis.jitteriest && analysis.jitteriest.spreadMs > 0 && (
                  <Field
                    label="Least stable hop"
                    value={`hop ${analysis.jitteriest.hop}`}
                    detail={`${Math.round(analysis.jitteriest.spreadMs)} ms spread across its probes.`}
                  />
                )}
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
                Select any hop for detail. Intermediate hops often deprioritise probe replies, so a high reading
                mid-path doesn't necessarily mean a slow route.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-line bg-surface/40 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Capture</p>
            <p className="mt-2 font-mono text-[11px] text-ink">{new Date(latest.captured_at).toLocaleString()}</p>
            <p className="mt-1 font-mono text-[10px] text-muted">{successful.length} successful traces recorded</p>
            {prior && (
              <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
                {changedHops.size > 0
                  ? `${changedHops.size} hop${changedHops.size === 1 ? "" : "s"} changed address since the previous capture.`
                  : "Path unchanged since the previous capture."}
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "warn" }) {
  return (
    <div className="bg-void px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 font-mono text-base ${tone === "warn" ? "text-warn" : "text-ink"}`}>{value}</p>
      {detail && <p className="mt-0.5 font-mono text-[10px] text-muted/70">{detail}</p>}
    </div>
  );
}

function Field({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-xs text-ink">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-relaxed text-muted">{detail}</p>}
    </div>
  );
}
