import { useEffect, useState, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  Node,
  OnConnect,
  NodeTypes,
  NodeChange,
  EdgeChange,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api, type RagDoc } from '../api';
import { useTenant } from '../TenantContext';

type AgentNode = {
  id: string;
  name: string;
  description?: string;
  type: 'llm';
  model: string;
  systemPrompt: string;
  thinkingInstructions?: string;
  temperature: number;
  ragEnabled?: boolean;
  dataSources?: { type: 'rag' | 'sheet' | 'doc' | 'api' | 'search'; sourceId: string }[];
};

type AgentFlow = {
  name: string;
  description?: string;
  mainNodeId: string;
  nodes: AgentNode[];
  edges: {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    label?: string;
    condition?: string;
  }[];
};

type GetResponse = {
  tenantId: string;
  flow: AgentFlow;
};

function AgentNodeCard({ data }: { data: { label: string; isMain: boolean; agentId: string } }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: data.isMain ? '2px solid #1e88e5' : '1px solid #ddd',
        background: data.isMain ? '#e3f2fd' : '#fff',
        fontSize: 12,
        minWidth: 140,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#555', width: 8, height: 8 }}
      />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.label}</div>
      {data.isMain && <div style={{ fontSize: 10, color: '#1e88e5' }}>Main agent</div>}
      <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>Click to edit</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#555', width: 8, height: 8 }}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agentNode: AgentNodeCard,
};

export default function AgentFlowEditor() {
  const { tenantId } = useTenant();
  const [flow, setFlow] = useState<AgentFlow | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [ragDocuments, setRagDocuments] = useState<RagDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api<GetResponse>(`/tenants/${tenantId}/agent-flow`);
        if (cancelled) return;
        const f = data.flow;
        setFlow(f);
        // Map to React Flow nodes/edges
        const rfNodes: Node[] = f.nodes.map((n, idx) => ({
          id: n.id,
          position: { x: 100 + idx * 220, y: 80 + (idx % 2) * 120 },
          data: { label: n.name, isMain: n.id === f.mainNodeId, agentId: n.id },
          type: 'agentNode',
        }));
        const rfEdges: Edge[] = f.edges.map((e) => ({
          id: e.id,
          source: e.fromNodeId,
          target: e.toNodeId,
          label: e.label,
          animated: true,
          style: { stroke: '#90caf9' },
        }));
        setNodes(rfNodes);
        setEdges(rfEdges);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load agent flow');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    api<{ documents: RagDoc[] }>(`/tenants/${tenantId}/rag/documents`)
      .then((r) => setRagDocuments(r.documents))
      .catch(() => setRagDocuments([]));
  }, [tenantId]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setEditingAgentId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
    setEditingAgentId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  const handleRemoveConnection = useCallback(() => {
    if (!selectedEdgeId || !flow) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setFlow((f) => (f ? { ...f, edges: f.edges.filter((e) => e.id !== selectedEdgeId) } : f));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, flow]);

  const handleUpdateFlowMeta = useCallback(
    (updates: { name?: string; description?: string }) => {
      if (!flow) return;
      setFlow((f) => (f ? { ...f, ...updates } : f));
    },
    [flow]
  );

  const handleUpdateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      setFlow((f) => {
        if (!f) return f;
        return {
          ...f,
          edges: f.edges.map((e) => (e.id === edgeId ? { ...e, label: label.trim() || undefined } : e)),
        };
      });
      setEdges((eds) => eds.map((e) => (e.id === edgeId ? { ...e, label: label.trim() || undefined } : e)));
    },
    []
  );

  const onEdgesChangeHandler = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        // Sync removed edges back to flow so save persists the disconnect
        setFlow((f) => {
          if (!f) return f;
          const nextIds = new Set(next.map((e) => e.id));
          const stillPresent = f.edges.filter((e: { id: string }) => nextIds.has(e.id));
          if (stillPresent.length === f.edges.length) return f;
          return { ...f, edges: stillPresent };
        });
        return next;
      });
    },
    []
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = `${connection.source}->${connection.target}-${Date.now()}`;
      const edge: Edge = {
        id,
        source: connection.source,
        target: connection.target,
        animated: true,
        style: { stroke: '#90caf9' },
      };
      setEdges((eds) => addEdge(edge, eds));
      setFlow((f) =>
        f
          ? {
              ...f,
              edges: [
                ...f.edges,
                {
                  id,
                  fromNodeId: connection.source!,
                  toNodeId: connection.target!,
                },
              ],
            }
          : f
      );
    },
    []
  );

  const handleSetMain = (nodeId: string) => {
    if (!flow) return;
    setFlow({ ...flow, mainNodeId: nodeId });
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...(n.data as any), isMain: n.id === nodeId },
      }))
    );
  };

  const handleUpdateAgent = (agentId: string, updates: Partial<AgentNode>) => {
    if (!flow) return;
    const updatedFlow = {
      ...flow,
      nodes: flow.nodes.map((n) => (n.id === agentId ? { ...n, ...updates } : n)),
    };
    setFlow(updatedFlow);
    // Update React Flow node label if name changed
    if (updates.name) {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === agentId
            ? { ...n, data: { ...(n.data as any), label: updates.name } }
            : n
        )
      );
    }
  };

  const handleDeleteAgent = (agentId: string) => {
    if (!flow) return;
    if (flow.nodes.length === 1) {
      setError('Cannot delete the last agent');
      return;
    }
    const updatedFlow = {
      ...flow,
      nodes: flow.nodes.filter((n) => n.id !== agentId),
      edges: flow.edges.filter((e) => e.fromNodeId !== agentId && e.toNodeId !== agentId),
      mainNodeId: flow.mainNodeId === agentId ? flow.nodes.find((n) => n.id !== agentId)?.id || flow.nodes[0].id : flow.mainNodeId,
    };
    setFlow(updatedFlow);
    setNodes((ns) => ns.filter((n) => n.id !== agentId));
    setEdges((eds) => eds.filter((e) => e.source !== agentId && e.target !== agentId));
    setEditingAgentId(null);
  };

  const handleSave = async () => {
    if (!flow) return;
    setSaving(true);
    setError(null);
    try {
      await api<unknown>(`/tenants/${tenantId}/agent-flow`, {
        method: 'PUT',
        body: JSON.stringify(flow),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save flow');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAgent = () => {
    const id = `agent-${Date.now()}`;
    const newNode: AgentNode = {
      id,
      name: `Agent ${flow ? flow.nodes.length + 1 : 1}`,
      type: 'llm',
      model: 'gemini-3-flash-preview',
      systemPrompt: '',
      thinkingInstructions: 'Be concise, empathetic, and safety-conscious.',
      temperature: 0.7,
      ragEnabled: false,
      dataSources: [],
    };
    const updatedFlow: AgentFlow = flow
      ? { ...flow, nodes: [...flow.nodes, newNode] }
      : {
          name: 'Default agent flow',
          description: '',
          mainNodeId: id,
          nodes: [newNode],
          edges: [],
        };
    setFlow(updatedFlow);
    setNodes((ns) => [
      ...ns,
      {
        id,
        position: { x: 120 + ns.length * 220, y: 80 + (ns.length % 2) * 120 },
        data: { label: newNode.name, isMain: updatedFlow.mainNodeId === id, agentId: id },
        type: 'agentNode',
      },
    ]);
  };

  const editingAgent = editingAgentId ? flow?.nodes.find((n) => n.id === editingAgentId) : null;

  if (loading) return <p>Loading agent flow...</p>;

  if (!flow) {
    return <p>Failed to load agent flow.</p>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>Agent flows (beta)</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
            Add agents, connect them, and set when each specialist should be consulted so the main agent grounds replies.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
              Flow name
              <input
                value={flow.name}
                onChange={(e) => handleUpdateFlowMeta({ name: e.target.value })}
                placeholder="e.g. Care + WHO specialist"
                style={{ display: 'block', width: '100%', padding: 6, marginTop: 4, boxSizing: 'border-box', fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
              Flow description (prescription)
              <textarea
                value={flow.description || ''}
                onChange={(e) => handleUpdateFlowMeta({ description: e.target.value })}
                placeholder="e.g. Main agent answers first; consults WHO Specialist for WHO site or official health updates."
                rows={2}
                style={{ display: 'block', width: '100%', padding: 6, marginTop: 4, boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <span style={{ fontSize: 11, color: '#666', marginTop: 4, display: 'block' }}>
                Tells the main agent how to use this setup. Saved with the flow.
              </span>
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleAddAgent}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ddd',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            + Add agent
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#1e88e5',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving...' : 'Save flow'}
          </button>
        </div>
      </div>
      {error && <p style={{ color: '#c62828', fontSize: 13 }}>{error}</p>}
      {selectedEdgeId && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 16px', background: '#e3f2fd', borderRadius: 8, border: '1px solid #1e88e5' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Connection</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            When to consult:
            <input
              value={flow.edges.find((e) => e.id === selectedEdgeId)?.label ?? ''}
              onChange={(e) => handleUpdateEdgeLabel(selectedEdgeId, e.target.value)}
              placeholder="e.g. WHO site, official WHO info"
              style={{ width: 220, padding: '6px 8px', borderRadius: 6, border: '1px solid #90caf9', fontSize: 13 }}
            />
          </label>
          <button
            type="button"
            onClick={handleRemoveConnection}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #c62828',
              background: '#ffebee',
              color: '#c62828',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Remove connection
          </button>
          <button
            type="button"
            onClick={() => setSelectedEdgeId(null)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #666', background: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            Done
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 500 }}>
        <div style={{ flex: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges.map((e) => ({ ...e, selected: e.id === selectedEdgeId }))}
            onNodesChange={(changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds))}
            onEdgesChange={onEdgesChangeHandler}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background gap={16} size={1} color="#eee" />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
        {editingAgent && (
          <div
            style={{
              width: 400,
              padding: 20,
              background: '#fff',
              borderRadius: 12,
              border: '1px solid #e0e0e0',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: '100%',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Edit Agent</h2>
              <button
                type="button"
                onClick={() => setEditingAgentId(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: '#666',
                  padding: 0,
                  width: 24,
                  height: 24,
                }}
              >
                ×
              </button>
            </div>
            <label>
              Agent name
              <input
                value={editingAgent.name}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { name: e.target.value })}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box' }}
              />
            </label>
            <label>
              Description
              <input
                value={editingAgent.description || ''}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { description: e.target.value })}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box' }}
                placeholder="Optional description"
              />
            </label>
            <label>
              System prompt
              <textarea
                value={editingAgent.systemPrompt}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { systemPrompt: e.target.value })}
                rows={8}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
                placeholder="e.g. You are a first aid specialist. Provide clear, concise first aid instructions. When you need medical advice beyond basic first aid, consult the main agent."
              />
              <span style={{ fontSize: 11, color: '#666', marginTop: 4, display: 'block' }}>
                Define this agent's role. To consult another connected agent, include <code style={{ background: '#f0f0f0', padding: '2px 4px', borderRadius: 3 }}>[CONSULT: agent-name]</code> in your response. 
                The system will automatically route to that agent and combine responses.
              </span>
            </label>
            <label>
              Thinking instructions
              <textarea
                value={editingAgent.thinkingInstructions || ''}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { thinkingInstructions: e.target.value })}
                rows={3}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
                placeholder="Be concise, empathetic, and safety-conscious."
              />
            </label>
            <label>
              Model
              <select
                value={editingAgent.model}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { model: e.target.value })}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box' }}
              >
                <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              </select>
            </label>
            <label>
              Temperature (0–2)
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={editingAgent.temperature}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { temperature: Number(e.target.value) })}
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={editingAgent.ragEnabled || false}
                onChange={(e) => handleUpdateAgent(editingAgent.id, { ragEnabled: e.target.checked })}
              />
              Use RAG for knowledge base
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={editingAgent.dataSources?.some((d) => d.type === 'search') ?? false}
                onChange={(e) => {
                  const current = editingAgent.dataSources ?? [];
                  const others = current.filter((d) => d.type !== 'search');
                  const next = e.target.checked
                    ? [...others, { type: 'search' as const, sourceId: 'web' }]
                    : others;
                  handleUpdateAgent(editingAgent.id, { dataSources: next });
                }}
              />
              Enable web search
            </label>
            <p style={{ fontSize: 11, color: '#666', margin: '-4px 0 0 0' }}>
              When enabled, the agent can use web search (SerpAPI or Serper). Set SERPAPI_API_KEY or SERPER_API_KEY in the API .env.
            </p>
            {editingAgent.ragEnabled && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Attach RAG documents to this agent</div>
                <p style={{ fontSize: 11, color: '#666', margin: '0 0 8px 0' }}>
                  Select which documents this agent can use. If none selected, it uses all tenant documents.
                </p>
                {ragDocuments.length === 0 ? (
                  <p style={{ fontSize: 11, color: '#888' }}>No RAG documents yet. Add some under RAG documents.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ragDocuments.map((doc) => {
                      const attached = editingAgent.dataSources?.some(
                        (d) => d.type === 'rag' && d.sourceId === doc.documentId
                      );
                      return (
                        <label key={doc.documentId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={!!attached}
                            onChange={() => {
                              const current = editingAgent.dataSources ?? [];
                              const others = current.filter((d) => !(d.type === 'rag' && d.sourceId === doc.documentId));
                              const next = attached
                                ? others
                                : [...others, { type: 'rag' as const, sourceId: doc.documentId }];
                              handleUpdateAgent(editingAgent.id, { dataSources: next });
                            }}
                          />
                          {doc.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#666', padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
              <strong>How connections work:</strong> When you connect agents with the strings (edges), at runtime the main agent is told the exact names of connected agents. It can then use <code style={{ background: '#fff', padding: '2px 4px', borderRadius: 3 }}>[CONSULT: Agent Name]</code> in its response to delegate; the system routes to that agent and combines responses. Use each agent's <strong>name</strong> (as shown on the node) in [CONSULT: ...].
            </div>
            {flow && flow.nodes.length > 1 && (
              <button
                type="button"
                onClick={() => handleDeleteAgent(editingAgent.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid #c62828',
                  background: '#fff',
                  color: '#c62828',
                  cursor: 'pointer',
                  fontSize: 13,
                  alignSelf: 'flex-start',
                }}
              >
                Delete agent
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#666' }}>
        Tip: Set a flow description so the main agent knows how to use this setup. Connect agents with arrows;
        click a connection to set “When to consult” (e.g. “WHO site, official WHO info”) so the main agent
        consults the right specialist. Save flow to persist.
      </div>
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <strong>Disconnect:</strong> Click a connection line between two agents, then press Delete or Backspace. Click "Save flow" to persist.
      </div>
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <strong>Set main agent:</strong>{' '}
        {flow.nodes.map((n, idx) => (
          <button
            key={n.id}
            type="button"
            onClick={() => handleSetMain(n.id)}
            style={{
              marginRight: 6,
              marginTop: 4,
              padding: '4px 8px',
              borderRadius: 12,
              border: n.id === flow.mainNodeId ? '1px solid #1e88e5' : '1px solid #ddd',
              background: n.id === flow.mainNodeId ? '#e3f2fd' : '#fff',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {idx + 1}. {n.name}
          </button>
        ))}
      </div>
    </div>
  );
}

