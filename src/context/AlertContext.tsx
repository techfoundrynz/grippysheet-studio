import React, { createContext, useContext, useState, ReactNode } from 'react';
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

    const showAlert = (newOptions: AlertOptions) => {
        setOptions(newOptions);
        setIsOpen(true);
    };

    const handleClose = () => {
        setIsOpen(false);
        // Clear options after animation to prevent content jumping
        setTimeout(() => setOptions(null), 300);
    };

    return (
        <AlertContext.Provider value={{ showAlert }}>
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
