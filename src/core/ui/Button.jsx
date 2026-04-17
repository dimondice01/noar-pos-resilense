import React from 'react';
import { cn } from '../utils/cn';

export const Button = ({ children, variant = 'primary', size = 'md', className, ...props }) => {
  const baseStyles = "inline-flex items-center justify-center gap-2 font-medium rounded-button transition-all duration-base ease-smooth active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none";

  const variants = {
    primary:   "bg-brand text-text-inverse hover:bg-brand-hover shadow-brand",
    secondary: "bg-surface-base text-text-primary border border-border-default hover:bg-surface-overlay shadow-xs",
    ghost:     "bg-transparent text-text-secondary hover:text-text-primary hover:bg-sys-100",
    danger:    "bg-pos-error text-text-inverse hover:bg-red-700 shadow-soft",
    success:   "bg-pos-success text-text-inverse hover:bg-green-700 shadow-soft",
    outline:   "bg-transparent text-brand border border-brand hover:bg-brand-light",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-5 py-3 text-base",
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
};