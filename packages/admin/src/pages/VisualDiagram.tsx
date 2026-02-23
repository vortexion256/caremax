import { useIsMobile } from '../hooks/useIsMobile';
import AIBrainVisualization from '../components/AIBrainVisualization';

export default function VisualDiagram() {
  const { isMobile } = useIsMobile();

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Visual Diagram</h1>
      <p style={{ color: '#64748b', fontSize: isMobile ? 15 : 16, lineHeight: 1.6, marginBottom: 24 }}>
        Live visualization of the agent orchestration, handoffs, and system flow.
      </p>

      <AIBrainVisualization isMobile={isMobile} />
    </div>
  );
}
