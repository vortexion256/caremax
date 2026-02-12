import React, { useEffect, useRef } from 'react';

interface AIBrainVisualizationProps {
  isMobile: boolean;
}

const AIBrainVisualization: React.FC<AIBrainVisualizationProps> = ({ isMobile }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const items = [
    { label: 'Tools', angle: 0 },
    { label: 'Excel Sheets', angle: 45 },
    { label: 'Agent Brain', angle: 90 },
    { label: 'Notes', angle: 135 },
    { label: 'Database', angle: 180 },
    { label: 'APIs', angle: 225 },
    { label: 'Documents', angle: 270 },
    { label: 'Analytics', angle: 315 }
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
    };

    const draw = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(canvas.width, canvas.height) * (isMobile ? 0.35 : 0.38);
      const time = Date.now() * 0.0005;

      items.forEach((item) => {
        const angle = (item.angle * Math.PI) / 180;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        // Draw connecting line
        const gradient = ctx.createLinearGradient(centerX, centerY, x, y);
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.5)');
        gradient.addColorStop(0.5, 'rgba(147, 51, 234, 0.25)');
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0.08)');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Draw animated particles
        const particleCount = 2;
        for (let i = 0; i < particleCount; i++) {
          const progress = (time + i / particleCount) % 1;
          const px = centerX + Math.cos(angle) * radius * progress;
          const py = centerY + Math.sin(angle) * radius * progress;

          ctx.fillStyle = `rgba(37, 99, 235, ${0.3 * (1 - progress)})`;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw center glow
      const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 70);
      glowGradient.addColorStop(0, 'rgba(37, 99, 235, 0.1)');
      glowGradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
      ctx.fillStyle = glowGradient;
      ctx.fillRect(centerX - 70, centerY - 70, 140, 140);

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isMobile]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: isMobile ? '300px' : '380px', 
        background: '#ffffff',
        borderRadius: '16px',
        overflow: 'hidden',
        marginTop: '24px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
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
          zIndex: 1
        }}
      />
      
      {/* Central Brain Image */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          width: isMobile ? '80px' : '100px',
          height: isMobile ? '80px' : '100px',
          borderRadius: '50%',
          border: '3px solid rgba(37, 99, 235, 0.6)',
          background: 'rgba(255, 255, 255, 0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 0 30px rgba(37, 99, 235, 0.4)'
        }}
      >
        <img 
          src="/visualization/caremaxbrain.png" 
          alt="AI Brain" 
          style={{ width: '90%', height: '90%', objectFit: 'contain' }}
        />
      </div>

      {/* Nodes */}
      {items.map((item, index) => {
        const angle = (item.angle * Math.PI) / 180;
        const nodeDistance = isMobile ? 40 : 35; // Percentage distance from center

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: `${50 + Math.cos(angle) * nodeDistance}%`,
              top: `${50 + Math.sin(angle) * nodeDistance}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
              padding: isMobile ? '6px 12px' : '8px 16px',
              background: 'rgba(255, 255, 255, 0.85)',
              border: '1px solid rgba(37, 99, 235, 0.5)',
              borderRadius: '20px',
              color: '#2563eb',
              fontSize: isMobile ? '11px' : '13px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.3s ease'
            }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
};

export default AIBrainVisualization;
