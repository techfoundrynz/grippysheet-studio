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
    onConfirm?: () => void;
}

export const AlertModal: React.FC<AlertModalProps> = ({
    isOpen,
    onClose,
    title,
    message,
    type = 'info',
    confirmText = 'Confirm',
    cancelText,
    onConfirm
}) => {
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
                            if (onConfirm) onConfirm();
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
