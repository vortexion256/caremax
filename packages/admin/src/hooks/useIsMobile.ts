import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [isVerySmall, setIsVerySmall] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 400;
  });
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsVerySmall(window.innerWidth < 400);
    };
    window.addEventListener('resize', handleResize);
    // Also listen to orientation changes
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);
  
  return { isMobile, isVerySmall };
}
