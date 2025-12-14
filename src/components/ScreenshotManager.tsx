import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ScreenshotManagerProps {
    triggerRef: React.MutableRefObject<((bgColor: string | null) => void) | null>;
    size: number;
}

const ScreenshotManager: React.FC<ScreenshotManagerProps> = ({ triggerRef, size }) => {
    const { gl, scene, camera: activeCamera } = useThree();
    
    useEffect(() => {
        triggerRef.current = (bgColor: string | null) => {
            const originalSize = new THREE.Vector2();
            gl.getSize(originalSize);
            const originalPixelRatio = gl.getPixelRatio();
            const originalBackground = scene.background;
            
            try {
                // 1. Configure High-Res Render
                const targetRes = 1600;
                gl.setPixelRatio(1);
                gl.setSize(targetRes, targetRes, false); // false = don't update CSS style
                
                // 2. Setup Background
                if (bgColor) {
                    scene.background = new THREE.Color(bgColor);
                } else {
                    scene.background = null;
                }
                
                // 3. Setup Temporary Orthographic Camera (Top Down)
                // Calculate Frustum to fit object with padding
                const padding = 1.2;
                const frustumSize = size * padding;
                const halfSize = frustumSize / 2;
                
                const shotCamera = new THREE.OrthographicCamera(
                    -halfSize, halfSize, 
                    halfSize, -halfSize, 
                    -2000, 2000
                );
                shotCamera.position.set(0, 0, 1000);
                shotCamera.lookAt(0, 0, 0);
                shotCamera.updateProjectionMatrix();

                // 4. Hide Helpers (Grid, Gizmos if any)
                const hiddenObjects: THREE.Object3D[] = [];
                scene.traverse((obj) => {
                    if (obj instanceof THREE.GridHelper || obj.type === 'GridHelper' || obj.type === 'AxesHelper') {
                        if (obj.visible) {
                            obj.visible = false;
                            hiddenObjects.push(obj);
                        }
                    }
                });

                // 5. Render & Capture
                gl.render(scene, shotCamera);
                
                // Composite Watermark (2D Canvas)
                const canvas = document.createElement('canvas');
                canvas.width = targetRes;
                canvas.height = targetRes;
                const ctx = canvas.getContext('2d');
                
                let dataUrl = '';

                if (ctx) {
                    // Draw 3D Scale
                    ctx.drawImage(gl.domElement, 0, 0);

                    // Watermark Settings
                    const fontSize = 32;
                    const lineHeight = 1.4;
                    const padding = 40;
                    
                    ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    
                    // Shadow for visibility
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    ctx.fillStyle = '#ffffff';

                    const text1 = "Made with GrippySheet Studio";
                    const text2 = "https://studio.grippysheet.com";

                    // Bottom line (URL)
                    ctx.fillText(text2, targetRes - padding, targetRes - padding);
                    // Top line (Title)
                    ctx.fillText(text1, targetRes - padding, targetRes - padding - (fontSize * lineHeight));
                    
                    dataUrl = canvas.toDataURL('image/png');
                } else {
                     // Fallback if context fails
                     dataUrl = gl.domElement.toDataURL('image/png');
                }
                
                // 6. Download
                const link = document.createElement('a');
                link.download = `grippysheet-ortho-${Date.now()}.png`;
                link.href = dataUrl;
                link.click();

                // Restore Helper Visibility
                hiddenObjects.forEach(obj => obj.visible = true);

            } catch (e) {
                console.error("Screenshot failed:", e);
            } finally {
                // Restore State
                scene.background = originalBackground;
                gl.setPixelRatio(originalPixelRatio);
                gl.setSize(originalSize.x, originalSize.y, false);
                
                // Re-render current view to prevent flicker of old buffer
                gl.render(scene, activeCamera); 
            }
        };
    }, [gl, scene, activeCamera, size, triggerRef]);

    return null;
};

export default ScreenshotManager;
