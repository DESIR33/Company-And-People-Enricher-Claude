"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";

export function MeshBackground() {
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Use documentElement so we pick up the layout viewport, not the visual
    // viewport — otherwise iOS Safari shrinks the shader when the URL bar
    // hides/shows and the user sees a seam at the bottom of the screen.
    const update = () =>
      setDimensions({
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <MeshGradient
        width={dimensions.width}
        height={dimensions.height}
        colors={["#C15F3C", "#F4F3EE", "#B1ADA1", "#fde8da", "#f9cfc0", "#F4F3EE"]}
        distortion={0.6}
        swirl={0.5}
        grainMixer={0}
        grainOverlay={0}
        speed={0.3}
        offsetX={0.05}
      />
      {/* Soft white veil so content remains readable */}
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
    </div>
  );
}
