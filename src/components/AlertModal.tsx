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

    const getIcon = () => {
        switch (type) {
            case 'warning': return <AlertTriangle size={24} className="text-amber-400" />;
            case 'error': return <XCircle size={24} className="text-red-400" />;
            default: return <Info size={24} className="text-blue-400" />;
        }
    };

    const getBgColor = () => {
        switch (type) {
            case 'warning': return 'bg-amber-400/10';
            case 'error': return 'bg-red-400/10';
            default: return 'bg-blue-400/10';
        }
    };

    const getConfirmBtnColor = () => {
         switch (type) {
            case 'warning': return 'bg-amber-600 hover:bg-amber-700';
            case 'error': return 'bg-red-500 hover:bg-red-600';
            default: return 'bg-blue-600 hover:bg-blue-700';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                         <div className={`p-2 rounded-lg ${getBgColor()}`}>
                            {getIcon()}
                         </div>
                         <h3 className="text-lg font-bold text-white leading-tight">{title}</h3>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
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
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 placeholder-gray-500 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (onConfirm) onConfirm(inputValue);
                                onClose();
                            }
                        }}
                    />
                )}
                
                <div className="flex items-center gap-3 pt-2">
                    {cancelText && (
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onConfirm) onConfirm(inputType ? inputValue : undefined);
                            onClose();
                        }}
                        className={`flex-1 px-4 py-2 text-white rounded-lg font-medium transition-colors ${getConfirmBtnColor()}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertModal;
