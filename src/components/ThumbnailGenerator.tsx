import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ThumbnailScene } from './STLThumbnail';

interface ThumbnailGeneratorProps {
    file: string | null;
    onGenerated: (dataUrl: string) => void;
    category?: string;
}

const ThumbnailGenerator: React.FC<ThumbnailGeneratorProps> = ({ file, onGenerated, category = 'patterns' }) => {
    // If no file to generate, we still keep the Canvas mounted but render nothing significant
    // to preserve the WebGL context.
    
    return (
        <div 
            className="fixed bottom-0 right-0 w-64 h-64 pointer-events-none opacity-0 overflow-hidden" 
            style={{ zIndex: -1000 }} // Keep it out of normal flow / view
        >
            <Canvas
                gl={{ preserveDrawingBuffer: true, alpha: true }}
                frameloop="always" // Ensure it renders to capture
            >
                <Suspense fallback={null}>
                    {file && (
                        <ThumbnailScene 
                            // Remount scene when file changes to ensure clean loader/geometry state
                            key={file} 
                            url={`/${category}/${file}`} 
                            onCapture={onGenerated} 
                            interactive={false} 
                        />
                    )}
                </Suspense>
            </Canvas>
        </div>
    );
};

export default ThumbnailGenerator;
