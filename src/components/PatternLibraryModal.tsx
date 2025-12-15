import React from 'react';
import { X } from 'lucide-react';
import STLThumbnail from './STLThumbnail';

interface PatternPreset {
    name: string;
    file: string;
    type: 'svg' | 'dxf' | 'stl';
    category: 'patterns' | 'inlays';
    keepOriginalColors?: boolean;
}

const PRESETS: PatternPreset[] = [
    { name: 'Pyramid', file: 'pyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'GrippySheet V1', file: 'grippysheet-v1.stl', type: 'stl', category: 'patterns' },
    { name: 'Dome', file: 'dome.stl', type: 'stl', category: 'patterns' },
    { name: 'Stud', file: 'stud.stl', type: 'stl', category: 'patterns' },
    { name: 'Tryramid', file: 'tryramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Hexyramid', file: 'hexyramid.stl', type: 'stl', category: 'patterns' },
    { name: 'Bevelled Cube', file: 'bevelled-cube.stl', type: 'stl', category: 'patterns' },
    { name: 'Skewed Pyramid', file: 'pyramid-skewed.stl', type: 'stl', category: 'patterns' },
    
    // Inlays
    { name: 'Pubmote', file: 'pubmote.svg', type: 'svg', category: 'inlays', keepOriginalColors: true },
];

interface PatternLibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (preset: PatternPreset) => void;
    category?: 'patterns' | 'inlays';
}

const PatternLibraryModal: React.FC<PatternLibraryModalProps> = ({ isOpen, onClose, onSelect, category = 'patterns' }) => {
    if (!isOpen) return null;

    const filteredPresets = PRESETS.filter(p => p.category === category);
    const title = category === 'inlays' ? 'Inlay Library' : 'Pattern Library';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <h3 className="text-lg font-semibold text-white">{title}</h3>
                    <button 
                        onClick={onClose}
                        className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-6 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {filteredPresets.map((preset) => (
                        <button
                            key={preset.file}
                            onClick={() => onSelect(preset)}
                            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-purple-500/50 rounded-lg p-4 flex flex-col items-center gap-3 transition-all group"
                        >
                            <div className="w-full aspect-square bg-gray-900 rounded-md flex items-center justify-center p-4">
                                {preset.type === 'stl' ? (
                                    <STLThumbnail 
                                        url={`/${preset.category}/${preset.file}`}
                                        alt={preset.name}
                                        className="w-full h-full object-contain"
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
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PatternLibraryModal;
