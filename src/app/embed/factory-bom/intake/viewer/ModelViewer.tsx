"use client";

import React, { useEffect, useRef, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Center } from "@react-three/drei";
import * as THREE from "three";

interface ModelViewerProps {
  blobUrl: string;
  onError?: (error: Error) => void;
}

function InnerModel({ url }: { url: string }) {
  const gltf = useGLTF(url, false, false); // Disable Draco / Meshopt remote loaders

  useEffect(() => {
    return () => {
      // Clean up cached assets and explicitly dispose geometries, materials, and textures
      if (gltf.scene) {
        const disposeMaterial = (mat: THREE.Material) => {
          for (const value of Object.values(mat)) {
            if (
              value &&
              typeof value === "object" &&
              "isTexture" in value &&
              typeof (value as { dispose?: unknown }).dispose === "function"
            ) {
              (value as THREE.Texture).dispose();
            }
          }
          mat.dispose();
        };

        gltf.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) {
              mesh.geometry.dispose();
            }
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(disposeMaterial);
              } else {
                disposeMaterial(mesh.material);
              }
            }
          }
        });
      }
      useGLTF.clear(url);
    };
  }, [url, gltf.scene]);

  return (
    <Center top>
      <primitive object={gltf.scene} />
    </Center>
  );
}

class WebGLErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center text-sm text-stone-500 bg-stone-50 dark:bg-stone-900 rounded-xl h-64 border border-stone-200 dark:border-stone-800">
          <p className="font-medium text-stone-700 dark:text-stone-300 mb-1">
            Preview paused
          </p>
          <p className="text-xs text-stone-400 mb-3 max-w-xs">
            We couldn't render this 3D model in your browser. The file will still be uploaded and processed on the server.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ModelViewer({ blobUrl, onError }: ModelViewerProps) {
  const [contextLost, setContextLost] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  if (contextLost) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-sm text-stone-500 bg-stone-50 dark:bg-stone-900 rounded-xl h-64 border border-stone-200 dark:border-stone-800">
        <p className="font-medium text-stone-700 dark:text-stone-300 mb-1">
          3D graphics context was paused
        </p>
        <button
          type="button"
          onClick={() => setContextLost(false)}
          className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium mt-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-72 sm:h-80 bg-gradient-to-b from-stone-100 to-stone-50 dark:from-stone-900 dark:to-stone-950 rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 touch-pan-y"
    >
      <WebGLErrorBoundary onError={onError}>
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            powerPreference: "low-power",
            toneMapping: THREE.ACESFilmicToneMapping,
          }}
          camera={{ position: [0, 1.5, 3], fov: 45 }}
          onCreated={({ gl }) => {
            const canvas = gl.domElement;
            const handleContextLost = (e: Event) => {
              e.preventDefault();
              setContextLost(true);
            };
            canvas.addEventListener("webglcontextlost", handleContextLost, false);
          }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <hemisphereLight
            color="#ffffff"
            groundColor="#888888"
            intensity={0.4}
          />
          <Suspense fallback={null}>
            <InnerModel url={blobUrl} />
          </Suspense>
          <OrbitControls
            makeDefault
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            autoRotate={false}
            minDistance={0.5}
            maxDistance={15}
          />
        </Canvas>
      </WebGLErrorBoundary>
      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/40 backdrop-blur-md rounded text-[10px] text-white/80 pointer-events-none">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}
