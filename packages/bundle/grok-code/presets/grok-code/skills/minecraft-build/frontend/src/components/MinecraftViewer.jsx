import { useRef, useMemo, useCallback, useLayoutEffect, useEffect } from "react";
import { useStore } from "../store";
import useLodestoneResources from "../hooks/useLodestoneResources";
import useCamera from "../hooks/useCamera";
import useFirstPersonCamera from "../hooks/useFirstPersonCamera";
import useRenderLoop from "../hooks/useRenderLoop";
import useMouseControls from "../hooks/useMouseControls";
import useFirstPersonControls from "../hooks/useFirstPersonControls";
import usePhysics from "../hooks/usePhysics";

export function MinecraftViewer() {
  const structureData = useStore((s) => s.structure);
  const timeOfDay = useStore((s) => s.timeOfDay);
  const viewerMode = useStore((s) => s.viewerMode);
  const setViewerMode = useStore((s) => s.setViewerMode);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const { resources, isLoading, error } = useLodestoneResources();

  const structureSize = useMemo(() => {
    if (!structureData) return null;
    return [structureData.width, structureData.height, structureData.depth];
  }, [structureData]);

  const orbitCamera = useCamera(structureSize);
  const fpCamera = useFirstPersonCamera(structureSize);
  const activeCamera = viewerMode === "orbit" ? orbitCamera : fpCamera;

  const { render, requestRender, resize, structureRef, resourcesRef, rendererRef } = useRenderLoop(
    canvasRef,
    structureData,
    resources,
    activeCamera,
    timeOfDay
  );

  const physics = usePhysics(
    fpCamera.cameraState,
    structureRef,
    resourcesRef,
    viewerMode === "playable",
    render,
    rendererRef
  );

  const exitPlayableMode = useCallback(() => {
    setViewerMode("orbit");
  }, [setViewerMode]);

  useEffect(() => {
    requestRender();
  }, [viewerMode, requestRender]);

  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  const updateCanvasSize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;

    canvas.width = clientWidth;
    canvas.height = clientHeight;
    resizeRef.current();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    updateCanvasSize();

    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [updateCanvasSize]);

  useMouseControls(canvasRef, orbitCamera, requestRender, viewerMode === "orbit");

  useFirstPersonControls(
    canvasRef,
    fpCamera,
    physics,
    requestRender,
    viewerMode === "playable",
    exitPlayableMode
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ display: isLoading || error ? "none" : "block" }}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70">
          Loading block textures...
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
