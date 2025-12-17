import React, { useState, useEffect, useMemo } from 'react';
import { parseDxfToShapes, generateSVGPath } from '../utils/dxfUtils';
import * as THREE from 'three';

interface DXFThumbnailProps {
    url: string;
    alt: string;
    className?: string;
    strokeColor?: string;
}

const DXFThumbnail: React.FC<DXFThumbnailProps> = ({ url, alt, className, strokeColor = '#22c55e' }) => {
    const [pathData, setPathData] = useState<string | null>(null);
    const [viewBox, setViewBox] = useState<string>("0 0 100 100");
    const [error, setError] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let mounted = true;
        
        const loadDxf = async () => {
            try {
                setLoading(true);
                const response = await fetch(url);
                if (!response.ok) throw new Error('Failed to fetch DXF');
                const text = await response.text();
                
                if (!mounted) return;

                const shapes = parseDxfToShapes(text);
                if (shapes && shapes.length > 0) {
                     const path = generateSVGPath(shapes);
                     
                     // Calculate bounds for ViewBox
                     const bounds = new THREE.Box2();
                     shapes.forEach(s => {
                         s.getPoints().forEach((p: THREE.Vector2) => {
                             bounds.expandByPoint(p);
                         });
                     });

                     if (!bounds.isEmpty()) {
                        const min = bounds.min;
                        const max = bounds.max;
                        const width = max.x - min.x;
                        const height = max.y - min.y;
                        const padding = Math.max(width, height) * 0.1;
                        // Transform for SVG locally (scale 1, -1) handled in render or viewBox?
                        // generateSVGPath outputs raw coordinates. SVG usually +Y down. ThreeJS +Y up.
                        // To render correctly upright, we typically scale(1, -1).
                        // If we scale(1, -1), y becomes -y.
                        // Bounds: min.y ... max.y.  Scaled: -max.y ... -min.y.
                        // So viewBox top-left y should be -max.y.
                         
                        setViewBox(`${min.x - padding} ${-max.y - padding} ${width + padding * 2} ${height + padding * 2}`);
                        setPathData(path);
                     } else {
                         setError(true);
                     }
                } else {
                    setError(true);
                }
            } catch (err) {
                console.error("Error loading DXF thumbnail:", err);
                if (mounted) setError(true);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        loadDxf();

        return () => {
            mounted = false;
        };
    }, [url]);

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-gray-900 text-gray-500 text-xs ${className}`}>
                Failed
            </div>
        );
    }

    if (loading) {
         return (
            <div className={`flex items-center justify-center bg-gray-900 ${className}`}>
                 <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className={`flex items-center justify-center ${className}`}>
             <svg viewBox={viewBox} className="w-full h-full" style={{ stroke: strokeColor, fill: 'none', strokeWidth: '1px', vectorEffect: 'non-scaling-stroke' }}>
                <path d={pathData || ''} transform="scale(1, -1)" />
            </svg>
        </div>
    );
};

export default DXFThumbnail;
