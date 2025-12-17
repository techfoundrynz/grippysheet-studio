import React, { useEffect, Suspense } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { Stage, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';

export interface ThumbnailSceneProps {
    url: string;
    onCapture?: (dataUrl: string) => void;
    interactive: boolean;
}

export const ThumbnailScene: React.FC<ThumbnailSceneProps> = ({ url, onCapture, interactive }) => {
    const geometry = useLoader(STLLoader, url);
    const { gl, scene, camera } = useThree();

    React.useLayoutEffect(() => {
        if (!geometry) return;
        
        // 1. Center geometry
        geometry.computeBoundingSphere();
        const sphere = geometry.boundingSphere;
        
        if (sphere) {
            // 2. Position camera manually to fit object immediately
            const radius = sphere.radius;
            // Calculate distance to fit sphere with margin
            // FOV 50 is default for makeDefault camera usually, but Stage might set it.
            // Let's assume standard perspective or read it.
            const fov = (camera as THREE.PerspectiveCamera).fov || 50;
            const dist = (radius * 1.5) / Math.sin((fov * Math.PI) / 360);
            
            // Standard isometric-ish angle
            const isoFactor = 1 / Math.sqrt(3);
            camera.position.set(dist * isoFactor, dist * isoFactor, dist * isoFactor);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();
        }

        // 3. Render and Capture immediately
        if (!interactive && onCapture) {
             gl.render(scene, camera);
             const dataUrl = gl.domElement.toDataURL('image/png');
             onCapture(dataUrl);
        }
    }, [gl, scene, camera, onCapture, geometry, interactive]);

    return (
        <Stage 
            intensity={0.5} 
            environment="city" 
            adjustCamera={false} // Disable auto-adjust to prevent race condition/animation
            preset="rembrandt"
            shadows={false}
        >
            <mesh geometry={geometry} rotation={[-Math.PI / 3, 0, Math.PI / 4]}>
                 <meshStandardMaterial color="#94a3b8" roughness={0.5} metalness={0.2} side={THREE.DoubleSide} />
            </mesh>
            {interactive && <OrbitControls makeDefault />}
        </Stage>
    );
};

interface STLThumbnailProps {
    url: string;
    alt?: string;
    className?: string;
    interactive?: boolean;
    cachedUrl?: string | null;
}

const STLThumbnail: React.FC<STLThumbnailProps> = ({ 
    url, 
    alt, 
    className, 
    interactive = false,
    cachedUrl
}) => {
    // If we have a cached URL and we're not in interactive mode, just show the image
    if (cachedUrl && !interactive) {
        return <img src={cachedUrl} alt={alt} className={className} />;
    }

    // If interactve, show the specialized interactive canvas
    if (interactive) {
        return (
            <div className={`relative w-full h-full ${className}`}>
                <Canvas
                    gl={{ preserveDrawingBuffer: true, alpha: true }}
                    style={{ width: '100%', height: '100%' }}
                >
                    <Suspense fallback={null}>
                        <ThumbnailScene 
                            url={url} 
                            interactive={true} 
                        />
                    </Suspense>
                </Canvas>
            </div>
        );
    }

    // Otherwise show loading placeholder while waiting for generator
    return (
        <div className={`relative w-full h-full flex items-center justify-center bg-gray-900/50 rounded-lg ${className}`}>
             <Loader2 className="w-6 h-6 text-gray-600 animate-spin" />
        </div>
    );
};

export default STLThumbnail;
