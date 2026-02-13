import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';

interface AIBrainVisualizationProps {
  isMobile: boolean;
}

interface Item {
  label: string;
  shortLabel: string;
  path: string;
  color: string;
}

const AIBrainVisualization: React.FC<AIBrainVisualizationProps> = ({ isMobile }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const brainRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [handoffCount, setHandoffCount] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const { tenantId } = useTenant();

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', '==', 'handoff_requested')
    );
    const unsub = onSnapshot(q, (snap) => {
      setHandoffCount(snap.size);
    });
    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    
    // Listen for real-time agent activities
    const q = query(
      collection(firestore, 'agent_activities'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      
      const activity = snap.docs[0].data();
      const activityType = activity.type;
      const createdAt = activity.createdAt?.toMillis() || 0;
      
      // Only trigger if the activity is very recent (within the last 5 seconds)
      // to avoid triggering on old records when the component mounts
      if (Date.now() - createdAt > 5000) return;

      const index = items.findIndex(item => {
        const path = item.path.replace('/', '');
        return path === activityType || (activityType === 'rag' && path === 'rag');
      });
      
      if (index !== -1) {
        setActiveItemIndex(index);
        setTimeout(() => setActiveItemIndex(null), 3000);
      }
    });

    return () => unsub();
  }, [tenantId]);

  const items: Item[] = [
    { label: 'Knowledge Base', shortLabel: 'KB', path: '/rag', color: '#3b82f6' },
    { label: 'Auto Brain', shortLabel: 'AB', path: '/agent-brain', color: '#8b5cf6' },
    { label: 'Notes', shortLabel: 'NT', path: '/agent-notes', color: '#ec4899' },
    { label: 'Handoffs', shortLabel: 'HO', path: '/handoffs', color: '#f43f5e' },
    { label: 'Integrations', shortLabel: 'IN', path: '/integrations', color: '#10b981' },
    { label: 'Agent Config', shortLabel: 'AC', path: '/agent', color: '#f59e0b' }
  ];

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    const draw = () => {
      if (!ctx || !canvas) return;
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      ctx.clearRect(0, 0, width, height);

      if (!brainRef.current) return;

      // Get brain center coordinates relative to canvas
      const brainRect = brainRef.current.getBoundingClientRect();
      const containerRect = canvas.parentElement!.getBoundingClientRect();
      const startX = brainRect.left - containerRect.left + brainRect.width / 2;
      const startY = brainRect.top - containerRect.top + brainRect.height / 2;

      const time = Date.now() * 0.001;

        items.forEach((_, index) => {
        const nodeEl = nodeRefs.current[index];
        if (!nodeEl) return;

        const nodeRect = nodeEl.getBoundingClientRect();
        const targetX = nodeRect.left - containerRect.left + nodeRect.width / 2;
        const targetY = nodeRect.top - containerRect.top; // Connect to top of card

        const isHovered = hoveredIndex === index;
        const isActive = activeItemIndex === index;
        const item = items[index];
        
        ctx.beginPath();
        ctx.lineWidth = (isHovered || isActive) ? 3 : 1.5;
        
        // Vertical-ish Bezier curve
        const cp1x = startX + Math.sin(time * 0.5 + index) * 20;
        const cp1y = startY + (targetY - startY) * 0.3;
        const cp2x = targetX + Math.cos(time * 0.7 + index) * 20;
        const cp2y = startY + (targetY - startY) * 0.7;

        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, targetX, targetY);

        const gradient = ctx.createLinearGradient(startX, startY, targetX, targetY);
        if (isHovered || isActive) {
          gradient.addColorStop(0, item.color);
          gradient.addColorStop(1, `${item.color}44`);
        } else {
          gradient.addColorStop(0, 'rgba(100, 116, 139, 0.3)');
          gradient.addColorStop(1, 'rgba(100, 116, 139, 0.1)');
        }

        ctx.strokeStyle = gradient;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Pulse particle
        const t = (time * 0.6 + index * 0.4) % 1;
        const px = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * cp1x + 3 * (1-t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * targetX;
        const py = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * cp1y + 3 * (1-t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * targetY;

        ctx.fillStyle = (isHovered || isActive) ? item.color : 'rgba(100, 116, 139, 0.4)';
        ctx.beginPath();
        ctx.arc(px, py, (isHovered || isActive) ? 4 : 2, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [dimensions, hoveredIndex, activeItemIndex]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'relative', 
        width: '100%', 
        background: '#ffffff',
        borderRadius: '24px',
        padding: isMobile ? '30px 15px' : '40px 30px',
        marginTop: '24px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #f1f5f9',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: isMobile ? '40px' : '60px',
        minHeight: isMobile ? '450px' : '500px'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />
      
      {/* Top: Central Agent Image */}
      <div
        ref={brainRef}
        style={{
          position: 'relative',
          zIndex: 10,
          width: isMobile ? '80px' : '110px',
          height: isMobile ? '80px' : '110px',
          borderRadius: '50%',
          border: '4px solid #fff',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 0 40px rgba(59, 130, 246, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1)',
        }}
      >
        <img 
          src="/visualization/caremaxbrain.png" 
          alt="CareMax Agent" 
          style={{ width: '85%', height: '85%', objectFit: 'contain' }}
        />
      </div>

      {/* Bottom: Interactive Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
          gap: isMobile ? '8px' : '20px',
          width: '100%',
          zIndex: 10,
          marginTop: 'auto'
        }}
      >
        {items.map((item, index) => (
          <button
            key={index}
            ref={el => nodeRefs.current[index] = el}
            onClick={() => navigate(item.path)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              position: 'relative',
              padding: isMobile ? '12px 8px' : '16px 12px',
              background: (hoveredIndex === index || activeItemIndex === index) ? item.color : '#fff',
              border: `1.5px solid ${(hoveredIndex === index || activeItemIndex === index) ? item.color : '#e2e8f0'}`,
              borderRadius: '16px',
              color: (hoveredIndex === index || activeItemIndex === index) ? '#fff' : '#475569',
              fontSize: isMobile ? '11px' : '14px',
              fontWeight: 600,
              boxShadow: (hoveredIndex === index || activeItemIndex === index)
                ? `0 10px 15px -3px ${item.color}44` 
                : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              textAlign: 'center',
              width: '100%',
              minWidth: 0
            }}
          >
            {item.path === '/handoffs' && handoffCount > 0 && (
              <div style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: '#ef4444',
                color: 'white',
                borderRadius: '50%',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 'bold',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                zIndex: 20
              }}>
                {handoffCount}
              </div>
            )}
            <div style={{ 
              width: isMobile ? '24px' : '32px', 
              height: isMobile ? '24px' : '32px', 
              borderRadius: '50%', 
              background: (hoveredIndex === index || activeItemIndex === index) ? 'rgba(255,255,255,0.2)' : `${item.color}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: (hoveredIndex === index || activeItemIndex === index) ? '#fff' : item.color,
              fontSize: isMobile ? '10px' : '12px'
            }}>
              {item.shortLabel}
            </div>
            <span style={{ 
              display: 'block', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              width: '100%'
            }}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default AIBrainVisualization;
