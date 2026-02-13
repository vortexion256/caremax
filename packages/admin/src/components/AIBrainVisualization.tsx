import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface AIBrainVisualizationProps {
  isMobile: boolean;
}

interface Item {
  label: string;
  angle: number;
  path: string;
  color: string;
}

const AIBrainVisualization: React.FC<AIBrainVisualizationProps> = ({ isMobile }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const items: Item[] = [
    { label: 'Knowledge Base (RAG)', angle: 210, path: '/rag', color: '#3b82f6' },
    { label: 'Auto Brain', angle: 270, path: '/agent-brain', color: '#8b5cf6' },
    { label: 'Notes', angle: 330, path: '/agent-notes', color: '#ec4899' },
    { label: 'Integrations', angle: 30, path: '/integrations', color: '#10b981' },
    { label: 'Agent Config', angle: 150, path: '/agent', color: '#f59e0b' }
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
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

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * (isMobile ? 0.32 : 0.35);
      const time = Date.now() * 0.001;

      items.forEach((item, index) => {
        const angle = (item.angle * Math.PI) / 180;
        const targetX = centerX + Math.cos(angle) * radius;
        const targetY = centerY + Math.sin(angle) * radius;

        const isHovered = hoveredIndex === index;
        
        // Draw life-like thread (Bezier curve with animation)
        ctx.beginPath();
        ctx.lineWidth = isHovered ? 3 : 2;
        
        // Dynamic control points for "life-like" movement
        const cp1x = centerX + Math.cos(angle + Math.sin(time * 0.5 + index) * 0.2) * (radius * 0.4);
        const cp1y = centerY + Math.sin(angle + Math.cos(time * 0.4 + index) * 0.2) * (radius * 0.4);
        const cp2x = centerX + Math.cos(angle + Math.cos(time * 0.6 + index) * 0.15) * (radius * 0.7);
        const cp2y = centerY + Math.sin(angle + Math.sin(time * 0.7 + index) * 0.15) * (radius * 0.7);

        ctx.moveTo(centerX, centerY);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, targetX, targetY);

        const gradient = ctx.createLinearGradient(centerX, centerY, targetX, targetY);
        if (isHovered) {
          gradient.addColorStop(0, item.color);
          gradient.addColorStop(1, `${item.color}44`);
        } else {
          gradient.addColorStop(0, 'rgba(100, 116, 139, 0.4)');
          gradient.addColorStop(1, 'rgba(100, 116, 139, 0.1)');
        }

        ctx.strokeStyle = gradient;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Animated "pulse" or particle moving along the thread
        const pulseProgress = (time * 0.8 + index * 0.5) % 1;
        const t = pulseProgress;
        // Bezier formula: (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
        const px = Math.pow(1-t, 3) * centerX + 3 * Math.pow(1-t, 2) * t * cp1x + 3 * (1-t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * targetX;
        const py = Math.pow(1-t, 3) * centerY + 3 * Math.pow(1-t, 2) * t * cp1y + 3 * (1-t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * targetY;

        ctx.fillStyle = isHovered ? item.color : 'rgba(100, 116, 139, 0.5)';
        ctx.beginPath();
        ctx.arc(px, py, isHovered ? 4 : 2, 0, Math.PI * 2);
        ctx.fill();
        
        if (isHovered) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = item.color;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      });

      // Draw center glow
      const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 60);
      glowGradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
      glowGradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
      ctx.fill();

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isMobile, hoveredIndex]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: isMobile ? '400px' : '450px', 
        background: '#ffffff',
        borderRadius: '24px',
        overflow: 'hidden',
        marginTop: '24px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #f1f5f9'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 1
        }}
      />
      
      {/* Central Agent Image */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          width: isMobile ? '90px' : '110px',
          height: isMobile ? '90px' : '110px',
          borderRadius: '50%',
          border: '4px solid #fff',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 0 40px rgba(59, 130, 246, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1)',
          cursor: 'default'
        }}
      >
        <img 
          src="/visualization/caremaxbrain.png" 
          alt="CareMax Agent" 
          style={{ width: '85%', height: '85%', objectFit: 'contain' }}
        />
      </div>

      {/* Interactive Nodes */}
      {items.map((item, index) => {
        const angle = (item.angle * Math.PI) / 180;
        const nodeDistance = isMobile ? 38 : 40; // Percentage distance from center

        return (
          <button
            key={index}
            onClick={() => navigate(item.path)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              position: 'absolute',
              left: `${50 + Math.cos(angle) * nodeDistance}%`,
              top: `${50 + Math.sin(angle) * nodeDistance}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 20,
              padding: isMobile ? '8px 14px' : '10px 20px',
              background: hoveredIndex === index ? item.color : '#fff',
              border: `1.5px solid ${hoveredIndex === index ? item.color : '#e2e8f0'}`,
              borderRadius: '12px',
              color: hoveredIndex === index ? '#fff' : '#475569',
              fontSize: isMobile ? '12px' : '14px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: hoveredIndex === index 
                ? `0 10px 15px -3px ${item.color}44` 
                : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: hoveredIndex === index ? '#fff' : item.color,
              boxShadow: hoveredIndex === index ? 'none' : `0 0 8px ${item.color}`
            }} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default AIBrainVisualization;
