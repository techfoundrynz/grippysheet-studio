import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Box } from 'lucide-react';
import STLThumbnail from './STLThumbnail';
import DXFThumbnail from './DXFThumbnail';
import Button from './ui/Button';
import ThumbnailGenerator from './ThumbnailGenerator';

export interface PatternPreset {
    name: string;
    file: string;
    type: 'svg' | 'dxf' | 'stl';
    category: 'patterns' | 'inlays' | 'outlines';
    keepOriginalColors?: boolean;
    infoUrl?: string;
}

const PRESETS: PatternPreset[] = [
    // Patterns
    { name: 'Pyramid', file: 'pyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'GrippySheet V1', file: 'grippysheet-v1.stl', type: 'stl', category: 'patterns' },
    { name: 'Dome', file: 'dome.stl', type: 'stl', category: 'patterns' },
    { name: 'Stud', file: 'stud.stl', type: 'stl', category: 'patterns' },
    { name: 'Tryramid', file: 'tryramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Hexyramid', file: 'hexyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Bevelled Cube', file: 'bevelled-cube.stl', type: 'stl', category: 'patterns' },
    { name: 'Skewed Pyramid', file: 'pyramid-skewed.stl', type: 'stl', category: 'patterns' },
    {name: 'Nipple', file: 'nipple.stl', type: 'stl', category: 'patterns' },
    { name: 'PubGrip', file: 'pubgrip.stl', type: 'stl', category: 'patterns' },
    
    // Inlays
    { name: 'GrippySheet', file: 'grippysheet.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Alt', file: 'grippysheetalt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Badge', file: 'grippysheetbadge.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'GrippySheet Alt Badge', file: 'grippysheetbadgealt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Pubmote', file: 'pubmote.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Trogdor the Burninator', file: 'trogdor.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Spooderman', file: 'spooderman.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Dolan Duck', file: 'dolan.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'Gooby', file: 'gooby.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
    { name: 'MatixBuilt', file: 'matixbuilt.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },

    // Outlines
    { name: 'XR Stock', file: 'xrstock.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Cobra/Viper', file: 'xrcobraviper.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Kush Wide', file: 'xrkushwide.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR Mushies V2', file: 'xrmushiesv2.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'XR PubPad', file: 'xrpubpad.dxf', type: 'dxf', category: 'outlines' },
    { name: 'XR Stompies', file: 'xrstompies.dxf', type: 'dxf', category: 'outlines' },
    { name: 'XR Viperbite Wide', file: 'xrviperbitewide.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Floatwheel', file: 'floatwheel.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT Stock', file: 'gtstock.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT Kush Wide', file: 'gtkushwide.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT Mushies', file: 'gtmushies.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'GT FST', file: 'gtfst.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Pint', file: 'pint.dxf', type: 'dxf', category: 'outlines', infoUrl: 'https://www.printables.com/model/968803' },
    { name: 'Pint Matix', file: 'pintmatix.dxf', type: 'dxf', category: 'outlines' },
    { name: 'Gosmilo X7', file: 'gosmilox7.dxf', type: 'dxf', category: 'outlines' }
];

interface PatternLibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (preset: PatternPreset) => void;
    category?: 'patterns' | 'inlays' | 'outlines';
}

const PatternLibraryModal: React.FC<PatternLibraryModalProps> = ({ isOpen, onClose, onSelect, category = 'patterns' }) => {
    // State for interactive mode (single item at a time)
    const [interactiveFile, setInteractiveFile] = useState<string | null>(null);
    
    // State for thumbnail generation queue
    const [generationQueue, setGenerationQueue] = useState<string[]>([]);
    const [generatingFile, setGeneratingFile] = useState<string | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

    // Track pointer down position to distinguish clicks from drags
    const pointerDownPos = React.useRef({ x: 0, y: 0 });

    const filteredPresets = PRESETS.filter(p => p.category === category);
    const title = category === 'inlays' ? 'Inlay Library' : (category === 'outlines' ? 'Outline Library' : 'Pattern Library');

    // Reset/Initialize queue when modal opens or category changes
    useEffect(() => {
        if (isOpen && category === 'patterns') {
            const stlFiles = filteredPresets
                .filter(p => p.type === 'stl')
                .map(p => p.file);
            
            // Only queue files that don't have a thumbnail yet
            const needed = stlFiles.filter(file => !thumbnails[file]);
            setGenerationQueue(needed);
        }
    }, [isOpen, category, filteredPresets, thumbnails]);

    // Process the queue
    useEffect(() => {
        if (generationQueue.length > 0 && !generatingFile) {
            const nextFile = generationQueue[0];
            setGeneratingFile(nextFile);
            setGenerationQueue(prev => prev.slice(1));
        }
    }, [generationQueue, generatingFile]);

    const handleThumbnailGenerated = (file: string, dataUrl: string) => {
        setThumbnails(prev => ({
            ...prev,
            [file]: dataUrl
        }));
        setGeneratingFile(null); // Ready for next
    };

    if (!isOpen) return null;

    const handlePointerDown = (e: React.PointerEvent) => {
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };

    const handlePatternClick = (preset: PatternPreset, e: React.MouseEvent) => {
        const isInteractive = interactiveFile === preset.file;
        
        // Calculate distance moved
        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If moved more than 5px, treat as drag/pan and ignore select
        if (isInteractive && distance > 5) {
            return;
        }
        
        onSelect(preset);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-semibold text-white">{title}</h3>
                    </div>
                    <Button 
                        onClick={onClose}
                        variant="ghost"
                        size="icon"
                        className="text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
                    >
                        <X size={20} />
                    </Button>
                </div>
                
                <div className="p-6 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {filteredPresets.map((preset) => (
                        <div
                            key={preset.file}
                            onPointerDown={handlePointerDown}
                            onClick={(e) => handlePatternClick(preset, e)}
                            className="relative bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-purple-500/50 rounded-lg p-4 flex flex-col items-center gap-3 transition-all group cursor-pointer"
                        >
                            {/* 3D Interactive Toggle (Only for patterns) */}
                            {category === 'patterns' && preset.type === 'stl' && (
                                <div className="absolute top-2 right-2 z-20 flex gap-1">
                                    {preset.infoUrl && (
                                        <a
                                            href={preset.infoUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="p-1.5 bg-gray-900/50 hover:bg-purple-500 text-gray-400 hover:text-white rounded-md backdrop-blur-sm transition-colors"
                                            title="View Info"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    )}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setInteractiveFile(interactiveFile === preset.file ? null : preset.file);
                                        }}
                                        className={`p-1.5 rounded-md backdrop-blur-sm transition-colors ${
                                            interactiveFile === preset.file 
                                                ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30' 
                                                : 'bg-gray-900/60 text-gray-400 hover:text-white hover:bg-gray-800'
                                        }`}
                                        title={interactiveFile === preset.file ? "Exit 3D Mode" : "View in 3D"}
                                    >
                                        <Box size={14} />
                                    </button>
                                </div>
                            )}

                            {preset.infoUrl && category !== 'patterns' && (
                                <a
                                    href={preset.infoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute top-2 right-2 p-1.5 bg-gray-900/50 hover:bg-purple-500 text-gray-400 hover:text-white rounded-md backdrop-blur-sm transition-colors z-10"
                                    title="View Info"
                                >
                                    <ExternalLink size={14} />
                                </a>
                            )}

                            <div className="w-full aspect-square bg-gray-900 rounded-md flex items-center justify-center p-4">
                                {preset.type === 'stl' ? (
                                    <STLThumbnail 
                                        url={`/${preset.category}/${preset.file}`}
                                        alt={preset.name}
                                        className="w-full h-full object-contain"
                                        interactive={interactiveFile === preset.file}
                                        cachedUrl={thumbnails[preset.file]}
                                    />
                                ) : preset.type === 'dxf' ? (
                                    <DXFThumbnail
                                        url={`/${preset.category}/${preset.file}`}
                                        alt={preset.name}
                                        className="w-full h-full"
                                    />
                                ) : (
                                    <img 
                                        src={`/${preset.category}/${preset.file}`}
                                        alt={preset.name}
                                        className={`w-full h-full object-contain opacity-70 group-hover:opacity-100 transition-opacity ${
                                            preset.keepOriginalColors ? '' : 'invert'
                                        }`} 
                                    />
                                )}
                            </div>
                            <span className="text-sm font-medium text-gray-300 group-hover:text-white">{preset.name}</span>
                        </div>
                    ))}
                </div>

                {/* Single Context Generator - only for patterns which use STLs */}
                {isOpen && category === 'patterns' && (
                    <ThumbnailGenerator 
                        file={generatingFile}
                        category={category}
                        onGenerated={(dataUrl) => generatingFile && handleThumbnailGenerated(generatingFile, dataUrl)}
                    />
                )}
            </div>
        </div>
    );
};

export default PatternLibraryModal;
