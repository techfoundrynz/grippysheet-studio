import React from 'react';
import { Camera, X, Check, ImageDown } from 'lucide-react';
import { COLORS } from '../constants/colors';

interface ScreenshotModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCapture: (bgColor: string | null) => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ isOpen, onClose, onCapture }) => {
    const [selectedColor, setSelectedColor] = React.useState<string | null>(null); // null = transparent

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in duration-200">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 text-purple-400">
                        <div className="p-2 bg-purple-400/10 rounded-lg">
                            <Camera size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-white">Capture Screenshot</h3>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
                
                <p className="text-gray-300 text-sm leading-relaxed">
                    Capture a high-resolution (1600x1600) top-down view of your design.
                </p>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">Background Color</label>
                    <div className="grid grid-cols-5 gap-2">
                        {/* Transparent Option */}
                        <button
                            onClick={() => setSelectedColor(null)}
                            className={`h-8 rounded-md border flex items-center justify-center transition-all ${selectedColor === null ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-gray-600 hover:border-gray-500'}`}
                            title="Transparent"
                        >
                            <div className="w-full h-full bg-[linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%,#374151),linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%,#374151)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] opacity-20 rounded-sm overflow-hidden" />
                        </button>
                        
                        {/* Color Options */}
                        {Object.values(COLORS).slice(0, 9).map((color) => (
                            <button
                                key={color}
                                onClick={() => setSelectedColor(color)}
                                className={`h-8 rounded-md transition-all ${selectedColor === color ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-gray-800' : 'hover:scale-105'}`}
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                </div>
                
                <div className="pt-2">
                    <button
                        onClick={() => onCapture(selectedColor)}
                        className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-purple-500/25"
                    >
                        <ImageDown size={20} />
                        Capture Image
                    </button>
                </div>
            </div>
        </div>
    );
};
