import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import AlertModal, { AlertType } from '../components/AlertModal';

interface AlertOptions {
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

interface AlertContextType {
    showAlert: (options: AlertOptions) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<AlertOptions | null>(null);

    // Stable identity so consumers can put `showAlert` in effect deps without
    // re-firing those effects on every provider render.
    const showAlert = useCallback((newOptions: AlertOptions) => {
        setOptions(newOptions);
        setIsOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        // Clear options after animation to prevent content jumping
        setTimeout(() => setOptions(null), 300);
    }, []);

    // Memoize the context value so its identity only changes when `showAlert`
    // does (which is never, given the empty deps above).
    const value = useMemo(() => ({ showAlert }), [showAlert]);

    return (
        <AlertContext.Provider value={value}>
            {children}
            {options && (
                <AlertModal
                    isOpen={isOpen}
                    onClose={handleClose}
                    {...options}
                />
            )}
        </AlertContext.Provider>
    );
};

export const useAlert = () => {
    const context = useContext(AlertContext);
    if (!context) {
        throw new Error('useAlert must be used within an AlertProvider');
    }
    return context;
};
