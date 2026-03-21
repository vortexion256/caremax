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
  matchPriority?: number;
  activityTypes?: string[];
}

const normalizeActivityToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const toActivityTokens = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);

interface CommunicationEvent {
  sourceIndex: number;
  targetIndex: number;
  color: string;
  startTime: number;
  duration: number;
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
  const [activityActiveIndex, setActivityActiveIndex] = useState<number | null>(null);
  const [pulseBorderOnly, setPulseBorderOnly] = useState(false);
  const [communicationEvents, setCommunicationEvents] = useState<CommunicationEvent[]>([]);
  const activityHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenActivityIdsRef = useRef<Set<string>>(new Set());
  const { tenantId } = useTenant();

  const items: Item[] = [
    { label: 'Knowledge', shortLabel: 'KB', path: '/rag', color: '#3b82f6', matchPriority: 60, activityTypes: ['rag', 'knowledge', 'knowledge-base'] },
    { label: 'Brain', shortLabel: 'AB', path: '/agent-brain', color: '#8b5cf6', matchPriority: 90, activityTypes: ['agent-brain', 'brain', 'orchestrator'] },
    { label: 'Handoffs', shortLabel: 'HO', path: '/handoffs', color: '#f43f5e', matchPriority: 80, activityTypes: ['handoffs', 'handoff', 'human-handoff'] },
    { label: 'Integrations', shortLabel: 'IN', path: '/integrations', color: '#10b981', matchPriority: 10, activityTypes: ['integrations', 'integration', 'google-sheets'] },
    { label: 'WhatsApp', shortLabel: 'WA', path: '/integrations', color: '#22c55e', matchPriority: 30, activityTypes: ['whatsapp', 'whatsapp-sent', 'whatsapp-received'] },
    { label: 'Twilio', shortLabel: 'TW', path: '/integrations', color: '#ef4444', matchPriority: 100, activityTypes: ['twilio', 'twilio-whatsapp', 'whatsapp-twilio', 'whatsapp-twilio-sent', 'whatsapp-twilio-received'] },
    { label: 'Meta', shortLabel: 'MT', path: '/integrations', color: '#2563eb', matchPriority: 100, activityTypes: ['meta', 'facebook', 'graph-api', 'whatsapp-meta', 'whatsapp-meta-sent', 'whatsapp-meta-received'] },
    { label: 'Gemini', shortLabel: 'GM', path: '/integrations', color: '#0ea5e9', matchPriority: 95, activityTypes: ['gemini', 'google-gemini', 'gemini-2.5-flash-preview-tts'] },
    { label: 'Sunbird', shortLabel: 'SB', path: '/integrations', color: '#f97316', matchPriority: 95, activityTypes: ['sunbird', 'sun-bird', 'sunbrd', 'sunbird-accessed'] },
    { label: 'Google TTS', shortLabel: 'GT', path: '/integrations', color: '#f59e0b', matchPriority: 95, activityTypes: ['google-cloud-tts', 'gcp-tts', 'google-tts', 'google-cloud-tts-accessed'] },
    { label: 'ElevenLabs', shortLabel: 'EL', path: '/integrations', color: '#7c3aed', matchPriority: 95, activityTypes: ['elevenlabs', 'eleven-labs', 'elevenlabs-accessed'] },
    { label: 'Config', shortLabel: 'AC', path: '/agent', color: '#14b8a6', matchPriority: 50, activityTypes: ['agent', 'config'] }
  ];

  const findItemIndexForActivity = (activityType: string): number => {
    const rawType = String(activityType || '').trim().toLowerCase();
    if (!rawType) return -1;

    const compactType = normalizeActivityToken(rawType);
    const typeTokens = new Set(toActivityTokens(rawType));

    let bestMatch = { index: -1, score: 0, priority: -1 };

    items.forEach((item, index) => {
      const aliases = [item.path.replace('/', ''), ...(item.activityTypes || [])];
      const priority = item.matchPriority ?? 0;

      aliases.forEach((alias) => {
        const normalizedAlias = normalizeActivityToken(alias);
        const aliasTokens = toActivityTokens(alias);
        let score = 0;

        if (!normalizedAlias) return;

        if (normalizedAlias === compactType) {
          score = 100;
        } else if (aliasTokens.length > 0 && aliasTokens.every(token => typeTokens.has(token))) {
          score = 80 + Math.min(aliasTokens.length, 10);
        } else if (typeTokens.has(normalizedAlias)) {
          score = 70;
        } else if (normalizedAlias.length >= 5 && compactType.includes(normalizedAlias)) {
          score = 50;
        }

        if (
          score > bestMatch.score
          || (score === bestMatch.score && priority > bestMatch.priority)
        ) {
          bestMatch = { index, score, priority };
        }
      });
    });

    return bestMatch.score > 0 ? bestMatch.index : -1;
  };

  // Clean up old communication events
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setCommunicationEvents(prev =>
        prev.filter(event => now - event.startTime < event.duration)
      );
    }, 100);

    return () => clearInterval(cleanupInterval);
  }, []);

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

  // Animate handoff card when handoff requests occur or handoff conversations are active
  useEffect(() => {
    if (!tenantId) return;
    
    // Find handoff card index
    const handoffIndex = items.findIndex(item => item.path === '/handoffs');
    if (handoffIndex === -1) return;
    
    // Listen for conversations with handoff status
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['handoff_requested', 'human_joined'])
    );
    
    let animationInterval: ReturnType<typeof setInterval> | null = null;
    
    const unsub = onSnapshot(q, (snap) => {
      const hasActiveHandoff = snap.size > 0;
      
      if (hasActiveHandoff) {
        // Check if any conversations are in 'human_joined' status
        const hasHumanJoined = snap.docs.some(doc => doc.data().status === 'human_joined');
        const hasHandoffRequested = snap.docs.some(doc => doc.data().status === 'handoff_requested');
        
        // When human has joined, only pulse border/line; when just requested, pulse full card
        setPulseBorderOnly(hasHumanJoined && !hasHandoffRequested);
        
        console.log(`[Dashboard] Active handoff detected: ${snap.size} conversations, human_joined=${hasHumanJoined}, animating handoff card`);
        
        // Start pulsing animation for handoff card with smooth transitions
        if (!animationInterval) {
          // Create smooth pulsing animation by gradually highlighting and unhighlighting
          const pulse = () => {
            // Fade in (soft start) - highlight over 400ms
            setActiveItemIndex(handoffIndex);
            // Fade out (soft end) - unhighlight after 700ms, giving 400ms fade in + 300ms hold
            setTimeout(() => {
              setActiveItemIndex(null);
            }, 700);
          };
          
          // Start immediately, then pulse every 1500ms
          pulse();
          animationInterval = setInterval(pulse, 1500);
        }
      } else {
        console.log('[Dashboard] No active handoffs, stopping handoff card animation');
        // Stop animation when no active handoffs
        if (animationInterval) {
          clearInterval(animationInterval);
          animationInterval = null;
        }
        setActiveItemIndex(null);
        setPulseBorderOnly(false);
      }
    });
    
    return () => {
      unsub();
      if (animationInterval) {
        clearInterval(animationInterval);
      }
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    
    // Listen for real-time agent activities
    const q = query(
      collection(firestore, 'agent_activities'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) return;

        const now = Date.now();
        const brainIndex = items.findIndex(item => item.label === 'Brain');

        const addedDocs = snap.docChanges().filter(change => change.type === 'added');
        addedDocs.forEach(change => {
          if (lastSeenActivityIdsRef.current.has(change.doc.id)) return;
          lastSeenActivityIdsRef.current.add(change.doc.id);

          const activity = change.doc.data();
          const activityType = String(activity.type || '');
          const createdAt = activity.createdAt?.toMillis?.() || 0;
          const ageMs = createdAt ? now - createdAt : 0;

          if (createdAt && ageMs > 60000) {
            return;
          }

          const index = findItemIndexForActivity(activityType);
          if (index === -1) return;

          setActivityActiveIndex(index);
          if (activityHighlightTimeoutRef.current) {
            clearTimeout(activityHighlightTimeoutRef.current);
          }
          activityHighlightTimeoutRef.current = setTimeout(() => {
            setActivityActiveIndex(null);
          }, 1800);

          if (brainIndex !== -1 && brainIndex !== index) {
            setCommunicationEvents(prev => [
              ...prev,
              {
                sourceIndex: brainIndex,
                targetIndex: index,
                color: items[index].color,
                startTime: Date.now(),
                duration: 2000,
              },
            ]);
          }
        });
      },
      (error) => {
        console.error('Error listening to agent activities:', error);
      }
    );

    return () => {
      unsub();
      if (activityHighlightTimeoutRef.current) {
        clearTimeout(activityHighlightTimeoutRef.current);
      }
    };
  }, [tenantId]);

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

      // Draw regular connections to all nodes
      items.forEach((_, index) => {
        const nodeEl = nodeRefs.current[index];
        if (!nodeEl) return;

        const nodeRect = nodeEl.getBoundingClientRect();
        const targetX = nodeRect.left - containerRect.left + nodeRect.width / 2;
        const targetY = nodeRect.top - containerRect.top; // Connect to top of card

        const isHovered = hoveredIndex === index;
        const isActive = activeItemIndex === index || activityActiveIndex === index;
        const item = items[index];
        
        ctx.beginPath();
        ctx.lineWidth = (isHovered || isActive) ? 3 : 1.5;
        
        // Vertical-ish Bezier curve
        const cp1x = startX + Math.sin(time * 0.2 + index) * 20; // Reduced speed: 0.2 (was 0.5)
        const cp1y = startY + (targetY - startY) * 0.3;
        const cp2x = targetX + Math.cos(time * 0.3 + index) * 20; // Reduced speed: 0.3 (was 0.7)
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

        // Pulse particle for hovered/active items
        if (isHovered || isActive) {
          const t = (time * 0.3 + index * 0.4) % 1; // Reduced speed: 0.3 (was 0.6)
          const px = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * cp1x + 3 * (1-t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * targetX;
          const py = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * cp1y + 3 * (1-t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * targetY;

          ctx.fillStyle = (isHovered || isActive) ? item.color : 'rgba(100, 116, 139, 0.4)';
          ctx.beginPath();
          ctx.arc(px, py, (isHovered || isActive) ? 4 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw communication events (node-to-node connections)
      const now = Date.now();
      communicationEvents.forEach(event => {
        const progress = (now - event.startTime) / event.duration;
        
        if (progress < 0 || progress > 1) return;

        const sourceNode = nodeRefs.current[event.sourceIndex];
        const targetNode = nodeRefs.current[event.targetIndex];

        if (!sourceNode || !targetNode) return;

        const sourceRect = sourceNode.getBoundingClientRect();
        const targetRect = targetNode.getBoundingClientRect();

        const sourceX = sourceRect.left - containerRect.left + sourceRect.width / 2;
        const sourceY = sourceRect.top - containerRect.top + sourceRect.height / 2;
        const targetX = targetRect.left - containerRect.left + targetRect.width / 2;
        const targetY = targetRect.top - containerRect.top + targetRect.height / 2;

        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Draw animated line between nodes
        ctx.beginPath();
        ctx.lineWidth = 3;
        
        const gradient = ctx.createLinearGradient(sourceX, sourceY, targetX, targetY);
        gradient.addColorStop(0, event.color);
        gradient.addColorStop(0.5, `${event.color}80`);
        gradient.addColorStop(1, `${event.color}00`);

        ctx.strokeStyle = gradient;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw dashed line effect
        const dashLength = 10;
        const gapLength = 5;
        const angle = Math.atan2(dy, dx);

        let currentDist = 0;
        let isDash = true;

        while (currentDist < distance * progress) {
          const segmentLength = isDash ? dashLength : gapLength;
          const nextDist = Math.min(currentDist + segmentLength, distance * progress);

          const x1 = sourceX + Math.cos(angle) * currentDist;
          const y1 = sourceY + Math.sin(angle) * currentDist;
          const x2 = sourceX + Math.cos(angle) * nextDist;
          const y2 = sourceY + Math.sin(angle) * nextDist;

          if (isDash) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }

          currentDist = nextDist;
          isDash = !isDash;
        }

        // Draw glowing particle at the end of the line
        const particleX = sourceX + Math.cos(angle) * (distance * progress);
        const particleY = sourceY + Math.sin(angle) * (distance * progress);

        ctx.fillStyle = event.color;
        ctx.beginPath();
        ctx.arc(particleX, particleY, 6, 0, Math.PI * 2);
        ctx.fill();

        // Add glow effect
        ctx.fillStyle = `${event.color}40`;
        ctx.beginPath();
        ctx.arc(particleX, particleY, 12, 0, Math.PI * 2);
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
  }, [dimensions, hoveredIndex, activeItemIndex, activityActiveIndex, communicationEvents, pulseBorderOnly]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        position: 'relative', 
        width: '100%', 
        background: '#ffffff',
        borderRadius: '20px',
        padding: isMobile ? '24px 12px' : '30px 22px',
        marginTop: '24px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #f1f5f9',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: isMobile ? '30px' : '44px',
        minHeight: isMobile ? '390px' : '430px'
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
          width: isMobile ? '70px' : '92px',
          height: isMobile ? '70px' : '92px',
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
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, minmax(0, 1fr))',
          gap: isMobile ? '8px' : '14px',
          width: '100%',
          zIndex: 10,
          marginTop: 'auto'
        }}
      >
        {items.map((item, index) => {
          const handoffIndex = items.findIndex(i => i.path === '/handoffs');
          const isHandoffCard = index === handoffIndex;
          const isHighlighted = hoveredIndex === index || activeItemIndex === index || activityActiveIndex === index;
          return (
          <button
            key={index}
            ref={el => nodeRefs.current[index] = el}
            onClick={() => navigate(item.path)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              position: 'relative',
              padding: isMobile ? '10px 6px' : '12px 8px',
              // When pulseBorderOnly is true and this is the handoff card, keep background white
              background: (pulseBorderOnly && isHandoffCard && isHighlighted) 
                ? '#fff' 
                : (isHighlighted ? item.color : '#fff'),
              border: `1.5px solid ${isHighlighted ? item.color : '#e2e8f0'}`,
              borderRadius: '12px',
              // When pulseBorderOnly is true, keep text color dark
              color: (pulseBorderOnly && isHandoffCard && isHighlighted)
                ? '#475569'
                : (isHighlighted ? '#fff' : '#475569'),
              fontSize: isMobile ? '10px' : '12px',
              fontWeight: 600,
              boxShadow: isHighlighted
                ? `0 10px 15px -3px ${item.color}44` 
                : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
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
              width: isMobile ? '22px' : '28px', 
              height: isMobile ? '22px' : '28px', 
              borderRadius: '50%', 
              // When pulseBorderOnly is true, keep icon background light
              background: (pulseBorderOnly && isHandoffCard && isHighlighted)
                ? `${item.color}15`
                : (isHighlighted ? 'rgba(255,255,255,0.2)' : `${item.color}15`),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // When pulseBorderOnly is true, keep icon color as item color
              color: (pulseBorderOnly && isHandoffCard && isHighlighted)
                ? item.color
                : (isHighlighted ? '#fff' : item.color),
              fontSize: isMobile ? '9px' : '11px'
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
          );
        })}
      </div>
    </div>
  );
};

export default AIBrainVisualization;
