import React, { useState } from 'react';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { Box, X, ExternalLink, ChevronDown, HelpCircle, Sparkles, Wrench } from 'lucide-react';
import Button from './ui/Button';

interface WelcomeModalProps {
    onClose: () => void;
}

// Dismissal key is versioned so we can re-surface the modal once when shipping
// a batch of user-visible features. Bumping the suffix forces returning users
// who previously dismissed v1 to see the new "What's new" section a single
// time. The old `welcome_modal_dismissed` key is left in place — no migration
// toast/banner; it just stops being read.
const DISMISSAL_KEY = 'welcome_modal_dismissed_v2';

const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose }) => {
    const [dontShowAgain, setDontShowAgain] = useState(() => {
        return !!localStorage.getItem(DISMISSAL_KEY);
    });
    const [showHelp, setShowHelp] = useState(false);

    const handleClose = () => {
        if (dontShowAgain) {
            localStorage.setItem(DISMISSAL_KEY, 'true');
        } else {
            localStorage.removeItem(DISMISSAL_KEY);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto custom-scrollbar p-6 space-y-6 animate-in zoom-in-95 duration-300 slide-in-from-bottom-4 flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="font-display text-2xl font-bold tracking-tight mb-1">
                            <span className="text-gray-300">Welcome to </span>
                            <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-accent-500 bg-clip-text text-transparent">GRIPPY</span>
                            <span className="text-gray-100">SHEET</span>
                            <span className="text-signal-ready text-xs font-mono font-semibold ml-1.5 align-top tracking-widest">STUDIO</span>
                        </h2>
                        <p className="text-gray-400 text-sm font-mono">// custom grip tape for onewheel &amp; friends</p>
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
                <div className="space-y-4">
                    {/* Two-mode feature grid — the core value prop in 2 cards.
                        The pattern mode + ColorFlow mode are the two creative
                        paths; surface them up front instead of burying them
                        in body copy. */}
                    <div className="grid grid-cols-2 gap-2.5">
                        <div className="rounded-xl bg-gradient-to-br from-brand-500/10 via-gray-900 to-gray-900 border border-brand-500/30 p-3.5 ring-1 ring-inset ring-white/5">
                            <div className="flex items-center gap-1.5 mb-2">
                                <span className="text-[10px] font-mono text-brand-400 tracking-widest">01</span>
                                <span className="text-brand-300 font-display font-bold text-sm tracking-wide">PATTERN</span>
                            </div>
                            <p className="text-[11px] text-gray-400 leading-snug">
                                Tile a tactile bump pattern (dots, hex, pyramids) across the deck. Add inlay logos with custom transforms.
                            </p>
                        </div>
                        <div className="rounded-xl bg-gradient-to-br from-accent-500/10 via-gray-900 to-gray-900 border border-accent-500/30 p-3.5 ring-1 ring-inset ring-white/5">
                            <div className="flex items-center gap-1.5 mb-2">
                                <span className="text-[10px] font-mono text-accent-500 tracking-widest">02</span>
                                <span className="text-accent-500 font-display font-bold text-sm tracking-wide">COLORFLOW</span>
                            </div>
                            <p className="text-[11px] text-gray-400 leading-snug">
                                Drop an image — quantize it into <span className="text-signal-ready">stacked color layers</span> for multi-filament print.
                            </p>
                        </div>
                    </div>

                    {/* "What's new" — secondary callout. No card chrome, just a
                        subtle cyan-tinted gradient strip so it reads as
                        telemetry/recent rather than a primary mode card. */}
                    <div className="rounded-xl bg-gradient-to-r from-signal-info/10 via-signal-info/[0.04] to-transparent border border-signal-info/20 px-3.5 py-3">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Sparkles size={11} className="text-signal-info" />
                            <span className="text-[10px] font-mono text-signal-info tracking-widest font-semibold">WHAT'S NEW</span>
                        </div>
                        <ul className="space-y-1.5 text-[11px] text-gray-300 leading-snug">
                            <li className="flex items-center gap-2">
                                <span className="text-sm leading-none" aria-hidden>📥</span>
                                <span>Drop image/DXF/3MF anywhere to load it</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="text-sm leading-none" aria-hidden>💾</span>
                                <span>Auto-save: refresh-safe with Resume banner</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="text-sm leading-none" aria-hidden>♻</span>
                                <span>3MF round-trip — print AND edit later</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <kbd className="font-mono text-[9px] text-gray-300 bg-gray-800 border border-gray-700 rounded px-1 py-px leading-none">⌘</kbd>
                                <span>Shortcuts: <span className="font-mono text-gray-200">2</span>/<span className="font-mono text-gray-200">3</span> mode · <span className="font-mono text-gray-200">O</span>/<span className="font-mono text-gray-200">I</span> cam · <span className="font-mono text-gray-200">F</span> FPS</span>
                            </li>
                        </ul>
                    </div>

                    <div className="grid gap-2.5">
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
                                <h3 className="font-semibold text-gray-200 text-sm">Source on GitHub</h3>
                                <p className="text-[11px] text-gray-400">Open source · star to support</p>
                            </div>
                            <ExternalLink size={14} className="text-gray-500 group-hover:text-signal-info transition-colors" />
                         </a>

                         <a
                            href="https://www.printables.com/model/968803-onewheel-grip-tape-dxf-outlines"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-4 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-all group"
                         >
                             <div className="p-2 bg-brand-500/10 rounded-lg group-hover:bg-brand-500/20 transition-colors text-brand-400">
                                <Box size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-200 text-sm">DXF Templates</h3>
                                <p className="text-[11px] text-gray-400">More deck outlines on Printables</p>
                            </div>
                            <ExternalLink size={14} className="text-gray-500 group-hover:text-brand-400 transition-colors" />
                         </a>

                         <a
                            href="https://repairflow.dev/?utm_source=grippysheet&utm_medium=referral&utm_content=welcome-modal"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-4 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-all group"
                         >
                             <div className="p-2 bg-accent-500/10 rounded-lg group-hover:bg-accent-500/20 transition-colors text-accent-500">
                                <Wrench size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-200 text-sm">Built with RepairFlow</h3>
                                <p className="text-[11px] text-gray-400">Features &amp; fixes by the RepairFlow team</p>
                            </div>
                            <ExternalLink size={14} className="text-gray-500 group-hover:text-accent-500 transition-colors" />
                         </a>
                    </div>

                    <div className="pt-4 border-t border-gray-800">
                        <button 
                            onClick={() => setShowHelp(!showHelp)}
                            className="flex items-center justify-between w-full text-left group"
                        >
                            <h3 className="text-sm font-semibold text-gray-200 group-hover:text-brand-400 transition-colors">How to use this tool</h3>
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
                        className="w-full font-display font-bold tracking-wide rounded-xl active:scale-[0.98]"
                    >
                        Get Started
                    </Button>
                    
                    <div className="mt-4 flex justify-center">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    className="peer h-4 w-4 rounded border-gray-600 bg-gray-700 text-brand-500 focus:ring-brand-500/50 focus:ring-offset-gray-900 transition-all accent-brand-500"
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
