import React, { useState, useEffect, Suspense } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { Center } from '@react-three/drei';
import * as THREE from 'three';

interface ThumbnailSceneProps {
    url: string;
    onCapture: (dataUrl: string) => void;
}

const ThumbnailScene: React.FC<ThumbnailSceneProps> = ({ url, onCapture }) => {
    const geometry = useLoader(STLLoader, url);
    const { gl, scene, camera, size } = useThree();

    useEffect(() => {
        if (!geometry) return;

        // Center the geometry
        geometry.center();
        geometry.computeBoundingSphere();
        
        const sphere = geometry.boundingSphere;
        if (sphere) {
            const fov = 40 * (Math.PI / 180); // Convert FOV to radians
            const objectSize = sphere.radius * 2.2; // Add some margin
            
            // Calculate distance to fit object (distance from camera to center)
            const distance = objectSize / (2 * Math.tan(fov / 2));
            
            // Position camera at [distance, distance, distance] relative direction, but scaled to exact distance
            const dir = new THREE.Vector3(1, 1, 1).normalize();
            camera.position.copy(dir.multiplyScalar(distance));
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();
        }

        // Trigger a render to ensure geometry is drawn
        gl.render(scene, camera);
        
        // Capture
        // Small timeout to ensure render is complete
        setTimeout(() => {
             const dataUrl = gl.domElement.toDataURL('image/png');
             onCapture(dataUrl);
        }, 50);
        
    }, [gl, scene, camera, geometry, onCapture]);

    return (
        <Center>
            <mesh geometry={geometry}>
                 {/* Standard material with some shading */}
                 <meshStandardMaterial color="#94a3b8" roughness={0.5} metalness={0.2} />
            </mesh>
        </Center>
    );
};

interface STLThumbnailProps {
    url: string;
    alt: string;
    className?: string;
}

const STLThumbnail: React.FC<STLThumbnailProps> = ({ url, alt, className }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    if (imageUrl) {
        return <img src={imageUrl} alt={alt} className={className} />;
    }

    return (
        <div className={`relative w-full h-full ${className}`}>
            <Canvas
                gl={{ preserveDrawingBuffer: true, alpha: true }}
                // Simple isometric-ish camera
                camera={{ position: [50, 50, 50], fov: 40 }}
                style={{ width: '100%', height: '100%', opacity: 0 }} // Start hidden or just rely on quick switch
                // Using opacity 0 might block capture? No, just display.
                // Let's keep it visible but maybe low alpha background
                className="pointer-events-none" // No interaction needed for thumbnail gen
            >
                <ambientLight intensity={0.7} />
                <directionalLight position={[10, 20, 10]} intensity={1} />
                <Suspense fallback={null}>
                    <ThumbnailScene url={url} onCapture={setImageUrl} />
                </Suspense>
            </Canvas>
             {/* Loading Spinner */}
             <div className="absolute inset-0 flex items-center justify-center">
                 <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin"></div>
             </div>
        </div>
    );
};

export default STLThumbnail;
