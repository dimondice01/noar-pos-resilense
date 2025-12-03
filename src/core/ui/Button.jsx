import React from 'react';
import { cn } from '../utils/cn';

export const Button = ({ children, variant = 'primary', className, ...props }) => {
  const baseStyles = "inline-flex items-center justify-center px-4 py-3 rounded-xl font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover shadow-lg shadow-brand/20",
    secondary: "bg-white text-sys-800 border border-sys-200 hover:bg-sys-50 shadow-sm",
    ghost: "bg-transparent text-sys-500 hover:text-sys-800 hover:bg-sys-100",
    danger: "bg-pos-error text-white hover:bg-red-600 shadow-lg shadow-red-500/20"
  };

  return (
    <button 
      className={cn(baseStyles, variants[variant], className)} 
      {...props}
    >
      {children}
    </button>
  );
};