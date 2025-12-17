import React, { useState } from 'react';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { Box, X, ExternalLink, ChevronDown, HelpCircle } from 'lucide-react';
import Button from './ui/Button';

interface WelcomeModalProps {
    onClose: () => void;
}

const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose }) => {
    const [dontShowAgain, setDontShowAgain] = useState(() => {
        return !!localStorage.getItem('welcome_modal_dismissed');
    });
    const [showHelp, setShowHelp] = useState(false);

    const handleClose = () => {
        if (dontShowAgain) {
            localStorage.setItem('welcome_modal_dismissed', 'true');
        } else {
            localStorage.removeItem('welcome_modal_dismissed');
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto custom-scrollbar p-6 space-y-6 animate-in zoom-in-95 duration-300 slide-in-from-bottom-4 flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-1">
                            Welcome to GrippySheet Studio
                        </h2>
                        <p className="text-gray-400 text-sm">Design custom printable grip tape patterns</p>
                    </div>
                    <Button 
                        onClick={handleClose}
                        variant="ghost"
                        size="icon"
                        className="text-gray-500 hover:text-white"
                    >
                        <X size={24} />
                    </Button>
                </div>

                {/* Content / Links */}
                <div className="space-y-3">
                    <p className="text-gray-300 text-sm leading-relaxed mb-4">
                        Get started by uploading your grip outline and configuring your shapes.
                    </p>

                    <div className="grid gap-3">
                         <a 
                            href="https://github.com/techfoundrynz/grippysheet-studio" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-4 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-all group"
                         >
                            <div className="p-2 bg-gray-700 rounded-lg group-hover:bg-gray-600 transition-colors text-white">
                                <SiGithub size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-200">View Source Code</h3>
                                <p className="text-xs text-gray-400">Star us on GitHub</p>
                            </div>
                            <ExternalLink size={16} className="text-gray-500 group-hover:text-cyan-400 transition-colors" />
                         </a>

                         <a 
                            href="https://www.printables.com/model/968803-onewheel-grip-tape-dxf-outlines" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-4 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-all group"
                         >
                             <div className="p-2 bg-orange-500/10 rounded-lg group-hover:bg-orange-500/20 transition-colors text-orange-500">
                                <Box size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-200">Download Templates</h3>
                                <p className="text-xs text-gray-400">Get grip outlines on Printables</p>
                            </div>
                            <ExternalLink size={16} className="text-gray-500 group-hover:text-orange-400 transition-colors" />
                         </a>
                    </div>

                    <div className="pt-4 border-t border-gray-800">
                        <button 
                            onClick={() => setShowHelp(!showHelp)}
                            className="flex items-center justify-between w-full text-left group"
                        >
                            <h3 className="text-sm font-semibold text-gray-200 group-hover:text-cyan-400 transition-colors">How to use this tool</h3>
                            <ChevronDown 
                                size={16} 
                                className={`text-gray-500 transition-transform duration-300 ${showHelp ? 'rotate-180' : ''}`} 
                            />
                        </button>
                        
                        <div className={`grid transition-all duration-300 ease-in-out ${showHelp ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
                            <div className="overflow-hidden">
                                <ol className="text-sm text-gray-400 space-y-3 list-decimal list-outside ml-4 marker:text-gray-600">
                                    <li className="pl-1"><span className="text-gray-300 font-medium">Upload your DXF file</span> for the grip outline. This will set the main shape of your grip tape.</li>
                                    <li className="pl-1"><span className="text-gray-300 font-medium">Set the thickness</span> of your grip tape. 1mm or 3mm is recommended but 1mm is recommended if you have not used 3D printed grip before.</li>
                                    <li className="pl-1"><span className="text-gray-300 font-medium">Optional - Upload a SVG file for your inlay.</span> This allows for custom backgrounds on your grip tape underneath the actual grip pattern and each color will be exported as a separate mesh for printing with multicolor printers.</li>
                                    <li className="pl-1">
                                        <span className="text-gray-300 font-medium">Configure your grip pattern</span>. You can use a 3D (STL) file here. There are various options for how these are distributed.
                                        <p className="mt-1 text-xs text-amber-500/80 italic">Please note that operations with complex geometries may take up to a minute to process.</p>
                                    </li>
                                    <li className="pl-1"><span className="text-gray-300 font-medium">Export your grip file</span> as 3MF and open in your slicer.</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer / Actions */}
                <div className="pt-2">
                    <Button
                        onClick={handleClose}
                        variant="primary"
                        size="lg"
                        className="w-full font-bold rounded-xl shadow-lg shadow-purple-900/20 active:scale-[0.98]"
                    >
                        Get Started
                    </Button>
                    
                    <div className="mt-4 flex justify-center">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    className="peer h-4 w-4 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500/50 focus:ring-offset-gray-900 transition-all"
                                    checked={dontShowAgain}
                                    onChange={(e) => setDontShowAgain(e.target.checked)}
                                />
                            </div>
                            <span className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors select-none">
                                Don't show this again
                            </span>
                        </label>
                    </div>
                    
                    <p className="text-center text-xs text-gray-600 mt-2">
                        Tip: Click the <HelpCircle size={14} className="inline text-gray-500 mb-0.5" /> logo to view this window again
                    </p>
                </div>
            </div>
        </div>
    );
};

export default WelcomeModal;
