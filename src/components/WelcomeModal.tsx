import React, { useState } from 'react';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { Box, X, ExternalLink } from 'lucide-react';

interface WelcomeModalProps {
    onClose: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose }) => {
    const [dontShowAgain, setDontShowAgain] = useState(() => {
        return !!localStorage.getItem('welcome_modal_dismissed');
    });

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
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-6 animate-in zoom-in-95 duration-300 slide-in-from-bottom-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-1">
                            Welcome to GrippySheet Studio
                        </h2>
                        <p className="text-gray-400 text-sm">Design custom printable grip tape patterns</p>
                    </div>
                    <button 
                        onClick={handleClose}
                        className="text-gray-500 hover:text-white transition-colors p-1"
                    >
                        <X size={24} />
                    </button>
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
                </div>

                {/* Footer / Actions */}
                <div className="pt-2">
                    <button
                        onClick={handleClose}
                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-purple-900/20 active:scale-[0.98] transition-all"
                    >
                        Get Started
                    </button>
                    
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
                </div>
            </div>
        </div>
    );
};
