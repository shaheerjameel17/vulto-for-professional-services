import type { CachedEdge, CachedNode, OptimisticCache } from "./cache";

/** An in-memory `OptimisticCache`, for tests. The real one is Stage 6's SQLite cache. */
export class MemoryCache implements OptimisticCache {
  readonly nodes = new Map<string, CachedNode>();
  readonly edges = new Map<string, CachedEdge>();
  async getNode(id: string) {
    return this.nodes.get(id);
  }
  async putNode(node: CachedNode) {
    this.nodes.set(node.nodeId, node);
  }
  async deleteNode(id: string) {
    this.nodes.delete(id);
  }
  async getEdge(id: string) {
    return this.edges.get(id);
  }
  async putEdge(edge: CachedEdge) {
    this.edges.set(edge.edgeId, edge);
  }
  async deleteEdge(id: string) {
    this.edges.delete(id);
  }
  async edgesFrom(nodeId: string, edgeType: string) {
    return [...this.edges.values()].filter(
      (e) => e.fromNodeId === nodeId && e.edgeType === edgeType,
    );
  }
  async edgesTo(nodeId: string, edgeType: string) {
    return [...this.edges.values()].filter(
      (e) => e.toNodeId === nodeId && e.edgeType === edgeType,
    );
  }
}
