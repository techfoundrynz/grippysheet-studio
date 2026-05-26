import React from 'react';
import { AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type AlertType = 'info' | 'warning' | 'error';

interface AlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    message: string;
    type?: AlertType;
    confirmText?: string;
    cancelText?: string;
    inputType?: 'text' | 'number';
    inputPlaceholder?: string;
    defaultValue?: string;
    onConfirm?: (value?: string) => void;
}

const AlertModal: React.FC<AlertModalProps> = ({
    isOpen,
    onClose,
    title,
    message,
    type = 'info',
    confirmText = 'Confirm',
    cancelText,
    onConfirm,
    inputType,
    inputPlaceholder,
    defaultValue = ''
}) => {
    const [inputValue, setInputValue] = React.useState(defaultValue);

    // Reset input value when modal opens
    React.useEffect(() => {
        if (isOpen) setInputValue(defaultValue);
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    // Brand-aligned tone palette — matches the signal-* tokens used by the
    // status footer + toast pills so the alert reads as part of the same
    // visual system rather than a generic Tailwind dialog.
    const tone = (() => {
        switch (type) {
            case 'warning': return { icon: <AlertTriangle size={22} className="text-signal-pending" />, halo: 'bg-signal-pending/15 ring-1 ring-signal-pending/30', confirm: 'bg-signal-pending/90 hover:bg-signal-pending text-gray-950' };
            case 'error':   return { icon: <XCircle size={22} className="text-signal-error" />, halo: 'bg-signal-error/15 ring-1 ring-signal-error/30', confirm: 'bg-signal-error hover:bg-signal-error/90 text-white' };
            default:        return { icon: <Info size={22} className="text-signal-info" />, halo: 'bg-signal-info/15 ring-1 ring-signal-info/30', confirm: 'bg-gradient-to-br from-brand-500 to-accent-500 hover:from-brand-400 hover:to-accent-500 text-white shadow-glow-brand ring-1 ring-white/15' };
        }
    })();

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl ring-1 ring-black/40 max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                         <div className={`p-2 rounded-lg ${tone.halo}`}>
                            {tone.icon}
                         </div>
                         <h3 className="font-display text-lg font-bold tracking-tight text-white leading-tight truncate">{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white hover:bg-gray-800 rounded-md p-1 transition-colors"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {message}
                </p>

                {inputType && (
                    <input
                        type={inputType}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={inputPlaceholder}
                        className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-gray-100 font-mono text-sm focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20 placeholder-gray-500"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (onConfirm) onConfirm(inputValue);
                                onClose();
                            }
                        }}
                    />
                )}

                <div className="flex items-center gap-2 pt-1">
                    {cancelText && (
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg font-medium transition-all"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) onConfirm(inputType ? inputValue : undefined);
                            onClose();
                        }}
                        className={`flex-1 px-4 py-2 rounded-lg font-display font-bold tracking-wide transition-all ${tone.confirm}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertModal;
